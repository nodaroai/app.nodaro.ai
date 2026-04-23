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
    Globe: I, Braces: I, Filter: I, ListFilter: I, CopyMinus: I, GitMerge: I,
    ArrowUpDown: I,
    Aperture: I, Lightbulb: I, SwatchBook: I, CloudFog: I,
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
import { NODE_OPTIONS, CATEGORIES } from "../add-node-popup"

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
    const categoryIds = new Set(CATEGORIES.map((c) => c.id))
    const missingCategories: string[] = []
    for (const opt of NODE_OPTIONS) {
      if (!categoryIds.has(opt.category)) {
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
    expect(assetTypes).toContain("scene")
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
    expect(ids).toContain("Parameter")
    expect(ids).toContain("AI")
    expect(ids).toContain("Processing")
    expect(ids).toContain("Assets")
    expect(ids).toContain("Output")
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
    for (const cat of CATEGORIES) {
      const nodesInCategory = NODE_OPTIONS.filter(
        (o) => o.category === cat.id,
      )
      expect(nodesInCategory.length).toBeGreaterThan(0)
    }
  })
})
