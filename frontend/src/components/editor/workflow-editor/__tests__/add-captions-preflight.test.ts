import { describe, it, expect } from "vitest"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { addCaptionsPreflight, wordTimingsPreflight } from "../add-captions-preflight"

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
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: false }, { text: "hello" })).toBeNull()
  })

  // The route counts a wired transcript as a top-level source (hasTopLevelSource),
  // so a node fed one must run with auto-transcribe off — refusing it was the
  // guard answering a question the route does not ask.
  it("a wired transcript satisfies the source requirement even when auto-transcribe is off", () => {
    expect(
      addCaptionsPreflight({ label: "n", autoTranscribe: false }, { transcript: '{"words":[]}' }),
    ).toBeNull()
  })

  it("undefined flag means transcribe — matching the worker's opt-out default, not the old opt-in read", () => {
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: undefined }, {})).toBeNull()
    expect(addCaptionsPreflight({ label: "n", autoTranscribe: true }, {})).toBeNull()
  })
})

/**
 * The run-level half: a Transcribe node on a word-incapable lane feeding Add
 * Captions is refused BEFORE anything runs. That lane bills and returns
 * `words: []`, so the alternative is a paid transcription plus a failed
 * captions node — the canvas twin of the MCP word-timings bug.
 */
describe("wordTimingsPreflight", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
    ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): WorkflowEdge =>
    ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

  it("blocks a whisper transcript wired into add-captions, naming the node and the remedy", () => {
    const msg = wordTimingsPreflight(
      [node("t1", "transcribe", { label: "My Transcribe", provider: "whisper" }), node("c1", "add-captions")],
      [edge("t1", "json", "c1", "transcript")],
    )
    expect(msg).toContain("My Transcribe")
    expect(msg).toContain("whisper")
    expect(msg).toContain("elevenlabs-stt")
  })

  it("lets a word-capable lane through", () => {
    for (const provider of ["elevenlabs-stt", "incredibly-fast-whisper"]) {
      expect(
        wordTimingsPreflight(
          [node("t1", "transcribe", { provider }), node("c1", "add-captions")],
          [edge("t1", "json", "c1", "transcript")],
        ),
        provider,
      ).toBeNull()
    }
  })

  it("an absent provider resolves to the node default (elevenlabs-stt), not the route's whisper default", () => {
    expect(
      wordTimingsPreflight(
        [node("t1", "transcribe"), node("c1", "add-captions")],
        [edge("t1", "json", "c1", "transcript")],
      ),
    ).toBeNull()
  })

  it("does not block a Transcribe node run on its own — the captions consumer is outside the run", () => {
    expect(
      wordTimingsPreflight(
        [node("t1", "transcribe", { provider: "whisper" })],
        [edge("t1", "json", "c1", "transcript")],
      ),
    ).toBeNull()
  })

  it("does not block a whisper transcript that feeds nothing", () => {
    expect(wordTimingsPreflight([node("t1", "transcribe", { provider: "whisper" })], [])).toBeNull()
  })
})
