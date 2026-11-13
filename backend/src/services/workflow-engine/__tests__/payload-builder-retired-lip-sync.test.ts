/**
 * A saved or imported Lip Sync node on a model retired from Lip Sync (Wav2Lip,
 * VideoReTalking, SadTalker — decided 2026-11-12) is refused at its build with
 * the route's sentence, before the executor creates or reserves anything
 * (node-executor-dubbing-source-gate.test.ts pins that a build refusal
 * reserves nothing). The node is never moved to another model: no job is
 * built at all. Every other model builds as before.
 */
import { describe, it, expect, afterEach } from "vitest"
import { RETIRED_LIP_SYNC_PROVIDERS, retiredLipSyncProviderMessage } from "@nodaro/shared/models"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

const INPUTS = { imageUrl: "https://cdn.example.com/face.png", videoUrl: "https://cdn.example.com/face.mp4", audioUrl: "https://cdn.example.com/line.mp3" } as ResolvedInputs

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => setProfile(null))

const node = (data: Record<string, unknown>): SimpleNode => ({ id: "lip-sync-1", type: "lip-sync", data: { label: "Lip Sync", ...data } })
const build = (n: SimpleNode) => buildPayload(n, "job-1", INPUTS, "usage-1", { nodes: [n], edges: [], nodeStates: {} })

describe("a workflow's Lip Sync node on a retired model", () => {
  for (const provider of Object.keys(RETIRED_LIP_SYNC_PROVIDERS)) {
    it(`${provider}: refused with the route's sentence, every lever the node carries notwithstanding`, () => {
      const message = retiredLipSyncProviderMessage(provider)!
      expect(() => build(node({ provider }))).toThrow(message)
      expect(() => build(node({ provider, pads: "0 10 0 0", enhancer: "gfpgan", audioDurationSec: 30, resolution: "720p" }))).toThrow(message)
    })

    it(`${provider}: the retirement answers on a deployment that restricts models too`, () => {
      setProfile({ models: { allow: ["kling-avatar"] } })
      expect(() => build(node({ provider }))).toThrow(retiredLipSyncProviderMessage(provider)!)
    })
  }

  it("a node with no model, and one on a model still offered, build as before", () => {
    expect(build(node({})).payload).toMatchObject({ provider: "kling-avatar" })
    expect(build(node({ provider: "latentsync" })).modelIdentifier).toBe("latentsync")
  })
})
