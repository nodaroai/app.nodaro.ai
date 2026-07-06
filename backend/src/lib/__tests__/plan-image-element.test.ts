import { describe, it, expect, vi } from "vitest"

// Mirror plan-validate-logo.test.ts's config mock so R2_PUBLIC_URL is set for
// the image-element `src` refine (isOurCdnUrl reads config at parse time).
vi.mock("../config.js", async (orig) => {
  const actual = (await orig()) as { config: Record<string, unknown> }
  return { config: { ...actual.config, R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})

import { validatePlanByType, shotElementSchema } from "../plan-schemas.js"

/**
 * A minimal-but-valid resolved shot-sequence plan (the render_shot_sequence /
 * POST /v1/render-video/plan ingress shape). Reveals nest under `shots`
 * (`resolvedSceneSchema` requires `shots: resolvedShotSchema[]`; there is no
 * `reveals` directly on the scene — see plan-schemas.ts:663-676), and the
 * top-level plan requires fps/width/height/durationInFrames/backgroundColor.
 * Mirrors `planWithLogoImage` in plan-validate-logo.test.ts, swapping its
 * blueprint reveal for an image-element reveal.
 */
function planWithImageElement(src: string) {
  return {
    planType: "shot-sequence",
    fps: 30, width: 1920, height: 1080, durationInFrames: 120, backgroundColor: "#000",
    audio: { src: "https://pub-test.r2.dev/vo.mp3" },
    scenes: [
      {
        id: "s1",
        startFrame: 0,
        durationInFrames: 90,
        shots: [
          {
            id: "sh1",
            reveals: [
              {
                id: "r1",
                frame: 0,
                element: { id: "img1", type: "image", src, x: 0, y: 0, width: 100, height: 100 },
                enter: { motion: "fade", durationFrames: 6 },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe("image element schema (Phase: image media element)", () => {
  it("rejects a non-our-CDN image src at the render ingress (direct-render SSRF gate)", () => {
    expect(() => validatePlanByType("shot-sequence", planWithImageElement("http://169.254.169.254/x.png")))
      .toThrow(/Nodaro CDN/)
  })
  it("accepts an our-CDN image src", () => {
    expect(() => validatePlanByType("shot-sequence", planWithImageElement("https://pub-test.r2.dev/img/x.png"))).not.toThrow()
  })
  it("RETAINS fit/radius/opacity through parse (guard is blind to optional sub-fields)", () => {
    const parsed = shotElementSchema.parse({
      id: "i", type: "image", src: "https://pub-test.r2.dev/x.png",
      x: 1, y: 2, width: 100, height: 50, fit: "cover", radius: 8, opacity: 0.5,
    })
    expect(parsed).toMatchObject({ type: "image", fit: "cover", radius: 8, opacity: 0.5 })
  })
})
