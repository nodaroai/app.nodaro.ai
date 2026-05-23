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
    AudioLines: I, Music: I, SlidersHorizontal: I, Scissors: I,
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
    expect(aiTypes).toContain("image-to-video")
    expect(aiTypes).toContain("text-to-video")
    expect(aiTypes).toContain("text-to-speech")
    expect(aiTypes).toContain("ai-writer")
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

  it("contains expected Sound nodes", () => {
    const soundTypes = NODE_OPTIONS
      .filter((o) => o.category === "Sound")
      .map((o) => o.type)
    expect(soundTypes).toContain("music-genre")
    expect(soundTypes).toContain("music-mood")
    expect(soundTypes).toContain("instrumentation")
    expect(soundTypes).toContain("voice-character")
    expect(soundTypes).toContain("voice-delivery")
  })

  it("every label is non-empty and under 30 characters", () => {
    for (const opt of NODE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.label.length).toBeLessThanOrEqual(30)
    }
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
    expect(ids).toContain("Sound")
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
