import net from "node:net"

/**
 * One HTTP exchange over a raw TCP socket, read byte for byte: the status
 * line, every header line in the order and case it was sent, and the body
 * bytes that arrived within a window. For answers whose exact wire form is the
 * subject (a response that must stay indistinguishable from what it was), and
 * for streams that never end, which `inject` and `fetch` cannot hold open.
 */

export interface RawAnswer {
  /** The status line, e.g. `HTTP/1.1 200 OK`. */
  statusLine: string
  status: number
  /** Header lines as sent, `Date` masked. */
  headerLines: string[]
  /** Body bytes as sent (chunk framing included), within the window. */
  body: string
  /** The server ended the response (or the socket) within the window. */
  ended: boolean
}

export interface RawRequest {
  method?: string
  path: string
  /** Header lines in order, as `name: value`. `Host` is added first unless `noHost`. */
  headers?: string[]
  httpVersion?: "1.1" | "1.0"
  noHost?: boolean
  /** Sent after the head as is (state its `Content-Length` in `headers`). */
  body?: string
  /** How long to read after the head arrived. */
  windowMs?: number
}

export interface OpenRaw {
  /** Resolves once the head has arrived, with what came within the window after it. */
  answer: Promise<RawAnswer>
  /** Every byte received so far, head included. */
  received(): string
  socket: net.Socket
  close(): void
}

export function openRaw(port: number, request: RawRequest): OpenRaw {
  const socket = net.connect(port, "127.0.0.1")
  const lines = [`${request.method ?? "GET"} ${request.path} HTTP/${request.httpVersion ?? "1.1"}`]
  if (!request.noHost) lines.push(`Host: 127.0.0.1:${port}`)
  lines.push(...(request.headers ?? []))
  socket.write(`${lines.join("\r\n")}\r\n\r\n${request.body ?? ""}`)
  let buffer = ""
  let ended = false
  socket.setEncoding("latin1")
  socket.on("data", (chunk: string) => (buffer += chunk))
  socket.on("error", () => {})
  const endedPromise = new Promise<void>((resolve) => socket.once("close", () => { ended = true; resolve() }))
  const answer = (async (): Promise<RawAnswer> => {
    const start = Date.now()
    while (!buffer.includes("\r\n\r\n") && !ended && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await Promise.race([endedPromise, new Promise((r) => setTimeout(r, request.windowMs ?? 300))])
    return parse(buffer, ended)
  })()
  return { answer, received: () => buffer, socket, close: () => socket.destroy() }
}

/** One exchange, the socket closed after the window. */
export async function rawExchange(port: number, request: RawRequest): Promise<RawAnswer> {
  const open = openRaw(port, request)
  try {
    return await open.answer
  } finally {
    open.close()
  }
}

function parse(buffer: string, ended: boolean): RawAnswer {
  const split = buffer.indexOf("\r\n\r\n")
  const head = split === -1 ? buffer : buffer.slice(0, split)
  const [statusLine = "", ...headerLines] = head.split("\r\n")
  return {
    statusLine,
    status: Number(statusLine.split(" ")[1] ?? 0),
    headerLines: headerLines.map((l) => (/^date:/i.test(l) ? "Date: <masked>" : l)),
    body: split === -1 ? "" : buffer.slice(split + 4),
    ended,
  }
}
