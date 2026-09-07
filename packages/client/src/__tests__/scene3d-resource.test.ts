import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../index.js"

describe("retained scene edits", () => {
  it("sends the revision guard and deterministic operations as JSON without starting a job", async () => {
    const output = { scenePlan: { schemaVersion: 2, revisionId: "next" }, changeSummary: "Moved box" }
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(output)))
    const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch })
    const params = { newRevisionId: "next", expectedContentHash: "a".repeat(64), operations: [
      { op: "set-override" as const, override: { kind: "entity-visibility" as const, entityId: "box", visible: false } },
    ] }
    expect(await client.scene3d.applyEdits("base", params)).toEqual(output)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/3d-scene/revisions/base/edits")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(init?.body as string)).toEqual(params)
  })
})
