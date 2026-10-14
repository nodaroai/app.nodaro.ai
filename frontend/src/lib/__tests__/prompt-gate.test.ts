// @vitest-environment node
import { describe, it, expect } from "vitest"
import { computeNodePrompt } from "@nodaro/prompts/prompt-fields"
import { NODE_PROMPT_FIELDS } from "../prompt-fields"

/**
 * A gated prompt field is only READ while its discriminator selects it. Typing
 * into such a field therefore has to flip the discriminator too, or the value
 * is stored and silently ignored — which is exactly what happened to
 * text-to-speech: the modal wrote `directText`, `textSource` stayed at its
 * `"connected"` default, and the run failed with "no text found" while the
 * text sat there in the node (founder hit it live, 2026-08-14).
 *
 * These tests pin the contract from both ends: the declaration exists, and the
 * resolver actually honours the value the writers produce.
 */
describe("gated prompt fields", () => {
  it("text-to-speech declares its gate", () => {
    expect(NODE_PROMPT_FIELDS["text-to-speech"].promptGate).toEqual({
      field: "textSource",
      value: "direct",
    })
  })

  it("every declared gate names a field other than the prompt itself", () => {
    for (const [type, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      if (!spec.promptGate) continue
      expect(spec.promptGate.field, `${type} gate must not point at the prompt field`).not.toBe(
        spec.prompt,
      )
      expect(spec.promptGate.value.length, `${type} gate needs a value`).toBeGreaterThan(0)
    }
  })

  it("uses typed text even when the gate says 'connected' and nothing is wired", () => {
    // The exact state the founder hit: text saved by a writer that predates
    // the gate flip, textSource still at its "connected" default, no upstream
    // node. Failing here with "no text found" while the text is visible in the
    // node is the bug.
    expect(
      computeNodePrompt(
        "text-to-speech",
        { directText: "בוקר טוב", textSource: "connected" },
        { refMap: new Map() },
      ),
    ).toBe("בוקר טוב")
  })

  it("still prefers the wired text when the gate says 'connected'", () => {
    // The gate is a preference, and it must keep meaning something: with an
    // upstream node connected, "connected" wins over stale typed text.
    expect(
      computeNodePrompt(
        "text-to-speech",
        { directText: "stale typed text", textSource: "connected" },
        { wired: "from the connected node", refMap: new Map() },
      ),
    ).toBe("from the connected node")
  })

  it("typed text wins over wired once the gate is explicitly 'direct'", () => {
    expect(
      computeNodePrompt(
        "text-to-speech",
        { directText: "chosen by the user", textSource: "direct" },
        { wired: "from the connected node", refMap: new Map() },
      ),
    ).toBe("chosen by the user")
  })

  it("the resolver returns the text once a writer flips the gate", () => {
    const spec = NODE_PROMPT_FIELDS["text-to-speech"]
    // Exactly what writeField() now produces in the modal and inline editor.
    const patch: Record<string, unknown> = { [spec.prompt]: "בוקר טוב" }
    if (spec.promptGate) patch[spec.promptGate.field] = spec.promptGate.value

    expect(computeNodePrompt("text-to-speech", patch, { refMap: new Map() })).toBe("בוקר טוב")
  })
})
