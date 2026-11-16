import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http"
import type { TLSSocket } from "node:tls"
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"

/**
 * `GET /mcp`: the stream a Streamable HTTP client opens after it initializes,
 * for messages the server starts. On this endpoint nothing is ever sent on it:
 * the route is stateless (every POST builds its own server and transport and
 * gets its answer in its own response), the server advertises no list changes
 * and no subscriptions, and nothing in the backend starts a message of its
 * own. Clients hold the stream open for as long as they are connected and
 * reopen it whenever it closes.
 *
 * It used to be answered by the SDK's transport, after building a whole MCP
 * server for the request (every tool and its schemas) that then stayed alive,
 * unused, for the life of the stream. It is answered here instead, with no
 * server: exactly as the SDK's stateless transport (`enableJsonResponse`,
 * through its Node adapter) answers it, in every outcome:
 *  - a URL the adapter cannot build from the request (no `Host`, a `Host` it
 *    rejects): 400, empty, `text/plain` (the adapter's refusal);
 *  - an `Accept` without `text/event-stream` (a case-sensitive substring of
 *    the joined header): 406 and the SDK's JSON-RPC error;
 *  - an `mcp-protocol-version` the SDK does not support (an empty one
 *    included): 400 and the SDK's JSON-RPC error, its list of versions read
 *    from the SDK;
 *  - otherwise: 200 and the SDK's stream head, flushed at once, and a stream
 *    that stays open, silent, until the client leaves (or a proxy closes it
 *    when idle, and the client reopens it).
 * Every other outcome of the SDK's GET handling cannot occur in this
 * configuration (stateless: no session check, no second-stream conflict; no
 * event store: `Last-Event-ID` is ignored; no DNS-rebinding check). A request
 * the adapter cannot read at all answers as the adapter answers a failure:
 * 500, empty, `text/plain`. `mcp-get-stream.test.ts` holds every answer equal
 * to what the installed SDK sends, so an SDK upgrade that changes one fails
 * there.
 *
 * Nothing is ever written after the head: the wire is what it was.
 *
 * What an open stream holds: its socket and the request, and no timer. Both
 * go when the client leaves, and when the app closes: every open stream is cut
 * then (as a process exit cut them before), so a shutdown never waits on them.
 */

/** The SDK's stream head, as its adapter writes it: through a Web `Headers`, so lowercase and in this order. */
function streamHead(): OutgoingHttpHeaders {
  return { "cache-control": "no-cache, no-transform", connection: "keep-alive", "content-type": "text/event-stream" }
}

interface Refusal {
  status: number
  headers: OutgoingHttpHeaders
  body?: string
}

/** The adapter's answer when it cannot build a request or the transport fails: no body, its default content type. */
function emptyAnswer(status: number): Refusal {
  return { status, headers: { "content-type": "text/plain; charset=UTF-8" } }
}

/** The SDK's JSON-RPC error, as its adapter writes it (the body read whole, so a length). */
function jsonRpcError(status: number, message: string): Refusal {
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null })
  return { status, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body }
}

/**
 * Whether the SDK's Node adapter can build a URL for this request: the same
 * test it makes before the transport sees the request (an absolute URL that
 * parses; else a `Host`, and one whose hostname survives parsing).
 */
function adapterBuildsUrl(raw: IncomingMessage): boolean {
  const target = raw.url || ""
  if (target[0] !== "/" && (target.startsWith("http://") || target.startsWith("https://"))) return URL.canParse(target)
  const host = raw.headers.host
  if (!host) return false
  const scheme = (raw.socket as Partial<TLSSocket> | undefined)?.encrypted ? "https" : "http"
  let url: URL
  try {
    url = new URL(`${scheme}://${host}${target}`)
  } catch {
    return false
  }
  return url.hostname.length === host.length || url.hostname === host.replace(/:\d+$/, "")
}

/** The request's headers as the transport reads them: a Web `Headers` from the raw list (repeats joined with ", "). */
function transportHeaders(raw: IncomingMessage): Headers {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < raw.rawHeaders.length; i += 2) {
    const name = raw.rawHeaders[i] ?? ""
    if (name.charCodeAt(0) !== 58) pairs.push([name, raw.rawHeaders[i + 1] ?? ""])
  }
  return new Headers(pairs)
}

/** How the SDK's transport refuses this GET, or null when it opens the stream. */
function refusalOf(raw: IncomingMessage): Refusal | null {
  if (!adapterBuildsUrl(raw)) return emptyAnswer(400)
  let headers: Headers
  try {
    headers = transportHeaders(raw)
  } catch {
    return emptyAnswer(500)
  }
  if (!headers.get("accept")?.includes("text/event-stream")) {
    return jsonRpcError(406, "Not Acceptable: Client must accept text/event-stream")
  }
  const version = headers.get("mcp-protocol-version")
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return jsonRpcError(400, `Bad Request: Unsupported protocol version: ${version} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`)
  }
  return null
}

/** Each app's open streams, cut when it closes, and whether its close has begun. */
interface AppStreams {
  open: Set<ServerResponse>
  closing: boolean
}

const appStreams = new WeakMap<FastifyInstance, AppStreams>()

/**
 * Cut every open GET stream when the app closes. Without it the app's close
 * waits on them (a stream never ends on its own), and a deploy waits until the
 * shutdown's time limit forces the process out. A GET whose answer comes after
 * that (it was still in sign-in when the close began) is cut as it is
 * answered (see answerMcpGet).
 */
export function registerMcpGetStreams(app: FastifyInstance): void {
  const state: AppStreams = { open: new Set(), closing: false }
  appStreams.set(app, state)
  app.addHook("preClose", (done) => {
    state.closing = true
    for (const res of state.open) res.destroy()
    done()
  })
}

/** How many GET streams `app` holds open. */
export function openMcpGetStreamCount(app: FastifyInstance): number {
  return appStreams.get(app)?.open.size ?? 0
}

/**
 * Whether the response can no longer be answered: its client left (or it was
 * cut) before the handler ran, which happens when the client leaves while an
 * async hook before the handler (sign-in) is still waiting, since Fastify runs
 * the handler anyway. Its `close` has then already been emitted, so a stream
 * opened on it would wait for one that never comes, holding the request (and
 * the handler) for good.
 *
 * `destroyed` is what Node sets on the response when its socket closes (and on
 * `destroy()`); the socket's own `destroyed` also covers the moment between
 * the socket being destroyed and the response hearing of it. `writableEnded`:
 * something already ended it. Not a missing `socket`: a pipelined response
 * waiting its turn has none yet and is still live.
 */
function responseGone(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded || res.socket?.destroyed === true
}

/**
 * Cut the connection once what was written (the stream head) has gone out, as
 * the app's close cuts the streams it holds; at once when there is no socket.
 */
function cutAfterWrites(res: ServerResponse): void {
  const socket = res.socket
  if (socket) socket.destroySoon()
  else res.destroy()
}

/**
 * Answer a `GET` on an MCP endpoint, for a caller the route has already
 * admitted. Settles when the response is over: at once for a refusal, a
 * client already gone, or a stream cut because the app is closing; when the
 * client leaves, or the app closes, for an open stream.
 */
export function answerMcpGet(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.hijack()
  // The line every MCP request logs (the transport's adapter writes it for the others).
  req.log.info({ ua: req.headers["user-agent"], mcpSession: req.headers["mcp-session-id"] }, "[mcp] incoming")

  const res = reply.raw
  if (responseGone(res)) return Promise.resolve()

  const refusal = refusalOf(req.raw)
  if (refusal) {
    res.writeHead(refusal.status, refusal.headers)
    if (refusal.body === undefined) res.end()
    else res.end(refusal.body)
    return Promise.resolve()
  }

  res.writeHead(200, streamHead())
  res.flushHeaders()
  const state = appStreams.get(app)
  if (state?.closing) {
    // The close has already cut the streams it held; this one, answered
    // after, gets the same head and the same cut, and is never held.
    cutAfterWrites(res)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    state?.open.add(res)
    // The response's close, never the request's: it comes when the client
    // leaves (or the stream is cut), whatever the request stream did.
    res.once("close", () => {
      state?.open.delete(res)
      resolve()
    })
  })
}
