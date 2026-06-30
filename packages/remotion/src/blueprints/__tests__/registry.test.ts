import { describe, it, expect, vi } from "vitest"
import { readdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

// Stub remotion and font-registry before importing the registry (which
// transitively imports all blueprint components — each calls useCurrentFrame
// and useVideoConfig at module scope via function bodies, but those are fine
// under vitest since they're inside function bodies, not at the top level).
vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
  interpolate: (v: number, [a, b]: number[], [c, d]: number[]) => {
    if (v <= a) return c
    if (v >= b) return d
    return c + ((v - a) / (b - a)) * (d - c)
  },
  Easing: { ease: (t: number) => t, out: (fn: (t: number) => number) => fn },
  Sequence: ({ children }: { children: unknown }) => children,
  AbsoluteFill: ({ children }: { children: unknown }) => children,
}))
vi.mock("../../../lib/font-registry", () => ({
  FONT_MAP: {},
  SUPPORTED_FONTS: [],
}))

import { BLUEPRINT_REGISTRY } from "../registry"

// Resolve the blueprints directory relative to this test file so the check
// stays accurate regardless of where tests are run from (mirrors the pattern
// in backend/src/services/shot-sequence/__tests__/blueprint-drift.test.ts).
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BLUEPRINTS_DIR = join(__dirname, "..")

describe("BLUEPRINT_REGISTRY", () => {
  it("keys match the .tsx component basenames in the blueprints directory", () => {
    // Derive the expected set from the filesystem — a blueprint file added without
    // a registry entry will now fail here instead of silently throwing at render time.
    // The .tsx filter naturally excludes registry.ts / types.ts / color.ts (.ts only).
    const componentBasenames = readdirSync(BLUEPRINTS_DIR)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.replace(".tsx", ""))
      .sort()

    expect(Object.keys(BLUEPRINT_REGISTRY).sort()).toEqual(componentBasenames)
  })

  it("every value is a function (React component)", () => {
    for (const [id, comp] of Object.entries(BLUEPRINT_REGISTRY)) {
      expect(typeof comp, `${id} should be a function`).toBe("function")
    }
  })

  it("has no duplicate keys", () => {
    const keys = Object.keys(BLUEPRINT_REGISTRY)
    expect(keys.length).toBe(new Set(keys).size)
  })
})
