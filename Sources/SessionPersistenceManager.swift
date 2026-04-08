import Foundation

/// Manages the lifecycle of `cmux-persist` daemon sessions that keep terminal
/// processes alive across app restarts. Each terminal panel can optionally be
/// backed by a persistent session identified by a stable `persistSessionId`.
final class SessionPersistenceManager: @unchecked Sendable {
    static let shared = SessionPersistenceManager()

    /// Directory where session sockets live.
    let socketDirectory = "/tmp/cmux-sessions"

    // MARK: - Binary discovery

    /// Path to the bundled `cmux-persist` binary.
    var binaryPath: String? {
        guard let binDir = Bundle.main.resourceURL?.appendingPathComponent("bin") else {
            return nil
        }
        let path = binDir.appendingPathComponent("cmux-persist").path
        return FileManager.default.isExecutableFile(atPath: path) ? path : nil
    }

    /// Whether the `cmux-persist` binary is available.
    var isAvailable: Bool {
        binaryPath != nil
    }

    // MARK: - Session IDs

    /// Generate a new stable session ID (persisted across restarts).
    func generateSessionId() -> String {
        let uuid = UUID().uuidString.lowercased()
        let prefix = String(uuid.prefix(12))
        return "cmux-\(prefix)"
    }

    /// Socket path for a session ID.
    func socketPath(for sessionId: String) -> String {
        "\(socketDirectory)/\(sessionId).sock"
    }

    // MARK: - Command construction

    /// Build the command string for Ghostty to run via `cmux-persist -A`.
    ///
    /// When a living daemon exists at the socket, this reattaches.
    /// Otherwise it creates a new session running `shell`.
    /// The command is executed via `/bin/sh -c` by Ghostty, so paths are shell-quoted.
    func command(sessionId: String, shell: String? = nil) -> String {
        guard let binary = binaryPath else {
            return shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        }
        let socket = socketPath(for: sessionId)
        let shellCmd = shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        return "\(shellQuote(binary)) -A \(shellQuote(socket)) -- \(shellQuote(shellCmd))"
    }

    /// Shell-quote a string for safe embedding in a `/bin/sh -c` command.
    private func shellQuote(_ s: String) -> String {
        // If the string contains no special characters, return as-is
        let needsQuoting = s.contains(where: { " \t\n\\\"'$`!#&|;(){}[]<>?*~".contains($0) })
        guard needsQuoting else { return s }
        // Wrap in single quotes, escaping any embedded single quotes
        let escaped = s.replacingOccurrences(of: "'", with: "'\\''")
        return "'\(escaped)'"
    }

    // MARK: - Session queries

    /// Check if a session is alive (socket file exists).
    ///
    /// A more thorough check would attempt a connection, but file existence
    /// is sufficient for the happy path; stale sockets are handled on reattach
    /// by `cmux-persist` itself.
    func sessionExists(_ sessionId: String) -> Bool {
        FileManager.default.fileExists(atPath: socketPath(for: sessionId))
    }

    // MARK: - Session lifecycle

    /// Kill a session (sends kill message + removes socket).
    func killSession(_ sessionId: String) {
        guard let binary = binaryPath else { return }
        let socket = socketPath(for: sessionId)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = ["-k", socket]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }

    /// Clean up orphaned sessions not tracked by the active set.
    func cleanupOrphans(activeSessionIds: Set<String>) {
        guard let binary = binaryPath else { return }
        let fm = FileManager.default

        guard let entries = try? fm.contentsOfDirectory(atPath: socketDirectory) else {
            return
        }

        for entry in entries {
            guard entry.hasSuffix(".sock") else { continue }
            let sessionId = String(entry.dropLast(5)) // remove ".sock"
            guard !activeSessionIds.contains(sessionId) else { continue }

            // Kill the orphaned session
            let socket = "\(socketDirectory)/\(entry)"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: binary)
            process.arguments = ["-k", socket]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
        }
    }

    /// Ensure the socket directory exists with correct permissions.
    func ensureSocketDirectory() {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: socketDirectory, isDirectory: &isDir) || !isDir.boolValue {
            try? fm.createDirectory(
                atPath: socketDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        }
    }
}
