// @test-reads-none reads only the clips it renders into its own temp dir
/**
 * A local media host for tests that run the REAL probe (ffprobe, the probe
 * guard's proxy, the own-storage download) against real HTTP: it serves the
 * clips it renders with ffmpeg (lavfi, a few kB each) with range requests,
 * answers redirects, playlists and announced sizes on demand, and records
 * every request it gets (path, Host, Range, User-Agent), so a test can tell
 * what was read — and, more to the point, what was never asked for.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A clip of a few MB that a probe has to read far into: an MP4 whose index
 * (moov) sits at the END of the file (ffmpeg's default without faststart, so
 * ffprobe seeks there with a range request), or a WebM written live, whose
 * header carries no length (so its length is read from every packet).
 */
export function renderLargeClip(kind: "mp4-index-at-end" | "webm-no-length", seconds: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "probe-media-"))
  try {
    const out = join(dir, kind === "mp4-index-at-end" ? "clip.mp4" : "clip.webm")
    const source = ["-f", "lavfi", "-i", `testsrc2=d=${seconds}:s=640x360:r=30`]
    const args = kind === "mp4-index-at-end"
      ? [...source, "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "4M", "-pix_fmt", "yuv420p", out]
      : [...source, "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "3M", "-f", "webm", "-live", "1", out]
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A recording written live, as a browser's MediaRecorder writes it: its header
 * carries no length (`format.duration` is N/A), so only its packets say how
 * long it is — the recipe of the header-less fixtures Trim, Loop and Combine
 * Videos are measured against (`video-utility-probe.e2e.test.ts`): VP8 or VP9
 * video (libvpx, realtime), or Opus sound alone.
 */
export function renderLiveWebm(kind: "vp8" | "vp9" | "opus", seconds: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "probe-media-"))
  try {
    const out = join(dir, "recording.webm")
    const args = kind === "opus"
      ? ["-f", "lavfi", "-i", `sine=d=${seconds}`, "-c:a", "libopus"]
      : ["-f", "lavfi", "-i", `color=c=green:s=64x64:r=10:d=${seconds}`, "-c:v", kind === "vp8" ? "libvpx" : "libvpx-vp9", "-deadline", "realtime"]
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args, "-f", "webm", "-live", "1", out])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A short clip rendered by the local ffmpeg: an MP4 video (with sound), a WebM video, an animated GIF, or an MP3. */
export function renderClip(kind: "video" | "webm" | "audio" | "gif", seconds: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "probe-media-"))
  try {
    const out = join(dir, kind === "video" ? "clip.mp4" : kind === "webm" ? "clip.webm" : kind === "gif" ? "clip.gif" : "clip.mp3")
    const args = kind === "gif"
      ? ["-f", "lavfi", "-i", `testsrc=d=${seconds}:s=64x48:r=10`, out]
      : kind === "video"
      ? ["-f", "lavfi", "-i", `testsrc=d=${seconds}:s=64x48:r=10`, "-f", "lavfi", "-i", `sine=d=${seconds}`, "-pix_fmt", "yuv420p", "-shortest", out]
      : kind === "webm"
        ? ["-f", "lavfi", "-i", `testsrc=d=${seconds}:s=64x48:r=10`, "-c:v", "libvpx", out]
        : ["-f", "lavfi", "-i", `sine=d=${seconds}`, "-c:a", "libmp3lame", out]
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface MediaHit {
  readonly path: string
  readonly host: string | undefined
  readonly range: string | undefined
  readonly userAgent: string | undefined
}

/**
 * What one path answers: a file (served with ranges), a redirect, a text body
 * (a playlist), or a response that only announces a size.
 */
export type MediaRoute =
  | { readonly file: Buffer; readonly type?: string }
  | { readonly redirect: string | ((req: IncomingMessage) => string); readonly status?: number }
  | { readonly text: string; readonly type: string }
  | { readonly announce: number }

export interface MediaServer {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string
  readonly port: number
  readonly hits: MediaHit[]
  route(path: string, answer: MediaRoute): void
  close(): Promise<void>
}

/** Answer `req` with `body`, honouring a single `bytes=` range (as a CDN does). */
export function serveFile(req: IncomingMessage, res: ServerResponse, body: Buffer, type: string): void {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "")
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
    if (start >= body.length) {
      res.writeHead(416, { "content-range": `bytes */${body.length}` }).end()
      return
    }
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": end - start + 1 })
    res.end(body.subarray(start, end + 1))
    return
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": body.length })
  res.end(body)
}

export async function startMediaServer(): Promise<MediaServer> {
  const routes = new Map<string, MediaRoute>()
  const hits: MediaHit[] = []
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!
    hits.push({ path, host: req.headers.host, range: req.headers.range, userAgent: req.headers["user-agent"] })
    const answer = routes.get(path)
    if (!answer) return void res.writeHead(404).end()
    if ("file" in answer) return serveFile(req, res, answer.file, answer.type ?? "application/octet-stream")
    if ("redirect" in answer) {
      const location = typeof answer.redirect === "function" ? answer.redirect(req) : answer.redirect
      return void res.writeHead(answer.status ?? 302, { location }).end()
    }
    if ("text" in answer) return void res.writeHead(200, { "content-type": answer.type }).end(answer.text)
    // A size announced, never sent: a download that respects a cap refuses at the headers.
    res.writeHead(200, { "content-type": "video/mp4", "content-length": answer.announce })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    hits,
    route: (path, answer) => void routes.set(path, answer),
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/** The `Proxy-Authorization` a guarded run's proxy expects: Basic of the credential in its `http_proxy` URL. */
export function proxyAuthorization(proxyUrl: string): string {
  const u = new URL(proxyUrl)
  return `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`
}
