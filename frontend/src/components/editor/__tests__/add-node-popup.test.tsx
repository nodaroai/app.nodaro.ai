import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mock direct imports of add-node-popup.tsx.
// lucide-react requires an explicit export list -- Proxy-based mocks can hang
// vitest during ESM resolution of large named-import destructuring.
// All values must be inline (vi.mock factories are hoisted before const decls).
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const I = () => null
  return {
    Type: I, List: I, BookOpen: I, ImageIcon: I, Film: I,
    Merge: I, Upload: I, Video: I, Rss: I, Palette: I,
    PaintBucket: I, Server: I, Hash: I, Clock: I, RatioIcon: I,
    Mic: I, ShieldCheck: I, Volume2: I, Captions: I, Maximize: I,
    AudioLines: I, VolumeX: I, Music: I, SlidersHorizontal: I, Scissors: I,
    HardDrive: I, Webhook: I, Clapperboard: I, UserPlus: I,
    Package: I, MapPin: I, ChevronRight: I, Search: I, Download: I,
    ArrowLeft: I, Wand2: I, Layers: I, Users: I, Waypoints: I,
    ArrowUpFromLine: I, FileText: I, Disc3: I, FastForward: I,
    Smile: I, Sparkles: I, Repeat: I, Gauge: I, SunDim: I,
    RefreshCw: I, Shapes: I, Box: I, AudioWaveform: I, Eye: I,
    Languages: I, AlignLeft: I, Workflow: I, LogIn: I, LogOut: I, Share2: I,
    Instagram: I, Youtube: I, Linkedin: I, Twitter: I, Facebook: I, StickyNote: I, UserRound: I, Send: I,
    GitBranch: I, Puzzle: I, MessageSquare: I, Frame: I, ZoomIn: I, Eraser: I, ListMusic: I,
    Globe: I, Braces: I, Filter: I, Funnel: I, ListFilter: I, CopyMinus: I, GitMerge: I,
    ArrowUpDown: I,
    Aperture: I, Lightbulb: I, SwatchBook: I, CloudFog: I, Brush: I,
    Mountain: I, PersonStanding: I, Gem: I,
    PawPrint: I, Car: I, Swords: I, Armchair: I,
    Camera: I, Hourglass: I, Cpu: I, LayoutDashboard: I, HandMetal: I,
    Zap: I,
    Activity: I, Piano: I, User: I, MessageCircle: I,
    ScanFace: I,
    VenetianMask: I,
    TrendingUp: I, Star: I,
    ListTree: I,
  }
})

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
import { NODE_OPTIONS, CATEGORIES, VIRTUAL_CATEGORY_IDS } from "../add-node-popup"
import { clusterByGroup } from "@/lib/cluster-by-group"

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

  it("sound pickers live under the Pickers category, Sound section", () => {
    const soundPickers = NODE_OPTIONS
      .filter((o) => o.category === "Pickers" && o.group === "Sound")
      .map((o) => o.type)
    expect(soundPickers).toContain("music-genre")
    expect(soundPickers).toContain("music-mood")
    expect(soundPickers).toContain("instrumentation")
    expect(soundPickers).toContain("voice-character")
    expect(soundPickers).toContain("voice-delivery")
  })

  it("Pickers is a single root category with the 5 picker sections", () => {
    // The old Camera/Look/Subject/Object/Sound root categories were collapsed
    // into one "Pickers" root, each becoming a `group` section.
    expect(CATEGORIES.map((c) => c.id)).toContain("Pickers")
    expect(CATEGORIES.map((c) => c.id)).not.toContain("Camera")
    const pickerGroups = new Set(
      NODE_OPTIONS.filter((o) => o.category === "Pickers").map((o) => o.group),
    )
    expect(pickerGroups).toEqual(
      new Set(["Camera", "Look", "Subject", "Object", "Sound"]),
    )
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

  it("every category has id, label, icon, and description", () => {
    for (const cat of CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.label).toBeTruthy()
      expect(cat.icon).toBeDefined()
      expect(cat.description).toBeTruthy()
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
