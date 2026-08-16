import { describe, it, expect } from "vitest"
import { computeAiAvatarReadiness, aiAvatarEngineLabel } from "../readiness"
import type { AiAvatarData } from "@/types/nodes"

const NONE = { script: false, audio: false, image: false } as const

function data(overrides: Partial<AiAvatarData> = {}): AiAvatarData {
  return {
    label: "AI Avatar",
    provider: "heygen",
    avatarSource: "avatar",
    engine: "avatar-iv",
    avatarId: "",
    speechMode: "text",
    resolution: "720p",
    aspectRatio: "16:9",
    fieldMappings: {},
    ...overrides,
  }
}

// The readiness rules mirror execute-node.ts's ai-avatar validation exactly:
//   text mode  → script (wired or typed) AND a voice
//   audio mode → audio (wired or data.audioUrl)
//   avatar src → avatarId          image src → image (wired or data.imageUrl)
describe("computeAiAvatarReadiness", () => {
  it("a bare catalog-source node needs an avatar, a voice and a script", () => {
    const r = computeAiAvatarReadiness(data(), NONE)
    expect(r.ready).toBe(false)
    expect(r.missing).toEqual(["avatar", "voice", "script"])
    expect(r.text).toBe("Needs an avatar, a voice and a script before it can run")
  })

  it("names the single missing piece", () => {
    const r = computeAiAvatarReadiness(
      data({ avatarId: "a1", voiceId: "v1" }),
      NONE,
    )
    expect(r.missing).toEqual(["script"])
    expect(r.text).toBe("Needs a script before it can run")
  })

  it("is ready in text mode with avatar + voice + typed script", () => {
    const r = computeAiAvatarReadiness(
      data({ avatarId: "a1", voiceId: "v1", script: "Hello there" }),
      NONE,
    )
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.text).toBe("Ready to run · avatar, voice and script are set")
  })

  it("a wired Script input satisfies the script requirement (whitespace-only typed script does not)", () => {
    expect(
      computeAiAvatarReadiness(data({ avatarId: "a1", voiceId: "v1", script: "   " }), NONE).missing,
    ).toEqual(["script"])
    expect(
      computeAiAvatarReadiness(data({ avatarId: "a1", voiceId: "v1", script: "   " }), { ...NONE, script: true }).ready,
    ).toBe(true)
  })

  it("audio mode ignores voice/script and needs wired audio (or data.audioUrl)", () => {
    const base = data({ avatarId: "a1", speechMode: "audio" })
    expect(computeAiAvatarReadiness(base, NONE)).toMatchObject({
      ready: false,
      missing: ["audio"],
      text: "Needs wired audio before it can run",
    })
    expect(computeAiAvatarReadiness(base, { ...NONE, audio: true })).toMatchObject({
      ready: true,
      text: "Ready to run · avatar and audio are set",
    })
    expect(computeAiAvatarReadiness(data({ ...base, audioUrl: "https://x/a.mp3" }), NONE).ready).toBe(true)
  })

  it("image source needs a source image (wired or uploaded) instead of an avatar", () => {
    const base = data({ avatarSource: "image", voiceId: "v1", script: "hi" })
    expect(computeAiAvatarReadiness(base, NONE)).toMatchObject({
      ready: false,
      missing: ["image"],
      text: "Needs a source image before it can run",
    })
    expect(computeAiAvatarReadiness(base, { ...NONE, image: true })).toMatchObject({
      ready: true,
      text: "Ready to run · image, voice and script are set",
    })
    expect(computeAiAvatarReadiness(data({ ...base, imageUrl: "https://x/p.png" }), NONE).ready).toBe(true)
    // an avatarId lying around from a previous mode does not count as the image
    expect(computeAiAvatarReadiness(data({ ...base, avatarId: "a1" }), NONE).ready).toBe(false)
  })

  it("image source + audio mode: needs image and audio", () => {
    const r = computeAiAvatarReadiness(data({ avatarSource: "image", speechMode: "audio" }), NONE)
    expect(r.missing).toEqual(["image", "audio"])
    expect(r.text).toBe("Needs a source image and wired audio before it can run")
    expect(
      computeAiAvatarReadiness(data({ avatarSource: "image", speechMode: "audio" }), { script: false, audio: true, image: true }).text,
    ).toBe("Ready to run · image and audio are set")
  })

  it("defaults: missing avatarSource/speechMode read as avatar + text", () => {
    const d = data()
    delete (d as Record<string, unknown>).avatarSource
    delete (d as Record<string, unknown>).speechMode
    expect(computeAiAvatarReadiness(d, NONE).missing).toEqual(["avatar", "voice", "script"])
  })
})

describe("aiAvatarEngineLabel", () => {
  it("catalog source shows the HeyGen engine + resolution", () => {
    expect(aiAvatarEngineLabel(data({ engine: "avatar-iv", resolution: "720p" }))).toBe("HeyGen Avatar IV · 720p")
    expect(aiAvatarEngineLabel(data({ engine: "avatar-v", resolution: "4k" }))).toBe("HeyGen Avatar V · 4K")
  })

  it("image source has its own engine (no IV/V lever)", () => {
    expect(aiAvatarEngineLabel(data({ avatarSource: "image", engine: "avatar-v", resolution: "1080p" }))).toBe("Image animation · 1080p")
  })

  it("falls back to avatar-iv / 720p when the fields are absent", () => {
    const d = data()
    delete (d as Record<string, unknown>).engine
    delete (d as Record<string, unknown>).resolution
    expect(aiAvatarEngineLabel(d)).toBe("HeyGen Avatar IV · 720p")
  })
})
