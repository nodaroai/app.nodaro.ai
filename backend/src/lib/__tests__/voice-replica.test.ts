/**
 * A one-off voice clone's recordings (decided 2026-11-13): one reader for the routes, the workflow run's gate
 * and the worker — https only, allowed on this deployment, the safe download within 10 MB, a WAV by its
 * bytes, the reference 10–30 s, the consent recording at most 30 s — and the job row never keeps their links.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const safeFetchBytes = vi.fn()
vi.mock("../safe-fetch-bytes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../safe-fetch-bytes.js")>()),
  safeFetchBytes: (...a: unknown[]) => safeFetchBytes(...a),
}))
const linkRefused = vi.hoisted(() => ({ value: false }))
vi.mock("../link-imports.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../link-imports.js")>()
  return { ...real, assertLinkImportAllowed: () => { if (linkRefused.value) throw new real.LinkImportsDisabledError() } }
})
const uploadJobScratchBuffer = vi.fn(async (_b: Buffer, name: string) => `https://r2.example/tmp/provider-input/job/${name}.wav`)
vi.mock("../job-scratch.js", () => ({ uploadJobScratchBuffer: (...a: Parameters<typeof uploadJobScratchBuffer>) => uploadJobScratchBuffer(...a) }))

const { readReplicaRecording, readReplica, stageReplica, replicaProbe, replicaRefusalMessage, withoutReplicaLinks, payloadReplicas, ReplicaRecordingError, isWavBytes } =
  await import("../voice-replica.js")
const { PublicDownloadTooLargeError } = await import("../safe-fetch-bytes.js")

const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(32)])
const seconds = vi.spyOn(replicaProbe, "durationSec")
const REPLICA = { sourceAudioUrl: "https://media.example/s.wav", consentAudioUrl: "https://media.example/c.wav" }

beforeEach(() => {
  safeFetchBytes.mockReset().mockResolvedValue(WAV)
  seconds.mockReset().mockResolvedValue(15)
  linkRefused.value = false
  uploadJobScratchBuffer.mockClear()
})

async function refusal(p: Promise<unknown>): Promise<InstanceType<typeof ReplicaRecordingError>> {
  const err = await p.then(() => undefined, (e: unknown) => e)
  expect(err).toBeInstanceOf(ReplicaRecordingError)
  return err as InstanceType<typeof ReplicaRecordingError>
}

describe("readReplicaRecording", () => {
  it("takes a WAV reference of 10–30 s fetched safely from an https link within 10 MB", async () => {
    const got = await readReplicaRecording("https://media.example/s.wav", "source")
    expect(got.seconds).toBe(15)
    expect(safeFetchBytes).toHaveBeenCalledWith("https://media.example/s.wav", 10 * 1024 * 1024, undefined)
  })

  it("refuses a link that is not https before any fetch", async () => {
    for (const url of ["http://media.example/s.wav", "file:///etc/passwd", "not a link"]) {
      expect((await refusal(readReplicaRecording(url, "source"))).code).toBe("replica_unreachable")
    }
    expect(safeFetchBytes).not.toHaveBeenCalled()
  })

  it("refuses an outside link where the deployment turned link imports off", async () => {
    linkRefused.value = true
    expect((await refusal(readReplicaRecording("https://elsewhere.example/s.wav", "consent"))).code).toBe("replica_link_refused")
    expect(safeFetchBytes).not.toHaveBeenCalled()
  })

  it("refuses a recording over 10 MB, one that cannot be downloaded, and one that is not a WAV", async () => {
    safeFetchBytes.mockRejectedValueOnce(new PublicDownloadTooLargeError("too large"))
    expect((await refusal(readReplicaRecording(REPLICA.sourceAudioUrl, "source"))).message).toBe("The reference recording must be at most 10 MB")
    safeFetchBytes.mockRejectedValueOnce(new Error("blocked: private address"))
    expect((await refusal(readReplicaRecording(REPLICA.sourceAudioUrl, "source"))).code).toBe("replica_unreachable")
    safeFetchBytes.mockResolvedValueOnce(Buffer.from("ID3\u0003mp3 bytes here"))
    expect((await refusal(readReplicaRecording(REPLICA.consentAudioUrl, "consent"))).code).toBe("replica_not_wav")
  })

  it("the reference is 10–30 s; the consent recording at most 30 s, with no minimum (one sentence)", async () => {
    seconds.mockResolvedValueOnce(8)
    expect((await refusal(readReplicaRecording(REPLICA.sourceAudioUrl, "source"))).message).toMatch(/must be 10–30 seconds of natural speech; this one is 8\.0 seconds/)
    seconds.mockResolvedValueOnce(42)
    expect((await refusal(readReplicaRecording(REPLICA.sourceAudioUrl, "source"))).code).toBe("replica_length")
    seconds.mockResolvedValueOnce(5)
    expect((await readReplicaRecording(REPLICA.consentAudioUrl, "consent")).seconds).toBe(5)
    seconds.mockResolvedValueOnce(45)
    expect((await refusal(readReplicaRecording(REPLICA.consentAudioUrl, "consent"))).code).toBe("replica_length")
  })

  it("isWavBytes reads the RIFF/WAVE header", () => {
    expect(isWavBytes(WAV)).toBe(true)
    expect(isWavBytes(Buffer.from("RIFF0000AVI "))).toBe(false)
  })
})

describe("stageReplica — the bytes judged, kept only in the job's scratch folder", () => {
  it("judges both, stores both in the scratch folder, and answers those links", async () => {
    const staged = await stageReplica(REPLICA)
    expect(staged).toEqual({
      sourceAudioUrl: "https://r2.example/tmp/provider-input/job/replica-source.wav",
      consentAudioUrl: "https://r2.example/tmp/provider-input/job/replica-consent.wav",
    })
    expect(uploadJobScratchBuffer).toHaveBeenCalledWith(WAV, "replica-source", "wav", "audio/wav")
    expect(uploadJobScratchBuffer).toHaveBeenCalledWith(WAV, "replica-consent", "wav", "audio/wav")
  })

  it("stores nothing when either recording is refused", async () => {
    seconds.mockResolvedValueOnce(15).mockResolvedValueOnce(99)
    await refusal(stageReplica(REPLICA))
    expect(uploadJobScratchBuffer).not.toHaveBeenCalled()
    await expect(readReplica(REPLICA)).resolves.toBeDefined()
  })
})

describe("what the job row keeps, and what a payload carries", () => {
  it("withoutReplicaLinks takes the links out and marks a clone, on the request and on each cloned speaker", () => {
    expect(withoutReplicaLinks({ text: "hi", replica: REPLICA })).toEqual({ text: "hi", oneOffClone: true })
    expect(withoutReplicaLinks({ dialogue: [], speakers: [{ voice: "Me", replica: REPLICA }, { voice: "Puck", pace: "Natural" }] })).toEqual({
      dialogue: [],
      speakers: [{ voice: "Me", oneOffClone: true }, { voice: "Puck", pace: "Natural" }],
    })
    expect(withoutReplicaLinks({ text: "hi" })).toEqual({ text: "hi" })
  })

  it("payloadReplicas reads one speaker's clone and a dialogue's cloned speakers, well formed only", () => {
    expect(payloadReplicas({ replica: REPLICA })).toEqual([REPLICA])
    expect(payloadReplicas({ speakers: [{ voice: "Me", replica: REPLICA }, { voice: "X", replica: { sourceAudioUrl: "http://a" } }] })).toEqual([REPLICA])
    expect(payloadReplicas({ text: "hi" })).toEqual([])
  })

  it("a refusal KIE answers is worded by the platform, never quoted", () => {
    expect(replicaRefusalMessage("task failed: [422] Invalid consent audio.")).toMatch(/^The consent recording was not accepted/)
    expect(replicaRefusalMessage("task failed: [422] something else")).toMatch(/^The voice recordings were not accepted/)
  })
})
