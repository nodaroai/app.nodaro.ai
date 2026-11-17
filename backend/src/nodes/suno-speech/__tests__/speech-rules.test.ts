/**
 * Suno Speech's run rule (`@nodaro/render-rules` suno-speech): the mode's own
 * fields only, trimmed; the limits as the provider counts them; and the
 * allow-listed provider input — Brief sends exactly `customMode: false` and
 * `prompt`, Script sends `customMode: true`, `script` and each option only
 * when set, the gender as `f` / `m` (the saved schema, decided 2026-11-17).
 */
import { describe, it, expect } from "vitest"
import { SUNO_SPEECH_LIMITS, sunoSpeechProblem, sunoSpeechProviderInput, sunoSpeechRun } from "@nodaro/render-rules"

describe("Suno Speech — the provider input", () => {
  it("Brief sends customMode false and the prompt, nothing else (the other mode's fields are dropped)", () => {
    const run = sunoSpeechRun({ mode: "brief", prompt: "  A short morning news intro about sunny weather  ", script: "ignored", tone: "warm", variety: 2, vocalGender: "female", backgroundMusic: true })
    expect(sunoSpeechProviderInput(run)).toStrictEqual({ customMode: false, prompt: "A short morning news intro about sunny weather" })
  })

  it("no mode is a Brief run", () => {
    expect(sunoSpeechProviderInput(sunoSpeechRun({ prompt: "x" }))).toStrictEqual({ customMode: false, prompt: "x" })
  })

  it("Script sends customMode true, the script and every option set, the gender as f / m", () => {
    const run = sunoSpeechRun({ mode: "script", script: "Welcome to today's briefing.\nThe city is awake.", tone: "Warm, calm narrator", variety: 1, vocalGender: "female", backgroundMusic: true, prompt: "ignored" })
    expect(sunoSpeechProviderInput(run)).toStrictEqual({
      customMode: true,
      script: "Welcome to today's briefing.\nThe city is awake.",
      tone: "Warm, calm narrator",
      variety: 1,
      vocalGender: "f",
      backgroundMusic: true,
    })
    expect(sunoSpeechProviderInput(sunoSpeechRun({ mode: "script", script: "Hi", vocalGender: "male", backgroundMusic: false }))).toStrictEqual({
      customMode: true, script: "Hi", vocalGender: "m", backgroundMusic: false,
    })
  })

  it("Script with no options sends only customMode and the script; variety 0 is sent, an empty tone is not", () => {
    expect(sunoSpeechProviderInput(sunoSpeechRun({ mode: "script", script: "Hi", tone: "   " }))).toStrictEqual({ customMode: true, script: "Hi" })
    expect(sunoSpeechProviderInput(sunoSpeechRun({ mode: "script", script: "Hi", variety: 0 }))).toStrictEqual({ customMode: true, script: "Hi", variety: 0 })
  })

  it("drops a variety the provider refuses (out of 0-4, not whole) and an unknown gender", () => {
    for (const variety of [-1, 5, 1.5, "2"]) {
      expect(sunoSpeechProviderInput(sunoSpeechRun({ mode: "script", script: "Hi", variety }))).toStrictEqual({ customMode: true, script: "Hi" })
    }
    expect(sunoSpeechProviderInput(sunoSpeechRun({ mode: "script", script: "Hi", vocalGender: "neutral" }))).toStrictEqual({ customMode: true, script: "Hi" })
  })
})

describe("Suno Speech — the limits (after trimming)", () => {
  it("refuses an empty brief or script", () => {
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "brief", prompt: "   " }))).toMatch(/needs a brief/)
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "script", script: "" }))).toMatch(/needs a script/)
  })

  it("takes a brief of exactly 3,000 characters and refuses 3,001", () => {
    expect(sunoSpeechProblem(sunoSpeechRun({ prompt: "a".repeat(SUNO_SPEECH_LIMITS.promptMax) }))).toBeUndefined()
    expect(sunoSpeechProblem(sunoSpeechRun({ prompt: "a".repeat(SUNO_SPEECH_LIMITS.promptMax + 1) }))).toMatch(/3001 characters/)
    // Counted after trimming, as the provider counts it.
    expect(sunoSpeechProblem(sunoSpeechRun({ prompt: `  ${"a".repeat(SUNO_SPEECH_LIMITS.promptMax)}  ` }))).toBeUndefined()
  })

  it("takes a script of exactly 5,000 characters and refuses 5,001; a tone over 1,000 is refused", () => {
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "script", script: "a".repeat(5000) }))).toBeUndefined()
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "script", script: "a".repeat(5001) }))).toMatch(/5001 characters/)
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "script", script: "Hi", tone: "t".repeat(1000) }))).toBeUndefined()
    expect(sunoSpeechProblem(sunoSpeechRun({ mode: "script", script: "Hi", tone: "t".repeat(1001) }))).toMatch(/tone is 1001/)
  })
})
