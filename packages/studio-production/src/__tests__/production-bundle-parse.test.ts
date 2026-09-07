import { describe, it, expect } from "vitest"

import type { Shot } from "../shot"
import { serializeProduction } from "../shot-graph"
import {
  BundleParseError,
  parseBundle,
} from "../bundle/production-bundle-parse"

/**
 * The bundle reader — envelope validation, kind/media inference for meta-less
 * bundles (a platform `export_workflow` file), and the sanitizing whitelist
 * (shared / trash / freecutDraftUrl / pendingClips can never pass through).
 */

const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

const clipOnly = (id: string): Shot => ({
  id,
  clip: {
    nodeId: `generate-video-${id}`,
    url: `https://r2.example/${id}.mp4`,
    provider: "grok-i2v",
    prompt: `clip ${id}`,
    duration: 5,
  },
})

/** A minimal meta-less envelope around a serialized graph. */
const envelope = (
  shots: ReadonlyArray<Shot>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  const graph = serializeProduction(shots, shots[0]?.id)
  return {
    version: 1,
    exportedAt: "2026-08-31T00:00:00Z",
    name: "Meta-less",
    nodes: graph.nodes,
    edges: graph.edges,
    settings: graph.settings,
    ...extra,
  }
}

const reasonOf = (value: unknown): string => {
  try {
    parseBundle(value)
  } catch (err) {
    if (err instanceof BundleParseError) return err.reason
    throw err
  }
  return "no-error"
}

describe("parseBundle — envelope validation", () => {
  it("rejects non-objects and non-bundles with typed reasons", () => {
    expect(reasonOf("nope")).toBe("not-a-bundle")
    expect(reasonOf(null)).toBe("not-a-bundle")
    expect(reasonOf([1, 2])).toBe("not-a-bundle")
    expect(reasonOf({ version: 1, nodes: "x", edges: [] })).toBe("not-a-bundle")
    expect(reasonOf({ version: 1, nodes: [], edges: [], settings: 7 })).toBe(
      "not-a-bundle",
    )
  })

  it("rejects a future bundle version", () => {
    expect(reasonOf({ version: 2, nodes: [], edges: [] })).toBe(
      "unsupported-version",
    )
  })

  it("rejects a bundle with no parseable scenes", () => {
    expect(reasonOf({ version: 1, name: "E", nodes: [], edges: [] })).toBe(
      "no-scenes",
    )
  })

  it("defaults a missing name", () => {
    const raw = envelope([stillOnly("s1")])
    delete raw.name
    expect(parseBundle(raw).name).toBe("Imported production")
  })
})

describe("parseBundle — kind/media inference (meta-less bundles)", () => {
  it("one lone-result still, nothing else → frame", () => {
    const parsed = parseBundle(envelope([stillOnly("s1")]))
    expect(parsed.kind).toBe("frame")
    expect(parsed.media).toBe("linked")
  })

  it("one lone-take clip, nothing else → motion", () => {
    expect(parseBundle(envelope([clipOnly("c1")])).kind).toBe("motion")
  })

  it("one shot with both halves → scene; several shots → film", () => {
    const both: Shot = { ...stillOnly("s1"), clip: clipOnly("s1").clip }
    expect(parseBundle(envelope([both])).kind).toBe("scene")
    expect(parseBundle(envelope([stillOnly("a"), stillOnly("b")])).kind).toBe(
      "film",
    )
  })

  it("recipe-only shots infer media none", () => {
    const recipeShot: Shot = {
      id: "r1",
      recipe: { framing: { prompt: "a dune at dawn" } },
    }
    const parsed = parseBundle(envelope([recipeShot, { id: "r2", name: "b" }]))
    expect(parsed.media).toBe("none")
    expect(parsed.kind).toBe("film")
  })

  it("a corrupt meta block falls back to inference", () => {
    const parsed = parseBundle(
      envelope([stillOnly("s1")], { nodaroStudio: { kind: "weird" } }),
    )
    expect(parsed.kind).toBe("frame")
  })

  it("a valid meta block wins over inference", () => {
    const parsed = parseBundle(
      envelope([stillOnly("s1")], {
        nodaroStudio: {
          version: 1,
          app: "studio.nodaro.ai",
          kind: "scene",
          media: "linked",
        },
      }),
    )
    expect(parsed.kind).toBe("scene")
  })
})

describe("parseBundle — the sanitizing whitelist", () => {
  it("never passes shared/trash/freecutDraftUrl through, and strips pendingClips", () => {
    const withPending: Shot = {
      ...stillOnly("s1"),
      pendingClips: [
        { jobId: "job-1", provider: "grok-i2v", prompt: "p", startedAt: 1 },
      ],
    }
    // A foreign file could carry the owner's share flag + draft pointer.
    const graph = serializeProduction(
      [withPending],
      "s1",
      undefined,
      true, // shared
      undefined,
      undefined,
      undefined,
      undefined,
      "https://r2.example/draft.json",
    )
    const parsed = parseBundle({
      version: 1,
      name: "Foreign",
      nodes: graph.nodes,
      edges: graph.edges,
      settings: graph.settings,
    })
    expect(parsed.shots[0]!.pendingClips).toBeUndefined()
    // The whitelist type has no shared/freecutDraftUrl at all — assert the
    // runtime object carries nothing beyond the whitelisted keys either.
    expect(parsed.production).toEqual({})
  })
})

describe("parseBundle — the film look is read KIND-AGNOSTICALLY (D-B1)", () => {
  it("reads a SCENE file's film look, not just a film file's", () => {
    // The reader never branched on kind, and must not start: with D-B1 every
    // kind emits `settings.studio.film`, and a scene's is the one the paste-time
    // ask is decided from. Asserted on a scene envelope because that is the kind
    // that carried nothing before.
    const graph = serializeProduction(
      [stillOnly("s1")],
      "s1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { colorLookId: "kodak-vision3", eraId: "1980s-neon" },
    )
    const parsed = parseBundle({
      version: 1,
      exportedAt: "2026-09-01T00:00:00Z",
      name: "A scene",
      nodes: graph.nodes,
      edges: graph.edges,
      settings: graph.settings,
      nodaroStudio: {
        version: 1,
        app: "studio.nodaro.ai",
        kind: "scene",
        media: "linked",
      },
    })
    expect(parsed.kind).toBe("scene")
    expect(parsed.production.film).toEqual({
      colorLookId: "kodak-vision3",
      eraId: "1980s-neon",
    })
  })
})
