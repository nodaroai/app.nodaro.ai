import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

/**
 * A workflow run on Kling Image 4.0 with a wired character whose run sends
 * two of its images: the character goes as ONE named subject, priced as one
 * input item, as on the route.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data })
const edge = (source: string, target: string): SimpleEdge => ({ id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null })

const kira = node("char-1", "character", {
  label: "Kira",
  characterName: "Kira",
  sourceImageUrl: "https://r2/kira-source.png",
  description: "young woman with warm smile",
  canonicalDescription: "young woman, brown eyes, auburn shoulder-length hair",
  defaultAssetUrl: "https://r2/kira-portrait.png",
  expressions: [{ name: "smile", url: "https://r2/kira-smile.png" }],
  poses: [],
  motions: [],
  angles: [],
  bodyAngles: [],
  lightingVariations: [],
})

describe("Kling Image 4.0 in a workflow run: a wired character is a named subject", () => {
  it("its two images go as one subject, priced as one item", () => {
    const gen = node("gen-1", "generate-image", { prompt: "@kira:1 and @kira:1:smile at the harbour", provider: "kling-image-4", aspectRatio: "16:9" })
    const r = buildPayload(gen, "job-1", {}, undefined, { nodes: [kira, gen], edges: [edge("char-1", "gen-1")], nodeStates: {} })
    const refs = r.payload.referenceImageUrls as string[]
    const subjects = r.payload.imageSubjects as Array<{ name: string; imageUrls: string[] }> | undefined
    expect(refs.length).toBeGreaterThanOrEqual(2)
    expect(subjects).toHaveLength(1)
    expect(subjects![0]!.name).toBe("Kira")
    expect(subjects![0]!.imageUrls.length).toBeGreaterThanOrEqual(2)
    const items = refs.length - (subjects![0]!.imageUrls.length - 1)
    expect(r.modelIdentifier).toBe(`kling-image-4-i2i:2K:${items}ref`)
  })

  it("another model sends the same images as references, priced per image", () => {
    const gen = node("gen-1", "generate-image", { prompt: "@kira:1 and @kira:1:smile at the harbour", provider: "seedream-5-5", aspectRatio: "16:9" })
    const r = buildPayload(gen, "job-1", {}, undefined, { nodes: [kira, gen], edges: [edge("char-1", "gen-1")], nodeStates: {} })
    expect(r.payload).not.toHaveProperty("imageSubjects")
  })
})

describe("Kling Image 4.0 in a workflow run: the limit counts items", () => {
  const char = (id: string, slug: string) => node(id, "character", {
    label: slug, characterName: slug, sourceImageUrl: `https://r2/${slug}-source.png`, description: "d",
    defaultAssetUrl: `https://r2/${slug}.png`,
    expressions: ["smile", "frown", "laugh"].map((name) => ({ name, url: `https://r2/${slug}-${name}.png` })),
    poses: [], motions: [], angles: [], bodyAngles: [], lightingVariations: [],
  })
  const mention = (slug: string) => `@${slug.toLowerCase()}:1 @${slug.toLowerCase()}:1:smile @${slug.toLowerCase()}:1:frown @${slug.toLowerCase()}:1:laugh`

  it("three wired characters of four images each run as three items", () => {
    const chars = [char("c1", "Kira"), char("c2", "Maxi"), char("c3", "Anna")]
    const gen = node("gen-1", "generate-image", { prompt: `${mention("Kira")} ${mention("Maxi")} ${mention("Anna")}`, provider: "kling-image-4", aspectRatio: "16:9" })
    const r = buildPayload(gen, "job-1", {}, undefined, { nodes: [...chars, gen], edges: chars.map((c) => edge(c.id, "gen-1")), nodeStates: {} })
    const refs = r.payload.referenceImageUrls as string[]
    const subjects = r.payload.imageSubjects as Array<{ imageUrls: string[] }>
    expect(refs.length).toBeGreaterThan(10)
    expect(subjects).toHaveLength(3)
    const items = refs.length - subjects.reduce((n, s) => n + s.imageUrls.length - 1, 0)
    expect(items).toBeLessThanOrEqual(10)
    expect(r.modelIdentifier).toBe(`kling-image-4-i2i:2K:${items}ref`)
  })
})
