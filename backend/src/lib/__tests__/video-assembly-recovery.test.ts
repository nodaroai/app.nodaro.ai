import { beforeEach, describe, expect, it, vi } from "vitest"
import { assemblyRecoveryColumns } from "../video-assembly-manifest.js"

const h = vi.hoisted(() => ({
  rpc: vi.fn(), assemble: vi.fn(), policy: vi.fn(), clean: vi.fn(), blocked: vi.fn(), restricted: vi.fn(),
}))
vi.mock("../job-scratch.js", () => ({ discardJobScratch: async () => {} }))
vi.mock("../supabase.js", () => ({ supabase: { rpc: h.rpc } }))
vi.mock("../private-plugins/services-registry.js", () => ({ getPluginServices: () => ({ videoAssemblyRecovery: { assemble: h.assemble } }) }))
vi.mock("../job-policy-gate.js", () => ({ applyResultGate: h.policy }))
vi.mock("../job-policy-outputs.js", () => ({ deleteOwnedObjects: h.clean }))
vi.mock("../access-blocks.js", () => ({ isUserBlocked: h.blocked, isUserQuietStopped: () => false }))
vi.mock("../content-restrictions.js", () => ({ isRestrictedAddress: h.restricted }))
vi.mock("../storage.js", () => ({ getR2ObjectSize: async () => 42, storageChargeOf: async () => ({ bytes: 42, uncounted: false }) }))
vi.mock("../asset-companions.js", () => ({ companionsForRow: () => [] }))
import { recoverNextVideoAssembly } from "../video-assembly-recovery.js"

const job = "00000000-0000-4000-8000-000000076901"
const attempt = "00000000-0000-4000-8000-000000076902"
const url = (suffix: string) => `https://files.test/videos/${job}-${suffix}.mp4`
const clips = [{ segment: 1, url: url("delivery-1") }, { segment: 2, url: url("delivery-2") }]
const output = { deliveryMode: "separate_clips", videoUrl: clips[0]!.url, unassembledClips: clips }
const candidate = url(`assembly-${attempt}`)

function claimed() {
  const { video_assembly_recovery } = assemblyRecoveryColumns(job, "generate-video-pro", output, "owner", true)
  return { data: { id: job, output, manifest: { ...(video_assembly_recovery as object), attemptId: attempt } }, error: null }
}

describe("repair of an already delivered Pro video", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("R2_PUBLIC_URL", "https://files.test")
    h.assemble.mockResolvedValue({ videoUrl: candidate })
    h.policy.mockResolvedValue("allow")
    h.rpc.mockImplementation(async (name: string) => name === "claim_video_assembly" ? claimed() : { data: true, error: null })
  })

  it("sends only the durable clips and publishes their replacement without another completion or credit call", async () => {
    await recoverNextVideoAssembly()
    expect(h.assemble).toHaveBeenCalledWith({ jobId: job, jobType: "generate-video-pro", attemptId: attempt, clips, shouldWatermark: true, userId: "owner" })
    expect(h.policy).toHaveBeenCalledWith(job, { output_data: { ...output, videoUrl: candidate, deliveryMode: "simple_cuts" } }, "direct", undefined, { replacement: true })
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_video_assembly", "finish_video_assembly"])
    expect(h.rpc.mock.calls[1]?.[1]).toMatchObject({ p_state: "publish", p_expected_output: output, p_video_url: candidate, p_size: 42 })
    expect(JSON.stringify(h.clean.mock.calls)).not.toContain(`assembly-${attempt}.mp4`)
  })

  it("returns the prepared retained footage's storage on a failed assembly and keeps the deliveries", async () => {
    const edit = { ...output, assemblyInputsPending: true, pro: { cuts: { headUrl: url("cut-head"), tailUrl: url("cut-tail") }, source: { width: 1920, height: 1080 } } }
    const { video_assembly_recovery } = assemblyRecoveryColumns(job, "edit-video-pro", edit, "owner", true)
    h.rpc.mockResolvedValueOnce({ data: { id: job, output: edit, manifest: { ...(video_assembly_recovery as object), attemptId: attempt } } })
    const stem = `videos/${job}-assembly-${attempt}`
    const stored = new Map<string, number>(clips.map(clip => [new URL(clip.url).pathname.slice(1), 100]))
    h.assemble.mockImplementationOnce(async () => {
      stored.set(`${stem}-source-head.mp4`, 40)
      stored.set(`${stem}-source-tail.mp4`, 60)
      throw new Error("combine failed")
    })
    let refunded = 0
    h.clean.mockImplementation(async (_job, objects: {key: string}[], opts) => {
      for (const {key} of objects) {
        if (opts.refundOwner) refunded += stored.get(key) ?? 0
        stored.delete(key)
      }
    })
    await recoverNextVideoAssembly()
    expect(refunded).toBe(100)
    expect([...stored.keys()]).toEqual(clips.map(clip => new URL(clip.url).pathname.slice(1)))
    expect(h.rpc.mock.calls[1]?.[1]).toMatchObject({ p_state: "retry" })
  })

  it("withholds a new result rejected by policy and preserves the original playable clips", async () => {
    h.policy.mockResolvedValue("blocked")
    await recoverNextVideoAssembly()
    expect(h.rpc.mock.calls[1]?.[1]).toMatchObject({ p_state: "discard" })
    expect(JSON.stringify(h.clean.mock.calls)).not.toContain("delivery-1")
  })

  it("keeps a possibly published candidate after the database response is lost", async () => {
    h.rpc.mockResolvedValueOnce(claimed()).mockRejectedValueOnce(new Error("lost acknowledgement"))
      .mockResolvedValueOnce({ data: false, error: null })
    await recoverNextVideoAssembly()
    expect(JSON.stringify(h.clean.mock.calls)).not.toContain(`assembly-${attempt}.mp4`)
  })

  it("never reassembles restricted media", async () => {
    h.restricted.mockResolvedValue(true)
    await recoverNextVideoAssembly()
    expect(h.assemble).not.toHaveBeenCalled()
    expect(h.rpc.mock.calls[1]?.[1]).toMatchObject({ p_state: "discard" })
  })

  it("reconstructs the entire edit from authorized cut pieces, preserving the source canvas", () => {
    const cut = { headUrl: url("cut-head"), tailUrl: url("cut-tail") }
    const edit = { ...output, assemblyInputsPending: true, pro: { cuts: cut, source: { width: 1920, height: 1080 } } }
    expect(assemblyRecoveryColumns(job, "edit-video-pro", edit, "owner", true)).toMatchObject({
      video_assembly_recovery: { inputs: { clips, retainedCuts: cut, canvas: { width: 1920, height: 1080 } } },
    })
    const foreign = { ...edit, pro: { ...edit.pro, cuts: { ...cut, headUrl: "https://other.test/head.mp4" } } }
    expect(assemblyRecoveryColumns(job, "edit-video-pro", foreign, "owner", true)).toEqual({})
    expect(assemblyRecoveryColumns(job, "edit-video-pro", { ...edit, assemblyInputsPending: false }, "owner", true)).toEqual({})
  })
})
