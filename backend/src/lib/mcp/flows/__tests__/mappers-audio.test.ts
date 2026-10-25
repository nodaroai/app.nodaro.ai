import { describe, expect, it } from "vitest"
import { buildPayload } from "../../../../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../../../../services/workflow-engine/types.js"
import { NODE_HANDLES } from "../../generated/node-handles.js"
import { flowNodeFor, type FlowNodeSpec } from "../node-mappers.js"

/**
 * The audio mappers' invariant: a node built from a verb call, run by the
 * server engine with the inputs its edges resolve to, asks for what the verb
 * asked for.
 */

const AUDIO = "https://media.nodaro.ai/audio/11111111-2222-3333-4444-555555555555.mp3"
const AUDIO_2 = "https://media.nodaro.ai/audio/66666666-7777-8888-9999-000000000000.mp3"
const VIDEO = "https://media.nodaro.ai/videos/11111111-2222-3333-4444-555555555555.mp4"
const TRANSPORT = { mcp_client: "Claude", userId: "u1" }

function node(route: string, body: Record<string, unknown>, tool: string): FlowNodeSpec {
  const spec = flowNodeFor(route, { ...TRANSPORT, ...body }, tool)
  if (!spec) throw new Error(`${tool} → ${route} mapped to no node`)
  return spec
}

function run(spec: FlowNodeSpec, inputs: Partial<ResolvedInputs> = {}) {
  const simple: SimpleNode = { id: "n1", type: spec.type, data: { ...spec.data } }
  return buildPayload(simple, "job1", inputs as ResolvedInputs, "usage1").payload as Record<string, unknown>
}

/** Every input lands on a handle the node really has. */
function expectRealHandles(spec: FlowNodeSpec) {
  for (const input of spec.inputs) expect(NODE_HANDLES[spec.type]?.inputs).toContain(input.targetHandle)
}

describe("audio mappers re-run the call they were made from", () => {
  it("generate_speech → Text to Speech", () => {
    const body = {
      text: "Welcome back to the show.", voice: "Rachel", provider: "elevenlabs-v3", voiceType: undefined,
      stability: 0.4, similarityBoost: 0.8, style: 0.2, speed: 1.1, languageCode: "en",
      previousText: "Last time,", nextText: "Let's begin.",
    }
    const spec = node("/v1/text-to-speech", body, "generate_speech")
    expect(spec).toMatchObject({ type: "text-to-speech", outputKey: "generatedAudioUrl", inputs: [] })
    const payload = run(spec)
    expect(payload).toMatchObject({
      text: body.text, voice: "Rachel", provider: "elevenlabs-v3", voiceType: "premade",
      stability: 0.4, similarityBoost: 0.8, style: 0.2, speed: 1.1, languageCode: "en",
      previousText: "Last time,", nextText: "Let's begin.",
    })
  })

  it("generate_dialogue → Text to Dialogue", () => {
    const body = {
      dialogue: [{ text: "Hi there.", voice: "Roger" }, { text: "[laughs] Hello!", voice: "Sarah" }],
      provider: "elevenlabs-dialogue", stability: 0.5, languageCode: "en", seed: 42, applyTextNormalization: "on",
    }
    const payload = run(node("/v1/text-to-dialogue", body, "generate_dialogue"))
    expect(payload).toMatchObject({ provider: "elevenlabs-dialogue", stability: 0.5, languageCode: "en", seed: 42, applyTextNormalization: "on" })
    expect((payload.dialogue as Array<{ text: string; voice: string }>).map(({ text, voice }) => ({ text, voice }))).toEqual(body.dialogue)
  })

  it("text_to_audio → Text to Audio, a call without a duration still without one", () => {
    const body = { prompt: "a door creaks open", provider: "elevenlabs-sfx", loop: true, promptInfluence: 0.7 }
    const payload = run(node("/v1/text-to-audio", body, "text_to_audio"))
    expect(payload).toMatchObject({ provider: "elevenlabs-sfx", loop: true, promptInfluence: 0.7 })
    expect(payload.duration).toBeUndefined()
    expect(String(payload.prompt)).toContain(body.prompt)
    expect(run(node("/v1/text-to-audio", { ...body, duration: 4 }, "text_to_audio")).duration).toBe(4)
  })

  it("suno_generate → Suno Create Music, custom mode as the route reads it", () => {
    const body = {
      prompt: "a summer anthem", model: "V5", style: "pop, upbeat", title: "Sunburn", negativeStyle: "metal",
      vocalGender: "female", instrumental: false, styleWeight: 0.6, weirdnessConstraint: 0.3, audioWeight: 0.5,
    }
    const payload = run(node("/v1/suno/generate", body, "suno_generate"))
    // The route runs a body without customMode as NOT custom, whatever it carries.
    expect(payload).toMatchObject({
      prompt: body.prompt, model: "V5", style: "pop, upbeat", title: "Sunburn", negativeStyle: "metal",
      vocalGender: "female", customMode: false, instrumental: false, styleWeight: 0.6, weirdnessConstraint: 0.3, audioWeight: 0.5,
    })
    const custom = { prompt: "a summer anthem", model: "V6", customMode: true, lyrics: "[Verse]\nSun on my face", style: "pop", title: "Sunburn", duration: 90 }
    expect(run(node("/v1/suno/generate", custom, "suno_generate"))).toMatchObject({ ...custom, instrumental: false })
  })

  it("generate_music (Suno lane) → Suno Create Music", () => {
    const body = { prompt: "calm piano", model: "V6", instrumental: true, customMode: true, title: "Untitled", style: "calm piano", duration: 22 }
    expect(run(node("/v1/suno/generate", body, "generate_music"))).toMatchObject(body)
  })

  it("generate_music (MiniMax lane) → Generate Music, its reference on ref-audio", () => {
    const body = { prompt: "a jazz trio", provider: "minimax", duration: 20, genre: "jazz", mood: "smoky", lyrics: "la la", referenceAudioUrl: AUDIO }
    const spec = node("/v1/generate-music", body, "generate_music")
    expect(spec.inputs).toEqual([{ url: AUDIO, kind: "audio", targetHandle: "ref-audio" }])
    expectRealHandles(spec)
    const payload = run(spec, { audioUrl: AUDIO })
    expect(payload).toMatchObject({ provider: "minimax", duration: 20, genre: "jazz", mood: "smoky", lyrics: "la la", referenceAudioUrl: AUDIO, instrumental: false })
    expect(String(payload.prompt)).toContain(body.prompt)
  })

  it("voice_changer → Voice Changer, audio or video", () => {
    const body = { audioUrl: AUDIO, voiceId: "George", stability: 0.3, similarityBoost: 0.9, style: 0.1, removeBackgroundNoise: true }
    const spec = node("/v1/voice-changer", body, "voice_changer")
    expect(spec.outputKey).toBe("generatedAudioUrl")
    expectRealHandles(spec)
    expect(run(spec, { audioUrl: AUDIO })).toMatchObject({ ...body, videoUrl: undefined })

    const video = node("/v1/voice-changer", { videoUrl: VIDEO, voiceId: "George" }, "voice_changer")
    expect(video.outputKey).toBe("generatedVideoUrl")
    expect(video.inputs).toEqual([{ url: VIDEO, kind: "video", targetHandle: "video" }])
    expect(run(video, { videoUrl: VIDEO })).toMatchObject({ videoUrl: VIDEO, voiceId: "George" })
  })

  it("voice_design → Voice Design", () => {
    const body = {
      text: "A calm and measured voice reading the evening news, with a warm and steady delivery that reassures the listener.",
      voiceDescription: "a warm baritone newsreader", model: "eleven_ttv_v3", loudness: 0.2, guidanceScale: 5, seed: 7, quality: 0.5, shouldEnhance: true,
    }
    const payload = run(node("/v1/voice-design", body, "voice_design"))
    expect(payload).toMatchObject({ text: body.text, model: "eleven_ttv_v3", loudness: 0.2, guidanceScale: 5, seed: 7, quality: 0.5, shouldEnhance: true })
    expect(String(payload.voiceDescription)).toContain(body.voiceDescription)
  })

  it("audio_isolation → Voice Extractor", () => {
    const spec = node("/v1/audio-isolation", { audioUrl: AUDIO }, "audio_isolation")
    expect(spec.inputs).toEqual([{ url: AUDIO, kind: "audio", targetHandle: "audio" }])
    expectRealHandles(spec)
    expect(run(spec, { audioUrl: AUDIO }).audioUrl).toBe(AUDIO)
  })

  it("trim_audio → Trim Audio, from an audio file or a video", () => {
    const body = { videoUrl: AUDIO, audioFormat: "wav", startTime: 1.5, endTime: 9 }
    const spec = node("/v1/trim-audio", body, "trim_audio")
    expect(spec.inputs).toEqual([{ url: AUDIO, kind: "audio", targetHandle: "in" }])
    expectRealHandles(spec)
    expect(run(spec, { audioUrl: AUDIO })).toMatchObject(body)

    const fromVideo = node("/v1/trim-audio", { videoUrl: VIDEO, audioFormat: "mp3" }, "trim_audio")
    expect(fromVideo.inputs).toEqual([{ url: VIDEO, kind: "video", targetHandle: "in" }])
    expect(run(fromVideo, { videoUrl: VIDEO })).toMatchObject({ videoUrl: VIDEO, audioFormat: "mp3" })
  })

  it("mix_audio → Mix Audio, a plain mix only", () => {
    const spec = node("/v1/mix-audio", { audioUrls: [AUDIO, AUDIO_2] }, "mix_audio")
    expect(spec.inputs.map((i) => [i.url, i.targetHandle])).toEqual([[AUDIO, "in"], [AUDIO_2, "in"]])
    expectRealHandles(spec)
    const payload = run(spec, {
      audioUrls: [AUDIO, AUDIO_2],
      audioUrlsWithSourceIds: [{ nodeId: "a", url: AUDIO }, { nodeId: "b", url: AUDIO_2 }],
    })
    expect(payload.audioUrls).toEqual([AUDIO, AUDIO_2])
    expect(payload).not.toHaveProperty("duck")
    expect(payload).not.toHaveProperty("endAt")
    // Volumes and the duck track are keyed by node id on the node: a body naming them maps to no node.
    expect(flowNodeFor("/v1/mix-audio", { audioUrls: [AUDIO, AUDIO_2], trackVolumes: [100, 30] }, "mix_audio")).toBeNull()
    expect(flowNodeFor("/v1/mix-audio", { audioUrls: [AUDIO, AUDIO_2], duck: { under: 0 } }, "mix_audio")).toBeNull()
    expect(flowNodeFor("/v1/mix-audio", { audioUrls: [AUDIO, AUDIO] }, "mix_audio")).toBeNull()
  })

  it("pitch_tempo → Pitch & Tempo, with the route's defaults", () => {
    const body = { audioUrl: AUDIO, semitones: -3, tempo: 1.25, preserveFormants: false }
    const spec = node("/v1/pitch-tempo", body, "pitch_tempo")
    expectRealHandles(spec)
    expect(run(spec, { audioUrl: AUDIO })).toMatchObject(body)

    const video = node("/v1/pitch-tempo", { videoUrl: VIDEO }, "pitch_tempo")
    expect(video.outputKey).toBe("generatedVideoUrl")
    expect(run(video, { videoUrl: VIDEO })).toMatchObject({ videoUrl: VIDEO, semitones: 0, tempo: 1, preserveFormants: true })
  })
})
