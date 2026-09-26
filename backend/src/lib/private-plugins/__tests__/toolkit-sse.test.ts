import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { buildToolkit } from "../toolkit.js"

/**
 * `tk.sse` lets a plugin route answer as a server-sent event stream through the
 * SAME helper the app's own streaming routes use, so a plugin stream reads
 * exactly like an app stream (one JSON object per `data:` line, a blank line
 * between events) and gets the same origin-checked CORS headers.
 */
describe("tk.sse", () => {
  it("opens an event stream on a plugin route, in the app's convention", async () => {
    const tk = buildToolkit()
    const app = Fastify({ logger: false })
    app.post("/v1/plugin-stream", async (req, reply) => {
      const sse = await tk.sse!.create(req, reply)
      sse.sendEvent({ type: "field", data: { field: "age", value: "age-30s" } })
      sse.sendEvent({ type: "done", data: { ok: true } })
      sse.close()
      expect(sse.isClosed).toBe(true)
    })
    await app.ready()

    const res = await app.inject({ method: "POST", url: "/v1/plugin-stream" })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("text/event-stream")
    expect(res.payload).toBe(
      'data: {"type":"field","data":{"field":"age","value":"age-30s"}}\n\n' +
        'data: {"type":"done","data":{"ok":true}}\n\n',
    )
    await app.close()
  })
})
