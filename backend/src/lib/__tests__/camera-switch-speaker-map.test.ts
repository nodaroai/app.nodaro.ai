import { describe, it, expect } from "vitest"
import { cameraSwitchSpeakerMapLanding, cameraSwitchSpeakerMapProblem, cameraSwitchSpeakerMapProblemText } from "@nodaro/render-rules"

// Camera Switch's `speakerMap` input rules, applied by both engines' resolvers and run checks.
const UPSTREAM = { type: "speaker-map", textSources: new Set<string>(["text-prompt"]) }
const RESULT = JSON.stringify({ version: 1, speakerMap: { s0: "camA" }, confidence: {}, notes: [] })

describe("cameraSwitchSpeakerMapLanding", () => {
  it("records the wire's JSON; an empty wire records \"\"; a value already recorded beats an empty wire", () => {
    expect(cameraSwitchSpeakerMapLanding(undefined, RESULT, UPSTREAM)).toBe(RESULT)
    expect(cameraSwitchSpeakerMapLanding(undefined, undefined, UPSTREAM)).toBe("")
    expect(cameraSwitchSpeakerMapLanding(undefined, "", UPSTREAM)).toBe("")
    expect(cameraSwitchSpeakerMapLanding(RESULT, undefined, UPSTREAM)).toBe(RESULT)
  })

  it("a parameter picker that is not a text source records nothing (as if unwired); a text source is a value", () => {
    expect(cameraSwitchSpeakerMapLanding(undefined, "melancholic", { type: "mood", textSources: UPSTREAM.textSources })).toBeUndefined()
    expect(cameraSwitchSpeakerMapLanding(RESULT, undefined, { type: "mood", textSources: UPSTREAM.textSources })).toBe(RESULT)
    expect(cameraSwitchSpeakerMapLanding(undefined, "{}", { type: "text-prompt", textSources: UPSTREAM.textSources })).toBe("{}")
  })
})

describe("cameraSwitchSpeakerMapProblem", () => {
  it("nothing wired, or a Speaker Map result (string or object): no problem", () => {
    expect(cameraSwitchSpeakerMapProblem(undefined)).toBeNull()
    expect(cameraSwitchSpeakerMapProblem(RESULT)).toBeNull()
    expect(cameraSwitchSpeakerMapProblem(JSON.parse(RESULT))).toBeNull()
  })

  it("wired but empty, or not a Speaker Map result: refused", () => {
    expect(cameraSwitchSpeakerMapProblem("")).toBe("empty-speaker-map")
    expect(cameraSwitchSpeakerMapProblem(null)).toBe("empty-speaker-map")
    expect(cameraSwitchSpeakerMapProblem(JSON.stringify({ words: [] }))).toBe("not-a-speaker-map")
    expect(cameraSwitchSpeakerMapProblem("not json")).toBe("not-a-speaker-map")
  })

  it("each refusal has its own words", () => {
    expect(cameraSwitchSpeakerMapProblemText("empty-speaker-map")).toMatch(/Speaker map input got nothing/)
    expect(cameraSwitchSpeakerMapProblemText("not-a-speaker-map")).toMatch(/not a Speaker Map result/)
  })
})
