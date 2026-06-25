import { describe, expect, it } from "vitest"
import {
  getHandleConnectionLimit,
  seedance2ImagePoolSlotsConsumed,
} from "../handle-limits"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

describe("getHandleConnectionLimit (generate-video)", () => {
  it("returns endFrame cap 1 for providers in PROVIDERS_WITH_END_FRAME", () => {
    // veo3.1 is in the end-frame catalog set.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "veo3.1" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(1)
  })

  it("returns endFrame cap 0 for providers without end-frame support", () => {
    // "kling" (2.6) only declares ["audio"] in MODEL_CATALOG.features — no
    // end-frame, so the cap must be 0.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(0)
  })

  it("returns startFrame cap 1 for any provider", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("returns audio cap 1 for any provider", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "audio")?.limit).toBe(1)
  })

  it("returns videoReferences cap 0 for provider absent from VIDEO_REF_LIMITS_BY_PROVIDER", () => {
    // kling is NOT in VIDEO_REF_LIMITS_BY_PROVIDER -> caps null -> 0.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "videoReferences")?.limit).toBe(0)
  })

  // Seedance 2 is NO LONGER mode-gated: the `seedance2InputMode` lever was
  // removed and the backend resolver (resolveSeedance2Inputs) decides the mode
  // at run time. Every S2 handle must return its FULL provider-capability cap
  // regardless of any (legacy) seedance2InputMode value — start/end frame = 1,
  // image refs = 9, video refs = 3, audio refs = 3 — so every input is always
  // connectable. This de-gating proves the inversion bug (refs disabled on
  // every migrated workflow because the absent field defaulted to "frames")
  // is gone.
  for (const legacyMode of ["frames", "references", undefined] as const) {
    const desc = legacyMode === undefined ? "no mode field" : `legacy seedance2InputMode='${legacyMode}'`
    it(`seedance-2-fast returns full caps for ALL handles (${desc})`, () => {
      const node = {
        id: "n",
        type: "generate-video",
        data: { provider: "seedance-2-fast", ...(legacyMode ? { seedance2InputMode: legacyMode } : {}) },
      } as unknown as WorkflowNode
      expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
      expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(1)
      expect(getHandleConnectionLimit(node, "imageReferences")?.limit).toBe(9)
      expect(getHandleConnectionLimit(node, "videoReferences")?.limit).toBe(3)
      expect(getHandleConnectionLimit(node, "audioReferences")?.limit).toBe(3)
    })
  }

  it("returns null for unknown handle on generate-video", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "look")).toBeNull()
  })

  it("falls back to kling when no provider is set", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: {},
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("does NOT affect generate-image dispatch", () => {
    const node = {
      id: "n",
      type: "generate-image",
      data: { provider: "nano-banana-pro" },
    } as unknown as WorkflowNode
    // generate-image only returns non-null for handleId === "references"
    expect(getHandleConnectionLimit(node, "startFrame")).toBeNull()
  })
})

describe("seedance2ImagePoolSlotsConsumed", () => {
  const edge = (targetHandle: string, target = "n", id = targetHandle): WorkflowEdge =>
    ({ id, source: `s_${id}`, target, targetHandle }) as unknown as WorkflowEdge

  it("returns 0 when nothing competes for the image pool", () => {
    expect(seedance2ImagePoolSlotsConsumed([], "n")).toBe(0)
    // imageReferences itself is NOT counted (it's the handle being measured),
    // and video/audio/picker handles never merge into the image pool.
    expect(
      seedance2ImagePoolSlotsConsumed(
        [edge("imageReferences"), edge("videoReferences"), edge("audioReferences"), edge("look"), edge("elements")],
        "n",
      ),
    ).toBe(0)
  })

  it("counts start + end frame as 1 slot each (clamped)", () => {
    expect(seedance2ImagePoolSlotsConsumed([edge("startFrame"), edge("endFrame")], "n")).toBe(2)
    // Duplicate start-frame edges (shouldn't happen — cap 1 — but be safe) stay 1.
    expect(
      seedance2ImagePoolSlotsConsumed([edge("startFrame", "n", "a"), edge("startFrame", "n", "b")], "n"),
    ).toBe(1)
  })

  it("counts each wired identity asset as 1 slot", () => {
    expect(
      seedance2ImagePoolSlotsConsumed(
        [edge("assets", "n", "c1"), edge("assets", "n", "c2")],
        "n",
      ),
    ).toBe(2)
  })

  it("sums frames + assets and ignores edges to other nodes", () => {
    const edges = [
      edge("startFrame"),
      edge("endFrame"),
      edge("assets", "n", "c1"),
      edge("assets", "n", "c2"),
      edge("imageReferences"), // not counted
      edge("startFrame", "OTHER"), // different node — ignored
    ]
    expect(seedance2ImagePoolSlotsConsumed(edges, "n")).toBe(4)
  })
})

describe("getHandleConnectionLimit — Seedance 2 imageReferences shared budget", () => {
  const node = {
    id: "n",
    type: "generate-video",
    data: { provider: "seedance-2-fast" },
  } as unknown as WorkflowNode

  it("is the full 9 with nothing else wired (no counts / zero counts)", () => {
    expect(getHandleConnectionLimit(node, "imageReferences")?.limit).toBe(9)
    expect(
      getHandleConnectionLimit(node, "imageReferences", { seedance2ImagePoolConsumed: 0 })?.limit,
    ).toBe(9)
  })

  it("subtracts start+end frame + 2 wired chars → 9-2-2 = 5", () => {
    // start(1) + end(1) + 2 assets(2) = 4 consumed.
    expect(
      getHandleConnectionLimit(node, "imageReferences", { seedance2ImagePoolConsumed: 4 })?.limit,
    ).toBe(5)
  })

  it("floors at 0 (never negative) when the pool is over-subscribed", () => {
    expect(
      getHandleConnectionLimit(node, "imageReferences", { seedance2ImagePoolConsumed: 12 })?.limit,
    ).toBe(0)
  })

  it("does NOT reduce the video or audio caps (separate pools)", () => {
    // The consumed-image-pool count is image-only; videos/audio stay 3/3.
    const counts = { seedance2ImagePoolConsumed: 4 }
    expect(getHandleConnectionLimit(node, "videoReferences", counts)?.limit).toBe(3)
    expect(getHandleConnectionLimit(node, "audioReferences", counts)?.limit).toBe(3)
  })

  it("end-to-end via the edge helper: start+end+2 chars → cap 5", () => {
    const e = (h: string, id: string): WorkflowEdge =>
      ({ id, source: `s_${id}`, target: "n", targetHandle: h }) as unknown as WorkflowEdge
    const edges = [
      e("startFrame", "sf"),
      e("endFrame", "ef"),
      e("assets", "c1"),
      e("assets", "c2"),
      e("imageReferences", "r1"), // the measured handle's own ref — not subtracted
    ]
    const consumed = seedance2ImagePoolSlotsConsumed(edges, "n")
    expect(
      getHandleConnectionLimit(node, "imageReferences", { seedance2ImagePoolConsumed: consumed })?.limit,
    ).toBe(5)
  })

  it("does NOT apply the budget to non-Seedance-2 ref providers (flat cap)", () => {
    // gemini-omni-video is in PROVIDERS_WITH_REFERENCES (cap 7) but is NOT a
    // Seedance 2 provider — it has no frame/asset reference_image_urls pool
    // sharing, so the consumed count MUST be ignored and the cap stays 7.
    const gemini = {
      id: "n",
      type: "generate-video",
      data: { provider: "gemini-omni-video" },
    } as unknown as WorkflowNode
    expect(
      getHandleConnectionLimit(gemini, "imageReferences", { seedance2ImagePoolConsumed: 3 })?.limit,
    ).toBe(7)
  })
})

describe("getHandleConnectionLimit (generate-image references)", () => {
  const node = (data: Record<string, unknown>) =>
    ({ id: "n", type: "generate-image", data }) as unknown as WorkflowNode

  it("uses the i2i sibling's cap for an auto-routed T2I provider", () => {
    // grok (t2i) auto-routes to grok-i2i (cap 1) when refs are attached — the
    // popover must show 1, matching the reference-support warning (not the t2i
    // id's default of 4).
    expect(getHandleConnectionLimit(node({ provider: "grok" }), "references")?.limit).toBe(1)
    // gpt-image-2 → gpt-image-2-i2i (cap 16).
    expect(getHandleConnectionLimit(node({ provider: "gpt-image-2" }), "references")?.limit).toBe(16)
  })

  it("uses the direct cap for a multi-ref T2I provider", () => {
    expect(
      getHandleConnectionLimit(node({ provider: "nano-banana-pro" }), "references")?.limit,
    ).toBe(8)
  })

  it("returns null when no selected provider consumes references", () => {
    // imagen4 ignores reference images entirely.
    expect(getHandleConnectionLimit(node({ provider: "imagen4" }), "references")).toBeNull()
  })

  it("takes the MIN cap across selected providers in multi-provider mode", () => {
    // nano-banana-pro (8) + grok→grok-i2i (1) → MIN 1, flagged multi-provider.
    const result = getHandleConnectionLimit(
      node({ providers: ["nano-banana-pro", "grok"] }),
      "references",
    )
    expect(result?.limit).toBe(1)
    expect(result?.isMultiProviderMin).toBe(true)
  })
})
