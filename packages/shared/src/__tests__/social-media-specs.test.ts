import {
  PLATFORM_SPECS,
  CONTENT_TYPES_BY_PLATFORM,
  PLATFORM_LABELS,
} from "../social-media-specs.js"
import type { SocialMediaPlatform } from "../social-media-specs.js"

const ALL_PLATFORMS: SocialMediaPlatform[] = [
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "facebook",
  "linkedin",
  "telegram",
]

// ---------------------------------------------------------------------------
// PLATFORM_SPECS
// ---------------------------------------------------------------------------
describe("PLATFORM_SPECS", () => {
  const entries = Object.entries(PLATFORM_SPECS)

  it("contains exactly 14 entries", () => {
    expect(entries).toHaveLength(14)
  })

  it("all entries have valid dimensions (width > 0 and height > 0)", () => {
    for (const [key, spec] of entries) {
      expect(spec.width, `${key} width`).toBeGreaterThan(0)
      expect(spec.height, `${key} height`).toBeGreaterThan(0)
    }
  })

  it("all keys match 'platform:contentType' format", () => {
    for (const key of Object.keys(PLATFORM_SPECS)) {
      expect(key).toMatch(/^[a-z]+:[a-z0-9-]+$/)
    }
  })

  it("every spec's platform matches its key prefix", () => {
    for (const [key, spec] of entries) {
      const prefix = key.split(":")[0]
      expect(spec.platform).toBe(prefix)
    }
  })

  it("image specs (isVideo=false) have maxDurationSeconds=null", () => {
    for (const [key, spec] of entries) {
      if (!spec.isVideo) {
        expect(spec.maxDurationSeconds, `${key}`).toBeNull()
      }
    }
  })

  it("video specs (isVideo=true) have maxDurationSeconds > 0", () => {
    for (const [key, spec] of entries) {
      if (spec.isVideo) {
        expect(spec.maxDurationSeconds, `${key}`).toBeGreaterThan(0)
      }
    }
  })

  it("all textLimits are positive", () => {
    for (const [key, spec] of entries) {
      expect(spec.textLimit, `${key}`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// CONTENT_TYPES_BY_PLATFORM
// ---------------------------------------------------------------------------
describe("CONTENT_TYPES_BY_PLATFORM", () => {
  it("keys cover all 7 platforms", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(CONTENT_TYPES_BY_PLATFORM).toHaveProperty(platform)
    }
  })

  it("every entry's key (except telegram) exists in PLATFORM_SPECS", () => {
    for (const [platform, contentTypes] of Object.entries(CONTENT_TYPES_BY_PLATFORM)) {
      // Telegram has a "telegram:message" entry that is not in PLATFORM_SPECS
      if (platform === "telegram") continue
      for (const ct of contentTypes) {
        expect(
          PLATFORM_SPECS,
          `${ct.key} referenced by ${platform} not found in PLATFORM_SPECS`,
        ).toHaveProperty(ct.key)
      }
    }
  })

  it("each platform has at least one content type", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(CONTENT_TYPES_BY_PLATFORM[platform].length).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// PLATFORM_LABELS
// ---------------------------------------------------------------------------
describe("PLATFORM_LABELS", () => {
  it("covers all 7 platforms", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(PLATFORM_LABELS).toHaveProperty(platform)
      expect(PLATFORM_LABELS[platform]).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Spot checks
// ---------------------------------------------------------------------------
describe("spot checks", () => {
  it("instagram:story-reel is 1080x1920", () => {
    const spec = PLATFORM_SPECS["instagram:story-reel"]
    expect(spec).toBeDefined()
    expect(spec.width).toBe(1080)
    expect(spec.height).toBe(1920)
  })

  it("x:image-landscape has textLimit=280", () => {
    const spec = PLATFORM_SPECS["x:image-landscape"]
    expect(spec).toBeDefined()
    expect(spec.textLimit).toBe(280)
  })
})
