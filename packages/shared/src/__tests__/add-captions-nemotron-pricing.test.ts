import { describe, expect, it } from "vitest"
import {
  ADD_CAPTIONS_KINETIC_CREDIT_ID,
  ADD_CAPTIONS_NEMOTRON_ID_PREFIX,
  addCaptionsNemotronBaseCredits,
  addCaptionsNemotronCreditId,
  addCaptionsNemotronMinutesId,
  addCaptionsNemotronQuoteCreditId,
  parseAddCaptionsNemotronCreditId,
} from "../credit-estimators/add-captions-nemotron.js"
import {
  NEMOTRON_TRANSCRIBE_PRICING,
  nemotronTranscribeBaseCredits,
  parseNemotronTranscribeCreditId,
} from "../credit-estimators/nemotron-transcribe.js"
import { captionsNeedTranscription, isStaticTextCaptionSource } from "../caption-styles.js"
import { transcribeNodeReturnsWords } from "../transcribe-preflight.js"

const RATE = NEMOTRON_TRANSCRIBE_PRICING.CREDITS_PER_RATE_DEFAULT
/** The kinetic row's launch base (STATIC_CREDIT_COSTS, migration 288). */
const KINETIC = 50

describe("Add Captions on Nemotron 3.5 Transcribe: one charge, render + per minute (decided 2026-11-13)", () => {
  it("keeps the add-captions prefix, so Add Captions' margin applies to the whole charge", () => {
    expect(ADD_CAPTIONS_NEMOTRON_ID_PREFIX.startsWith(`${ADD_CAPTIONS_KINETIC_CREDIT_ID}:`)).toBe(true)
    expect(addCaptionsNemotronCreditId(600)).toBe(`${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:10m`)
  })

  it.each([
    [45, 1],
    [60, 1],
    [61, 2],
    [600, 10],
    [3600, 60],
  ])("a %s s video holds %s started minutes", (sec, minutes) => {
    expect(parseAddCaptionsNemotronCreditId(addCaptionsNemotronCreditId(sec))).toEqual({ minutes })
  })

  it("an unknown length is quoted at 60 minutes, a known one at its own minutes", () => {
    expect(addCaptionsNemotronQuoteCreditId(undefined)).toBe(addCaptionsNemotronMinutesId(60))
    expect(addCaptionsNemotronQuoteCreditId(null)).toBe(addCaptionsNemotronMinutesId(60))
    expect(addCaptionsNemotronQuoteCreditId(0)).toBe(addCaptionsNemotronMinutesId(60))
    expect(addCaptionsNemotronQuoteCreditId(125)).toBe(addCaptionsNemotronMinutesId(3))
  })

  it("the minutes id is clamped to 1..60", () => {
    expect(addCaptionsNemotronMinutesId(0)).toBe(`${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:1m`)
    expect(addCaptionsNemotronMinutesId(75)).toBe(`${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:60m`)
  })

  it("parses only its own ids", () => {
    expect(parseAddCaptionsNemotronCreditId("add-captions:kinetic")).toBeUndefined()
    expect(parseAddCaptionsNemotronCreditId(`${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:0m`)).toBeUndefined()
    expect(parseAddCaptionsNemotronCreditId(`${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:61m`)).toBeUndefined()
    // and the Transcribe node's parser never reads one
    expect(parseNemotronTranscribeCreditId(addCaptionsNemotronCreditId(600))).toBeUndefined()
  })

  // The sum is the kinetic row plus exactly what the Transcribe node charges for the same minutes:
  // a caption run costs what a Nemotron Transcribe node wired into Add Captions costs.
  it.each([
    [1, 51],
    [2, 52],
    [10, 58],
    [30, 73],
    [60, 95],
  ])("%s minutes: base %s (the kinetic row + Nemotron's own minutes)", (minutes, base) => {
    expect(addCaptionsNemotronBaseCredits(KINETIC, RATE, minutes)).toBe(base)
    expect(addCaptionsNemotronBaseCredits(KINETIC, RATE, minutes)).toBe(KINETIC + nemotronTranscribeBaseCredits(RATE, minutes))
  })
})

describe("captionsNeedTranscription (shared with the editor and the run estimate)", () => {
  it("a render with no caption source of its own transcribes", () => {
    expect(captionsNeedTranscription({ style: "word-highlight" })).toBe(true)
    expect(captionsNeedTranscription({ style: "subtitle" })).toBe(true)
  })

  it("its own captions, a transcript, a subtitle's text or auto_transcribe: false do not", () => {
    expect(captionsNeedTranscription({ style: "word-highlight", captions: [{ text: "hi" }] })).toBe(false)
    expect(captionsNeedTranscription({ style: "word-highlight", transcript: { words: [] } })).toBe(false)
    expect(captionsNeedTranscription({ style: "subtitle", text: "Hello" })).toBe(false)
    expect(captionsNeedTranscription({ style: "word-highlight", auto_transcribe: false })).toBe(false)
  })

  it("a kinetic style's text is only its fallback: it still transcribes", () => {
    expect(isStaticTextCaptionSource({ style: "karaoke", text: "Hello" })).toBe(false)
    expect(captionsNeedTranscription({ style: "karaoke", text: "Hello" })).toBe(true)
  })

  it("segments transcribe only when one of them needs the shared source", () => {
    expect(captionsNeedTranscription({ segments: [{ text: "a" }, { captions: [{}] }] })).toBe(false)
    expect(captionsNeedTranscription({ segments: [{ text: "a" }, {}] })).toBe(true)
  })
})

describe("transcribeNodeReturnsWords (what a caption render downstream can take as its words)", () => {
  it("a word-level lane always; a lane that gives them on request only when asked or its json is wired", () => {
    expect(transcribeNodeReturnsWords({ provider: "elevenlabs-stt" }, false)).toBe(true)
    expect(transcribeNodeReturnsWords({}, false)).toBe(true) // the node default is ElevenLabs Scribe
    expect(transcribeNodeReturnsWords({ provider: "incredibly-fast-whisper" }, false)).toBe(false)
    expect(transcribeNodeReturnsWords({ provider: "incredibly-fast-whisper", wordTimestamps: true }, false)).toBe(true)
    expect(transcribeNodeReturnsWords({ provider: "nemotron-3-5-transcribe" }, true)).toBe(true)
  })

  it("never on whisper, never while translating, never on an unknown lane", () => {
    expect(transcribeNodeReturnsWords({ provider: "whisper", wordTimestamps: true }, true)).toBe(false)
    expect(transcribeNodeReturnsWords({ provider: "nemotron-3-5-transcribe", targetLanguage: "es" }, true)).toBe(false)
    expect(transcribeNodeReturnsWords({ provider: "some-new-lane" }, true)).toBe(false)
  })
})
