import { NodaroError, throwFromResponse } from "./errors.js"

/**
 * The ONE server-sent-event reader in this package.
 *
 * Every streaming route here writes the same minimal shape — `data: <json>\n\n`
 * frames, with the event kind INSIDE the JSON rather than on an `event:` line —
 * so one reader serves them all, and a second hand-rolled parse loop is the
 * thing this file exists to prevent. Deliberately minimal, matching the
 * server's writer rather than the whole SSE grammar: split on blank lines,
 * JSON-parse each `data:` line on its own, skip what does not parse (the next
 * frame re-reports state), and ignore every other line — keepalive comments
 * (`: keepalive`) included.
 *
 * Frames are separated by a bare `\n\n` and each `data:` line is parsed on its
 * own, exactly as the server writes them. Both halves are literal: a stream
 * whose frames arrive CRLF-terminated, or whose JSON was split across two
 * `data:` lines, yields NOTHING rather than erroring — so an intermediary that
 * normalises line endings would show up as an empty stream, not a parse
 * failure. The server's writer produces neither shape.
 *
 * No timeout is applied. The caller owns the lifetime: pass the `AbortSignal`
 * to the `fetch` that produced `res`, or just stop iterating — the `finally`
 * cancels the body, which ends the HTTP request.
 */
export async function* readSseStream<T>(
  res: Response,
  opts: {
    /** Names the stream in the "no response body" error. */
    label?: string
  } = {},
): AsyncGenerator<T, void, undefined> {
  if (!res.ok) {
    let errBody: Record<string, unknown> = {}
    try {
      errBody = (await res.json()) as Record<string, unknown>
    } catch {
      // Empty/non-JSON body — fall through with empty errBody
    }
    throwFromResponse(res.status, errBody)
  }
  if (!res.body) {
    throw new NodaroError(`${opts.label ?? "event stream"} has no response body`, "empty_stream", res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          try {
            yield JSON.parse(line.slice(5).trim()) as T
          } catch {
            // Skip malformed frames — the next tick re-reports full state.
          }
        }
      }
    }
  } finally {
    // Ends the HTTP request when the consumer breaks out of the loop early.
    reader.releaseLock()
    await res.body.cancel().catch(() => {})
  }
}
