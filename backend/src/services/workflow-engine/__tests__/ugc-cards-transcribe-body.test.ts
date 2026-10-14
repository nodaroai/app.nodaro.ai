import { DEFAULT_TRANSCRIBE_NODE_PROVIDER } from "@nodaro/shared/models"
import { ugcCardsJobs } from "@nodaro/shared/ugc"
import { describe, expect, it } from "vitest"
import { transcribeBody } from "../../../routes/transcribe.js"

const jobs = (transcribeArgs: Record<string, unknown>) => {
  const j = ugcCardsJobs({ planOutWire: JSON.stringify({ v: 1, plan: {}, transcribeArgs }), videoUrl: "https://cdn.example/v.mp4", transcript: "a" })
  if ("error" in j) throw new Error(j.error)
  return j.transcribe.body
}
describe("UGC Cards' transcription body survives the route's schema", () => {
  it("the Hebrew wire keeps language: he", () => {
    expect(transcribeBody.parse(jobs({ language: "he" }))).toMatchObject({ language: "he", provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
  })
  it("the English wire is exactly audioUrl, provider and wordTimestamps", () => {
    expect(jobs({})).toEqual({ audioUrl: "https://cdn.example/v.mp4", provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
    expect(transcribeBody.parse(jobs({}))).toMatchObject({ audioUrl: "https://cdn.example/v.mp4", provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
  })
  it("a wire carrying provider or wordTimestamps: false changes neither", () => {
    expect(jobs({ provider: "other", wordTimestamps: false })).toMatchObject({ provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
  })
})
