// ---------------------------------------------------------------------------
// SSE Client — Consume Server-Sent Events from POST requests
// ---------------------------------------------------------------------------
// Native EventSource only supports GET. This utility uses fetch() with
// ReadableStream to consume SSE from any HTTP method.
//
// Usage:
//   const controller = new AbortController()
//   for await (const event of streamRequest("/v1/ai-writer/generate-stream", {
//     body: { systemPrompt, userInput, userId },
//     signal: controller.signal,
//   })) {
//     if (event.type === "token") console.log(event.data)
//     if (event.type === "done") console.log("Finished:", event.data)
//     if (event.type === "error") console.error(event.data.message)
//   }
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "token"; data: string }
  | { type: "metadata"; data: Record<string, unknown> }
  | { type: "progress"; step: number; total: number; message: string }
  | { type: "done"; data: Record<string, unknown> }
  | { type: "error"; data: { code: string; message: string } }

export async function* streamRequest<T = StreamEvent>(
  url: string,
  options: {
    body: Record<string, unknown>
    signal?: AbortSignal
    /** Optional base URL to call backend directly, bypassing Next.js proxy */
    baseUrl?: string
  },
): AsyncGenerator<T> {
  const fullUrl = options.baseUrl ? `${options.baseUrl}${url}` : url
  const response = await fetch(fullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options.body),
    signal: options.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`SSE request failed (${response.status}): ${text}`)
  }

  const body = response.body
  if (!body) {
    throw new Error("Response body is null — streaming not supported")
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n")
      // Last element is either empty (complete event) or a partial chunk
      buffer = parts.pop() ?? ""

      for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed === "") continue

        // Process each line in the event block
        for (const line of trimmed.split("\n")) {
          // Skip SSE comments (keepalive pings)
          if (line.startsWith(":")) continue
          // Skip empty lines
          if (line.trim() === "") continue

          // Parse data lines
          if (line.startsWith("data: ")) {
            const json = line.slice(6)
            try {
              yield JSON.parse(json) as T
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }

    // Flush any remaining buffered data
    const remaining = buffer.trim()
    if (remaining !== "") {
      for (const line of remaining.split("\n")) {
        if (line.startsWith(":")) continue
        if (line.trim() === "") continue
        if (line.startsWith("data: ")) {
          const json = line.slice(6)
          try {
            yield JSON.parse(json) as T
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
