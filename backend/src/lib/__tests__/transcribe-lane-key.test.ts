import { describe, it, expect, vi } from "vitest"
vi.mock("../config.js", () => ({ config: { ELEVENLABS_API_KEY: "el-key", REPLICATE_API_TOKEN: "rep-key" } }))
import { transcribeLaneKey, transcribeLaneKeyName } from "../transcribe-lane-key.js"

describe("transcribeLaneKey — the key a transcribe job runs on locally", () => {
  it("ElevenLabs Scribe uses the ElevenLabs key; everything else (Whisper) the Replicate token", () => {
    expect(transcribeLaneKey("elevenlabs-stt")).toBe("el-key")
    expect(transcribeLaneKey("whisper")).toBe("rep-key")
    expect(transcribeLaneKey(undefined)).toBe("rep-key")
    expect(transcribeLaneKeyName("elevenlabs-stt")).toBe("ELEVENLABS_API_KEY")
    expect(transcribeLaneKeyName(undefined)).toBe("REPLICATE_API_TOKEN")
  })
})
