import { describe, it, expect, vi } from "vitest"
vi.mock("../config.js", () => ({ config: { ELEVENLABS_API_KEY: "el-key", REPLICATE_API_TOKEN: "rep-key", KIE_API_KEY: "kie-key" } }))
import { transcribeLaneKey, transcribeLaneKeyName, transcribeTaskKind } from "../transcribe-lane-key.js"

describe("transcribeLaneKey — the key a transcribe job runs on locally", () => {
  it("ElevenLabs Scribe uses the ElevenLabs key; everything else (Whisper) the Replicate token", () => {
    expect(transcribeLaneKey("elevenlabs-stt")).toBe("el-key")
    expect(transcribeLaneKey("whisper")).toBe("rep-key")
    expect(transcribeLaneKey(undefined)).toBe("rep-key")
    expect(transcribeLaneKeyName("elevenlabs-stt")).toBe("ELEVENLABS_API_KEY")
    expect(transcribeLaneKeyName(undefined)).toBe("REPLICATE_API_TOKEN")
  })

  it("Nemotron 3.5 Transcribe runs on the KIE key", () => {
    expect(transcribeLaneKey("nemotron-3-5-transcribe")).toBe("kie-key")
    expect(transcribeLaneKeyName("nemotron-3-5-transcribe")).toBe("KIE_API_KEY")
  })
})

describe("transcribeTaskKind — the reconcile kind a transcribe job's task id is saved under", () => {
  it("a KIE record-info task for Nemotron, a Replicate prediction for the whisper lanes", () => {
    expect(transcribeTaskKind("nemotron-3-5-transcribe")).toBe("kie-standard")
    expect(transcribeTaskKind("whisper")).toBe("replicate-prediction")
    expect(transcribeTaskKind("incredibly-fast-whisper")).toBe("replicate-prediction")
    expect(transcribeTaskKind(undefined)).toBe("replicate-prediction")
  })
})
