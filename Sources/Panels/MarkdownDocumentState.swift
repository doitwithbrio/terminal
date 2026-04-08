import Foundation

@MainActor
final class MarkdownDocumentState: ObservableObject {
    @Published private(set) var content: String = ""
    @Published private(set) var isFileUnavailable: Bool = false
    @Published private(set) var filePath: String?

    private nonisolated(unsafe) var fileWatchSource: DispatchSourceFileSystemObject?
    private var isClosed: Bool = false
    private let watchQueue = DispatchQueue(label: "com.cmux.markdown-document-watch", qos: .utility)

    private static let maxReattachAttempts = 6
    private static let reattachDelay: TimeInterval = 0.5

    init(filePath: String? = nil) {
        setFilePath(filePath)
    }

    func setFilePath(_ newFilePath: String?) {
        stopWatching()
        filePath = newFilePath?.trimmingCharacters(in: .whitespacesAndNewlines)
        isClosed = false

        guard let filePath, !filePath.isEmpty else {
            content = ""
            isFileUnavailable = false
            return
        }

        loadFileContent()
        startWatching()
        if isFileUnavailable && fileWatchSource == nil {
            scheduleReattach(attempt: 1)
        }
    }

    func close() {
        isClosed = true
        stopWatching()
    }

    private func loadFileContent() {
        guard let filePath, !filePath.isEmpty else {
            content = ""
            isFileUnavailable = false
            return
        }

        do {
            content = try String(contentsOfFile: filePath, encoding: .utf8)
            isFileUnavailable = false
        } catch {
            if let data = FileManager.default.contents(atPath: filePath),
               let decoded = String(data: data, encoding: .isoLatin1) {
                content = decoded
                isFileUnavailable = false
            } else {
                content = ""
                isFileUnavailable = true
            }
        }
    }

    private func startWatching() {
        guard let filePath, !filePath.isEmpty else { return }
        let fileDescriptor = open(filePath, O_EVTONLY)
        guard fileDescriptor >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename, .extend],
            queue: watchQueue
        )

        source.setEventHandler { [weak self] in
            guard let self else { return }
            let flags = source.data
            if flags.contains(.delete) || flags.contains(.rename) {
                DispatchQueue.main.async {
                    self.stopWatching()
                    self.loadFileContent()
                    if self.isFileUnavailable {
                        self.scheduleReattach(attempt: 1)
                    } else {
                        self.startWatching()
                    }
                }
            } else {
                DispatchQueue.main.async {
                    self.loadFileContent()
                }
            }
        }

        source.setCancelHandler {
            Darwin.close(fileDescriptor)
        }

        source.resume()
        fileWatchSource = source
    }

    private func scheduleReattach(attempt: Int) {
        guard attempt <= Self.maxReattachAttempts else { return }
        watchQueue.asyncAfter(deadline: .now() + Self.reattachDelay) { [weak self] in
            guard let self else { return }
            DispatchQueue.main.async {
                guard !self.isClosed,
                      let filePath = self.filePath,
                      !filePath.isEmpty else { return }
                if FileManager.default.fileExists(atPath: filePath) {
                    self.isFileUnavailable = false
                    self.loadFileContent()
                    self.startWatching()
                } else {
                    self.scheduleReattach(attempt: attempt + 1)
                }
            }
        }
    }

    private func stopWatching() {
        if let source = fileWatchSource {
            source.cancel()
            fileWatchSource = nil
        }
    }

    deinit {
        fileWatchSource?.cancel()
    }
}
