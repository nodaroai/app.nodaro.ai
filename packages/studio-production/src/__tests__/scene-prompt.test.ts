import { describe, it, expect } from "vitest"

import { foldScenePrompt, stripScenePrompt } from "../scene-prompt"

const SCENE = "A rain-soaked rooftop chase. Keep it grim."
const BODY = "0-2s — She turns.\n2-6s — She runs."

describe("foldScenePrompt", () => {
  it("leads the body with the scene paragraph", () => {
    expect(foldScenePrompt(SCENE, BODY)).toBe(`${SCENE}\n\n${BODY}`)
  })

  it("a scene prompt alone IS the prompt", () => {
    expect(foldScenePrompt(SCENE, "")).toBe(SCENE)
    expect(foldScenePrompt(SCENE, "   \n")).toBe(SCENE)
  })

  it("without one the body is handed back untouched (byte-identical)", () => {
    expect(foldScenePrompt(undefined, BODY)).toBe(BODY)
    expect(foldScenePrompt("  \n ", BODY)).toBe(BODY)
  })

  it("trims at the seam only — one blank line, never two", () => {
    expect(foldScenePrompt(`${SCENE}\n`, `\n${BODY}`)).toBe(`${SCENE}\n\n${BODY}`)
  })
})

describe("stripScenePrompt — the exact inverse", () => {
  it("undoes the fold", () => {
    expect(stripScenePrompt(foldScenePrompt(SCENE, BODY), SCENE)).toBe(BODY)
    expect(stripScenePrompt(foldScenePrompt(SCENE, ""), SCENE)).toBe("")
  })

  it("keeps a prompt that was never folded with this scene", () => {
    expect(stripScenePrompt(BODY, SCENE)).toBe(BODY)
    expect(stripScenePrompt(BODY, undefined)).toBe(BODY)
  })

  it("keeps prose that merely OPENS with the same words", () => {
    // No paragraph break ⇒ this is one sentence, not a folded scene prompt.
    const oneSentence = `${SCENE} She turns.`
    expect(stripScenePrompt(oneSentence, SCENE)).toBe(oneSentence)
  })

  it("tolerates the stored whitespace a textarea keeps", () => {
    expect(stripScenePrompt(`${SCENE}\n\n${BODY}`, `  ${SCENE}  `)).toBe(BODY)
  })
})
