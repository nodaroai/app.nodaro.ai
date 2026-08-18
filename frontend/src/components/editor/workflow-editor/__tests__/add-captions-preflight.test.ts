import { describe, it, expect } from "vitest"
import { ALL_CAPTION_STYLES } from "@nodaro/shared"
import { addCaptionsPreflight } from "../add-captions-preflight"

/**
 * The guard test #759 asked for: Add Captions must be runnable from a bare
 * video for EVERY style. The old pre-flight read `autoTranscribe` opt-IN
 * against a flag nothing writes, so every style was unrunnable; the fix
 * mirrors the route's superRefine (opt-OUT, worker semantics).
 */
describe("addCaptionsPreflight (#759)", () => {
  it("every caption style is runnable from a bare video — no text, no captions, default flags", () => {
    for (const style of ALL_CAPTION_STYLES) {
      // style is not an input to the decision — that IS the assertion: the
      // default node (autoTranscribe undefined) may always proceed.
      expect(
        addCaptionsPreflight({ label: `test-${style}` }, {}),
        `style "${style}" should be runnable`,
      ).toBeNull()
    }
  })

  it("explicit autoTranscribe:false with no other source blocks with a message that names the remedy", () => {
    const msg = addCaptionsPreflight({ label: "Captions", autoTranscribe: false }, {})
    expect(msg).toContain("Captions")
    expect(msg).toContain("auto-transcribe")
  })

  it("text satisfies the source requirement even when auto-transcribe is off", () => {
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: false }, { prompt: "hello" })).toBeNull()
  })

  it("wired captions satisfy the source requirement even when auto-transcribe is off", () => {
    expect(
      addCaptionsPreflight({ label: "n", autoTranscribe: false }, { captions: [{ text: "hi", startMs: 0 }] }),
    ).toBeNull()
  })

  it("undefined flag means transcribe — matching the worker's opt-out default, not the old opt-in read", () => {
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: undefined }, {})).toBeNull()
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: true }, {})).toBeNull()
  })
})
