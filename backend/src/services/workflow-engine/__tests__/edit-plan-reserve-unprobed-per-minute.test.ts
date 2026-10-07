/**
 * Review round F4 (decided 2026-10-07): with the per-minute capability on, an
 * edit-plan reserve whose probe of the master FAILS (a transient network error,
 * an SSRF block) keeps the id `buildPayload` built. For a URL / reference-audio
 * master that id comes from the transcript's last word — a lower bound, since
 * trailing music and silence are not transcribed. As started minutes it could
 * sit under the file's real length (speech ends 44:50, the file runs to 45:10 →
 * `:45m`), and the plugin, which re-probes the file successfully, refuses a
 * reserve more than 3 s short of it — failing the paid run. The step (`:60m`)
 * absorbs the tail, so that basis keeps it.
 *
 * Real `buildPayload` and real `computeEditPlanReserveId`, composed exactly as
 * the executor composes them (`computeEditPlanReserveId(...) ?? modelIdentifier`);
 * only the probe is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeMediaDuration: mockProbe,
}))

import { buildPayload } from "../payload-builder.js"
import { computeEditPlanReserveId } from "../../../lib/edit-plan-pricing.js"

// Speech ends at 44:50; the file itself runs on to 45:10.
const transcript = {
  version: 1,
  words: [
    { text: "hello", startMs: 0, endMs: 600 },
    { text: "bye", startMs: 2_689_000, endMs: 2_690_000 },
  ],
}
const urlMaster = { nodeId: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" as const }

async function reserveId(): Promise<{ id: string; reservedCreditId: unknown }> {
  const built = buildPayload(
    { id: "ep1", type: "edit-plan", data: { mode: "tighten", planTier: "standard" } } as never,
    "job-1",
    { transcript, editPlanSources: [urlMaster] } as never,
    undefined,
    { nodes: [], edges: [], nodeStates: {}, editPlanPerMinute: true } as never,
  )
  const id = (await computeEditPlanReserveId(built.jobName, built.payload, true)) ?? built.modelIdentifier
  return { id, reservedCreditId: (built.payload as { reservedCreditId?: unknown }).reservedCreditId }
}

describe("edit-plan reserve — per minute, transcript basis, probe fails", () => {
  beforeEach(() => {
    mockProbe.mockReset()
  })

  it("never reserves the transcript's started minutes: the step, :60m", async () => {
    mockProbe.mockImplementation(async () => {
      throw new Error("fetch failed")
    })
    const { id, reservedCreditId } = await reserveId()
    expect(id).toBe("edit-plan:tighten:standard:60m")
    expect(reservedCreditId).toBe("edit-plan:tighten:standard:60m")
  })

  it("a probe that succeeds still reserves the file's exact started minutes", async () => {
    mockProbe.mockResolvedValue(45 * 60 + 10)
    const { id, reservedCreditId } = await reserveId()
    expect(id).toBe("edit-plan:tighten:standard:46m")
    expect(reservedCreditId).toBe("edit-plan:tighten:standard:46m")
  })
})
