import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { BuildImagePromptConfig } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

/**
 * Characterization fixtures for `buildImagePrompt` — written BEFORE the
 * segments refactor (Task 16) so the refactor provably changes nothing.
 *
 * The matrix exercises every final-assembly branch the segment work touches:
 *   - directive prepend (connectedReferences path, `Use these references…`)
 *   - style append (both paths: `\nStyle: …`)
 *   - native-negative routing vs `Avoid:` append (both paths)
 *   - truncation (both paths, > 2000 chars → slice(0,1997) + "...")
 *   - empty body + style (legacy path, leading-`\n` Style suffix)
 *
 * After the Task-16 refactor these snapshots MUST NOT change — that is the
 * whole point of this file.
 */

/**
 * connectedReferences fixture ref. Minimum REAL `ConnectedReference` fields
 * (id / defaultName / source / url) plus a `description` so the emitted
 * directive carries a descriptor. (The plan draft used a `defaultLabel` field
 * + `as never` cast; `ConnectedReference` has no `defaultLabel` — the real
 * descriptor field is `description`.) The token in the prompt is
 * `{image:1:background}` (LABELED): a bare `{image:N}` yields NO identity
 * directive (`collectIdentities` skips label-less tokens), and `wired-image`
 * is excluded from the wired-location/object canonical fallback — so without a
 * label the `Use these references…` block would never appear. The `background`
 * label routes through the BACKGROUND_LABELS verb ("use as the
 * background/setting"). `nano-banana-pro` is in
 * MODELS_WITH_REFERENCE_IMAGE_SUPPORT, so the URL is also returned.
 */
const castleRef: ConnectedReference = {
  id: "r1",
  defaultName: "Castle",
  source: "wired-image",
  url: "https://example.com/castle.png",
  description: "a stone castle",
}

export const SEGMENT_FIXTURES: ReadonlyArray<{ name: string; config: BuildImagePromptConfig }> = [
  { name: "plain prompt", config: { prompt: "a knight on a cliff", provider: "nano-banana-pro" } },
  { name: "style appended", config: { prompt: "a knight", provider: "nano-banana-pro", style: "cinematic" } },
  { name: "negative appended as Avoid (no native field)", config: { prompt: "a knight", provider: "gpt-image", negativePrompt: "blurry, watermark" } },
  { name: "negative native (imagen4)", config: { prompt: "a knight", provider: "imagen4", negativePrompt: "blurry" } },
  { name: "truncation", config: { prompt: "x".repeat(2100), provider: "nano-banana-pro" } },
  { name: "empty prompt + style", config: { prompt: "", provider: "nano-banana-pro", style: "noir" } },
  {
    name: "connected references directives",
    config: {
      prompt: "a knight at {image:1:background}",
      provider: "nano-banana-pro",
      connectedReferences: [castleRef],
    },
  },
]

describe("buildImagePrompt characterization (pre/post segment refactor)", () => {
  it("produces stable output across the fixture matrix", () => {
    // Snapshot the CURRENT behavior. After the Task-16 refactor these
    // snapshots MUST NOT change — that is the whole point of this test.
    for (const f of SEGMENT_FIXTURES) {
      expect(buildImagePrompt(f.config)).toMatchSnapshot(f.name)
    }
  })

  it("native-negative fixtures route negatives where expected", () => {
    // Guards the two negative-routing branches the snapshots also capture, but
    // as explicit assertions so a future enum change to NATIVE_NEGATIVE_PROMPT_MODELS
    // surfaces here (not just as an opaque snapshot diff).
    const imagen4 = buildImagePrompt({ prompt: "a knight", provider: "imagen4", negativePrompt: "blurry" })
    expect(imagen4.nativeNegativePrompt).toBe("blurry")
    expect(imagen4.prompt).toBe("a knight")

    const gptImage = buildImagePrompt({ prompt: "a knight", provider: "gpt-image", negativePrompt: "blurry, watermark" })
    expect(gptImage.nativeNegativePrompt).toBeUndefined()
    expect(gptImage.prompt).toBe("a knight\nAvoid: blurry, watermark")
  })

  it("connected-references fixture exercises the directive block", () => {
    // The whole reason the fixture uses a LABELED {image:1:background} token:
    // it must actually produce the `Use these references…` directive branch.
    const out = buildImagePrompt(SEGMENT_FIXTURES[6].config)
    expect(out.prompt).toContain("Use these references for the output image:")
    expect(out.prompt).toContain("Image 1 (background")
    expect(out.referenceImageUrls).toEqual(["https://example.com/castle.png"])
  })
})
