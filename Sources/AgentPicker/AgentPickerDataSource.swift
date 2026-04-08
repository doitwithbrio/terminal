import AppKit
import Bonsplit
import Foundation
import SQLite3

/// Provides items for each Agent Picker category by discovering existing
/// T3Code threads, OpenCode sessions, and offering creation actions.
@MainActor
final class AgentPickerDataSource {

    // MARK: - Public

    /// Returns the items for the given category.
    /// - Parameters:
    ///   - category: The selected category.
    ///   - tabManager: The tab manager for the current window (used for Terminal / T3Code actions).
    ///   - allTabManagers: All tab managers across all windows (used for T3Code discovery).
    ///   - workspaceDirectory: The focused workspace's current directory (used for T3Code/OpenCode filtering).
    ///   - openT3Code: Closure to create a new T3 thread.
    ///   - openOMO: Closure to open a terminal running `cmux omo` with optional args.
    ///   - focusPanel: Closure to focus a specific panel in a specific tab manager.
    func items(
        for category: AgentPickerCategory,
        tabManager: TabManager?,
        allTabManagers: [(tabManager: TabManager, windowTitle: String?)],
        workspaceDirectory: String?,
        openT3Code: @escaping @MainActor (_ threadId: String?) -> Void,
        openOMO: @escaping @MainActor (_ sessionArgs: [String]) -> Void,
        focusPanel: @escaping @MainActor (_ tabManager: TabManager, _ workspaceId: UUID, _ panelId: UUID) -> Void
    ) -> [AgentPickerItem] {
        switch category {
        case .terminal:
            return terminalItems(tabManager: tabManager)
        case .t3code:
            return t3codeItems(
                workspaceDirectory: workspaceDirectory,
                openT3Code: openT3Code
            )
        case .opencode:
            return opencodeItems(
                workspaceDirectory: workspaceDirectory,
                openOMO: openOMO
            )
        }
    }

    // MARK: - Terminal

    private func terminalItems(tabManager: TabManager?) -> [AgentPickerItem] {
        [
            AgentPickerItem(
                id: "terminal-new",
                title: String(localized: "agentPicker.terminal.new", defaultValue: "New Terminal"),
                subtitle: nil,
                isCreateNew: true,
                action: { [weak tabManager] in
                    tabManager?.newSurface()
                }
            ),
        ]
    }

    // MARK: - T3Code

    private func t3codeItems(
        workspaceDirectory: String?,
        openT3Code: @escaping @MainActor (_ threadId: String?) -> Void
    ) -> [AgentPickerItem] {
        var items: [AgentPickerItem] = []
        let normalizedWorkspaceDirectory = Self.normalizedWorkspaceDirectory(workspaceDirectory)

        // "New Thread" first — always item #1
        items.append(AgentPickerItem(
            id: "t3-new",
            title: String(localized: "agentPicker.t3code.new", defaultValue: "New Thread"),
            subtitle: nil,
            isCreateNew: true,
            action: { openT3Code(nil) }
        ))

        guard let normalizedWorkspaceDirectory else {
#if DEBUG
            dlog("t3open.datasource.built itemCount=\(items.count) workspaceDir=nil threadIds=[]")
#endif
            return items
        }

        let threads = Self.queryT3Threads(
            at: Self.defaultT3DatabasePath(),
            workspaceDirectory: normalizedWorkspaceDirectory,
            limit: 20
        )
        for thread in threads {
            let threadId = thread.threadId
            items.append(AgentPickerItem(
                id: "t3-\(thread.threadId)",
                title: thread.title,
                subtitle: thread.relativeTime,
                isCreateNew: false,
                action: {
#if DEBUG
                    dlog(
                        "t3open.datasource.select threadId=\(threadId.prefix(8)) " +
                        "workspaceDir=\(normalizedWorkspaceDirectory) scopedMatch=1"
                    )
#endif
                    openT3Code(threadId)
                }
            ))
        }

#if DEBUG
        dlog(
            "t3open.datasource.built itemCount=\(items.count) " +
            "workspaceDir=\(normalizedWorkspaceDirectory) " +
            "threadIds=[\(threads.map { $0.threadId.prefix(8) }.joined(separator: ","))]"
        )
#endif
        return items
    }

    // MARK: - T3 SQLite

    struct T3Thread {
        let threadId: String
        let title: String
        let updatedAt: String
        var relativeTime: String {
            // Parse ISO 8601 date string
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: updatedAt) else { return "" }
            let seconds = Date().timeIntervalSince(date)
            if seconds < 60 { return String(localized: "agentPicker.time.justNow", defaultValue: "just now") }
            let minutes = Int(seconds / 60)
            if minutes < 60 { return "\(minutes)m ago" }
            let hours = minutes / 60
            if hours < 24 { return "\(hours)h ago" }
            let days = hours / 24
            return "\(days)d ago"
        }
    }

    static func defaultT3DatabasePath(
        homeDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) -> String {
        (T3ServerManager.resolvedT3HomeDirectory(homeDirectory: homeDirectory) as NSString)
            .appendingPathComponent("userdata/state.sqlite")
    }

    static func queryT3Threads(
        at dbPath: String,
        workspaceDirectory: String,
        limit: Int
    ) -> [T3Thread] {
        guard FileManager.default.fileExists(atPath: dbPath) else { return [] }

        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_close(db) }

        let sql = """
            SELECT
                threads.thread_id,
                threads.title,
                threads.updated_at
            FROM projection_threads AS threads
            INNER JOIN projection_projects AS projects
                ON projects.project_id = threads.project_id
            WHERE threads.deleted_at IS NULL
                AND threads.archived_at IS NULL
                AND COALESCE(NULLIF(threads.worktree_path, ''), projects.workspace_root) = ?1
            ORDER BY threads.updated_at DESC
            LIMIT ?2
            """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, (workspaceDirectory as NSString).utf8String, -1, nil)
        sqlite3_bind_int(stmt, 2, Int32(limit))

        var threads: [T3Thread] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let idPtr = sqlite3_column_text(stmt, 0),
                  let titlePtr = sqlite3_column_text(stmt, 1),
                  let updatedPtr = sqlite3_column_text(stmt, 2)
            else { continue }
            threads.append(T3Thread(
                threadId: String(cString: idPtr),
                title: String(cString: titlePtr),
                updatedAt: String(cString: updatedPtr)
            ))
        }

        return threads
    }

    // MARK: - OpenCode

    private func opencodeItems(
        workspaceDirectory: String?,
        openOMO: @escaping @MainActor (_ sessionArgs: [String]) -> Void
    ) -> [AgentPickerItem] {
        var items: [AgentPickerItem] = []
        let normalizedWorkspaceDirectory = Self.normalizedWorkspaceDirectory(workspaceDirectory)

        // "New Session" first — always item #1
        items.append(AgentPickerItem(
            id: "oc-new",
            title: String(localized: "agentPicker.opencode.new", defaultValue: "New Session"),
            subtitle: nil,
            isCreateNew: true,
            action: {
                openOMO([])
            }
        ))

        if let normalizedWorkspaceDirectory {
            let sessions = Self.queryOpenCodeSessions(
                at: Self.defaultOpenCodeDatabasePath(),
                directory: normalizedWorkspaceDirectory,
                limit: 20
            )
            for session in sessions {
                let sessionId = session.id
                items.append(AgentPickerItem(
                    id: "oc-\(session.id)",
                    title: session.title,
                    subtitle: session.relativeTime,
                    isCreateNew: false,
                    action: {
                        openOMO(["--session", sessionId])
                    }
                ))
            }
        }

        return items
    }

    // MARK: - OpenCode SQLite

    struct OpenCodeSession {
        let id: String
        let title: String
        let timeUpdated: Int64
        var relativeTime: String {
            let seconds = Date().timeIntervalSince1970 - Double(timeUpdated) / 1000.0
            if seconds < 60 { return String(localized: "agentPicker.time.justNow", defaultValue: "just now") }
            let minutes = Int(seconds / 60)
            if minutes < 60 { return "\(minutes)m ago" }
            let hours = minutes / 60
            if hours < 24 { return "\(hours)h ago" }
            let days = hours / 24
            return "\(days)d ago"
        }
    }

    static func defaultOpenCodeDatabasePath(
        homeDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) -> String {
        (homeDirectory as NSString).appendingPathComponent(".local/share/opencode/opencode.db")
    }

    static func queryOpenCodeSessions(
        at dbPath: String,
        directory: String,
        limit: Int
    ) -> [OpenCodeSession] {
        guard FileManager.default.fileExists(atPath: dbPath) else { return [] }

        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_close(db) }

        let sql = """
            SELECT id, title, time_updated
            FROM session
            -- OpenCode session discovery is intentionally exact-directory scoped.
            WHERE time_archived IS NULL AND parent_id IS NULL AND directory = ?1
            ORDER BY time_updated DESC
            LIMIT ?2
            """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, (directory as NSString).utf8String, -1, nil)
        sqlite3_bind_int(stmt, 2, Int32(limit))

        var sessions: [OpenCodeSession] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let idPtr = sqlite3_column_text(stmt, 0),
                  let titlePtr = sqlite3_column_text(stmt, 1)
            else { continue }
            let id = String(cString: idPtr)
            let title = String(cString: titlePtr)
            let timeUpdated = sqlite3_column_int64(stmt, 2)
            sessions.append(OpenCodeSession(id: id, title: title, timeUpdated: timeUpdated))
        }

        return sessions
    }

    // MARK: - Helpers

    static func normalizedWorkspaceDirectory(_ workspaceDirectory: String?) -> String? {
        guard let workspaceDirectory = workspaceDirectory?.trimmingCharacters(in: .whitespacesAndNewlines),
              workspaceDirectory.isEmpty == false else {
            return nil
        }
        return workspaceDirectory
    }

    private func abbreviateHome(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}
