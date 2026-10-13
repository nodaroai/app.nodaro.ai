import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { ugcChildIdempotencyKey, ugcNodeIdempotencyKey } from "../ugc-child-key"

const BODY = { prompt: "p", provider: "image-model-a", aspectRatio: "3:4", userId: "user-1" }
const key = (over: Partial<Parameters<typeof ugcChildIdempotencyKey>[0]> = {}) =>
  ugcChildIdempotencyKey({ runKey: "run-key-1", nodeId: "creator", step: "r0-c0-image", path: "/v1/generate-image", body: BODY, ...over })

/** The orchestrator's fingerprint of a request (`computeFingerprint`): SHA-256 of the route and the body with its keys sorted. */
function serverFingerprint(path: string, body: unknown): string {
  const stable = (v: unknown): string => {
    if (v === undefined) return "null"
    if (v === null || typeof v !== "object") return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`
  }
  return createHash("sha256").update(path).update(":").update(stable(body)).digest("hex")
}

describe("a UGC child call's idempotency key on the canvas", () => {
  it("is the run's key, the node, the step and the request's fingerprint — the orchestrator's child key", async () => {
    expect(await key()).toBe(`run-key-1:creator:r0-c0-image:${serverFingerprint("/v1/generate-image", BODY).slice(0, 16)}`)
  })
  it("the same request of the same run is the same key, whatever the body's key order", async () => {
    const reordered = { userId: "user-1", aspectRatio: "3:4", provider: "image-model-a", prompt: "p" }
    expect(await key({ body: reordered })).toBe(await key())
  })
  it("another step, another request, another node or another run is another key", async () => {
    const base = await key()
    expect(await key({ step: "r0-c1-image" })).not.toBe(base)
    expect(await key({ body: { ...BODY, prompt: "q" } })).not.toBe(base)
    expect(await key({ path: "/v1/image-to-image" })).not.toBe(base)
    expect(await key({ nodeId: "creator-2" })).not.toBe(base)
    expect(await key({ runKey: "run-key-2" })).not.toBe(base)
  })
  it("a run nobody clicked has no key at all, so nothing is handed back", async () => {
    expect(await key({ runKey: undefined })).toBeUndefined()
    expect(await key({ runKey: "" })).toBeUndefined()
  })
  it("a key that would not fit a header is hashed, still deterministic", async () => {
    const long = await key({ nodeId: "n".repeat(300) })
    expect(long).toMatch(/^run-key-1:[0-9a-f]{40}$/)
    expect(await key({ nodeId: "n".repeat(300) })).toBe(long)
    const nonAscii = await key({ nodeId: "יוצר" })
    expect(nonAscii).toMatch(/^run-key-1:[0-9a-f]{40}$/)
    expect(nonAscii).not.toBe(long)
  })
})

describe("a UGC node's own call's key on the canvas", () => {
  it("is the run's key and the node, so two nodes one click runs never share one", async () => {
    expect(await ugcNodeIdempotencyKey("run-key-1", "script")).toBe("run-key-1:script")
    expect(await ugcNodeIdempotencyKey("run-key-1", "clip")).not.toBe(await ugcNodeIdempotencyKey("run-key-1", "script"))
  })
  it("no run key, no key; a node id that would not fit a header is hashed", async () => {
    expect(await ugcNodeIdempotencyKey(undefined, "script")).toBeUndefined()
    expect(await ugcNodeIdempotencyKey("run-key-1", "sw::".repeat(60))).toMatch(/^run-key-1:[0-9a-f]{40}$/)
  })
})
