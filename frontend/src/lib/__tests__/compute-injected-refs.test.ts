import { describe, it, expect } from "vitest"
import {
  computeInjectedRefs,
  wiredTileId,
  mentionTileId,
  canonicalFallbackTileId,
  type InjectedRefTile,
} from "../compute-injected-refs"
import type { ConnectedReference } from "@nodaro/shared"

const kiraCanonical: ConnectedReference = {
  id: "node-kira",
  defaultName: "Kira",
  source: "wired-character",
  description: "young woman with warm smile",
  url: "https://r2/kira-portrait.png",
  characterSlug: "kira",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, brown eyes",
  variantDescription: null,
  variantDisplayName: "canonical",
}

const kiraSmile: ConnectedReference = {
  id: "node-kira_expressions_smile",
  defaultName: "Kira / smile",
  source: "wired-character",
  description: "warm closed-mouth smile",
  url: "https://r2/kira-smile.png",
  characterSlug: "kira",
  variantSlug: "smile",
  characterCanonicalDescription: "young woman, brown eyes",
  variantDescription: "smile variant",
  variantDisplayName: "smile",
}

const kiraWalking: ConnectedReference = {
  id: "node-kira_poses_walking",
  defaultName: "Kira / walking",
  source: "wired-character",
  description: "walking pose",
  url: "https://r2/kira-walking.png",
  characterSlug: "kira",
  variantSlug: "walking",
  characterCanonicalDescription: "young woman, brown eyes",
  variantDescription: "walking pose",
  variantDisplayName: "walking",
}

const adamCanonical: ConnectedReference = {
  id: "node-adam",
  defaultName: "Adam",
  source: "wired-character",
  description: "older man",
  url: "https://r2/adam-portrait.png",
  characterSlug: "adam",
  variantSlug: undefined,
  characterCanonicalDescription: "older man, grey hair",
  variantDescription: null,
  variantDisplayName: "canonical",
}

const wiredUpload: ConnectedReference = {
  id: "node-upload-1",
  defaultName: "Upload 1",
  source: "wired-image",
  url: "https://r2/upload-1.png",
}

const wiredGenerated: ConnectedReference = {
  id: "node-gen-image-1",
  defaultName: "Gen Image",
  source: "wired-image",
  url: "https://r2/generated-1.png",
}

describe("computeInjectedRefs - basics", () => {
  it("returns empty list when no refs and no prompt", () => {
    const tiles = computeInjectedRefs({ connectedReferences: [], prompt: "" })
    expect(tiles).toEqual([])
  })

  it("emits wired-raw tiles for non-character refs", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [wiredUpload, wiredGenerated],
      prompt: "",
    })
    expect(tiles).toHaveLength(2)
    expect(tiles[0].id).toBe(wiredTileId("node-upload-1"))
    expect(tiles[0].origin).toBe("wired-raw")
    expect(tiles[0].url).toBe("https://r2/upload-1.png")
    expect(tiles[0].imageIndex).toBe(1)
    expect(tiles[1].imageIndex).toBe(2)
  })

  it("emits canonical-fallback tile for wired character with no mention", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile],
      prompt: "no mentions in this prompt",
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].id).toBe(canonicalFallbackTileId("kira"))
    expect(tiles[0].origin).toBe("canonical-fallback")
    expect(tiles[0].url).toBe(kiraCanonical.url)
    expect(tiles[0].characterName).toBe("Kira")
  })

  it("emits mention-variant tile when @kira:1:smile is in prompt", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile],
      prompt: "@kira:1:smile in a meadow",
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].id).toBe(mentionTileId("kira", "smile"))
    expect(tiles[0].origin).toBe("mention-variant")
    expect(tiles[0].url).toBe(kiraSmile.url)
    expect(tiles[0].variantSlug).toBe("smile")
    expect(tiles[0].characterName).toBe("Kira")
    expect(tiles[0].mentionToken).toBe("@kira:1:smile")
  })

  it("dedupes canonical fallback + mention for same character (mention wins)", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile],
      prompt: "@kira:1:smile",
    })
    // Should not also produce a char-canonical:kira tile
    const ids = tiles.map((t) => t.id)
    expect(ids).not.toContain(canonicalFallbackTileId("kira"))
    expect(ids).toContain(mentionTileId("kira", "smile"))
  })

  it("collapses multiple mentions of the same (slug, variant) to one tile", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile],
      prompt: "@kira:1:smile and again @kira:2:smile",
    })
    const mentions = tiles.filter((t) => t.origin === "mention-variant")
    expect(mentions).toHaveLength(1)
  })

  it("emits one tile per distinct (slug, variant)", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile, kiraWalking],
      prompt: "@kira:1:smile and @kira:2:walking",
    })
    const mentions = tiles.filter((t) => t.origin === "mention-variant")
    expect(mentions).toHaveLength(2)
    expect(mentions.map((t) => t.variantSlug)).toEqual(["smile", "walking"])
  })

  it("handles wired-raw + mention + canonical-fallback together in URL-merge order", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [wiredUpload, kiraCanonical, kiraSmile, adamCanonical],
      prompt: "@kira:1:smile",
    })
    // Order: wired-raw → mentions → canonical fallbacks (in connectedReferences order).
    expect(tiles.map((t) => t.origin)).toEqual([
      "wired-raw",
      "mention-variant",
      "canonical-fallback",
    ])
    expect(tiles.map((t) => t.url)).toEqual([
      wiredUpload.url,
      kiraSmile.url,
      adamCanonical.url,
    ])
    expect(tiles.map((t) => t.imageIndex)).toEqual([1, 2, 3])
  })

  it("ignores unknown character mentions", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical],
      prompt: "@unknown:1 wave",
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].id).toBe(canonicalFallbackTileId("kira"))
  })
})

describe("computeInjectedRefs - suppressedCanonicalCharacterIds", () => {
  it("drops canonical-fallback tile when slug is suppressed", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, adamCanonical],
      prompt: "",
      suppressedCanonicalCharacterIds: ["kira"],
    })
    const slugs = tiles.map((t) => t.characterSlug).filter(Boolean)
    expect(slugs).toEqual(["adam"])
  })

  it("does NOT drop mention tiles when slug is suppressed (mention is explicit)", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [kiraCanonical, kiraSmile],
      prompt: "@kira:1:smile",
      suppressedCanonicalCharacterIds: ["kira"],
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].origin).toBe("mention-variant")
    expect(tiles[0].variantSlug).toBe("smile")
  })
})

describe("computeInjectedRefs - referenceOrder", () => {
  function fixture(): { refs: ConnectedReference[]; prompt: string } {
    return {
      refs: [wiredUpload, kiraCanonical, kiraSmile, adamCanonical, wiredGenerated],
      prompt: "@kira:1:smile",
    }
  }

  it("pulls IDs in referenceOrder to the front", () => {
    const { refs, prompt } = fixture()
    const naturalOrder = computeInjectedRefs({ connectedReferences: refs, prompt })
    // Natural: [wired-upload, wired-gen, mention:kira:smile, char-canonical:adam]
    expect(naturalOrder.map((t) => t.id)).toEqual([
      wiredTileId("node-upload-1"),
      wiredTileId("node-gen-image-1"),
      mentionTileId("kira", "smile"),
      canonicalFallbackTileId("adam"),
    ])

    const reorderedIds = [
      canonicalFallbackTileId("adam"),
      mentionTileId("kira", "smile"),
    ]
    const tiles = computeInjectedRefs({
      connectedReferences: refs,
      prompt,
      referenceOrder: reorderedIds,
    })
    expect(tiles.slice(0, 2).map((t) => t.id)).toEqual(reorderedIds)
    // Imageindex updates to the new positions.
    expect(tiles[0].imageIndex).toBe(1)
    expect(tiles[1].imageIndex).toBe(2)
    // Unordered tiles fall through in natural order.
    expect(tiles.slice(2).map((t) => t.id)).toEqual([
      wiredTileId("node-upload-1"),
      wiredTileId("node-gen-image-1"),
    ])
  })

  it("silently drops stale IDs in referenceOrder without breaking layout", () => {
    const { refs, prompt } = fixture()
    const tiles = computeInjectedRefs({
      connectedReferences: refs,
      prompt,
      referenceOrder: [
        "stale:nonexistent",
        mentionTileId("kira", "smile"),
        "wired:also-deleted",
        canonicalFallbackTileId("adam"),
      ],
    })
    // Stale IDs are simply skipped; remaining ordered IDs apply.
    expect(tiles.slice(0, 2).map((t) => t.id)).toEqual([
      mentionTileId("kira", "smile"),
      canonicalFallbackTileId("adam"),
    ])
    // All tiles still present in some order.
    expect(tiles).toHaveLength(4)
    expect(new Set(tiles.map((t) => t.id))).toEqual(
      new Set([
        wiredTileId("node-upload-1"),
        wiredTileId("node-gen-image-1"),
        mentionTileId("kira", "smile"),
        canonicalFallbackTileId("adam"),
      ]),
    )
  })

  it("does not duplicate tiles when referenceOrder has duplicate IDs", () => {
    const { refs, prompt } = fixture()
    const tiles = computeInjectedRefs({
      connectedReferences: refs,
      prompt,
      referenceOrder: [
        mentionTileId("kira", "smile"),
        mentionTileId("kira", "smile"),
        mentionTileId("kira", "smile"),
      ],
    })
    const mentionTiles = tiles.filter((t) => t.origin === "mention-variant")
    expect(mentionTiles).toHaveLength(1)
  })

  it("empty referenceOrder is a no-op (natural order preserved)", () => {
    const { refs, prompt } = fixture()
    const a = computeInjectedRefs({ connectedReferences: refs, prompt })
    const b = computeInjectedRefs({ connectedReferences: refs, prompt, referenceOrder: [] })
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })
})

describe("computeInjectedRefs - usage mode propagation", () => {
  it("uses character's defaultUsageMode for canonical-fallback tile when no override", () => {
    const refs: ConnectedReference[] = [{
      ...kiraCanonical,
      defaultUsageMode: "face",
    }]
    const tiles = computeInjectedRefs({ connectedReferences: refs, prompt: "" })
    expect(tiles[0].usageMode).toBe("face")
  })

  it("propagates per-mention usage mode override from @-token", () => {
    const refs: ConnectedReference[] = [
      { ...kiraCanonical, defaultUsageMode: "identical" },
      { ...kiraSmile, defaultUsageMode: "identical" },
    ]
    const tiles = computeInjectedRefs({
      connectedReferences: refs,
      prompt: "@kira:1:smile:face",
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].usageMode).toBe("face")
  })

  it("falls back to ref's defaultUsageMode when mention has no override", () => {
    const refs: ConnectedReference[] = [
      { ...kiraCanonical, defaultUsageMode: "pose" },
      { ...kiraSmile, defaultUsageMode: "pose" },
    ]
    const tiles = computeInjectedRefs({
      connectedReferences: refs,
      prompt: "@kira:1:smile",
    })
    expect(tiles[0].usageMode).toBe("pose")
  })
})

describe("computeInjectedRefs - sourceNodeIdById", () => {
  it("uses provided source node IDs for wired tiles when supplied", () => {
    const sourceNodeIdById = new Map([
      ["node-upload-1", "actual-upstream-node-id"],
    ])
    const tiles = computeInjectedRefs({
      connectedReferences: [wiredUpload],
      prompt: "",
      sourceNodeIdById,
    })
    expect(tiles[0].id).toBe(wiredTileId("actual-upstream-node-id"))
    expect(tiles[0].sourceNodeId).toBe("actual-upstream-node-id")
  })

  it("falls back to ref.id when sourceNodeIdById not provided", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [wiredUpload],
      prompt: "",
    })
    expect(tiles[0].id).toBe(wiredTileId("node-upload-1"))
  })
})

describe("computeInjectedRefs - imageIndex reflects final order", () => {
  it("reorder updates imageIndex to new position", () => {
    const tiles = computeInjectedRefs({
      connectedReferences: [wiredUpload, kiraCanonical, kiraSmile],
      prompt: "@kira:1:smile",
      referenceOrder: [
        mentionTileId("kira", "smile"),
        wiredTileId("node-upload-1"),
      ],
    })
    const byOrigin: Record<string, InjectedRefTile> = {}
    for (const t of tiles) byOrigin[t.origin] = t
    expect(byOrigin["mention-variant"].imageIndex).toBe(1)
    expect(byOrigin["wired-raw"].imageIndex).toBe(2)
  })
})
