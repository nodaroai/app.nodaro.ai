import { describe, it, expect, vi } from "vitest"

// Mirror download.test.ts / brand-tokens-schema.test.ts's config mock so
// R2_PUBLIC_URL is set for the logo.image refine (isOurCdnUrl reads config
// at parse time).
vi.mock("../config.js", async (orig) => {
  const actual = (await orig()) as { config: Record<string, unknown> }
  return { config: { ...actual.config, R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})

import { validatePlanByType } from "../plan-schemas.js"

/**
 * A minimal-but-valid resolved shot-sequence plan (the render_shot_sequence /
 * POST /v1/render-video/plan ingress shape). Reveals nest under `shots`
 * (`resolvedSceneSchema` requires `shots: resolvedShotSchema[]`; there is no
 * `reveals` directly on the scene — see plan-schemas.ts:663-676), and
 * resolved reveals use `frame` (scene-relative baked frame), not the brief
 * schema's `revealAt`.
 */
function planWithLogoImage(imageUrl: string) {
  return {
    planType: "shot-sequence",
    fps: 30, width: 1920, height: 1080, durationInFrames: 120, backgroundColor: "#000",
    brandTokens: {
      palette: { bg: "#000", text: "#fff", accent: "#f00" },
      fonts: { heading: "Anton", body: "Inter" },
      logo: { name: "X", image: imageUrl },
    },
    audio: { src: "https://pub-test.r2.dev/a.mp3" },
    scenes: [
      {
        id: "s1",
        startFrame: 0,
        durationInFrames: 120,
        shots: [
          {
            id: "sh1",
            reveals: [
              { id: "r1", frame: 0, blueprint: { id: "logo-assemble-lockup", params: { brand: "X" } }, durationFrames: 120 },
            ],
          },
        ],
      },
    ],
  }
}

describe("validatePlanByType — logo.image is gated on every ingress path", () => {
  it("rejects an external logo.image in a pre-baked plan (direct-render SSRF gate)", () => {
    expect(() => validatePlanByType("shot-sequence", planWithLogoImage("http://169.254.169.254/x.png")))
      .toThrow(/logo\.image|Nodaro CDN/)
  })
  it("accepts an our-CDN logo.image", () => {
    expect(() => validatePlanByType("shot-sequence", planWithLogoImage("https://pub-test.r2.dev/logos/x.png")))
      .not.toThrow()
  })
})
