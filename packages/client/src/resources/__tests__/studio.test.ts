import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
function fixture(body: unknown = { data: {} }) {
  const fetch = vi.fn().mockImplementation(() => ok(body))
  const client = createClient({ baseUrl: "https://api.test", auth: new StaticTokenAuth("token"), fetch: fetch as typeof globalThis.fetch })
  return { client, fetch, request: () => fetch.mock.calls[0] as [string, RequestInit] }
}
describe("Studio production transport", () => {
  it("copies through the server with source revision and destination project", async () => {
    const f = fixture()
    await f.client.studio.clone("film/id", { name: "My copy", projectId: "project", expectedVersion: 8 })
    expect(f.request()[0]).toBe("https://api.test/v1/studio/productions/film%2Fid/clone")
    expect(f.request()[1].method).toBe("POST")
    expect(JSON.parse(f.request()[1].body as string)).toEqual({ name: "My copy", projectId: "project", expectedVersion: 8 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])("sends sharing=%s through the audience route with the reviewed revision", async (shared) => {
    const f = fixture()
    await f.client.studio.setShared("film/id", { shared, expectedVersion: 8 })
    expect(f.request()[0]).toBe("https://api.test/v1/studio/productions/film%2Fid/share")
    expect(f.request()[1].method).toBe("POST")
    expect(JSON.parse(f.request()[1].body as string)).toEqual({ shared, expectedVersion: 8 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it("does not retry sharing over a revision conflict", async () => {
    const f = fixture()
    f.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409,
      json: async () => ({ error: { code: "workflow_conflict", message: "Reload before sharing" } }) } as Response))
    await expect(f.client.studio.setShared("film", { shared: true, expectedVersion: 8 }))
      .rejects.toMatchObject({ code: "workflow_conflict" })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it("saves an editor draft with an explicit revision and strict conflict handling", async () => {
    const f = fixture(), graph = { nodes: [], edges: [], settings: { studio: { version: 3, shots: [] } } }
    await f.client.studio.saveEditorState("film/id", { expectedVersion: 8, graph, clientRequestId: "draft-1" })
    const [url, init] = f.request()
    expect(url).toContain("film%2Fid/ops")
    expect(JSON.parse(init.body as string)).toEqual({
      baseVersion: 8, strict: true, clientRequestId: "draft-1",
      ops: [{ op: "save_editor_state", expectedVersion: 8, graph }],
    })
  })
  it("keeps the list envelope and pagination cursor intact", async () => {
    const body = { data: { data: [{ id: "film", name: "Canal" }], nextCursor: "next" } }
    const f = fixture(body)
    await expect(f.client.studio.list({ limit: 3, includeArchived: true })).resolves.toEqual(body)
    expect(f.request()[0]).toBe("https://api.test/v1/studio/productions?limit=3&includeArchived=true")
  })
  it("validates and creates plans through separate explicit requests", async () => {
    const f = fixture(), plan = { format: "nodaro-studio-production", version: 3, scenes: [] }
    await f.client.studio.validatePlan(plan)
    expect(f.request()[0].endsWith("/validate")).toBe(true)
    expect(JSON.parse(f.request()[1].body as string)).toEqual({ plan })
    await f.client.studio.create({ name: "Canal", plan })
    expect(JSON.parse(f.fetch.mock.calls[1]![1].body)).toEqual({ name: "Canal", plan })
  })
  it("passes a linked clip quote through without changing its requested mode", async () => {
    const f = fixture({ data: { dryRun: true, provider: "wan-3", count: 1, credits: 111 } })
    const input = { kind: "clip" as const, shotId: "AB", dryRun: true, clientRequestId: "quote" }
    await f.client.studio.generateShot("film", input)
    expect(JSON.parse(f.request()[1].body as string)).toEqual(input)
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it("carries a reviewed linked-clip input hash without retrying a changed quote", async () => {
    const f = fixture()
    f.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409,
      json: async () => ({ error: { code: "sequence_quote_changed", message: "Review the changed inputs" } }) } as Response))
    const input = { kind: "clip" as const, shotId: "AB", expectedInputHash: "a".repeat(64), clientRequestId: "clip-click" }
    await expect(f.client.studio.generateShot("film", input)).rejects.toMatchObject({ code: "sequence_quote_changed" })
    expect(JSON.parse(f.request()[1].body as string)).toEqual(input)
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it("reads a selected shot with encoded IDs and the caller's workspace", async () => {
    const f = fixture({ data: { production: { id: "film", keyframes: [{ id: "A", acceptedResultKey: null }] } } })
    const response = await f.client.withWorkspace("workspace").studio.get("film/a", { detail: "full", shotId: "shot a" })
    expect(response.data.production.keyframes![0]!.acceptedResultKey).toBeNull()
    const [url, init] = f.request()
    expect(url).toBe("https://api.test/v1/studio/productions/film%2Fa?detail=full&shot_id=shot+a")
    expect(new Headers(init.headers).get("X-Nodaro-Workspace")).toBe("workspace")
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token")
    expect(init.method).toBe("GET")
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it("generates one frame without accepting it or generating a portrait", async () => {
    const f = fixture({ data: { jobIds: ["job"] } })
    const input = { keyframeId: "A", expectedRevision: 3, clientRequestId: "same-click", overrides: { provider: "nano-banana-pro" } }
    await expect(f.client.studio.generateKeyframe("film", input)).resolves.toEqual({ data: { jobIds: ["job"] } })
    expect(JSON.parse(f.request()[1].body as string)).toEqual({ ...input, kind: "keyframe" })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it("keeps frame and workflow revision conditions on explicit acceptance", async () => {
    const f = fixture()
    const review = { keyframeId: "A", expectedRevision: 3, resultKey: "candidate", expectedAcceptedResultKey: "previous",
      requirementChecks: [{ requirementId: "coat", outcome: "pass" as const }] }
    await f.client.studio.acceptKeyframe("film", review, { baseVersion: 7, strict: true, clientRequestId: "review-click" })
    expect(f.request()[0]).toBe("https://api.test/v1/studio/productions/film/ops")
    expect(JSON.parse(f.request()[1].body as string)).toEqual({ baseVersion: 7, strict: true, clientRequestId: "review-click",
      ops: [{ ...review, op: "accept_keyframe_result" }] })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([["capabilities", "/capabilities", "GET"], ["skill", "/skill", "GET"], ["reconcile", "/film/reconcile", "POST"]] as const)(
    "routes %s explicitly", async (method, suffix, verb) => {
      const f = fixture()
      if (method === "reconcile") await f.client.studio.reconcile("film")
      else await f.client.studio[method]()
      expect(f.request()[0]).toBe(`https://api.test/v1/studio/productions${suffix}`)
      expect(f.request()[1].method).toBe(verb)
    })
  it("preserves stale-review conflicts without choosing another result", async () => {
    const f = fixture()
    f.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409,
      json: async () => ({ error: { code: "keyframe_stale", message: "Review the changed frame" } }) } as Response))
    await expect(f.client.studio.acceptKeyframe("film", { keyframeId: "A", expectedRevision: 1,
      resultKey: "old", expectedAcceptedResultKey: null, requirementChecks: [] })).rejects.toMatchObject({ code: "keyframe_stale" })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
})
