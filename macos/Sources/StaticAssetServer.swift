import Foundation
import Network

/// Serves only the signed bundle's static export; this is never a proxy or a bridge endpoint.
final class StaticAssetServer {
    private let root: URL
    private static let headerTerminator = Data("\r\n\r\n".utf8)
    private static let headPrefix = Data("HEAD ".utf8)
    private let queue = DispatchQueue(label: "com.youwenqwq.ysuclient.assets")
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: Client] = [:]
    private var stopped = false
    private var reportedFailure = false

    init(root: URL) throws {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: canonical.path, isDirectory: &isDirectory),
              isDirectory.boolValue,
              FileManager.default.fileExists(atPath: canonical.appendingPathComponent("index.html").path) else {
            throw ServerError.missingResources
        }
        self.root = canonical
    }

    func start(onReady: @escaping () -> Void, onFailure: @escaping () -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: AppOrigin.port)!)
        // 允许复用 TIME_WAIT；仍在监听的实例不会被顶掉。
        parameters.allowLocalEndpointReuse = true
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            switch state {
            case .ready:
                DispatchQueue.main.async(execute: onReady)
            case .failed:
                guard !self.reportedFailure else { return }
                self.reportedFailure = true
                self.stopOnQueue()
                DispatchQueue.main.async(execute: onFailure)
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self, !self.stopped else {
                connection.cancel()
                return
            }
            let identifier = ObjectIdentifier(connection)
            let client = Client(connection: connection, server: self, queue: self.queue) { [weak self] in
                self?.clients.removeValue(forKey: identifier)
            }
            self.clients[identifier] = client
            client.start()
        }
        listener.start(queue: queue)
    }

    func stop() {
        queue.sync { stopOnQueue() }
    }

    private func stopOnQueue() {
        guard !stopped else { return }
        stopped = true
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
        let active = Array(clients.values)
        clients.removeAll()
        for client in active { client.close() }
    }

    private func response(for header: Data) -> Response {
        guard let text = String(data: header, encoding: .utf8) else { return .error(400) }
        let lines = text.components(separatedBy: "\r\n")
        guard let first = lines.first else { return .error(400) }
        let request = first.split(separator: " ", omittingEmptySubsequences: false)
        guard request.count == 3, request[2] == "HTTP/1.1" || request[2] == "HTTP/1.0" else {
            return .error(400)
        }
        let method = String(request[0])
        guard method == "GET" || method == "HEAD" else { return .error(405) }
        var fields: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { return .error(400) }
            let name = String(line[..<colon]).lowercased()
            guard name.utf8.allSatisfy({ Self.headerToken.contains($0) }), fields[name] == nil else {
                return .error(400)
            }
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !value.unicodeScalars.contains(where: { $0.value < 32 && $0.value != 9 || $0.value == 127 }) else {
                return .error(400)
            }
            fields[name] = value
        }
        guard fields["host"] == AppOrigin.authority else { return .error(403) }
        guard fields["transfer-encoding"] == nil,
              fields["content-length"] == nil || fields["content-length"] == "0" else { return .error(400) }

        let target = String(request[1])
        guard target.hasPrefix("/"), !target.hasPrefix("//"), !target.contains("#") else { return .error(400) }
        let encodedPath = String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard let path = encodedPath.removingPercentEncoding,
              !path.contains("\\"), !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            return .error(400)
        }
        let components = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.contains(where: { $0 == "." || $0 == ".." || $0.hasPrefix(".") }) else {
            return .error(403)
        }
        var file = root.appendingPathComponent(components.joined(separator: "/"))
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory) else { return .error(404) }
        if isDirectory.boolValue { file.appendPathComponent("index.html") }
        file = file.standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else { return .error(403) }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  let size = attributes[.size] as? NSNumber else { return .error(404) }
            let body: Data
            if method == "HEAD" {
                body = Data()
            } else {
                body = try Data(contentsOf: file, options: .mappedIfSafe)
            }
            return Response(status: 200, mime: Self.mimeType(file.pathExtension), length: size.intValue, body: body)
        } catch {
            return .error(404)
        }
    }

    private static let headerToken = Set("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyz".utf8)

    private static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "txt": return "text/plain; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "avif": return "image/avif"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "webmanifest": return "application/manifest+json"
        case "wasm": return "application/wasm"
        case "pdf": return "application/pdf"
        case "mp4": return "video/mp4"
        case "mp3": return "audio/mpeg"
        default: return "application/octet-stream"
        }
    }

    private struct Response {
        let status: Int
        let mime: String
        let length: Int
        let body: Data

        static func error(_ status: Int) -> Response {
            let body = Data("\(status)\n".utf8)
            return Response(status: status, mime: "text/plain; charset=utf-8", length: body.count, body: body)
        }

        var header: Data {
            let reason: String
            switch status {
            case 200: reason = "OK"
            case 400: reason = "Bad Request"
            case 403: reason = "Forbidden"
            case 404: reason = "Not Found"
            case 405: reason = "Method Not Allowed"
            case 431: reason = "Request Header Fields Too Large"
            default: reason = "Error"
            }
            let allow = status == 405 ? "Allow: GET, HEAD\r\n" : ""
            return Data("HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(mime)\r\nContent-Length: \(length)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\(allow)\r\n".utf8)
        }
    }

    private final class Client {
        let connection: NWConnection
        private weak var server: StaticAssetServer?
        private let queue: DispatchQueue
        private let onClose: () -> Void
        private var buffer = Data()
        private var deadline: DispatchWorkItem?
        private var closed = false

        init(connection: NWConnection, server: StaticAssetServer, queue: DispatchQueue, onClose: @escaping () -> Void) {
            self.connection = connection
            self.server = server
            self.queue = queue
            self.onClose = onClose
        }

        func start() {
            connection.stateUpdateHandler = { [weak self] state in
                switch state {
                case .failed, .cancelled: self?.close()
                default: break
                }
            }
            let deadline = DispatchWorkItem { [weak self] in self?.close() }
            self.deadline = deadline
            queue.asyncAfter(deadline: .now() + 15, execute: deadline)
            connection.start(queue: queue)
            receive()
        }

        private func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
                guard let self, !self.closed else { return }
                if let data { self.buffer.append(data) }
                if let end = self.buffer.range(of: StaticAssetServer.headerTerminator) {
                    guard end.upperBound <= 32768 else { self.send(.error(431)); return }
                    guard let server = self.server else { self.close(); return }
                    let response = server.response(for: self.buffer[..<end.lowerBound])
                    self.send(response)
                } else if self.buffer.count > 32768 {
                    self.send(.error(431))
                } else if complete || error != nil {
                    self.close()
                } else {
                    self.receive()
                }
            }
        }

        private func send(_ response: Response) {
            connection.send(content: response.header, completion: .contentProcessed { [weak self] error in
                guard let self, !self.closed else { return }
                guard error == nil else { self.close(); return }
                let body = self.buffer.starts(with: StaticAssetServer.headPrefix) ? Data() : response.body
                self.connection.send(content: body, isComplete: true, completion: .contentProcessed { [weak self] _ in
                    self?.close()
                })
            })
        }

        func close() {
            guard !closed else { return }
            closed = true
            deadline?.cancel()
            deadline = nil
            connection.stateUpdateHandler = nil
            connection.cancel()
            onClose()
        }
    }

    enum ServerError: Error {
        case missingResources
    }
}
