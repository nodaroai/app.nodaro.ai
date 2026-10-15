/**
 * A Generate Image node whose stored `direction` names the caller's palette /
 * moodboard, built by the orchestrator. The node executor resolves the
 * reference first (`node-user-direction.ts`) and hands the result in as
 * `PayloadBuildContext.userDirection`; this pins what the builder does with it,
 * on BOTH of its `assembleImageInput` branches: the clauses fold like catalog
 * clauses, the moodboard's images follow the node's own references, the price
 * is the price of what is sent, and a moodboard that did not fit says so on
 * the payload (which becomes the job's `input_data`).
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import type { ResolvedUserDirection } from "../../../lib/user-direction.js"
import { imageReferenceLimit } from "@nodaro/shared/models"

const PALETTE = "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MOODBOARD = "moodboard:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
const PALETTE_CLAUSE = "color palette: petrol blue #0F4C5C, honey #E3B23C"
const images = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.test/mood-${i + 1}.png` }))

function resolved(n = 2): ResolvedUserDirection {
  return {
    refs: new Map([[PALETTE, PALETTE_CLAUSE], [MOODBOARD, "Moody Nordic interiors"]]),
    styleReferences: images(n),
    moodboard: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", name: "Nordic calm" },
  }
}

const node = (id: string, type: string, data: Record<string, unknown>): SimpleNode => ({ id, type, data })
const edge = (source: string, target: string): SimpleEdge => ({ id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null })

function build(
  data: Record<string, unknown>,
  userDirection: ResolvedUserDirection | undefined,
  opts: { wiredCharacter?: boolean } = {},
) {
  const gi = node("gen-1", "generate-image", { provider: "nano-banana-pro", prompt: "a cabin", ...data })
  const character = node("char-1", "character", {
    label: "Kira",
    characterName: "Kira",
    sourceImageUrl: "https://r2/kira-source.png",
    canonicalDescription: "young woman, auburn hair",
    defaultAssetUrl: "https://r2/kira-portrait.png",
  })
  const nodes = opts.wiredCharacter ? [character, gi] : [gi]
  const edges = opts.wiredCharacter ? [edge("char-1", "gen-1")] : []
  const inputs: ResolvedInputs = opts.wiredCharacter ? { referenceImageUrls: ["https://r2/kira-portrait.png"] } : {}
  return buildPayload(gi, "job-1", inputs, undefined, {
    nodes,
    edges,
    nodeStates: {},
    ...(userDirection ? { userDirection } : {}),
  })
}

describe("Generate Image node with the caller's palette / moodboard (workflow lane)", () => {
  for (const wiredCharacter of [false, true]) {
    const branch = wiredCharacter ? "connected-refs branch" : "flat branch"

    it(`folds both clauses and sends the moodboard after the node's own references (${branch})`, () => {
      const { payload } = build({ direction: { colorLook: PALETTE, style: MOODBOARD } }, resolved(2), { wiredCharacter })
      expect(payload.prompt).toContain(PALETTE_CLAUSE)
      expect(payload.prompt).toContain("Moody Nordic interiors")
      const refs = payload.referenceImageUrls as string[]
      expect(refs.slice(-2)).toEqual(["https://cdn.test/mood-1.png", "https://cdn.test/mood-2.png"])
      if (wiredCharacter) expect(refs[0]).toBe("https://r2/kira-portrait.png")
      expect(payload).not.toHaveProperty("warnings")
    })
  }

  it("prices the run on the references it sends", () => {
    const withBoard = build({ provider: "flux-2-max", direction: { style: MOODBOARD } }, resolved(2))
    const without = build({ provider: "flux-2-max", direction: { style: "anime" } }, undefined)
    expect(withBoard.modelIdentifier).not.toBe(without.modelIdentifier)
    expect((withBoard.payload.referenceImageUrls as string[]).length).toBe(2)
  })

  it("carries a warning when the moodboard did not fit the model's reference limit", () => {
    const cap = imageReferenceLimit("nano-banana-pro")
    const { payload } = build({ direction: { style: MOODBOARD } }, resolved(cap + 3))
    expect((payload.referenceImageUrls as string[]).length).toBe(cap)
    const warnings = payload.warnings as Array<{ code: string; message: string }>
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe("moodboard_images_not_sent")
    expect(warnings[0].message).toContain(`3 of the ${cap + 3} images`)
  })

  it("keeps the ids in the node's direction (what the job records is the reference, not its text)", () => {
    const gi = node("gen-1", "generate-image", { provider: "nano-banana-pro", prompt: "a cabin", direction: { colorLook: PALETTE } })
    buildPayload(gi, "job-1", {}, undefined, { nodes: [gi], edges: [], nodeStates: {}, userDirection: resolved(0) })
    expect(gi.data.direction).toEqual({ colorLook: PALETTE })
  })

  it("folds nothing for a reference it was not handed", () => {
    const { payload } = build({ direction: { colorLook: PALETTE } }, undefined)
    expect(payload.prompt).toBe("a cabin")
  })
})
