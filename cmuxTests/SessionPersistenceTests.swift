import XCTest
import SQLite3
import WebKit

#if canImport(cmux_DEV)
@testable import cmux_DEV
#elseif canImport(cmux)
@testable import cmux
#endif

final class SessionPersistenceTests: XCTestCase {
    private struct LegacyPersistedWindowGeometry: Codable {
        let frame: SessionRectSnapshot
        let display: SessionDisplaySnapshot?
    }

    @MainActor
    func testWorkspaceSessionSnapshotRestoresMarkdownPanel() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-markdown-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let markdownURL = root.appendingPathComponent("note.md")
        try "# hello\n".write(to: markdownURL, atomically: true, encoding: .utf8)

        let workspace = Workspace()
        let paneId = try XCTUnwrap(workspace.bonsplitController.allPaneIds.first)
        let panel = try XCTUnwrap(
            workspace.newMarkdownSurface(
                inPane: paneId,
                filePath: markdownURL.path,
                focus: true
            )
        )
        workspace.setCustomTitle("Docs")
        workspace.setPanelCustomTitle(panelId: panel.id, title: "Readme")

        let snapshot = workspace.sessionSnapshot(includeScrollback: false)

        let restored = Workspace()
        restored.restoreSessionSnapshot(snapshot)

        let restoredPanelId = try XCTUnwrap(restored.focusedPanelId)
        let restoredPanel = try XCTUnwrap(restored.markdownPanel(for: restoredPanelId))
        XCTAssertEqual(restoredPanel.filePath, markdownURL.path)
        XCTAssertEqual(restored.customTitle, "Docs")
        XCTAssertEqual(restored.panelTitle(panelId: restoredPanelId), "Readme")
    }

    @MainActor
    func testWorkspaceSessionSnapshotPersistsContextBindingsWithoutStructuralContextPanel() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-context-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let workspace = Workspace(workingDirectory: root.path)
        let agentPanelId = try XCTUnwrap(workspace.selectedAgentPanelId)
        let contextPanelId = try XCTUnwrap(workspace.panels.values.compactMap { ($0 as? ContextPanel)?.id }.first)

        workspace.focusPanel(contextPanelId)
        workspace.selectContextPage(forAgentPanelId: agentPanelId, kind: .plan)

        let snapshot = workspace.sessionSnapshot(includeScrollback: false)

        XCTAssertEqual(snapshot.focusedPanelId, agentPanelId)
        XCTAssertFalse(snapshot.panels.contains(where: { $0.type == .context }))

        let binding = try XCTUnwrap(snapshot.contextBindings.first(where: { $0.agentPanelId == agentPanelId }))
        XCTAssertEqual(binding.kindRawValue, ContextPageKind.plan.rawValue)
        XCTAssertNotNil(binding.planFilePath)
    }

    @MainActor
    func testRestoreSessionSnapshotRecreatesContextPanelAndRemapsBindings() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-restore-context-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let workspace = Workspace(workingDirectory: root.path)
        let firstAgentPanelId = try XCTUnwrap(workspace.selectedAgentPanelId)
        let paneId = try XCTUnwrap(workspace.paneId(forPanelId: firstAgentPanelId))
        let secondPanel = try XCTUnwrap(workspace.newTerminalSurface(inPane: paneId, focus: false))

        workspace.selectContextPage(forAgentPanelId: firstAgentPanelId, kind: .plan)
        workspace.selectContextPage(forAgentPanelId: secondPanel.id, kind: .agentMd)
        workspace.focusPanel(secondPanel.id)

        let snapshot = workspace.sessionSnapshot(includeScrollback: false)
        let originalPlanBinding = try XCTUnwrap(
            snapshot.contextBindings.first(where: { $0.agentPanelId == firstAgentPanelId && $0.kindRawValue == ContextPageKind.plan.rawValue })
        )

        let restored = Workspace(createInitialTerminal: false)
        restored.restoreSessionSnapshot(snapshot)

        let contextPanels = restored.panels.values.compactMap { $0 as? ContextPanel }
        XCTAssertEqual(contextPanels.count, 1)

        let restoredContextPanel = try XCTUnwrap(contextPanels.first)
        XCTAssertEqual(restoredContextPanel.pageState.kind, .agentMd)

        let restoredSnapshot = restored.sessionSnapshot(includeScrollback: false)
        XCTAssertEqual(restoredSnapshot.contextBindings.count, 2)
        XCTAssertEqual(restored.focusedPanelId, restored.selectedAgentPanelId)
        XCTAssertNotEqual(restored.focusedPanelId, restoredContextPanel.id)

        let restoredPlanBinding = try XCTUnwrap(
            restoredSnapshot.contextBindings.first(where: { $0.kindRawValue == ContextPageKind.plan.rawValue })
        )
        XCTAssertEqual(restoredPlanBinding.planFilePath, originalPlanBinding.planFilePath)
    }

    @MainActor
    func testRestoreSessionSnapshotReResolvesAgentMdAgainstRestoredDirectory() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-agent-md-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let workspace = Workspace(workingDirectory: root.path)
        let agentPanelId = try XCTUnwrap(workspace.selectedAgentPanelId)
        workspace.selectContextPage(forAgentPanelId: agentPanelId, kind: .agentMd)

        let snapshot = workspace.sessionSnapshot(includeScrollback: false)
        let restored = Workspace(createInitialTerminal: false)
        restored.restoreSessionSnapshot(snapshot)

        let restoredContextPanel = try XCTUnwrap(restored.panels.values.compactMap { $0 as? ContextPanel }.first)
        XCTAssertEqual(restoredContextPanel.pageState.kind, .agentMd)
        XCTAssertEqual(restoredContextPanel.pageState.resolvedFilePath, root.appendingPathComponent("AGENT.md").path)
        XCTAssertEqual(
            restoredContextPanel.pageState.missingReason,
            String(localized: "contextPage.agentMd.missing", defaultValue: "No workspace-local AGENT.md file was found.")
        )
    }

    func testSaveAndLoadRoundTripWithCustomSnapshotPath() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let snapshotURL = tempDir.appendingPathComponent("session.json", isDirectory: false)
        let snapshot = makeSnapshot(version: SessionSnapshotSchema.currentVersion)

        XCTAssertTrue(SessionPersistenceStore.save(snapshot, fileURL: snapshotURL))

        let loaded = SessionPersistenceStore.load(fileURL: snapshotURL)
        XCTAssertNotNil(loaded)
        XCTAssertEqual(loaded?.version, SessionSnapshotSchema.currentVersion)
        XCTAssertEqual(loaded?.windows.count, 1)
        XCTAssertEqual(loaded?.windows.first?.sidebar.selection, .tabs)
        let frame = try XCTUnwrap(loaded?.windows.first?.frame)
        XCTAssertEqual(frame.x, 10, accuracy: 0.001)
        XCTAssertEqual(frame.y, 20, accuracy: 0.001)
        XCTAssertEqual(frame.width, 900, accuracy: 0.001)
        XCTAssertEqual(frame.height, 700, accuracy: 0.001)
        XCTAssertEqual(loaded?.windows.first?.display?.displayID, 42)
        let visibleFrame = try XCTUnwrap(loaded?.windows.first?.display?.visibleFrame)
        XCTAssertEqual(visibleFrame.y, 25, accuracy: 0.001)
    }

    func testSaveAndLoadRoundTripPreservesWorkspaceCustomColor() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let snapshotURL = tempDir.appendingPathComponent("session.json", isDirectory: false)
        var snapshot = makeSnapshot(version: SessionSnapshotSchema.currentVersion)
        snapshot.windows[0].tabManager.workspaces[0].customColor = "#C0392B"

        XCTAssertTrue(SessionPersistenceStore.save(snapshot, fileURL: snapshotURL))

        let loaded = SessionPersistenceStore.load(fileURL: snapshotURL)
        XCTAssertEqual(
            loaded?.windows.first?.tabManager.workspaces.first?.customColor,
            "#C0392B"
        )
    }

    func testSaveSkipsRewritingIdenticalSnapshotData() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let snapshotURL = tempDir.appendingPathComponent("session.json", isDirectory: false)
        let snapshot = makeSnapshot(version: SessionSnapshotSchema.currentVersion)

        XCTAssertTrue(SessionPersistenceStore.save(snapshot, fileURL: snapshotURL))
        let firstFileNumber = try fileNumber(for: snapshotURL)

        XCTAssertTrue(SessionPersistenceStore.save(snapshot, fileURL: snapshotURL))
        let secondFileNumber = try fileNumber(for: snapshotURL)

        XCTAssertEqual(
            secondFileNumber,
            firstFileNumber,
            "Saving identical session data should not replace the snapshot file"
        )
    }

    func testWorkspaceCustomColorDecodeSupportsMissingLegacyField() throws {
        var snapshot = makeSnapshot(version: SessionSnapshotSchema.currentVersion)
        snapshot.windows[0].tabManager.workspaces[0].customColor = nil

        let encoder = JSONEncoder()
        let data = try encoder.encode(snapshot)
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(json.contains("\"customColor\""))

        let decoded = try JSONDecoder().decode(AppSessionSnapshot.self, from: data)
        XCTAssertNil(decoded.windows.first?.tabManager.workspaces.first?.customColor)
    }

    func testLoadRejectsSchemaVersionMismatch() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let snapshotURL = tempDir.appendingPathComponent("session.json", isDirectory: false)
        XCTAssertTrue(SessionPersistenceStore.save(makeSnapshot(version: SessionSnapshotSchema.currentVersion + 1), fileURL: snapshotURL))

        XCTAssertNil(SessionPersistenceStore.load(fileURL: snapshotURL))
    }

    func testDefaultSnapshotPathSanitizesBundleIdentifier() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-session-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let path = SessionPersistenceStore.defaultSnapshotFileURL(
            bundleIdentifier: "com.example/unsafe id",
            appSupportDirectory: tempDir
        )

        XCTAssertNotNil(path)
        XCTAssertTrue(path?.path.contains("com.example_unsafe_id") == true)
    }

    func testRestorePolicySkipsWhenLaunchHasExplicitArguments() {
        let shouldRestore = SessionRestorePolicy.shouldAttemptRestore(
            arguments: ["/Applications/cmux.app/Contents/MacOS/cmux", "--window", "window:1"],
            environment: [:]
        )

        XCTAssertFalse(shouldRestore)
    }

    func testRestorePolicyAllowsFinderStyleLaunchArgumentsOnly() {
        let shouldRestore = SessionRestorePolicy.shouldAttemptRestore(
            arguments: ["/Applications/cmux.app/Contents/MacOS/cmux", "-psn_0_12345"],
            environment: [:]
        )

        XCTAssertTrue(shouldRestore)
    }

    func testRestorePolicySkipsWhenRunningUnderXCTest() {
        let shouldRestore = SessionRestorePolicy.shouldAttemptRestore(
            arguments: ["/Applications/cmux.app/Contents/MacOS/cmux"],
            environment: ["XCTestConfigurationFilePath": "/tmp/xctest.xctestconfiguration"]
        )

        XCTAssertFalse(shouldRestore)
    }

    func testSidebarWidthSanitizationClampsToPolicyRange() {
        XCTAssertEqual(
            SessionPersistencePolicy.sanitizedSidebarWidth(-20),
            SessionPersistencePolicy.minimumSidebarWidth,
            accuracy: 0.001
        )
        XCTAssertEqual(
            SessionPersistencePolicy.sanitizedSidebarWidth(10_000),
            SessionPersistencePolicy.maximumSidebarWidth,
            accuracy: 0.001
        )
        XCTAssertEqual(
            SessionPersistencePolicy.sanitizedSidebarWidth(nil),
            SessionPersistencePolicy.defaultSidebarWidth,
            accuracy: 0.001
        )
    }

    func testSessionRectSnapshotEncodesXYWidthHeightKeys() throws {
        let snapshot = SessionRectSnapshot(x: 101.25, y: 202.5, width: 903.75, height: 704.5)
        let data = try JSONEncoder().encode(snapshot)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Double])

        XCTAssertEqual(Set(object.keys), Set(["x", "y", "width", "height"]))
        XCTAssertEqual(try XCTUnwrap(object["x"]), 101.25, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(object["y"]), 202.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(object["width"]), 903.75, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(object["height"]), 704.5, accuracy: 0.001)
    }

    func testSessionBrowserPanelSnapshotHistoryRoundTrip() throws {
        let profileID = try XCTUnwrap(UUID(uuidString: "8F03A658-5A84-428B-AD03-5A6D04692F64"))
        let source = SessionBrowserPanelSnapshot(
            urlString: "https://example.com/current",
            profileID: profileID,
            shouldRenderWebView: true,
            pageZoom: 1.2,
            developerToolsVisible: true,
            backHistoryURLStrings: [
                "https://example.com/a",
                "https://example.com/b"
            ],
            forwardHistoryURLStrings: [
                "https://example.com/d"
            ]
        )

        let data = try JSONEncoder().encode(source)
        let decoded = try JSONDecoder().decode(SessionBrowserPanelSnapshot.self, from: data)
        XCTAssertEqual(decoded.urlString, source.urlString)
        XCTAssertEqual(decoded.profileID, source.profileID)
        XCTAssertEqual(decoded.backHistoryURLStrings, source.backHistoryURLStrings)
        XCTAssertEqual(decoded.forwardHistoryURLStrings, source.forwardHistoryURLStrings)
    }

    func testSessionBrowserPanelSnapshotHistoryDecodesWhenKeysAreMissing() throws {
        let json = """
        {
          "urlString": "https://example.com/current",
          "shouldRenderWebView": true,
          "pageZoom": 1.0,
          "developerToolsVisible": false
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(SessionBrowserPanelSnapshot.self, from: json)
        XCTAssertEqual(decoded.urlString, "https://example.com/current")
        XCTAssertNil(decoded.profileID)
        XCTAssertNil(decoded.backHistoryURLStrings)
        XCTAssertNil(decoded.forwardHistoryURLStrings)
    }

    func testScrollbackReplayEnvironmentWritesReplayFile() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: "line one\nline two\n",
            tempDirectory: tempDir
        )

        let path = environment[SessionScrollbackReplayStore.environmentKey]
        XCTAssertNotNil(path)
        XCTAssertTrue(path?.hasPrefix(tempDir.path) == true)

        guard let path else { return }
        let contents = try? String(contentsOfFile: path, encoding: .utf8)
        XCTAssertEqual(contents, "line one\nline two\n")
    }

    func testScrollbackReplayEnvironmentSkipsWhitespaceOnlyContent() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: " \n\t  ",
            tempDirectory: tempDir
        )

        XCTAssertTrue(environment.isEmpty)
    }

    func testScrollbackReplayEnvironmentPreservesANSIColorSequences() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let red = "\u{001B}[31m"
        let reset = "\u{001B}[0m"
        let source = "\(red)RED\(reset)\n"
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey] else {
            XCTFail("Expected replay file path")
            return
        }

        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertTrue(contents.contains("\(red)RED\(reset)"))
        XCTAssertTrue(contents.hasPrefix(reset))
        XCTAssertTrue(contents.hasSuffix(reset))
    }

    func testScrollbackReplayEnvironmentStripsLeadingLastLoginBanners() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let source = "Last login: Thu Apr 2 17:30:14 on ttys015\nLast login: Thu Apr 2 17:40:22 on ttys016\n~\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, "~\n> ")
    }

    func testScrollbackReplayEnvironmentStripsAnsiWrappedLeadingLastLoginBanners() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let reset = "\u{001B}[0m"
        let source = "\(reset)Last login: Thu Apr 2 17:30:14 on ttys015\n~\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, "~\n> ")
    }

    func testScrollbackReplayEnvironmentSkipsBannerOnlyReplay() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: "Last login: Thu Apr 2 17:30:14 on ttys015\n",
            tempDirectory: tempDir
        )

        XCTAssertTrue(environment.isEmpty)
    }

    func testScrollbackReplayEnvironmentPreservesNonLeadingLastLoginText() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let source = "~\ncat log.txt\nLast login: preserved output\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, source)
    }

    func testScrollbackReplayEnvironmentStripsNonLeadingRealLoginBannerText() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let source = "~\nLast login: Thu Apr 2 20:23:20 on ttys021\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, "~\n> ")
    }

    func testScrollbackReplayEnvironmentStripsAnsiPrefixedNonLeadingRealLoginBannerText() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let reset = "\u{001B}[0m"
        let source = "~\n\(reset)Last login: Thu Apr 2 20:23:20 on ttys021\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, "~\n> ")
    }

    func testScrollbackReplayEnvironmentPreservesLeadingNonBannerLastLoginText() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cmux-scrollback-replay-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let source = "Last login: preserved output\n> "
        let environment = SessionScrollbackReplayStore.replayEnvironment(
            for: source,
            tempDirectory: tempDir
        )

        guard let path = environment[SessionScrollbackReplayStore.environmentKey],
              let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            XCTFail("Expected replay file contents")
            return
        }

        XCTAssertEqual(contents, source)
    }

    func testTruncatedScrollbackAvoidsLeadingPartialANSICSISequence() {
        let maxChars = SessionPersistencePolicy.maxScrollbackCharactersPerTerminal
        let source = "\u{001B}[31m"
            + String(repeating: "X", count: maxChars - 7)
            + "\u{001B}[0m"

        guard let truncated = SessionPersistencePolicy.truncatedScrollback(source) else {
            XCTFail("Expected truncated scrollback")
            return
        }

        XCTAssertFalse(truncated.hasPrefix("31m"))
        XCTAssertFalse(truncated.hasPrefix("[31m"))
        XCTAssertFalse(truncated.hasPrefix("m"))
    }

    func testNormalizedExportedScreenPathAcceptsAbsoluteAndFileURL() {
        XCTAssertEqual(
            TerminalController.normalizedExportedScreenPath("/tmp/cmux-screen.txt"),
            "/tmp/cmux-screen.txt"
        )
        XCTAssertEqual(
            TerminalController.normalizedExportedScreenPath(" file:///tmp/cmux-screen.txt "),
            "/tmp/cmux-screen.txt"
        )
    }

    func testNormalizedExportedScreenPathRejectsRelativeAndWhitespace() {
        XCTAssertNil(TerminalController.normalizedExportedScreenPath("relative/path.txt"))
        XCTAssertNil(TerminalController.normalizedExportedScreenPath("   "))
        XCTAssertNil(TerminalController.normalizedExportedScreenPath(nil))
    }

    func testShouldRemoveExportedScreenDirectoryOnlyWithinTemporaryRoot() {
        let tempRoot = URL(fileURLWithPath: "/tmp")
            .appendingPathComponent("cmux-export-tests-\(UUID().uuidString)", isDirectory: true)
        let tempFile = tempRoot
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent("screen.txt", isDirectory: false)
        let outsideFile = URL(fileURLWithPath: "/Users/example/screen.txt")

        XCTAssertTrue(
            TerminalController.shouldRemoveExportedScreenDirectory(
                fileURL: tempFile,
                temporaryDirectory: tempRoot
            )
        )
        XCTAssertFalse(
            TerminalController.shouldRemoveExportedScreenDirectory(
                fileURL: outsideFile,
                temporaryDirectory: tempRoot
            )
        )
    }

    func testShouldRemoveExportedScreenFileOnlyWithinTemporaryRoot() {
        let tempRoot = URL(fileURLWithPath: "/tmp")
            .appendingPathComponent("cmux-export-tests-\(UUID().uuidString)", isDirectory: true)
        let tempFile = tempRoot
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent("screen.txt", isDirectory: false)
        let outsideFile = URL(fileURLWithPath: "/Users/example/screen.txt")

        XCTAssertTrue(
            TerminalController.shouldRemoveExportedScreenFile(
                fileURL: tempFile,
                temporaryDirectory: tempRoot
            )
        )
        XCTAssertFalse(
            TerminalController.shouldRemoveExportedScreenFile(
                fileURL: outsideFile,
                temporaryDirectory: tempRoot
            )
        )
    }

    func testWindowUnregisterSnapshotPersistencePolicy() {
        XCTAssertTrue(
            AppDelegate.shouldPersistSnapshotOnWindowUnregister(isTerminatingApp: false)
        )
        XCTAssertFalse(
            AppDelegate.shouldPersistSnapshotOnWindowUnregister(isTerminatingApp: true)
        )
        XCTAssertTrue(
            AppDelegate.shouldRemoveSnapshotWhenNoWindowsRemainOnWindowUnregister(isTerminatingApp: false)
        )
        XCTAssertFalse(
            AppDelegate.shouldRemoveSnapshotWhenNoWindowsRemainOnWindowUnregister(isTerminatingApp: true)
        )
    }

    func testShouldSkipSessionSaveDuringStartupRestorePolicy() {
        XCTAssertTrue(
            AppDelegate.shouldSkipSessionSaveDuringStartupRestore(
                isApplyingStartupSessionRestore: true,
                includeScrollback: false
            )
        )
        XCTAssertFalse(
            AppDelegate.shouldSkipSessionSaveDuringStartupRestore(
                isApplyingStartupSessionRestore: true,
                includeScrollback: true
            )
        )
        XCTAssertFalse(
            AppDelegate.shouldSkipSessionSaveDuringStartupRestore(
                isApplyingStartupSessionRestore: false,
                includeScrollback: false
            )
        )
    }

    func testSessionAutosaveTickPolicySkipsWhenTerminating() {
        XCTAssertTrue(
            AppDelegate.shouldRunSessionAutosaveTick(isTerminatingApp: false)
        )
        XCTAssertFalse(
            AppDelegate.shouldRunSessionAutosaveTick(isTerminatingApp: true)
        )
    }

    func testSessionSnapshotSynchronousWritePolicy() {
        XCTAssertFalse(
            AppDelegate.shouldWriteSessionSnapshotSynchronously(
                isTerminatingApp: false,
                includeScrollback: false
            )
        )
        XCTAssertFalse(
            AppDelegate.shouldWriteSessionSnapshotSynchronously(
                isTerminatingApp: false,
                includeScrollback: true
            )
        )
        XCTAssertFalse(
            AppDelegate.shouldWriteSessionSnapshotSynchronously(
                isTerminatingApp: true,
                includeScrollback: false
            )
        )
        XCTAssertTrue(
            AppDelegate.shouldWriteSessionSnapshotSynchronously(
                isTerminatingApp: true,
                includeScrollback: true
            )
        )
    }

    func testUnchangedAutosaveFingerprintSkipsWithinStalenessWindow() {
        let now = Date()
        XCTAssertTrue(
            AppDelegate.shouldSkipSessionAutosaveForUnchangedFingerprint(
                isTerminatingApp: false,
                includeScrollback: false,
                previousFingerprint: 1234,
                currentFingerprint: 1234,
                lastPersistedAt: now.addingTimeInterval(-5),
                now: now,
                maximumAutosaveSkippableInterval: 60
            )
        )
    }

    func testUnchangedAutosaveFingerprintDoesNotSkipAfterStalenessWindow() {
        let now = Date()
        XCTAssertFalse(
            AppDelegate.shouldSkipSessionAutosaveForUnchangedFingerprint(
                isTerminatingApp: false,
                includeScrollback: false,
                previousFingerprint: 1234,
                currentFingerprint: 1234,
                lastPersistedAt: now.addingTimeInterval(-120),
                now: now,
                maximumAutosaveSkippableInterval: 60
            )
        )
    }

    func testUnchangedAutosaveFingerprintNeverSkipsTerminatingOrScrollbackWrites() {
        let now = Date()
        XCTAssertFalse(
            AppDelegate.shouldSkipSessionAutosaveForUnchangedFingerprint(
                isTerminatingApp: true,
                includeScrollback: false,
                previousFingerprint: 1234,
                currentFingerprint: 1234,
                lastPersistedAt: now.addingTimeInterval(-1),
                now: now
            )
        )
        XCTAssertFalse(
            AppDelegate.shouldSkipSessionAutosaveForUnchangedFingerprint(
                isTerminatingApp: false,
                includeScrollback: true,
                previousFingerprint: 1234,
                currentFingerprint: 1234,
                lastPersistedAt: now.addingTimeInterval(-1),
                now: now
            )
        )
    }

    func testResolvedWindowFramePrefersSavedDisplayIdentity() {
        let savedFrame = SessionRectSnapshot(x: 1_200, y: 100, width: 600, height: 400)
        let savedDisplay = SessionDisplaySnapshot(
            displayID: 2,
            frame: SessionRectSnapshot(x: 1_000, y: 0, width: 1_000, height: 800),
            visibleFrame: SessionRectSnapshot(x: 1_000, y: 0, width: 1_000, height: 800)
        )

        // Display 1 and 2 swapped horizontal positions between snapshot and restore.
        let display1 = AppDelegate.SessionDisplayGeometry(
            displayID: 1,
            frame: CGRect(x: 1_000, y: 0, width: 1_000, height: 800),
            visibleFrame: CGRect(x: 1_000, y: 0, width: 1_000, height: 800)
        )
        let display2 = AppDelegate.SessionDisplayGeometry(
            displayID: 2,
            frame: CGRect(x: 0, y: 0, width: 1_000, height: 800),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_000, height: 800)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: savedDisplay,
            availableDisplays: [display1, display2],
            fallbackDisplay: display1
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertTrue(display2.visibleFrame.intersects(restored))
        XCTAssertFalse(display1.visibleFrame.intersects(restored))
        XCTAssertEqual(restored.width, 600, accuracy: 0.001)
        XCTAssertEqual(restored.height, 400, accuracy: 0.001)
        XCTAssertEqual(restored.minX, 200, accuracy: 0.001)
        XCTAssertEqual(restored.minY, 100, accuracy: 0.001)
    }

    func testResolvedWindowFrameKeepsIntersectingFrameWithoutDisplayMetadata() {
        let savedFrame = SessionRectSnapshot(x: 120, y: 80, width: 500, height: 350)
        let display = AppDelegate.SessionDisplayGeometry(
            displayID: 1,
            frame: CGRect(x: 0, y: 0, width: 1_000, height: 800),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_000, height: 800)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: nil,
            availableDisplays: [display],
            fallbackDisplay: display
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertEqual(restored.minX, 120, accuracy: 0.001)
        XCTAssertEqual(restored.minY, 80, accuracy: 0.001)
        XCTAssertEqual(restored.width, 500, accuracy: 0.001)
        XCTAssertEqual(restored.height, 350, accuracy: 0.001)
    }

    func testResolvedStartupPrimaryWindowFrameFallsBackToPersistedGeometryWhenPrimaryMissing() {
        let fallbackFrame = SessionRectSnapshot(x: 180, y: 140, width: 900, height: 640)
        let fallbackDisplay = SessionDisplaySnapshot(
            displayID: 1,
            frame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000),
            visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000)
        )
        let display = AppDelegate.SessionDisplayGeometry(
            displayID: 1,
            frame: CGRect(x: 0, y: 0, width: 1_600, height: 1_000),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_600, height: 1_000)
        )

        let restored = AppDelegate.resolvedStartupPrimaryWindowFrame(
            primarySnapshot: nil,
            fallbackFrame: fallbackFrame,
            fallbackDisplaySnapshot: fallbackDisplay,
            availableDisplays: [display],
            fallbackDisplay: display
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertEqual(restored.minX, 180, accuracy: 0.001)
        XCTAssertEqual(restored.minY, 140, accuracy: 0.001)
        XCTAssertEqual(restored.width, 900, accuracy: 0.001)
        XCTAssertEqual(restored.height, 640, accuracy: 0.001)
    }

    func testResolvedStartupPrimaryWindowFramePrefersPrimarySnapshotOverFallback() {
        let primarySnapshot = SessionWindowSnapshot(
            frame: SessionRectSnapshot(x: 220, y: 160, width: 980, height: 700),
            display: SessionDisplaySnapshot(
                displayID: 1,
                frame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000),
                visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000)
            ),
            tabManager: SessionTabManagerSnapshot(selectedWorkspaceIndex: nil, workspaces: []),
            sidebar: SessionSidebarSnapshot(isVisible: true, selection: .tabs, width: 220)
        )
        let fallbackFrame = SessionRectSnapshot(x: 40, y: 30, width: 700, height: 500)
        let fallbackDisplay = SessionDisplaySnapshot(
            displayID: 1,
            frame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000),
            visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000)
        )
        let display = AppDelegate.SessionDisplayGeometry(
            displayID: 1,
            frame: CGRect(x: 0, y: 0, width: 1_600, height: 1_000),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_600, height: 1_000)
        )

        let restored = AppDelegate.resolvedStartupPrimaryWindowFrame(
            primarySnapshot: primarySnapshot,
            fallbackFrame: fallbackFrame,
            fallbackDisplaySnapshot: fallbackDisplay,
            availableDisplays: [display],
            fallbackDisplay: display
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertEqual(restored.minX, 220, accuracy: 0.001)
        XCTAssertEqual(restored.minY, 160, accuracy: 0.001)
        XCTAssertEqual(restored.width, 980, accuracy: 0.001)
        XCTAssertEqual(restored.height, 700, accuracy: 0.001)
    }

    func testDecodedPersistedWindowGeometryDataAcceptsCurrentSchema() throws {
        let data = try JSONEncoder().encode(
            AppDelegate.PersistedWindowGeometry(
                version: AppDelegate.persistedWindowGeometrySchemaVersion,
                frame: SessionRectSnapshot(x: 220, y: 160, width: 980, height: 700),
                display: SessionDisplaySnapshot(
                    displayID: 1,
                    frame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000),
                    visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000)
                )
            )
        )

        let decoded = try XCTUnwrap(AppDelegate.decodedPersistedWindowGeometryData(data))
        XCTAssertEqual(decoded.version, AppDelegate.persistedWindowGeometrySchemaVersion)
        XCTAssertEqual(decoded.frame.x, 220, accuracy: 0.001)
        XCTAssertEqual(decoded.frame.y, 160, accuracy: 0.001)
        XCTAssertEqual(decoded.frame.width, 980, accuracy: 0.001)
        XCTAssertEqual(decoded.frame.height, 700, accuracy: 0.001)
        XCTAssertEqual(decoded.display?.displayID, 1)
    }

    func testDecodedPersistedWindowGeometryDataRejectsLegacyUnversionedPayload() throws {
        let data = try JSONEncoder().encode(
            LegacyPersistedWindowGeometry(
                frame: SessionRectSnapshot(x: 180, y: 140, width: 900, height: 640),
                display: SessionDisplaySnapshot(
                    displayID: 1,
                    frame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000),
                    visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 1_600, height: 1_000)
                )
            )
        )

        XCTAssertNil(AppDelegate.decodedPersistedWindowGeometryData(data))
    }

    func testDecodedPersistedWindowGeometryDataRejectsDifferentSchemaVersion() throws {
        let data = try JSONEncoder().encode(
            AppDelegate.PersistedWindowGeometry(
                version: AppDelegate.persistedWindowGeometrySchemaVersion + 1,
                frame: SessionRectSnapshot(x: 220, y: 160, width: 980, height: 700),
                display: nil
            )
        )

        XCTAssertNil(AppDelegate.decodedPersistedWindowGeometryData(data))
    }

    func testResolvedWindowFrameCentersInFallbackDisplayWhenOffscreen() {
        let savedFrame = SessionRectSnapshot(x: 4_000, y: 4_000, width: 900, height: 700)
        let display = AppDelegate.SessionDisplayGeometry(
            displayID: 1,
            frame: CGRect(x: 0, y: 0, width: 1_000, height: 800),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_000, height: 800)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: nil,
            availableDisplays: [display],
            fallbackDisplay: display
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertTrue(display.visibleFrame.contains(restored))
        XCTAssertEqual(restored.minX, 50, accuracy: 0.001)
        XCTAssertEqual(restored.minY, 50, accuracy: 0.001)
        XCTAssertEqual(restored.width, 900, accuracy: 0.001)
        XCTAssertEqual(restored.height, 700, accuracy: 0.001)
    }

    func testResolvedWindowFramePreservesExactGeometryWhenDisplayIsUnchanged() {
        let savedFrame = SessionRectSnapshot(x: 1_303, y: -90, width: 1_280, height: 1_410)
        let savedDisplay = SessionDisplaySnapshot(
            displayID: 2,
            frame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_410)
        )
        let display = AppDelegate.SessionDisplayGeometry(
            displayID: 2,
            frame: CGRect(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: CGRect(x: 0, y: 0, width: 2_560, height: 1_410)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: savedDisplay,
            availableDisplays: [display],
            fallbackDisplay: display
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertEqual(restored.minX, 1_303, accuracy: 0.001)
        XCTAssertEqual(restored.minY, -90, accuracy: 0.001)
        XCTAssertEqual(restored.width, 1_280, accuracy: 0.001)
        XCTAssertEqual(restored.height, 1_410, accuracy: 0.001)
    }

    func testResolvedWindowFramePreservesExactGeometryWhenDisplayChangesButWindowRemainsAccessible() {
        let savedFrame = SessionRectSnapshot(x: 1_100, y: -20, width: 1_280, height: 1_000)
        let savedDisplay = SessionDisplaySnapshot(
            displayID: 2,
            frame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_410)
        )
        let adjustedDisplay = AppDelegate.SessionDisplayGeometry(
            displayID: 2,
            frame: CGRect(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: CGRect(x: 0, y: 40, width: 2_560, height: 1_360)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: savedDisplay,
            availableDisplays: [adjustedDisplay],
            fallbackDisplay: adjustedDisplay
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertEqual(restored.minX, 1_100, accuracy: 0.001)
        XCTAssertEqual(restored.minY, -20, accuracy: 0.001)
        XCTAssertEqual(restored.width, 1_280, accuracy: 0.001)
        XCTAssertEqual(restored.height, 1_000, accuracy: 0.001)
    }

    func testResolvedWindowFrameClampsWhenDisplayGeometryChangesEvenWithSameDisplayID() {
        let savedFrame = SessionRectSnapshot(x: 1_303, y: -90, width: 1_280, height: 1_410)
        let savedDisplay = SessionDisplaySnapshot(
            displayID: 2,
            frame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: SessionRectSnapshot(x: 0, y: 0, width: 2_560, height: 1_410)
        )
        let resizedDisplay = AppDelegate.SessionDisplayGeometry(
            displayID: 2,
            frame: CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
            visibleFrame: CGRect(x: 0, y: 0, width: 1_920, height: 1_050)
        )

        let restored = AppDelegate.resolvedWindowFrame(
            from: savedFrame,
            display: savedDisplay,
            availableDisplays: [resizedDisplay],
            fallbackDisplay: resizedDisplay
        )

        XCTAssertNotNil(restored)
        guard let restored else { return }
        XCTAssertTrue(resizedDisplay.visibleFrame.contains(restored))
        XCTAssertNotEqual(restored.minX, 1_303, "Changed display geometry should clamp/remap frame")
        XCTAssertNotEqual(restored.minY, -90, "Changed display geometry should clamp/remap frame")
    }

    func testResolvedSnapshotTerminalScrollbackPrefersCaptured() {
        let resolved = Workspace.resolvedSnapshotTerminalScrollback(
            capturedScrollback: "captured-value",
            fallbackScrollback: "fallback-value"
        )

        XCTAssertEqual(resolved, "captured-value")
    }

    func testResolvedSnapshotTerminalScrollbackFallsBackWhenCaptureMissing() {
        let resolved = Workspace.resolvedSnapshotTerminalScrollback(
            capturedScrollback: nil,
            fallbackScrollback: "fallback-value"
        )

        XCTAssertEqual(resolved, "fallback-value")
    }

    func testResolvedSnapshotTerminalScrollbackTruncatesFallback() {
        let oversizedFallback = String(
            repeating: "x",
            count: SessionPersistencePolicy.maxScrollbackCharactersPerTerminal + 37
        )
        let resolved = Workspace.resolvedSnapshotTerminalScrollback(
            capturedScrollback: nil,
            fallbackScrollback: oversizedFallback
        )

        XCTAssertEqual(
            resolved?.count,
            SessionPersistencePolicy.maxScrollbackCharactersPerTerminal
        )
    }

    func testResolvedSnapshotTerminalScrollbackSkipsFallbackWhenRestoreIsUnsafe() {
        let resolved = Workspace.resolvedSnapshotTerminalScrollback(
            capturedScrollback: nil,
            fallbackScrollback: "fallback-value",
            allowFallbackScrollback: false
        )

        XCTAssertNil(resolved)
    }

    private func makeSnapshot(version: Int) -> AppSessionSnapshot {
        let workspace = SessionWorkspaceSnapshot(
            processTitle: "Terminal",
            customTitle: "Restored",
            customColor: nil,
            isPinned: true,
            currentDirectory: "/tmp",
            focusedPanelId: nil,
            layout: .pane(SessionPaneLayoutSnapshot(panelIds: [], selectedPanelId: nil)),
            panels: [],
            statusEntries: [],
            logEntries: [],
            progress: nil,
            gitBranch: nil
        )

        let tabManager = SessionTabManagerSnapshot(
            selectedWorkspaceIndex: 0,
            workspaces: [workspace]
        )

        let window = SessionWindowSnapshot(
            frame: SessionRectSnapshot(x: 10, y: 20, width: 900, height: 700),
            display: SessionDisplaySnapshot(
                displayID: 42,
                frame: SessionRectSnapshot(x: 0, y: 0, width: 1920, height: 1200),
                visibleFrame: SessionRectSnapshot(x: 0, y: 25, width: 1920, height: 1175)
            ),
            tabManager: tabManager,
            sidebar: SessionSidebarSnapshot(isVisible: true, selection: .tabs, width: 240)
        )

        return AppSessionSnapshot(
            version: version,
            createdAt: Date().timeIntervalSince1970,
            windows: [window]
        )
    }

    private func fileNumber(for fileURL: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        return try XCTUnwrap(attributes[.systemFileNumber] as? Int)
    }
}

final class SocketListenerAcceptPolicyTests: XCTestCase {
    func testAcceptErrorClassificationBucketsExpectedErrnos() {
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: EINTR),
            "immediate_retry"
        )
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: ECONNABORTED),
            "immediate_retry"
        )
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: EMFILE),
            "resource_pressure"
        )
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: ENOMEM),
            "resource_pressure"
        )
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: EBADF),
            "fatal"
        )
        XCTAssertEqual(
            TerminalController.acceptErrorClassification(errnoCode: EINVAL),
            "fatal"
        )
    }

    func testAcceptErrorPolicySignalsRearmOnlyForFatalErrors() {
        XCTAssertTrue(TerminalController.shouldRearmListenerForAcceptError(errnoCode: EBADF))
        XCTAssertTrue(TerminalController.shouldRearmListenerForAcceptError(errnoCode: ENOTSOCK))
        XCTAssertFalse(TerminalController.shouldRearmListenerForAcceptError(errnoCode: EMFILE))
        XCTAssertFalse(TerminalController.shouldRearmListenerForAcceptError(errnoCode: EINTR))
    }

    func testAcceptErrorPolicyRearmsAfterPersistentFailures() {
        XCTAssertFalse(TerminalController.shouldRearmForConsecutiveAcceptFailures(consecutiveFailures: 0))
        XCTAssertFalse(TerminalController.shouldRearmForConsecutiveAcceptFailures(consecutiveFailures: 49))
        XCTAssertTrue(TerminalController.shouldRearmForConsecutiveAcceptFailures(consecutiveFailures: 50))
        XCTAssertTrue(TerminalController.shouldRearmForConsecutiveAcceptFailures(consecutiveFailures: 120))
    }

    func testAcceptFailureBackoffIsExponentialAndCapped() {
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 0),
            0
        )
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 1),
            10
        )
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 2),
            20
        )
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 6),
            320
        )
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 12),
            5_000
        )
        XCTAssertEqual(
            TerminalController.acceptFailureBackoffMilliseconds(consecutiveFailures: 50),
            5_000
        )
    }

    func testAcceptFailureRearmDelayAppliesMinimumThrottle() {
        XCTAssertEqual(
            TerminalController.acceptFailureRearmDelayMilliseconds(consecutiveFailures: 0),
            100
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRearmDelayMilliseconds(consecutiveFailures: 1),
            100
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRearmDelayMilliseconds(consecutiveFailures: 2),
            100
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRearmDelayMilliseconds(consecutiveFailures: 6),
            320
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRearmDelayMilliseconds(consecutiveFailures: 12),
            5_000
        )
    }

    func testAcceptFailureRecoveryActionResumesAfterDelayForTransientErrors() {
        XCTAssertEqual(
            TerminalController.acceptFailureRecoveryAction(
                errnoCode: EPROTO,
                consecutiveFailures: 1
            ),
            .resumeAfterDelay(delayMs: 10)
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRecoveryAction(
                errnoCode: EMFILE,
                consecutiveFailures: 3
            ),
            .resumeAfterDelay(delayMs: 40)
        )
    }

    func testAcceptFailureRecoveryActionRearmsForFatalAndPersistentFailures() {
        XCTAssertEqual(
            TerminalController.acceptFailureRecoveryAction(
                errnoCode: EBADF,
                consecutiveFailures: 1
            ),
            .rearmAfterDelay(delayMs: 100)
        )
        XCTAssertEqual(
            TerminalController.acceptFailureRecoveryAction(
                errnoCode: EPROTO,
                consecutiveFailures: 50
            ),
            .rearmAfterDelay(delayMs: 5_000)
        )
    }

    func testAcceptFailureBreadcrumbSamplingPrefersEarlyAndPowerOfTwoMilestones() {
        XCTAssertTrue(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 1))
        XCTAssertTrue(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 2))
        XCTAssertTrue(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 3))
        XCTAssertFalse(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 5))
        XCTAssertTrue(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 8))
        XCTAssertFalse(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 9))
        XCTAssertTrue(TerminalController.shouldEmitAcceptFailureBreadcrumb(consecutiveFailures: 16))
    }

    func testAcceptLoopCleanupUnlinkPolicySkipsDuringListenerStartup() {
        XCTAssertFalse(
            TerminalController.shouldUnlinkSocketPathAfterAcceptLoopCleanup(
                pathMatches: true,
                isRunning: false,
                activeGeneration: 0,
                listenerStartInProgress: true
            )
        )
        XCTAssertFalse(
            TerminalController.shouldUnlinkSocketPathAfterAcceptLoopCleanup(
                pathMatches: false,
                isRunning: false,
                activeGeneration: 0,
                listenerStartInProgress: false
            )
        )
        XCTAssertFalse(
            TerminalController.shouldUnlinkSocketPathAfterAcceptLoopCleanup(
                pathMatches: true,
                isRunning: true,
                activeGeneration: 7,
                listenerStartInProgress: false
            )
        )
        XCTAssertTrue(
            TerminalController.shouldUnlinkSocketPathAfterAcceptLoopCleanup(
                pathMatches: true,
                isRunning: false,
                activeGeneration: 0,
                listenerStartInProgress: false
            )
        )
    }
}

final class SidebarDragFailsafePolicyTests: XCTestCase {
    func testRequestsClearWhenMonitorStartsAfterMouseRelease() {
        XCTAssertTrue(
            SidebarDragFailsafePolicy.shouldRequestClearWhenMonitoringStarts(
                isLeftMouseButtonDown: false
            )
        )
        XCTAssertFalse(
            SidebarDragFailsafePolicy.shouldRequestClearWhenMonitoringStarts(
                isLeftMouseButtonDown: true
            )
        )
    }

    func testRequestsClearForLeftMouseUpEventsOnly() {
        XCTAssertTrue(
            SidebarDragFailsafePolicy.shouldRequestClear(
                forMouseEventType: .leftMouseUp
            )
        )
        XCTAssertFalse(
            SidebarDragFailsafePolicy.shouldRequestClear(
                forMouseEventType: .leftMouseDragged
            )
        )
    }
}

@MainActor
final class AgentPickerAndT3ServerManagerTests: XCTestCase {
    func testQueryT3ThreadsScopesToExactWorkspaceDirectory() throws {
        let root = try makeTemporaryDirectory(prefix: "cmux-t3-picker")
        defer { try? FileManager.default.removeItem(at: root) }

        let dbURL = root.appendingPathComponent("state.sqlite")
        try createT3Database(
            at: dbURL,
            projects: [
                (id: "project-terminal", workspaceRoot: "/Users/tim/Desktop/terminal"),
                (id: "project-notes", workspaceRoot: "/Users/tim/Desktop/notes"),
            ],
            threads: [
                (
                    id: "thread-terminal-root",
                    projectId: "project-terminal",
                    title: "terminal root",
                    worktreePath: nil,
                    updatedAt: "2026-04-08T10:00:00.000Z"
                ),
                (
                    id: "thread-notes-root",
                    projectId: "project-notes",
                    title: "notes root",
                    worktreePath: nil,
                    updatedAt: "2026-04-08T11:00:00.000Z"
                ),
            ]
        )

        let threads = AgentPickerDataSource.queryT3Threads(
            at: dbURL.path,
            workspaceDirectory: "/Users/tim/Desktop/terminal",
            limit: 20
        )

        XCTAssertEqual(threads.map(\.threadId), ["thread-terminal-root"])
    }

    func testQueryT3ThreadsPrefersWorktreePathOverWorkspaceRoot() throws {
        let root = try makeTemporaryDirectory(prefix: "cmux-t3-picker")
        defer { try? FileManager.default.removeItem(at: root) }

        let dbURL = root.appendingPathComponent("state.sqlite")
        try createT3Database(
            at: dbURL,
            projects: [
                (id: "project-terminal", workspaceRoot: "/Users/tim/Desktop/terminal"),
            ],
            threads: [
                (
                    id: "thread-root",
                    projectId: "project-terminal",
                    title: "root thread",
                    worktreePath: nil,
                    updatedAt: "2026-04-08T10:00:00.000Z"
                ),
                (
                    id: "thread-worktree",
                    projectId: "project-terminal",
                    title: "worktree thread",
                    worktreePath: "/Users/tim/Desktop/terminal-worktree",
                    updatedAt: "2026-04-08T11:00:00.000Z"
                ),
            ]
        )

        let threads = AgentPickerDataSource.queryT3Threads(
            at: dbURL.path,
            workspaceDirectory: "/Users/tim/Desktop/terminal",
            limit: 20
        )

        XCTAssertEqual(threads.map(\.threadId), ["thread-root"])
    }

    func testQueryOpenCodeSessionsScopesToExactDirectory() throws {
        let root = try makeTemporaryDirectory(prefix: "cmux-opencode-picker")
        defer { try? FileManager.default.removeItem(at: root) }

        let dbURL = root.appendingPathComponent("opencode.db")
        try createOpenCodeDatabase(
            at: dbURL,
            sessions: [
                (
                    id: "session-terminal",
                    title: "terminal session",
                    timeUpdated: 1_744_108_800_000,
                    directory: "/Users/tim/Desktop/terminal"
                ),
                (
                    id: "session-notes",
                    title: "notes session",
                    timeUpdated: 1_744_108_900_000,
                    directory: "/Users/tim/Desktop/notes"
                ),
            ]
        )

        let sessions = AgentPickerDataSource.queryOpenCodeSessions(
            at: dbURL.path,
            directory: "/Users/tim/Desktop/terminal",
            limit: 20
        )

        XCTAssertEqual(sessions.map(\.id), ["session-terminal"])
    }

    func testT3ServerEnvironmentUsesWorkspaceCwdAndGlobalT3Home() {
        let projectDirectory = "/Users/tester/project"
        let t3HomeDirectory = T3ServerManager.resolvedT3HomeDirectory(homeDirectory: "/Users/tester")
        let environment = T3ServerManager.makeEnvironment(
            projectDirectory: projectDirectory,
            t3HomeDirectory: t3HomeDirectory,
            reservedPort: 43123,
            serverDirectory: URL(fileURLWithPath: "/tmp/t3code-server"),
            baseEnvironment: [:]
        )

        XCTAssertEqual(t3HomeDirectory, "/Users/tester/.t3")
        XCTAssertEqual(environment["T3CODE_HOME"], "/Users/tester/.t3")
        XCTAssertEqual(environment["T3CODE_PORT"], "43123")
        XCTAssertEqual(environment["T3CODE_HOST"], "127.0.0.1")
        XCTAssertEqual(environment["NODE_PATH"], "/tmp/t3code-server/node_modules")
        XCTAssertNotEqual(environment["T3CODE_HOME"], projectDirectory)
    }

    func testT3CodeWebSupportUsesServerClientDirectoryAndTwoStageScripts() {
        let bundleURL = URL(fileURLWithPath: "/tmp/cmux.app/Contents/Resources", isDirectory: true)
        let clientURL = T3CodeWebSupport.bundledClientDirectory(bundleURL: bundleURL)
        let themeURL = T3CodeWebSupport.bundledThemeURL(bundleURL: bundleURL)

        XCTAssertEqual(T3CodeWebSupport.bundledClientRelativePath, "t3code-server/client")
        XCTAssertEqual(T3CodeWebSupport.bundledThemeFilename, "cmux-ernest-theme.css")
        XCTAssertEqual(clientURL.path, "/tmp/cmux.app/Contents/Resources/t3code-server/client")
        XCTAssertEqual(
            themeURL.path,
            "/tmp/cmux.app/Contents/Resources/t3code-server/client/cmux-ernest-theme.css"
        )

        let tempDir = try! makeTemporaryDirectory(prefix: "cmux-t3-theme")
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let resourcesDir = tempDir.appendingPathComponent("Contents/Resources", isDirectory: true)
        let clientDir = T3CodeWebSupport.bundledClientDirectory(bundleURL: resourcesDir)
        try! FileManager.default.createDirectory(at: clientDir, withIntermediateDirectories: true)
        try! "html[data-cmux-t3-theme='ernest']{color-scheme:light;}".write(
            to: T3CodeWebSupport.bundledThemeURL(bundleURL: resourcesDir),
            atomically: true,
            encoding: .utf8
        )

        let scripts = T3CodeWebSupport.makeInitialUserScripts(bundleURL: resourcesDir)
        XCTAssertEqual(scripts.count, 2)
        XCTAssertEqual(scripts[0].injectionTime, .atDocumentStart)
        XCTAssertEqual(scripts[1].injectionTime, .atDocumentEnd)
    }

    func testT3CodeWebSupportSkipsScriptsWhenThemeDisabled() {
        let tempDir = try! makeTemporaryDirectory(prefix: "cmux-t3-theme-disabled")
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let resourcesDir = tempDir.appendingPathComponent("Contents/Resources", isDirectory: true)
        let clientDir = T3CodeWebSupport.bundledClientDirectory(bundleURL: resourcesDir)
        try! FileManager.default.createDirectory(at: clientDir, withIntermediateDirectories: true)
        try! "html[data-cmux-t3-theme='ernest']{color-scheme:light;}".write(
            to: T3CodeWebSupport.bundledThemeURL(bundleURL: resourcesDir),
            atomically: true,
            encoding: .utf8
        )

        let suiteName = "cmux-t3-theme-disabled-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(false, forKey: T3CodeWebSupport.hostThemeEnabledDefaultsKey)

        let scripts = T3CodeWebSupport.makeInitialUserScripts(
            bundleURL: resourcesDir,
            userDefaults: defaults
        )

        XCTAssertTrue(scripts.isEmpty)
        XCTAssertFalse(T3CodeWebSupport.isHostThemeEnabled(userDefaults: defaults))
    }

    func testT3CodeWebSupportReadinessDispositionDistinguishesReadyMissingShellAndDisabled() {
        let readyPayload = T3CodeWebSupport.ThemeProbePayload(
            theme: "ernest",
            critical: true,
            full: true,
            installed: true,
            autoDisabled: false,
            disableReason: nil,
            headerPresent: true,
            composerPresent: false,
            mainPresent: false,
            interactiveElementCount: 3,
            bodyTextLength: 42,
            composerShellTagged: false,
            composerEditorTagged: false,
            headerBadgeTaggedCount: 0,
            toolbarClusterTaggedCount: 0,
            toolbarButtonTaggedCount: 0,
            userShellTaggedCount: 0,
            timestampTaggedCount: 0,
            scrollButtonTaggedCount: 0,
            consoleLogCount: 0,
            errorLogCount: 0,
            recentConsoleLog: [],
            recentErrorLog: []
        )
        XCTAssertEqual(
            T3CodeWebSupport.readinessDisposition(from: readyPayload, themeEnabled: true),
            .themeInstalledAndReady
        )

        let genericBodyPayload = T3CodeWebSupport.ThemeProbePayload(
            theme: "ernest",
            critical: true,
            full: true,
            installed: true,
            autoDisabled: false,
            disableReason: nil,
            headerPresent: false,
            composerPresent: false,
            mainPresent: false,
            interactiveElementCount: 5,
            bodyTextLength: 128,
            composerShellTagged: false,
            composerEditorTagged: false,
            headerBadgeTaggedCount: 0,
            toolbarClusterTaggedCount: 0,
            toolbarButtonTaggedCount: 0,
            userShellTaggedCount: 0,
            timestampTaggedCount: 0,
            scrollButtonTaggedCount: 0,
            consoleLogCount: 0,
            errorLogCount: 0,
            recentConsoleLog: [],
            recentErrorLog: []
        )
        XCTAssertEqual(
            T3CodeWebSupport.readinessDisposition(from: genericBodyPayload, themeEnabled: true),
            .themeInstalledButMissingShell
        )

        let missingShellPayload = T3CodeWebSupport.ThemeProbePayload(
            theme: "ernest",
            critical: true,
            full: true,
            installed: true,
            autoDisabled: false,
            disableReason: nil,
            headerPresent: false,
            composerPresent: false,
            mainPresent: false,
            interactiveElementCount: 0,
            bodyTextLength: 0,
            composerShellTagged: true,
            composerEditorTagged: true,
            headerBadgeTaggedCount: 1,
            toolbarClusterTaggedCount: 1,
            toolbarButtonTaggedCount: 4,
            userShellTaggedCount: 1,
            timestampTaggedCount: 1,
            scrollButtonTaggedCount: 1,
            consoleLogCount: 0,
            errorLogCount: 0,
            recentConsoleLog: [],
            recentErrorLog: []
        )
        XCTAssertEqual(
            T3CodeWebSupport.readinessDisposition(from: missingShellPayload, themeEnabled: true),
            .themeInstalledButMissingShell
        )

        let jsErrorPayload = T3CodeWebSupport.ThemeProbePayload(
            theme: "ernest",
            critical: true,
            full: true,
            installed: true,
            autoDisabled: false,
            disableReason: nil,
            headerPresent: false,
            composerPresent: false,
            mainPresent: false,
            interactiveElementCount: 0,
            bodyTextLength: 0,
            composerShellTagged: false,
            composerEditorTagged: false,
            headerBadgeTaggedCount: 0,
            toolbarClusterTaggedCount: 0,
            toolbarButtonTaggedCount: 0,
            userShellTaggedCount: 0,
            timestampTaggedCount: 0,
            scrollButtonTaggedCount: 0,
            consoleLogCount: 1,
            errorLogCount: 1,
            recentConsoleLog: ["boom"],
            recentErrorLog: ["ReferenceError: x is not defined"]
        )
        XCTAssertEqual(
            T3CodeWebSupport.readinessDisposition(from: jsErrorPayload, themeEnabled: true),
            .jsErrorDetectedBeforeReady
        )

        XCTAssertEqual(
            T3CodeWebSupport.readinessDisposition(from: nil, themeEnabled: false),
            .themeDisabled
        )
    }

    private func makeTemporaryDirectory(prefix: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func createT3Database(
        at dbURL: URL,
        projects: [(id: String, workspaceRoot: String)],
        threads: [(id: String, projectId: String, title: String, worktreePath: String?, updatedAt: String)]
    ) throws {
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbURL.path, &db), SQLITE_OK)
        guard let db else {
            XCTFail("Expected sqlite database handle")
            return
        }
        defer { sqlite3_close(db) }

        try executeSQL(
            """
            CREATE TABLE projection_projects (
                project_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                workspace_root TEXT NOT NULL,
                scripts_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                default_model_selection_json TEXT
            );
            CREATE TABLE projection_threads (
                thread_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                branch TEXT,
                worktree_path TEXT,
                latest_turn_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                runtime_mode TEXT NOT NULL DEFAULT 'full-access',
                interaction_mode TEXT NOT NULL DEFAULT 'default',
                model_selection_json TEXT,
                archived_at TEXT
            );
            """,
            in: db
        )

        for project in projects {
            try executeSQL(
                """
                INSERT INTO projection_projects (
                    project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
                ) VALUES (
                    '\(project.id)', '\(project.id)', '\(project.workspaceRoot)', '[]',
                    '2026-04-08T09:00:00.000Z', '2026-04-08T09:00:00.000Z', NULL
                );
                """,
                in: db
            )
        }

        for thread in threads {
            let worktreePathValue = thread.worktreePath.map { "'\($0)'" } ?? "NULL"
            try executeSQL(
                """
                INSERT INTO projection_threads (
                    thread_id, project_id, title, branch, worktree_path, latest_turn_id,
                    created_at, updated_at, deleted_at, runtime_mode, interaction_mode,
                    model_selection_json, archived_at
                ) VALUES (
                    '\(thread.id)', '\(thread.projectId)', '\(thread.title)', NULL, \(worktreePathValue), NULL,
                    '2026-04-08T09:00:00.000Z', '\(thread.updatedAt)', NULL,
                    'full-access', 'default', NULL, NULL
                );
                """,
                in: db
            )
        }
    }

    private func createOpenCodeDatabase(
        at dbURL: URL,
        sessions: [(id: String, title: String, timeUpdated: Int64, directory: String)]
    ) throws {
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbURL.path, &db), SQLITE_OK)
        guard let db else {
            XCTFail("Expected sqlite database handle")
            return
        }
        defer { sqlite3_close(db) }

        try executeSQL(
            """
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                time_updated INTEGER NOT NULL,
                time_archived INTEGER,
                parent_id TEXT,
                directory TEXT NOT NULL
            );
            """,
            in: db
        )

        for session in sessions {
            try executeSQL(
                """
                INSERT INTO session (
                    id, title, time_updated, time_archived, parent_id, directory
                ) VALUES (
                    '\(session.id)', '\(session.title)', \(session.timeUpdated), NULL, NULL, '\(session.directory)'
                );
                """,
                in: db
            )
        }
    }

    private func executeSQL(_ sql: String, in db: OpaquePointer) throws {
        var errorMessage: UnsafeMutablePointer<Int8>?
        defer { sqlite3_free(errorMessage) }
        if sqlite3_exec(db, sql, nil, nil, &errorMessage) != SQLITE_OK {
            let message = errorMessage.map { String(cString: $0) } ?? "Unknown sqlite error"
            throw NSError(domain: "AgentPickerAndT3ServerManagerTests", code: 1, userInfo: [
                NSLocalizedDescriptionKey: message,
            ])
        }
    }
}
