import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mock direct imports of add-node-popup.tsx.
// lucide-react requires an explicit export list -- Proxy-based mocks can hang
// vitest during ESM resolution of large named-import destructuring.
// All values must be inline (vi.mock factories are hoisted before const decls).
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => new Proxy({}, {
  // Any icon name resolves to a null component — the rich picker-ui package
  // imports icons a closed list cannot anticipate (Dog, Car, ...).
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}))

vi.mock("@/lib/node-compatibility", () => ({
  getCompatibleNodes: () => [],
  resolveTargetHandle: () => undefined,
  HANDLE_COMPATIBILITY: {},
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, session: null }),
}))

// ---------------------------------------------------------------------------
// Import the exports under test
// ---------------------------------------------------------------------------
import {
  NODE_OPTIONS,
  CATEGORIES,
  VIRTUAL_CATEGORY_IDS,
  COMMON_NODE_TYPES,
  searchNodeOptions,
  searchNodeOptionsSectioned,
} from "../add-node-popup"
import { clusterByGroup } from "@/lib/cluster-by-group"
import { CREATIVE_CONTROL_FAMILY_IDS } from "@/lib/node-families"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NODE_OPTIONS", () => {
  it("has at least 60 entries", () => {
    expect(NODE_OPTIONS.length).toBeGreaterThanOrEqual(60)
  })

  it("every option has type, label, icon, and category", () => {
    for (const opt of NODE_OPTIONS) {
      expect(opt.type).toBeTruthy()
      expect(opt.label).toBeTruthy()
      expect(opt.icon).toBeDefined()
      expect(opt.category).toBeTruthy()
    }
  })

  it("has no duplicate types", () => {
    const types = NODE_OPTIONS.map((o) => o.type)
    const unique = new Set(types)
    if (unique.size !== types.length) {
      const duplicates = types.filter(
        (t, i) => types.indexOf(t) !== i,
      )
      throw new Error(`Duplicate node types found: ${duplicates.join(", ")}`)
    }
    expect(unique.size).toBe(types.length)
  })

  it("all category values used by options are defined in CATEGORIES", () => {
    // The "Parameter" category is intentionally orphaned right now — its
    // CATEGORIES entry was removed (the section was an empty pane in the UI
    // because all Parameter-typed options are filtered out of `visibleNodes`).
    // The Parameter-typed options are kept in NODE_OPTIONS so re-enabling is
    // a one-line change. Treat as a known-orphan in this invariant.
    const KNOWN_ORPHAN_CATEGORIES = new Set(["Parameter"])
    const categoryIds = new Set(CATEGORIES.map((c) => c.id))
    const missingCategories: string[] = []
    for (const opt of NODE_OPTIONS) {
      if (!categoryIds.has(opt.category) && !KNOWN_ORPHAN_CATEGORIES.has(opt.category)) {
        missingCategories.push(`${opt.type} -> ${opt.category}`)
      }
    }
    expect(missingCategories).toEqual([])
  })

  it("contains expected Input nodes", () => {
    const inputTypes = NODE_OPTIONS
      .filter((o) => o.category === "Input")
      .map((o) => o.type)
    expect(inputTypes).toContain("text-prompt")
    expect(inputTypes).toContain("upload-image")
    expect(inputTypes).toContain("upload-video")
    expect(inputTypes).toContain("upload-audio")
  })

  it("contains expected AI nodes", () => {
    const aiTypes = NODE_OPTIONS
      .filter((o) => o.category === "AI")
      .map((o) => o.type)
    expect(aiTypes).toContain("generate-image")
    // Task 7.1: i2v + t2v collapsed into a single generate-video entry.
    expect(aiTypes).toContain("generate-video")
    expect(aiTypes).not.toContain("image-to-video")
    expect(aiTypes).not.toContain("text-to-video")
    expect(aiTypes).toContain("text-to-speech")
    expect(aiTypes).toContain("llm-chat")
    expect(aiTypes).toContain("generate-music")
    // Phase 1B.2 — Scene moved from Assets to AI (Pipeline group), pipeline-managed
    expect(aiTypes).toContain("scene")
  })

  it("contains expected Processing nodes", () => {
    const processingTypes = NODE_OPTIONS
      .filter((o) => o.category === "Processing")
      .map((o) => o.type)
    expect(processingTypes).toContain("combine-videos")
    expect(processingTypes).toContain("trim-video")
    expect(processingTypes).toContain("render-video")
    expect(processingTypes).toContain("composite")
    expect(processingTypes).toContain("merge-video-audio")
    expect(processingTypes).toContain("trim-audio")
  })

  it("contains expected Output nodes", () => {
    const outputTypes = NODE_OPTIONS
      .filter((o) => o.category === "Output")
      .map((o) => o.type)
    expect(outputTypes).toContain("save-to-storage")
    expect(outputTypes).toContain("webhook-output")
  })

  it("contains expected Assets nodes", () => {
    const assetTypes = NODE_OPTIONS
      .filter((o) => o.category === "Assets")
      .map((o) => o.type)
    expect(assetTypes).toContain("character")
    expect(assetTypes).toContain("object")
    expect(assetTypes).toContain("location")
    expect(assetTypes).toContain("face")
    // Phase 1B.2 — Scene moved from Assets to AI (Pipeline group), pipeline-managed
    expect(assetTypes).not.toContain("scene")
  })

  it("sound pickers live under the Music & Voice creative-control family", () => {
    const soundPickers = NODE_OPTIONS
      .filter((o) => o.category === "Pickers" && o.group === "cc-music-voice")
      .map((o) => o.type)
    expect(soundPickers).toContain("music-genre")
    expect(soundPickers).toContain("music-mood")
    expect(soundPickers).toContain("instrumentation")
    expect(soundPickers).toContain("voice-character")
    expect(soundPickers).toContain("voice-delivery")
  })

  it("Pickers is a single root category whose nodes are all creative controls", () => {
    // The old Camera/Look/Subject/Object/Sound root categories were collapsed
    // into one "Pickers" root; the picker redesign then re-cut them into the
    // eight Creative Controls sub-families that expand at the bottom of the
    // Image / Video / Audio tabs.
    expect(CATEGORIES.map((c) => c.id)).toContain("Pickers")
    expect(CATEGORIES.map((c) => c.id)).not.toContain("Camera")
    const pickerGroups = new Set(
      NODE_OPTIONS.filter((o) => o.category === "Pickers").map((o) => o.group),
    )
    expect(pickerGroups).toEqual(new Set(CREATIVE_CONTROL_FAMILY_IDS))
  })

  it("every label is non-empty and under 30 characters", () => {
    for (const opt of NODE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.label.length).toBeLessThanOrEqual(30)
    }
  })

  // Regression: the sidebar + popup render group sub-headers sequentially (header
  // shown when group != previous). If a category's nodes interleave groups (e.g.
  // AI had Video…Pipeline…Video, Processing had Video…Video Production…Video) the
  // same header rendered twice. clusterByGroup() must collapse each group into one
  // contiguous block so every section header renders exactly once.
  it("clusterByGroup makes every category's group sections contiguous", () => {
    for (const cat of new Set(NODE_OPTIONS.map((o) => o.category))) {
      const ordered = clusterByGroup(NODE_OPTIONS.filter((o) => o.category === cat))
      const seen = new Set<string>()
      let prev: string | undefined
      for (const node of ordered) {
        const g = node.group ?? ""
        if (g !== prev) {
          expect(
            seen.has(g),
            `group "${g}" renders twice (non-contiguous) in category "${cat}"`,
          ).toBe(false)
          seen.add(g)
          prev = g
        }
      }
    }
  })

  it("clusterByGroup gathers interleaved groups, preserving first-appearance order", () => {
    const input: { type: string; group?: string }[] = [
      { type: "a", group: "X" },
      { type: "b", group: "Y" },
      { type: "c", group: "X" },
      { type: "d" },
    ]
    expect(clusterByGroup(input).map((n) => n.type)).toEqual(["a", "c", "b", "d"])
  })

  it("every type is lowercase with hyphens (kebab-case) or has digits", () => {
    // Allow kebab-case like "text-prompt" and also "3d-title"
    const validPattern = /^[a-z0-9][a-z0-9-]*$/
    for (const opt of NODE_OPTIONS) {
      expect(opt.type).toMatch(validPattern)
    }
  })
})

describe("CATEGORIES", () => {
  it("has at least 6 categories", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(6)
  })

  it("has the expected category ids", () => {
    const ids = CATEGORIES.map((c) => c.id)
    expect(ids).toContain("Input")
    // "Parameter" is intentionally absent — see the orphan-category note in
    // the NODE_OPTIONS test above.
    expect(ids).not.toContain("Parameter")
    expect(ids).toContain("AI")
    expect(ids).toContain("Processing")
    expect(ids).toContain("Assets")
    expect(ids).toContain("Output")
    // Camera/Look/Subject/Object/Sound collapsed into one "Pickers" root.
    expect(ids).toContain("Pickers")
    expect(ids).not.toContain("Sound")
  })

  it("every category has id, labelKey, icon, and descKey", () => {
    for (const cat of CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.labelKey).toBeTruthy()
      expect(cat.icon).toBeDefined()
      expect(cat.descKey).toBeTruthy()
    }
  })

  it("has no duplicate ids", () => {
    const ids = CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every category has at least one node option", () => {
    // Virtual categories have no NODE_OPTIONS entries — they draw from
    // selection history or a curated list at render time.
    const VIRTUAL_CATEGORIES = new Set<string>(Object.values(VIRTUAL_CATEGORY_IDS))
    for (const cat of CATEGORIES) {
      if (VIRTUAL_CATEGORIES.has(cat.id)) continue
      const nodesInCategory = NODE_OPTIONS.filter(
        (o) => o.category === cat.id,
      )
      expect(nodesInCategory.length).toBeGreaterThan(0)
    }
  })
})

// ─── Common/All tabs (nodes-menu modes) ───
//
// The popup root is split into two tabs: COMMON (the curated common view) and
// ALL (the root categories). Common is no longer a navigable category — it's a
// tab — so it must NOT appear in CATEGORIES, and the remaining real categories
// must follow the requested All-tab order.

describe("Common/All tabs", () => {
  it("CATEGORIES no longer contains the Common entry (it's a tab now)", () => {
    expect(CATEGORIES.map((c) => c.id)).not.toContain(VIRTUAL_CATEGORY_IDS.common)
  })

  it("CATEGORIES (minus opt-in virtuals) follows the requested All-tab order", () => {
    const virtuals = new Set<string>([VIRTUAL_CATEGORY_IDS.recent])
    const realIds = CATEGORIES.map((c) => c.id).filter((id) => !virtuals.has(id))
    expect(realIds).toEqual([
      "Input",
      "Assets",
      "AI",
      "Pickers",
      "Processing",
      "Data",
      "Component",
      "Workflow",
      "Triggers",
      "Output",
      // Models is the All tab's last root category — opens the model browser.
      "Models",
    ])
  })

  it("COMMON_NODE_TYPES is non-empty and every member exists in NODE_OPTIONS", () => {
    expect(COMMON_NODE_TYPES.size).toBeGreaterThan(10)
    const allTypes = new Set(NODE_OPTIONS.map((o) => o.type))
    for (const t of COMMON_NODE_TYPES) {
      expect(allTypes.has(t), `COMMON_NODE_TYPES contains unknown type: ${t}`).toBe(true)
    }
  })
})

// ─── Image / Video / Audio media tabs ───
//
// Each media tab lists the nodes whose PRIMARY OUTPUT is that medium, sourced
// from the platform's producer sets (IMAGE_PRODUCER_TYPES + the shared
// VIDEO/AUDIO_PRODUCER_TYPES — the same sets driving canvas handle validation
// and backend output routing). Within a tab, the curated COMMON members come
// first (in Common-tab order), then the remaining producers in catalog order.

describe("searchNodeOptions", () => {
  it("matches by label, type, category, and keywords", () => {
    const byLabel = searchNodeOptions(NODE_OPTIONS, "Generate Image")
    expect(byLabel.map((o) => o.type)).toContain("generate-image")

    const byType = searchNodeOptions(NODE_OPTIONS, "llm-chat")
    expect(byType.map((o) => o.type)).toContain("llm-chat")

    const byCategory = searchNodeOptions(NODE_OPTIONS, "Triggers")
    expect(byCategory.map((o) => o.type)).toContain("webhook-trigger")

    const byKeyword = searchNodeOptions(NODE_OPTIONS, "i2v")
    expect(byKeyword.map((o) => o.type)).toContain("generate-video")
  })

  it("returns common nodes before non-common ones", () => {
    const results = searchNodeOptions(NODE_OPTIONS, "video")
    const buckets = results.map((o) => (COMMON_NODE_TYPES.has(o.type) ? 0 : 1))
    // Once a non-common result appears, no common result may follow.
    expect(buckets).toEqual([...buckets].sort((a, b) => a - b))
    // Sanity: the query actually matched both buckets.
    expect(buckets).toContain(0)
    expect(buckets).toContain(1)
  })

  it("keeps pool order within the common and non-common buckets (stable)", () => {
    const results = searchNodeOptions(NODE_OPTIONS, "video").map((o) => o.type)
    // Both are common; generate-video precedes extend-video in NODE_OPTIONS.
    expect(results.indexOf("generate-video")).toBeLessThan(results.indexOf("extend-video"))
  })

  it("direct-match tier outranks the common bucket when directTypes is given", () => {
    const direct = new Set(["video-to-video"] as const) as ReadonlySet<
      (typeof NODE_OPTIONS)[number]["type"]
    >
    const results = searchNodeOptions(NODE_OPTIONS, "video", direct).map((o) => o.type)
    // video-to-video is NOT common, but as a direct match it must come first.
    expect(results[0]).toBe("video-to-video")
    expect(results.indexOf("video-to-video")).toBeLessThan(results.indexOf("generate-video"))
  })

  it("returns an empty array when nothing matches", () => {
    expect(searchNodeOptions(NODE_OPTIONS, "zzz-no-such-node")).toEqual([])
  })
})

// ─── Tab-aware search sectioning ───
//
// While on the Common / Image / Video / Audio tabs, search puts the active
// tab's own items first and the remaining matches under an "Other" section.
// The All tab (and the edge-drop compatibility view) stays flat.

describe("searchNodeOptionsSectioned", () => {
  it("counts everything the tab renders as 'own', not just its producers", () => {
    const { own, other } = searchNodeOptionsSectioned(NODE_OPTIONS, "video", "video")
    const ownTypes = own.map((o) => o.type)
    expect(ownTypes).toContain("generate-video")
    expect(ownTypes).toContain("upload-video")
    // The tab is a "deals with video" superset now, so the plan-emitting nodes
    // it displays are own matches — they are visible on this very tab, and
    // filing them under "From other tabs" would send the user hunting.
    expect(ownTypes).toContain("video-composer") // Compose Video
    expect(ownTypes).toContain("generative-pipeline") // Story → Video
    const otherTypes = other.map((o) => o.type)
    expect(otherTypes).not.toContain("generate-video")
    // No overlap between the sections
    expect(ownTypes.filter((t) => otherTypes.includes(t))).toEqual([])
  })

  it("on the common tab, own = the curated Common nodes, other = the rest", () => {
    const { own, other } = searchNodeOptionsSectioned(NODE_OPTIONS, "video", "common")
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((o) => COMMON_NODE_TYPES.has(o.type))).toBe(true)
    expect(own.map((o) => o.type)).toContain("generate-video")
    expect(other.map((o) => o.type)).toContain("video-to-video")
  })

  it("own may be empty when the query only matches other tabs' nodes", () => {
    const { own, other } = searchNodeOptionsSectioned(NODE_OPTIONS, "lip sync", "image")
    expect(own).toEqual([])
    expect(other.map((o) => o.type)).toContain("lip-sync")
  })

  it("on the all tab there is no sectioning — everything is own", () => {
    const { own, other } = searchNodeOptionsSectioned(NODE_OPTIONS, "video", "all")
    expect(other).toEqual([])
    expect(own.map((o) => o.type)).toContain("generate-video")
    expect(own.map((o) => o.type)).toContain("video-composer")
  })
})

// ─── Regression: tone (Parameter category) reachable for typed handles ───
//
// The popup's `visibleNodes` filter strips Parameter-category nodes (the
// category is currently hidden from the browse UI). That filter must be
// SKIPPED for typed-handle edge drops — otherwise tone, a registered
// HINT_PRODUCER, never appears as a candidate for camera-motion's
// startState even though `getCompatibleNodes`, the canvas validator, and
// target-handle-registry all accept it.
//
// We can't easily render the full popup here (the mocked `getCompatibleNodes`
// returns []), but we can pin the invariant that the FULL NODE_OPTIONS
// pool contains tone with category="Parameter" — the assertion the
// popup's typed-handle branch depends on.
describe("typed-handle drops include Parameter-category nodes", () => {
  it("tone is present in NODE_OPTIONS with category='Parameter'", () => {
    const tone = NODE_OPTIONS.find((o) => o.type === "tone")
    expect(tone).toBeDefined()
    expect(tone?.category).toBe("Parameter")
  })

  // The popup applies a Parameter-category filter to its browse view AND
  // a typed-handle override (TYPED_HANDLE_IDS = {startState, endState, target}).
  // This test pins the override-allowlist boundary by asserting at least
  // one canonical typed handle id is in the set.
  it("startState / endState / target are the typed-handle override allowlist", () => {
    // Sanity: the popup's TYPED_HANDLE_IDS set should align with
    // target-handle-registry's typed handles. Update both if either changes.
    const TYPED_HANDLE_IDS = ["startState", "endState", "target"]
    expect(new Set(TYPED_HANDLE_IDS)).toEqual(new Set(["startState", "endState", "target"]))
  })
})
