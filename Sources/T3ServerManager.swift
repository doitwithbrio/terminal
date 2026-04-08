import Foundation

/// Manages the lifecycle of the bundled T3 Code backend server.
///
/// The server runs as a child process using the bundled Bun (or Node) runtime,
/// executing the pre-built T3 Code server entry point. It binds to a dynamic
/// loopback port and communicates with the T3 Code frontend via HTTP + WebSocket.
///
/// Lifecycle:
///   - Lazily started when the first T3 Code panel is created.
///   - Kept alive while any T3 Code panel exists.
///   - Stopped with a grace period after the last panel closes.
@MainActor
final class T3ServerManager {
    static let shared = T3ServerManager()

    // MARK: - Public state

    /// Whether the server process is currently running.
    private(set) var isRunning: Bool = false

    /// Whether the server has been confirmed responding to HTTP requests.
    /// Set to true after first successful probe, false on termination.
    var isReady: Bool = false

    /// The loopback port the server is listening on, or nil if not running.
    private(set) var port: UInt16?

    /// Random auth token required for WebSocket connections.
    private(set) var authToken: String = ""

    /// HTTP base URL for the server (e.g. http://127.0.0.1:PORT).
    var serverURL: URL? {
        guard let port else { return nil }
        return URL(string: "http://127.0.0.1:\(port)")
    }

    /// WebSocket URL including auth token for frontend connections.
    var wsURL: URL? {
        guard let port else { return nil }
        return URL(string: "ws://127.0.0.1:\(port)/?token=\(authToken)")
    }

    /// The project root directory for the T3 server process cwd.
    /// This selects the active workspace/project context without changing
    /// T3's persistent state home.
    var projectDirectory: String?

    var resolvedT3HomeDirectory: String {
        Self.resolvedT3HomeDirectory()
    }

    // MARK: - Private state

    private var serverProcess: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var retryCount: Int = 0
    private var gracePeriodTimer: DispatchWorkItem?
    private var panelCount: Int = 0

    private static let maxRetries = 3
    private static let gracePeriodSeconds: TimeInterval = 30

    // MARK: - Init

    private init() {}

    // MARK: - Panel reference counting

    /// Call when a new T3 Code panel is created. Starts the server if not running.
    func registerPanel() {
        panelCount += 1
        gracePeriodTimer?.cancel()
        gracePeriodTimer = nil

        if !isRunning {
            start()
        }
    }

    /// Call when a T3 Code panel is closed. Schedules server stop after grace period.
    func unregisterPanel() {
        panelCount = max(0, panelCount - 1)
        if panelCount == 0 {
            scheduleGracePeriodStop()
        }
    }

    // MARK: - Lifecycle

    static func resolvedT3HomeDirectory(
        homeDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) -> String {
        (homeDirectory as NSString).appendingPathComponent(".t3")
    }

    static func makeEnvironment(
        projectDirectory: String,
        t3HomeDirectory: String,
        reservedPort: UInt16,
        serverDirectory: URL,
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        let t3Env: [String: String] = [
            "T3CODE_PORT": String(reservedPort),
            "T3CODE_HOST": "127.0.0.1",
            "T3CODE_NO_BROWSER": "true",
            "T3CODE_HOME": t3HomeDirectory,
            "NODE_ENV": "production",
            "NODE_PATH": serverDirectory.appendingPathComponent("node_modules").path,
        ]
        return baseEnvironment.merging(t3Env) { _, new in new }
    }

    func start() {
        guard !isRunning else { return }

        // Locate bundled runtime and server entry point
        let runtimeURL = locateRuntime()
        let serverEntryURL = locateServerEntry()
        let projectDir = projectDirectory ?? NSHomeDirectory()
        let t3HomeDirectory = resolvedT3HomeDirectory
        NSLog(
            "[T3ServerManager] start() runtime=\(runtimeURL?.path ?? "nil") " +
            "server=\(serverEntryURL?.path ?? "nil") " +
            "projectDirectory=\(projectDir) " +
            "t3HomeDirectory=\(t3HomeDirectory) " +
            "bundleURL=\(Bundle.main.resourceURL?.path ?? "nil")"
        )

        guard let runtimeURL, let serverEntryURL else {
            NSLog("[T3ServerManager] Failed to locate bundled runtime or server entry point")
            return
        }

        // Reserve a dynamic port
        let reservedPort = reservePort()
        self.port = reservedPort

        // Generate auth token
        self.authToken = generateAuthToken()

        // Configure the process
        let process = Process()
        process.executableURL = runtimeURL
        // Pass the project directory as a CLI argument so the server uses it as cwd
        process.arguments = [serverEntryURL.path, projectDir]
        // Set working directory to the PROJECT directory (this becomes process.cwd()
        // which the T3 server uses as the default project folder).
        // node_modules are resolved via NODE_PATH instead.
        let serverDir = serverEntryURL.deletingLastPathComponent()
        process.currentDirectoryURL = URL(fileURLWithPath: projectDir)
        process.environment = Self.makeEnvironment(
            projectDirectory: projectDir,
            t3HomeDirectory: t3HomeDirectory,
            reservedPort: reservedPort,
            serverDirectory: serverDir
        )

        // Set up stdout/stderr pipes for monitoring
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        self.stdoutPipe = stdout
        self.stderrPipe = stderr

        // Monitor output for ready signal and errors
        monitorOutput(stdout, label: "stdout")
        monitorOutput(stderr, label: "stderr")

        // Handle termination
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                let status = process.terminationStatus
                NSLog("[T3ServerManager] Server exited with status \(status)")
                self.isRunning = false
                self.isReady = false
                self.serverProcess = nil

                // Auto-restart if panels are still open and we haven't exceeded retries
                if self.panelCount > 0 && self.retryCount < Self.maxRetries {
                    self.retryCount += 1
                    let delay = pow(2.0, Double(self.retryCount)) // Exponential backoff: 2, 4, 8 seconds
                    NSLog("[T3ServerManager] Restarting in \(delay)s (attempt \(self.retryCount)/\(Self.maxRetries))")
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                        self?.start()
                    }
                }
            }
        }

        // Launch
        do {
            try process.run()
            self.serverProcess = process
            self.isRunning = true
            self.retryCount = 0
            NSLog("[T3ServerManager] Server started on port \(reservedPort), PID=\(process.processIdentifier)")

            // Background readiness probe — confirms the server is responding
            // so that openT3Code() can use the fast path.
            probeUntilReady(attempt: 0)
        } catch {
            NSLog("[T3ServerManager] Failed to start server: \(error)")
            self.isRunning = false
        }
    }

    /// Probes the server in the background until it responds with HTTP 200.
    private func probeUntilReady(attempt: Int) {
        guard attempt < 30, isRunning, !isReady else { return }
        guard let url = serverURL else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.probeUntilReady(attempt: attempt + 1)
            }
            return
        }

        let probe = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        URLSession.shared.dataTask(with: probe) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self, self.isRunning else { return }
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    self.isReady = true
                    NSLog("[T3ServerManager] Server confirmed ready on port \(self.port ?? 0)")
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self.probeUntilReady(attempt: attempt + 1)
                    }
                }
            }
        }.resume()
    }

    func stop() {
        gracePeriodTimer?.cancel()
        gracePeriodTimer = nil

        guard let process = serverProcess, process.isRunning else {
            isRunning = false
            serverProcess = nil
            return
        }

        NSLog("[T3ServerManager] Stopping server (PID=\(process.processIdentifier))")

        // Send SIGTERM for graceful shutdown
        process.terminate()

        // Force kill after 5 seconds if still running
        DispatchQueue.global().asyncAfter(deadline: .now() + 5.0) { [weak process] in
            guard let process, process.isRunning else { return }
            NSLog("[T3ServerManager] Force-killing server after timeout")
            kill(process.processIdentifier, SIGKILL)
        }

        isRunning = false
        serverProcess = nil
        port = nil
    }

    // MARK: - Private helpers

    private func scheduleGracePeriodStop() {
        gracePeriodTimer?.cancel()
        let timer = DispatchWorkItem { [weak self] in
            guard let self, self.panelCount == 0 else { return }
            self.stop()
        }
        gracePeriodTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.gracePeriodSeconds, execute: timer)
    }

    private func locateRuntime() -> URL? {
        // Look for bundled bun or node runtime
        if let bundleURL = Bundle.main.resourceURL {
            let bunURL = bundleURL.appendingPathComponent("bin/bun")
            if FileManager.default.isExecutableFile(atPath: bunURL.path) {
                return bunURL
            }
            let nodeURL = bundleURL.appendingPathComponent("bin/node")
            if FileManager.default.isExecutableFile(atPath: nodeURL.path) {
                return nodeURL
            }
        }

        // Fallback: look for system-installed bun or node
        let systemPaths = [
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
        ]
        for path in systemPaths {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }

        // Try PATH lookup via /usr/bin/env
        return URL(fileURLWithPath: "/usr/bin/env")
    }

    private func locateServerEntry() -> URL? {
        guard let bundleURL = Bundle.main.resourceURL else { return nil }
        let serverDir = bundleURL.appendingPathComponent("t3code-server")

        // Try common entry point names
        let candidates = ["bin.mjs", "index.mjs", "server.mjs", "bin.js", "index.js"]
        for candidate in candidates {
            let url = serverDir.appendingPathComponent(candidate)
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }

        return nil
    }

    private func reservePort() -> UInt16 {
        // Bind to port 0 to get a system-assigned free port
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { return 19847 } // Fallback port

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0 // System assigns a free port
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        guard bindResult == 0 else {
            Darwin.close(socket)
            return 19847
        }

        var boundAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &boundAddr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = getsockname(socket, $0, &addrLen)
            }
        }

        let port = UInt16(bigEndian: boundAddr.sin_port)
        Darwin.close(socket)
        return port
    }

    private func generateAuthToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func monitorOutput(_ pipe: Pipe, label: String) {
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            if let output = String(data: data, encoding: .utf8) {
                for line in output.components(separatedBy: .newlines) where !line.isEmpty {
                    NSLog("[T3Server/\(label)] \(line)")
                }
            }
        }
    }

    deinit {
        serverProcess?.terminate()
    }
}
