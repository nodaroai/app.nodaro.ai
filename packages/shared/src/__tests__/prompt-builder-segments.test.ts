import { describe, it, expect } from "vitest"
import { buildImagePrompt, buildImagePromptSegments } from "../prompt-builder.js"
import type { BuildImagePromptConfig, PromptSegment } from "../prompt-builder.js"
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

/**
 * A `wired-object` ref with a URL + description but NO `{image:N}` token in the
 * body. It earns a canonical-fallback directive (wired-object/wired-location are
 * the two sources `buildNonCharacterDirectives` auto-emits), so the directive
 * block PREPENDS via the "Use these references…/Compose them naturally into a
 * single image: <body>" wrap — but because the body carries no token,
 * `expandImageRefTokensForRefs` is a no-op and `applyReferenceOrder` is skipped
 * (single URL). The modeled `directivesPrefix` + body therefore reconstruct the
 * final string exactly — this is the clean prepend case the segment capture is
 * designed for, distinct from SEGMENT_FIXTURES' castle fixture (whose
 * `{image:1:background}` token gets rewritten AFTER the marks are captured, so
 * its segments deliberately collapse to the single-segment fallback).
 */
const swordRef: ConnectedReference = {
  id: "o1",
  defaultName: "Sword",
  source: "wired-object",
  url: "https://example.com/sword.png",
  description: "an ornate longsword",
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

describe("buildImagePromptSegments", () => {
  it("join(segments) equals the legacy prompt for every fixture", () => {
    // The absolute invariant: regardless of which assembly branch fires (and
    // whether the modeled marks reconstruct or the join-fallback collapses to a
    // single segment), the decomposition must rejoin to the byte-identical
    // legacy prompt. Also asserts the other returned fields are untouched.
    for (const f of SEGMENT_FIXTURES) {
      const legacy = buildImagePrompt(f.config)
      const seg = buildImagePromptSegments(f.config)
      expect(seg.prompt).toBe(legacy.prompt)
      expect(seg.nativeNegativePrompt).toBe(legacy.nativeNegativePrompt)
      expect(seg.referenceImageUrls).toEqual(legacy.referenceImageUrls)
      expect(seg.segments.map((s) => s.text).join("")).toBe(legacy.prompt)
    }
  })

  it("tags style and Avoid suffixes", () => {
    const seg = buildImagePromptSegments({ prompt: "a knight", provider: "gpt-image", style: "noir", negativePrompt: "blurry" })
    expect(seg.segments.some((s) => s.origin === "style" && s.text.startsWith("\nStyle:"))).toBe(true)
    expect(seg.segments.some((s) => s.origin === "negative" && s.text.startsWith("\nAvoid:"))).toBe(true)
    // And of course the join still reconstructs the assembled prompt.
    expect(seg.segments.map((s) => s.text).join("")).toBe(seg.prompt)
  })

  it("preserves caller body segments when the body is untouched", () => {
    // Legacy path (no connectedReferences) with no style/negative/truncation →
    // the body string equals config.prompt verbatim, so caller-provided segments
    // that join to it survive with their origins intact.
    const body: PromptSegment[] = [
      { text: "a knight, ", origin: "user" },
      { text: "golden hour light", origin: "picker" },
    ]
    const seg = buildImagePromptSegments({ prompt: "a knight, golden hour light", provider: "nano-banana-pro" }, body)
    expect(seg.segments.filter((s) => s.origin === "picker")).toHaveLength(1)
    expect(seg.segments).toEqual(body)
    expect(seg.segments.map((s) => s.text).join("")).toBe(seg.prompt)
  })

  it("collapses body segments when they don't reconstruct the body", () => {
    const seg = buildImagePromptSegments(
      { prompt: "a knight", provider: "nano-banana-pro" },
      [{ text: "different text", origin: "picker" }],
    )
    expect(seg.segments).toEqual([{ text: "a knight", origin: "user" }])
  })

  it("captures the directive prefix as a mention segment on the real prepend branch", () => {
    // A token-free body + a wired-object ref → the directive block prepends via
    // the "Use these references…/Compose them naturally into a single image: …"
    // wrap, and (no token expansion, single URL → no reorder) the modeled marks
    // reconstruct exactly. This proves the prepend capture works on the actual
    // directive branch (not just the collapse fallback).
    const config: BuildImagePromptConfig = {
      prompt: "a knight in a courtyard",
      provider: "nano-banana-pro",
      connectedReferences: [swordRef],
    }
    const legacy = buildImagePrompt(config)
    const seg = buildImagePromptSegments(config)
    // Sanity: the fixture really does hit the prepend branch.
    expect(legacy.prompt).toContain("Use these references for the output image:")
    expect(legacy.prompt).toContain("Compose them naturally into a single image:")
    // Join invariant holds AND a mention-origin segment carries the directives.
    expect(seg.segments.map((s) => s.text).join("")).toBe(legacy.prompt)
    const mention = seg.segments.find((s) => s.origin === "mention")
    expect(mention).toBeDefined()
    expect(mention?.text.startsWith("Use these references for the output image:")).toBe(true)
    // The body survived as its own user segment (prefix correctly stripped).
    expect(seg.segments.some((s) => s.origin === "user" && s.text === "a knight in a courtyard")).toBe(true)
  })
})
