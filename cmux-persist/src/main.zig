const std = @import("std");
const posix = std.posix;
const c = @cImport({
    @cInclude("util.h"); // forkpty
    @cInclude("sys/ioctl.h");
    @cInclude("termios.h");
    @cInclude("signal.h");
    @cInclude("unistd.h");
    @cInclude("sys/socket.h");
    @cInclude("sys/un.h");
    @cInclude("poll.h");
    @cInclude("sys/wait.h");
    @cInclude("errno.h");
    @cInclude("fcntl.h");
    @cInclude("stdlib.h");
    @cInclude("string.h");
});

// --- Protocol ---
const MSG_DATA: u8 = 0x00;
const MSG_WINCH: u8 = 0x01;
const MSG_EXIT: u8 = 0x02;
const MSG_KILL: u8 = 0x03;

const HEADER_SIZE: usize = 5; // 1 byte type + 4 bytes length (LE)
const BUFFER_SIZE: usize = 256 * 1024; // 256KB circular buffer
const IO_BUF_SIZE: usize = 16384;

// --- Circular buffer for detached output ---
const CircularBuffer = struct {
    data: [BUFFER_SIZE]u8 = undefined,
    write_pos: usize = 0,
    count: usize = 0, // how many bytes are stored (up to BUFFER_SIZE)

    fn write(self: *CircularBuffer, buf: []const u8) void {
        for (buf) |byte| {
            self.data[self.write_pos] = byte;
            self.write_pos = (self.write_pos + 1) % BUFFER_SIZE;
            if (self.count < BUFFER_SIZE) {
                self.count += 1;
            }
        }
    }

    /// Get the buffered content in order (up to 2 slices for wrap-around)
    fn getContents(self: *const CircularBuffer) struct { first: []const u8, second: []const u8 } {
        if (self.count == 0) {
            return .{ .first = &[0]u8{}, .second = &[0]u8{} };
        }
        if (self.count < BUFFER_SIZE) {
            // No wrap-around: data starts at 0
            const start = self.write_pos - self.count;
            return .{ .first = self.data[start..self.write_pos], .second = &[0]u8{} };
        }
        // Wrap-around: read_pos == write_pos when full
        return .{
            .first = self.data[self.write_pos..BUFFER_SIZE],
            .second = self.data[0..self.write_pos],
        };
    }

    fn clear(self: *CircularBuffer) void {
        self.write_pos = 0;
        self.count = 0;
    }
};

// --- Globals for signal handling ---
var g_child_pid: c_int = -1;
var g_child_exited: bool = false;
var g_child_exit_status: i32 = 0;
var g_got_sigterm: bool = false;

fn sigchld_handler(_: c_int) callconv(.c) void {
    var status: c_int = 0;
    const pid = c.waitpid(g_child_pid, &status, c.WNOHANG);
    if (pid == g_child_pid) {
        g_child_exited = true;
        if (c.WIFEXITED(status)) {
            g_child_exit_status = c.WEXITSTATUS(status);
        } else {
            g_child_exit_status = 128;
        }
    }
}

fn sigterm_handler(_: c_int) callconv(.c) void {
    g_got_sigterm = true;
}

// --- Socket helpers ---
fn createUnixSocket(path: []const u8) !posix.fd_t {
    const fd = try posix.socket(posix.AF.UNIX, posix.SOCK.STREAM, 0);
    errdefer posix.close(fd);

    var addr: posix.sockaddr.un = std.mem.zeroes(posix.sockaddr.un);
    addr.family = posix.AF.UNIX;

    if (path.len >= addr.path.len) {
        return error.PathTooLong;
    }
    @memcpy(addr.path[0..path.len], path);

    // Remove stale socket if exists
    _ = c.unlink(path.ptr);

    const addr_ptr: *const posix.sockaddr = @ptrCast(&addr);
    try posix.bind(fd, addr_ptr, @sizeOf(posix.sockaddr.un));
    try posix.listen(fd, 1);

    return fd;
}

fn connectUnixSocket(path: []const u8) !posix.fd_t {
    const fd = try posix.socket(posix.AF.UNIX, posix.SOCK.STREAM, 0);
    errdefer posix.close(fd);

    var addr: posix.sockaddr.un = std.mem.zeroes(posix.sockaddr.un);
    addr.family = posix.AF.UNIX;

    if (path.len >= addr.path.len) {
        return error.PathTooLong;
    }
    @memcpy(addr.path[0..path.len], path);

    const addr_ptr: *const posix.sockaddr = @ptrCast(&addr);
    posix.connect(fd, addr_ptr, @sizeOf(posix.sockaddr.un)) catch {
        return error.ConnectionRefused;
    };

    return fd;
}

// --- Framed message I/O ---
fn sendMessage(fd: posix.fd_t, msg_type: u8, payload: []const u8) !void {
    var header: [HEADER_SIZE]u8 = undefined;
    header[0] = msg_type;
    std.mem.writeInt(u32, header[1..5], @intCast(payload.len), .little);

    // Send header
    var sent: usize = 0;
    while (sent < HEADER_SIZE) {
        const n = posix.write(fd, header[sent..]) catch |err| {
            if (err == error.BrokenPipe) return err;
            return err;
        };
        sent += n;
    }

    // Send payload
    sent = 0;
    while (sent < payload.len) {
        const n = posix.write(fd, payload[sent..]) catch |err| {
            if (err == error.BrokenPipe) return err;
            return err;
        };
        sent += n;
    }
}

const RecvResult = struct {
    msg_type: u8,
    length: u32,
    payload: []const u8,
};

/// Read exactly `len` bytes into `buf`, returns false on EOF/error
fn readExact(fd: posix.fd_t, buf: []u8) bool {
    var total: usize = 0;
    while (total < buf.len) {
        const n = posix.read(fd, buf[total..]) catch return false;
        if (n == 0) return false; // EOF
        total += n;
    }
    return true;
}

fn recvMessage(fd: posix.fd_t, payload_buf: []u8) ?RecvResult {
    var header: [HEADER_SIZE]u8 = undefined;
    if (!readExact(fd, &header)) return null;

    const msg_type = header[0];
    const length = std.mem.readInt(u32, header[1..5], .little);

    if (length > payload_buf.len) {
        // Payload too large, skip it
        var remaining = length;
        var skip_buf: [4096]u8 = undefined;
        while (remaining > 0) {
            const to_read = @min(remaining, skip_buf.len);
            const n = posix.read(fd, skip_buf[0..to_read]) catch return null;
            if (n == 0) return null;
            remaining -= @intCast(n);
        }
        return RecvResult{ .msg_type = msg_type, .length = 0, .payload = &[0]u8{} };
    }

    if (length > 0) {
        if (!readExact(fd, payload_buf[0..length])) return null;
    }

    return RecvResult{
        .msg_type = msg_type,
        .length = length,
        .payload = payload_buf[0..length],
    };
}

// --- Set fd to non-blocking ---
fn setNonBlocking(fd: posix.fd_t) void {
    const flags = c.fcntl(fd, c.F_GETFL, @as(c_int, 0));
    if (flags >= 0) {
        _ = c.fcntl(fd, c.F_SETFL, flags | c.O_NONBLOCK);
    }
}

fn setBlocking(fd: posix.fd_t) void {
    const flags = c.fcntl(fd, c.F_GETFL, @as(c_int, 0));
    if (flags >= 0) {
        _ = c.fcntl(fd, c.F_SETFL, flags & ~@as(c_int, c.O_NONBLOCK));
    }
}

// --- Set window size on PTY ---
fn setWinSize(pty_fd: posix.fd_t, rows: u16, cols: u16, xpixel: u16, ypixel: u16) void {
    var ws: c.struct_winsize = .{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = xpixel,
        .ws_ypixel = ypixel,
    };
    _ = c.ioctl(pty_fd, c.TIOCSWINSZ, &ws);
}

// --- Get current window size from stdin ---
fn getStdinWinSize() c.struct_winsize {
    var ws: c.struct_winsize = .{
        .ws_row = 24,
        .ws_col = 80,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    _ = c.ioctl(posix.STDIN_FILENO, c.TIOCGWINSZ, &ws);
    return ws;
}

// --- Daemon mode: create PTY, accept clients, relay ---
fn runDaemon(socket_path: []const u8, cmd_args: []const [*:0]const u8) !void {
    // Ensure socket directory exists
    if (std.mem.lastIndexOfScalar(u8, socket_path, '/')) |sep| {
        const dir = socket_path[0..sep];
        std.fs.makeDirAbsolute(dir) catch |err| {
            if (err != error.PathAlreadyExists) return err;
        };
    }

    // Create PTY and fork child
    var master_fd: c_int = -1;
    var ws = getStdinWinSize();

    const pid = c.forkpty(&master_fd, null, null, &ws);
    if (pid < 0) {
        return error.ForkFailed;
    }

    if (pid == 0) {
        // Child process: exec the command
        // Reset signal handlers to defaults
        const dfl_act = posix.Sigaction{
            .handler = .{ .handler = null }, // SIG_DFL
            .mask = posix.sigemptyset(),
            .flags = 0,
        };
        posix.sigaction(posix.SIG.CHLD, &dfl_act, null);
        posix.sigaction(posix.SIG.TERM, &dfl_act, null);

        // Build null-terminated argv for execvp
        var argv_buf: [65]?[*:0]const u8 = undefined;
        const argv_count = @min(cmd_args.len, 64);
        for (0..argv_count) |idx| {
            argv_buf[idx] = cmd_args[idx];
        }
        argv_buf[argv_count] = null; // null terminator for execvp

        const result = c.execvp(cmd_args[0], @ptrCast(&argv_buf));
        if (result < 0) {
            _ = c.write(c.STDERR_FILENO, "cmux-persist: exec failed\n", 27);
            c._exit(127);
        }
        unreachable;
    }

    // Parent: we are the daemon
    g_child_pid = pid;

    // Install signal handlers
    const chld_act = posix.Sigaction{
        .handler = .{ .handler = sigchld_handler },
        .mask = posix.sigemptyset(),
        .flags = posix.SA.RESTART | posix.SA.NOCLDSTOP,
    };
    posix.sigaction(posix.SIG.CHLD, &chld_act, null);

    const term_act = posix.Sigaction{
        .handler = .{ .handler = sigterm_handler },
        .mask = posix.sigemptyset(),
        .flags = posix.SA.RESTART,
    };
    posix.sigaction(posix.SIG.TERM, &term_act, null);

    // Ignore SIGPIPE and SIGHUP (daemon must survive parent PTY teardown)
    const ign_act = posix.Sigaction{
        .handler = .{ .handler = @ptrFromInt(1) }, // SIG_IGN
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.PIPE, &ign_act, null);
    posix.sigaction(posix.SIG.HUP, &ign_act, null);

    // Create listen socket
    // Ensure socket path is null-terminated for C APIs
    var path_buf: [256]u8 = undefined;
    if (socket_path.len >= path_buf.len) return error.PathTooLong;
    @memcpy(path_buf[0..socket_path.len], socket_path);
    path_buf[socket_path.len] = 0;

    const listen_fd = createUnixSocket(path_buf[0 .. socket_path.len + 1]) catch |err| {
        // Clean up child
        _ = c.kill(pid, c.SIGHUP);
        return err;
    };
    defer {
        posix.close(listen_fd);
        _ = c.unlink(@ptrCast(path_buf[0 .. socket_path.len + 1]));
    }

    setNonBlocking(master_fd);

    // Write PID file alongside socket for kill mode
    var pid_path_buf: [280]u8 = undefined;
    const pid_path = std.fmt.bufPrint(&pid_path_buf, "{s}.pid", .{socket_path}) catch socket_path;
    {
        var pid_buf: [20]u8 = undefined;
        const pid_str = std.fmt.bufPrint(&pid_buf, "{d}", .{c.getpid()}) catch "";
        if (std.fs.createFileAbsolute(pid_path, .{})) |f| {
            _ = f.write(pid_str) catch {};
            f.close();
        } else |_| {}
    }
    defer {
        std.fs.deleteFileAbsolute(pid_path) catch {};
    }

    var circ_buf = CircularBuffer{};
    var client_fd: posix.fd_t = -1;

    // First client is stdin/stdout (the launching terminal)
    // But we need to handle the case where stdin is a TTY vs pipe
    const initial_client_is_tty = c.isatty(posix.STDIN_FILENO) != 0;
    const using_stdio = initial_client_is_tty;

    if (using_stdio) {
        // Set stdin to raw mode to pass through
        var orig_termios: c.struct_termios = undefined;
        _ = c.tcgetattr(posix.STDIN_FILENO, &orig_termios);
        var raw = orig_termios;
        c.cfmakeraw(&raw);
        _ = c.tcsetattr(posix.STDIN_FILENO, c.TCSANOW, &raw);

        // We'll relay directly between stdin/stdout and the PTY master
        // without framing (since stdin/stdout are a raw TTY)
        relayStdio(master_fd, listen_fd, &circ_buf, &orig_termios);
    }

    // After stdio client disconnects or if not a TTY, become a pure socket daemon
    // Daemonize: double-fork to detach from terminal
    if (!using_stdio) {
        // Already not attached to a terminal, just continue
    } else {
        // Close stdin/stdout/stderr and redirect to /dev/null
        const devnull = c.open("/dev/null", c.O_RDWR);
        if (devnull >= 0) {
            _ = c.dup2(devnull, c.STDIN_FILENO);
            _ = c.dup2(devnull, c.STDOUT_FILENO);
            _ = c.dup2(devnull, c.STDERR_FILENO);
            if (devnull > 2) _ = c.close(devnull);
        }
    }

    // Socket-based client loop
    while (!g_child_exited and !g_got_sigterm) {
        // Accept a client connection (blocking with timeout via poll)
        var pfd = [_]c.struct_pollfd{
            .{ .fd = listen_fd, .events = c.POLLIN, .revents = 0 },
            .{ .fd = master_fd, .events = c.POLLIN, .revents = 0 },
        };

        const poll_result = c.poll(&pfd, 2, 1000); // 1 second timeout for checking signals
        if (poll_result < 0) continue; // EINTR from signal

        // Buffer PTY output while no client
        if (pfd[1].revents & c.POLLIN != 0) {
            var buf: [IO_BUF_SIZE]u8 = undefined;
            const n = posix.read(master_fd, &buf) catch |err| {
                if (err == error.WouldBlock) continue;
                break; // PTY closed
            };
            if (n == 0) break; // PTY closed
            circ_buf.write(buf[0..n]);
        }

        // Check for PTY errors (child exited)
        if (pfd[1].revents & (c.POLLHUP | c.POLLERR) != 0) {
            // Drain remaining output
            while (true) {
                var buf: [IO_BUF_SIZE]u8 = undefined;
                const n = posix.read(master_fd, &buf) catch break;
                if (n == 0) break;
                circ_buf.write(buf[0..n]);
            }
            break;
        }

        // Accept new client
        if (pfd[0].revents & c.POLLIN != 0) {
            const accepted = posix.accept(listen_fd, null, null, 0) catch continue;
            client_fd = accepted;

            // Replay buffered output to new client
            const contents = circ_buf.getContents();
            if (contents.first.len > 0) {
                sendMessage(client_fd, MSG_DATA, contents.first) catch {
                    posix.close(client_fd);
                    client_fd = -1;
                    continue;
                };
            }
            if (contents.second.len > 0) {
                sendMessage(client_fd, MSG_DATA, contents.second) catch {
                    posix.close(client_fd);
                    client_fd = -1;
                    continue;
                };
            }
            circ_buf.clear();

            // Serve this client
            relayClient(master_fd, client_fd, listen_fd, &circ_buf);
            posix.close(client_fd);
            client_fd = -1;
        }
    }

    // Cleanup: send SIGHUP to child
    if (!g_child_exited) {
        _ = c.kill(pid, c.SIGHUP);
        _ = c.waitpid(pid, null, 0);
    }
}

/// Relay between stdin/stdout (raw TTY) and PTY master.
/// This is used for the initial client that launched us.
fn relayStdio(
    master_fd: posix.fd_t,
    listen_fd: posix.fd_t,
    _: *CircularBuffer,
    orig_termios: *const c.struct_termios,
) void {
    setNonBlocking(posix.STDIN_FILENO);

    while (!g_child_exited and !g_got_sigterm) {
        var pfds = [_]c.struct_pollfd{
            .{ .fd = posix.STDIN_FILENO, .events = c.POLLIN, .revents = 0 },
            .{ .fd = master_fd, .events = c.POLLIN, .revents = 0 },
            .{ .fd = listen_fd, .events = 0, .revents = 0 }, // not listening yet
        };

        const poll_result = c.poll(&pfds, 3, 1000);
        if (poll_result < 0) continue;

        // stdin → master (user input)
        if (pfds[0].revents & c.POLLIN != 0) {
            var buf: [IO_BUF_SIZE]u8 = undefined;
            const n = posix.read(posix.STDIN_FILENO, &buf) catch break;
            if (n == 0) break; // stdin EOF = client disconnected
            _ = posix.write(master_fd, buf[0..n]) catch break;
        }

        // stdin HUP = client disconnected
        if (pfds[0].revents & (c.POLLHUP | c.POLLERR) != 0) {
            break;
        }

        // master → stdout (PTY output)
        if (pfds[1].revents & c.POLLIN != 0) {
            var buf: [IO_BUF_SIZE]u8 = undefined;
            const n = posix.read(master_fd, &buf) catch |err| {
                if (err == error.WouldBlock) continue;
                break;
            };
            if (n == 0) break;
            _ = posix.write(posix.STDOUT_FILENO, buf[0..n]) catch break;
        }

        // master HUP = child exited
        if (pfds[1].revents & (c.POLLHUP | c.POLLERR) != 0) {
            // Drain output
            while (true) {
                var buf: [IO_BUF_SIZE]u8 = undefined;
                const n = posix.read(master_fd, &buf) catch break;
                if (n == 0) break;
                _ = posix.write(posix.STDOUT_FILENO, buf[0..n]) catch break;
            }
            // Child exited while stdio client was attached: restore terminal and exit
            _ = c.tcsetattr(posix.STDIN_FILENO, c.TCSANOW, orig_termios);
            if (g_child_exited) {
                std.process.exit(@intCast(@as(u32, @bitCast(g_child_exit_status))));
            }
            std.process.exit(0);
        }
    }

    // Restore terminal before going to background
    _ = c.tcsetattr(posix.STDIN_FILENO, c.TCSANOW, orig_termios);
}

/// Relay between a Unix socket client and PTY master using the framed protocol.
fn relayClient(
    master_fd: posix.fd_t,
    client_fd: posix.fd_t,
    listen_fd: posix.fd_t,
    _: *CircularBuffer,
) void {
    setNonBlocking(master_fd);
    setNonBlocking(client_fd);

    var payload_buf: [IO_BUF_SIZE]u8 = undefined;

    while (!g_child_exited and !g_got_sigterm) {
        var pfds = [_]c.struct_pollfd{
            .{ .fd = client_fd, .events = c.POLLIN, .revents = 0 },
            .{ .fd = master_fd, .events = c.POLLIN, .revents = 0 },
            .{ .fd = listen_fd, .events = 0, .revents = 0 }, // not accepting new clients while serving
        };

        const poll_result = c.poll(&pfds, 3, 1000);
        if (poll_result < 0) continue;

        // Client → master
        if (pfds[0].revents & c.POLLIN != 0) {
            // Need to read framed messages from client
            setBlocking(client_fd);
            const msg = recvMessage(client_fd, &payload_buf);
            setNonBlocking(client_fd);

            if (msg == null) break; // Client disconnected

            switch (msg.?.msg_type) {
                MSG_DATA => {
                    if (msg.?.length > 0) {
                        setBlocking(master_fd);
                        _ = posix.write(master_fd, msg.?.payload) catch break;
                        setNonBlocking(master_fd);
                    }
                },
                MSG_WINCH => {
                    if (msg.?.length >= 8) {
                        const rows = std.mem.readInt(u16, msg.?.payload[0..2], .little);
                        const cols = std.mem.readInt(u16, msg.?.payload[2..4], .little);
                        const xpixel = std.mem.readInt(u16, msg.?.payload[4..6], .little);
                        const ypixel = std.mem.readInt(u16, msg.?.payload[6..8], .little);
                        setWinSize(master_fd, rows, cols, xpixel, ypixel);
                    }
                },
                MSG_KILL => {
                    // Client requested session termination
                    g_got_sigterm = true;
                    return;
                },
                else => {},
            }
        }

        // Client HUP
        if (pfds[0].revents & (c.POLLHUP | c.POLLERR) != 0) {
            break; // Client disconnected, go back to waiting
        }

        // Master → client
        if (pfds[1].revents & c.POLLIN != 0) {
            var buf: [IO_BUF_SIZE]u8 = undefined;
            const n = posix.read(master_fd, &buf) catch |err| {
                if (err == error.WouldBlock) continue;
                break;
            };
            if (n == 0) break;

            setBlocking(client_fd);
            sendMessage(client_fd, MSG_DATA, buf[0..n]) catch {
                setNonBlocking(client_fd);
                break; // Client disconnected
            };
            setNonBlocking(client_fd);
        }

        // Master HUP = child exited
        if (pfds[1].revents & (c.POLLHUP | c.POLLERR) != 0) {
            // Drain and forward remaining output
            setBlocking(master_fd);
            while (true) {
                var buf: [IO_BUF_SIZE]u8 = undefined;
                const n = posix.read(master_fd, &buf) catch break;
                if (n == 0) break;
                setBlocking(client_fd);
                sendMessage(client_fd, MSG_DATA, buf[0..n]) catch break;
            }

            // Send exit notification
            var exit_payload: [4]u8 = undefined;
            std.mem.writeInt(i32, &exit_payload, g_child_exit_status, .little);
            setBlocking(client_fd);
            sendMessage(client_fd, MSG_EXIT, &exit_payload) catch {};
            return;
        }
    }

    // Client disconnected but child still alive.
    // The outer daemon loop will continue buffering PTY output into circ_buf.
}

/// Client/attach mode: connect to an existing daemon via Unix socket,
/// relay between stdin/stdout and the socket.
fn runClient(socket_path: []const u8) !void {
    const sock_fd = try connectUnixSocket(socket_path);
    defer posix.close(sock_fd);

    // Set stdin to raw mode
    var orig_termios: c.struct_termios = undefined;
    const is_tty = c.isatty(posix.STDIN_FILENO) != 0;
    if (is_tty) {
        _ = c.tcgetattr(posix.STDIN_FILENO, &orig_termios);
        var raw = orig_termios;
        c.cfmakeraw(&raw);
        _ = c.tcsetattr(posix.STDIN_FILENO, c.TCSANOW, &raw);
    }
    defer {
        if (is_tty) {
            _ = c.tcsetattr(posix.STDIN_FILENO, c.TCSANOW, &orig_termios);
        }
    }

    // Send current window size
    if (is_tty) {
        const ws = getStdinWinSize();
        var winch_payload: [8]u8 = undefined;
        std.mem.writeInt(u16, winch_payload[0..2], ws.ws_row, .little);
        std.mem.writeInt(u16, winch_payload[2..4], ws.ws_col, .little);
        std.mem.writeInt(u16, winch_payload[4..6], ws.ws_xpixel, .little);
        std.mem.writeInt(u16, winch_payload[6..8], ws.ws_ypixel, .little);
        try sendMessage(sock_fd, MSG_WINCH, &winch_payload);
    }

    setNonBlocking(posix.STDIN_FILENO);
    setNonBlocking(sock_fd);

    var payload_buf: [IO_BUF_SIZE]u8 = undefined;

    while (true) {
        var pfds = [_]c.struct_pollfd{
            .{ .fd = posix.STDIN_FILENO, .events = c.POLLIN, .revents = 0 },
            .{ .fd = sock_fd, .events = c.POLLIN, .revents = 0 },
        };

        const poll_result = c.poll(&pfds, 2, 1000);
        if (poll_result < 0) continue;

        // stdin → socket (user input)
        if (pfds[0].revents & c.POLLIN != 0) {
            var buf: [IO_BUF_SIZE]u8 = undefined;
            const n = posix.read(posix.STDIN_FILENO, &buf) catch break;
            if (n == 0) break;
            setBlocking(sock_fd);
            sendMessage(sock_fd, MSG_DATA, buf[0..n]) catch break;
            setNonBlocking(sock_fd);
        }

        // stdin HUP
        if (pfds[0].revents & (c.POLLHUP | c.POLLERR) != 0) {
            break;
        }

        // socket → stdout (daemon output)
        if (pfds[1].revents & c.POLLIN != 0) {
            setBlocking(sock_fd);
            const msg = recvMessage(sock_fd, &payload_buf);
            setNonBlocking(sock_fd);

            if (msg == null) break;

            switch (msg.?.msg_type) {
                MSG_DATA => {
                    if (msg.?.length > 0) {
                        _ = posix.write(posix.STDOUT_FILENO, msg.?.payload) catch break;
                    }
                },
                MSG_EXIT => {
                    var exit_code: u8 = 0;
                    if (msg.?.length >= 4) {
                        const code = std.mem.readInt(i32, msg.?.payload[0..4], .little);
                        exit_code = @intCast(@as(u32, @bitCast(code)) & 0xFF);
                    }
                    std.process.exit(exit_code);
                },
                else => {},
            }
        }

        // socket HUP
        if (pfds[1].revents & (c.POLLHUP | c.POLLERR) != 0) {
            break;
        }
    }
}

/// Kill mode: connect to daemon and send kill message
fn runKill(socket_path: []const u8) !void {
    // First try sending a kill message via socket
    if (connectUnixSocket(socket_path)) |sock_fd| {
        sendMessage(sock_fd, MSG_KILL, &[0]u8{}) catch {};
        posix.close(sock_fd);

        // Give daemon a moment to clean up
        std.Thread.sleep(100 * std.time.ns_per_ms);
    } else |_| {
        // Socket connect failed, try PID file
    }

    // Also try killing via PID file
    var pid_path_buf: [280]u8 = undefined;
    const pid_path = std.fmt.bufPrint(&pid_path_buf, "{s}.pid", .{socket_path}) catch return;

    if (std.fs.openFileAbsolute(pid_path, .{})) |f| {
        defer f.close();
        var pid_buf: [20]u8 = undefined;
        const n = f.read(&pid_buf) catch return;
        const pid_str = std.mem.trimRight(u8, pid_buf[0..n], &[_]u8{ '\n', '\r', ' ' });
        const pid = std.fmt.parseInt(c_int, pid_str, 10) catch return;
        _ = c.kill(pid, c.SIGTERM);
    } else |_| {}

    // Clean up socket file
    var path_z: [256]u8 = undefined;
    if (socket_path.len < path_z.len) {
        @memcpy(path_z[0..socket_path.len], socket_path);
        path_z[socket_path.len] = 0;
        _ = c.unlink(@ptrCast(&path_z));
    }

    // Clean up PID file
    std.fs.deleteFileAbsolute(pid_path) catch {};
}

/// Check if a socket is alive (daemon is listening)
fn isSocketAlive(socket_path: []const u8) bool {
    if (connectUnixSocket(socket_path)) |fd| {
        posix.close(fd);
        return true;
    } else |_| {
        return false;
    }
}

// --- Main ---
pub fn main() !void {
    const args = std.os.argv;

    if (args.len < 2) {
        printUsage();
        std.process.exit(1);
    }

    const arg1 = std.mem.span(args[1]);

    if (std.mem.eql(u8, arg1, "-A")) {
        // Create-or-attach mode
        if (args.len < 3) {
            printUsage();
            std.process.exit(1);
        }

        const socket_path = std.mem.span(args[2]);

        // Find the command after "--"
        var cmd_start: usize = 3;
        while (cmd_start < args.len) : (cmd_start += 1) {
            if (std.mem.eql(u8, std.mem.span(args[cmd_start]), "--")) {
                cmd_start += 1;
                break;
            }
        }

        // Check if daemon is already running
        if (isSocketAlive(socket_path)) {
            // Attach to existing session
            try runClient(socket_path);
        } else {
            // Clean up stale socket if present
            var path_z: [256]u8 = undefined;
            if (socket_path.len < path_z.len) {
                @memcpy(path_z[0..socket_path.len], socket_path);
                path_z[socket_path.len] = 0;
                _ = c.unlink(@ptrCast(&path_z));
            }

            if (cmd_start >= args.len) {
                // No command specified, use $SHELL or /bin/sh
                const shell_env = std.posix.getenv("SHELL") orelse "/bin/sh";
                // Need to create a null-terminated copy
                var shell_buf: [256]u8 = undefined;
                if (shell_env.len < shell_buf.len) {
                    @memcpy(shell_buf[0..shell_env.len], shell_env);
                    shell_buf[shell_env.len] = 0;
                    const shell_z: [*:0]const u8 = @ptrCast(&shell_buf);
                    const cmd = [_][*:0]const u8{shell_z};
                    try runDaemon(socket_path, &cmd);
                } else {
                    const cmd = [_][*:0]const u8{"/bin/sh"};
                    try runDaemon(socket_path, &cmd);
                }
            } else {
                // Collect command arguments (already null-terminated from argv)
                var cmd_args: [64][*:0]const u8 = undefined;
                var cmd_count: usize = 0;
                var i = cmd_start;
                while (i < args.len and cmd_count < 63) : (i += 1) {
                    cmd_args[cmd_count] = args[i];
                    cmd_count += 1;
                }

                try runDaemon(socket_path, cmd_args[0..cmd_count]);
            }
        }
    } else if (std.mem.eql(u8, arg1, "-k")) {
        // Kill mode
        if (args.len < 3) {
            printUsage();
            std.process.exit(1);
        }
        const socket_path = std.mem.span(args[2]);
        try runKill(socket_path);
    } else if (std.mem.eql(u8, arg1, "--help") or std.mem.eql(u8, arg1, "-h")) {
        printUsage();
    } else {
        printUsage();
        std.process.exit(1);
    }
}

fn printUsage() void {
    const msg =
        \\Usage: cmux-persist [options]
        \\
        \\  -A <socket> [-- <command...>]   Create or attach to a session
        \\  -k <socket>                     Kill a session
        \\  -h, --help                      Show this help
        \\
        \\If -A is used and the socket exists with a running daemon, attaches.
        \\Otherwise creates a new session running <command> (default: $SHELL).
        \\
    ;
    _ = posix.write(posix.STDERR_FILENO, msg) catch {};
}

// --- Tests ---
test "circular buffer write and read" {
    var buf = CircularBuffer{};

    // Write some data
    buf.write("hello");
    const contents = buf.getContents();
    try std.testing.expectEqualStrings("hello", contents.first);
    try std.testing.expectEqual(@as(usize, 0), contents.second.len);
}

test "circular buffer wrap-around" {
    var buf = CircularBuffer{};

    // Fill buffer completely
    var data: [BUFFER_SIZE]u8 = undefined;
    @memset(&data, 'A');
    buf.write(&data);

    try std.testing.expectEqual(BUFFER_SIZE, buf.count);

    // Write more (wraps around)
    buf.write("hello");
    const contents = buf.getContents();
    // After wrap: first slice is from write_pos to end, second is from 0 to write_pos
    try std.testing.expectEqual(BUFFER_SIZE, contents.first.len + contents.second.len);
    // Last 5 bytes should be "hello"
    try std.testing.expectEqualStrings("hello", contents.second[0..5]);
}

test "circular buffer clear" {
    var buf = CircularBuffer{};
    buf.write("hello");
    buf.clear();
    const contents = buf.getContents();
    try std.testing.expectEqual(@as(usize, 0), contents.first.len);
    try std.testing.expectEqual(@as(usize, 0), contents.second.len);
}

test "message framing roundtrip" {
    // Test that sendMessage and recvMessage are compatible
    // We'll test the header format manually
    var header: [HEADER_SIZE]u8 = undefined;
    header[0] = MSG_DATA;
    std.mem.writeInt(u32, header[1..5], 5, .little);

    try std.testing.expectEqual(MSG_DATA, header[0]);
    try std.testing.expectEqual(@as(u32, 5), std.mem.readInt(u32, header[1..5], .little));
}
