import net from "node:net"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"

/**
 * A short-lived localhost proxy that forwards to an authenticated upstream proxy
 * (`YTDLP_PROXY`), INJECTING the `Proxy-Authorization` header on every hop.
 *
 * WHY THIS EXISTS — the ffmpeg proxy-auth handshake bug:
 * A YouTube TRIM uses yt-dlp's `--download-sections`, which fetches the media
 * with a SEPARATE ffmpeg process (FFmpegFD). ffmpeg fires its first proxy
 * CONNECT with NO credentials and only sends them after a `407` challenge — but
 * the residential proxy (Decodo) answers that no-auth attempt non-standardly
 * ("Access denied", not a clean `407 Basic` challenge), so ffmpeg never retries
 * correctly and the fetch dies with "ffmpeg exited with code 187". yt-dlp's own
 * (native) downloader sends credentials up front, which is exactly why
 * WHOLE-video downloads succeed through the same proxy while trims fail.
 *
 * This shim requires NO auth from its client, so ffmpeg connects cleanly with no
 * 407 dance; the shim then authenticates to the real proxy itself — reproducing
 * the native downloader's proactive-auth behaviour for the ffmpeg path. Point
 * yt-dlp at `shim.url` (a credential-free `http://127.0.0.1:<port>`) and both the
 * Python extraction AND ffmpeg's fetch reach the upstream authenticated.
 *
 * Bound to 127.0.0.1 only (never externally reachable) and torn down per download.
 */
export interface ProxyAuthShim {
  /** `http://127.0.0.1:<port>` — pass to yt-dlp as `--proxy`. Requires no auth. */
  readonly url: string
  /** Stop listening and destroy any still-open sockets. Idempotent-safe to await once. */
  close(): Promise<void>
}

/** Basic-auth header for `user:pass` in an upstream proxy URL, or undefined if it carries no creds. */
function basicAuthHeader(upstream: URL): string | undefined {
  if (!upstream.username) return undefined
  const user = decodeURIComponent(upstream.username)
  const pass = decodeURIComponent(upstream.password)
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
}

export async function startProxyAuthShim(upstreamProxyUrl: string): Promise<ProxyAuthShim> {
  const upstream = new URL(upstreamProxyUrl)
  const upstreamHost = upstream.hostname
  const upstreamPort = Number(upstream.port) || 80
  const authHeader = basicAuthHeader(upstream)

  // Track every live socket so close() can force-destroy them (server.close()
  // alone leaves established CONNECT tunnels open).
  const sockets = new Set<Duplex>()
  const track = (s: Duplex) => {
    sockets.add(s)
    s.once("close", () => sockets.delete(s))
  }

  const server = http.createServer((clientReq, clientRes) => {
    // Plain-HTTP proxied request (absolute-form URI): replay it to the upstream
    // proxy with credentials attached. YouTube traffic is almost all HTTPS
    // (handled by 'connect' below); this covers the rare plain-HTTP hop.
    const headers = { ...clientReq.headers }
    if (authHeader) headers["proxy-authorization"] = authHeader
    const upReq = http.request(
      { host: upstreamHost, port: upstreamPort, method: clientReq.method, path: clientReq.url, headers },
      (upRes) => {
        clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers)
        upRes.pipe(clientRes)
      },
    )
    upReq.on("error", () => {
      if (!clientRes.headersSent) clientRes.writeHead(502)
      clientRes.end()
    })
    clientReq.pipe(upReq)
  })

  server.on("connect", (req, clientSocket, head) => {
    track(clientSocket)
    clientSocket.on("error", () => clientSocket.destroy())

    // Open our OWN CONNECT to the upstream proxy, carrying the credentials the
    // client (ffmpeg) omitted, then splice the two sockets on a 2xx reply.
    const upstreamSocket = net.connect(upstreamPort, upstreamHost)
    track(upstreamSocket)
    upstreamSocket.on("error", () => {
      clientSocket.destroy()
      upstreamSocket.destroy()
    })
    upstreamSocket.on("connect", () => {
      const lines = [`CONNECT ${req.url} HTTP/1.1`, `Host: ${req.url}`]
      if (authHeader) lines.push(`Proxy-Authorization: ${authHeader}`)
      lines.push("", "")
      upstreamSocket.write(lines.join("\r\n"))
    })

    // Buffer the upstream's CONNECT response until its header terminator, decide
    // on the status, then relay (forwarding any bytes that trailed the header).
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const end = buf.indexOf("\r\n\r\n")
      if (end === -1) return
      upstreamSocket.removeListener("data", onData)
      const statusLine = buf.subarray(0, buf.indexOf("\r\n")).toString("latin1")
      const status = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)
      if (!status || status[1][0] !== "2") {
        clientSocket.destroy()
        upstreamSocket.destroy()
        return
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      const leftover = buf.subarray(end + 4)
      if (leftover.length) clientSocket.write(leftover)
      if (head.length) upstreamSocket.write(head)
      upstreamSocket.pipe(clientSocket)
      clientSocket.pipe(upstreamSocket)
    }
    upstreamSocket.on("data", onData)
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        // Destroy the outgoing upstream sockets we opened (server.close() doesn't
        // track those) AND force-close the hijacked CONNECT sockets the http
        // server still holds — otherwise server.close()'s callback never fires.
        for (const s of sockets) s.destroy()
        sockets.clear()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
