import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http"
import { randomBytes } from "node:crypto"
import { hostname, platform } from "node:os"
import { spawn } from "node:child_process"
import { info, dim, warn } from "./output.js"

interface BrowserLoginOpts {
  /** Base URL of the Nodaro instance, e.g. https://app.nodaro.ai */
  baseUrl: string
  /** Override the device label sent to the browser bridge (defaults to os.hostname()). */
  device?: string
  /** Cap how long we wait for the browser callback. Default 5min. */
  timeoutMs?: number
}

interface BrowserLoginResult {
  /** Plaintext token captured from the loopback callback. */
  token: string
}

/**
 * `nodaro auth login` browser flow:
 *
 * 1. Bind a single-shot http.Server to 127.0.0.1:0 (kernel picks a free port).
 * 2. Open the system browser to <baseUrl>/auth/cli with a `callback` pointing
 *    to our loopback server and a fresh `state` token.
 * 3. The frontend bridge mints an API token via /v1/api-tokens (JWT auth) and
 *    redirects the browser to our /callback URL with the token.
 * 4. We validate the state, capture the token, send a closing HTML page, and
 *    shut the server down.
 *
 * Throws on timeout, state mismatch, or explicit user cancel.
 */
export async function loginViaBrowser(opts: BrowserLoginOpts): Promise<BrowserLoginResult> {
  const state = randomBytes(16).toString("hex")
  const device = opts.device ?? hostname()
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000

  return new Promise<BrowserLoginResult>((resolve, reject) => {
    let settled = false
    let server: Server | null = null
    let timeoutHandle: NodeJS.Timeout | null = null

    function settle(action: () => void) {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (server) server.close()
      action()
    }

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("not found")
        return
      }
      const error = url.searchParams.get("error")
      const echoedState = url.searchParams.get("state")
      const token = url.searchParams.get("token")

      if (echoedState !== state) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("state mismatch")
        settle(() => reject(new Error("state mismatch — possible CSRF; aborting")))
        return
      }

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(htmlPage("Authorization cancelled.", "You can close this tab and return to your terminal."))
        settle(() => reject(new Error(`browser flow rejected: ${error}`)))
        return
      }

      if (!token) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("missing token")
        settle(() => reject(new Error("callback missing token")))
        return
      }

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(htmlPage("Login successful.", "You can close this tab and return to your terminal."))
      settle(() => resolve({ token }))
    })

    server.on("error", (err) => {
      settle(() => reject(err))
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server!.address()
      if (typeof address !== "object" || address === null) {
        settle(() => reject(new Error("could not bind loopback port")))
        return
      }
      const port = address.port
      const callback = `http://127.0.0.1:${port}/callback`
      const target = new URL("/auth/cli", opts.baseUrl)
      target.searchParams.set("callback", callback)
      target.searchParams.set("state", state)
      target.searchParams.set("device", device)

      info(`Opening browser to ${stripQuery(target.toString())} …`)
      dim(`(local listener: ${callback}, state: ${state.slice(0, 8)}…)`)
      const opened = openBrowser(target.toString())
      if (!opened) {
        warn("Could not auto-open browser. Open this URL manually:")
        console.log(target.toString())
      }

      timeoutHandle = setTimeout(() => {
        settle(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for browser callback`)))
      }, timeoutMs)
    })
  })
}

function stripQuery(url: string): string {
  const idx = url.indexOf("?")
  return idx >= 0 ? url.slice(0, idx) : url
}

function openBrowser(url: string): boolean {
  const cmd = platform() === "darwin" ? "open"
    : platform() === "win32" ? "cmd"
    : "xdg-open"
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true })
    child.unref()
    return true
  } catch {
    return false
  }
}

function htmlPage(title: string, detail: string): string {
  // Single self-contained doc — no external assets, no JS. Safe to inline.
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#f0f0f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:420px;padding:32px;border:1px solid #2d2d2d;border-radius:12px;background:#16161f;text-align:center}
h1{margin:0 0 8px;font-size:18px}
p{margin:0;color:#8888aa;font-size:14px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff0073;margin-right:8px;vertical-align:middle}</style>
</head><body><div class="card"><h1><span class="dot"></span>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&amp;"
    if (c === "<") return "&lt;"
    if (c === ">") return "&gt;"
    if (c === '"') return "&quot;"
    return "&#39;"
  })
}
