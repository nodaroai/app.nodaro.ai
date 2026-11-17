/**
 * The Suno Speech worker (worker.ts): the run is policed, held to the
 * provider's limits again as it will be sent, saved under the market lane's
 * own task kind (so the reconcile finishes it from its task), marked as spoken
 * takes, and never relayed to a connected cloud.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  policy: vi.fn(),
  sunoSpeech: vi.fn(),
  runTracks: vi.fn(),
  makeOnTaskCreated: vi.fn(),
}))

vi.mock("@/lib/prompt-policy.js", () => ({ applyPromptPolicies: m.policy }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: m.makeOnTaskCreated }))
vi.mock("@/lib/suno-id-source.js", () => ({ SUNO_TRACK_KIND_FIELD: "sunoTrackKind", SUNO_TRACK_KIND_SPEECH: "speech" }))
vi.mock("@/providers/kie/suno-market.js", () => ({ SUNO_SPEECH_PROVIDER_COST_USD: 0.06, sunoSpeech: m.sunoSpeech }))
vi.mock("@/workers/handlers/suno.js", () => ({ runSunoTracksJob: m.runTracks }))

import { worker } from "../worker.js"

const ctx = { jobId: "job-1", usageLogId: "ul-1", jobUserId: "user-1" }
const job = (data: Record<string, unknown>) => ({ data, name: "suno-speech" })
const run = (data: Record<string, unknown>) => worker(job(data) as never, ctx as never)

beforeEach(() => {
  m.policy.mockReset().mockImplementation((a: { prompt: string; vocalGender?: string }) => ({ prompt: a.prompt, negativePrompt: "", vocalGender: a.vocalGender }))
  m.sunoSpeech.mockReset().mockResolvedValue({ taskId: "t-speech", tracks: [] })
  m.makeOnTaskCreated.mockReset().mockReturnValue(() => undefined)
  // The shared tail runs the provider call it is handed.
  m.runTracks.mockReset().mockImplementation(async (_job: unknown, _ctx: unknown, _label: string, call: () => Promise<unknown>) => { await call() })
})

describe("the Suno Speech worker", () => {
  it("sends the policed brief, saves its task under the market lane's kind, marks the takes as speech and records the provider's charge", async () => {
    m.policy.mockImplementation((a: { prompt: string }) => ({ prompt: `${a.prompt}, in a calm voice`, negativePrompt: "" }))
    await run({ mode: "brief", prompt: "A short morning news intro" })
    expect(m.sunoSpeech).toHaveBeenCalledWith({ mode: "brief", prompt: "A short morning news intro, in a calm voice" }, expect.objectContaining({ modelKey: "suno-speech" }))
    expect(m.makeOnTaskCreated).toHaveBeenCalledWith("job-1", "kie-suno-market")
    const [, , label, , cost, facts] = m.runTracks.mock.calls[0]!
    expect(label).toBe("Suno Speech returned no takes")
    expect(cost).toBe(0.06)
    expect(facts).toStrictEqual({ sunoTrackKind: "speech" })
  })

  it("a Script's spoken words are never rewritten; its tone is what is policed", async () => {
    m.policy.mockImplementation((a: { prompt: string }) => ({ prompt: `${a.prompt} (policed)`, negativePrompt: "", vocalGender: "female" }))
    await run({ mode: "script", script: "Hello.\nWorld.", tone: "warm", variety: 2 })
    expect(m.policy).toHaveBeenCalledWith(expect.objectContaining({ prompt: "warm" }))
    expect(m.sunoSpeech.mock.calls[0]![0]).toStrictEqual({ mode: "script", script: "Hello.\nWorld.", tone: "warm (policed)", variety: 2, vocalGender: "female" })
  })

  it("a brief or a tone a policy pushed past the provider's limit is refused, never cut and never sent", async () => {
    m.policy.mockImplementation((a: { prompt: string }) => ({ prompt: a.prompt + "x".repeat(50), negativePrompt: "" }))
    await expect(run({ mode: "brief", prompt: "b".repeat(2990) })).rejects.toThrow(/at most 3000/)
    await expect(run({ mode: "script", script: "Hi", tone: "t".repeat(990) })).rejects.toThrow(/at most 1000/)
    expect(m.sunoSpeech).not.toHaveBeenCalled()
  })

  it("a run that could not be sent fails before the provider is asked", async () => {
    await expect(run({ mode: "brief", prompt: "   " })).rejects.toThrow(/needs a brief/)
    expect(m.runTracks).not.toHaveBeenCalled()
  })
})
