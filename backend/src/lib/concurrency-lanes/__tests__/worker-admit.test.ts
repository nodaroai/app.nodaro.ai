// admitWorkerJob / admitOrPark: the pickup gate of the BullMQ workers, on the
// gate's JS twin. Which slot a picked-up job takes (or borrows, or none), in
// which mode, on which line — and that a lane problem never fails a job.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, LaneGateTimeoutError, type WakeTarget } from "../gate.js"
import type { LaneSizes, PayerKey } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore, type FakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
  sizeSubjects: [] as Array<{ userId: string; payer: string; tier: string | null }>,
  provider: "kie" as string | null,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../sizes.js", () => ({
  laneSizesFor: async (subject: { userId: string; payer: string; tier: string | null }) => {
    refs.sizeSubjects.push(subject)
    return refs.sizes
  },
}))
vi.mock("../provider-of.js", () => ({ primaryProviderOfJob: () => refs.provider }))
vi.mock("../../supabase.js", () => ({ supabase: {} }))

const { admitWorkerJob, admitOrPark, pickupStatusesFor, registerNotAdmittedHandler, registerWakeTargetsHandler, resetWorkerAdmitHooksForTests } =
  await import("../worker-admit.js")
const { handOffConcurrencySlot } = await import("../handoff.js")
const { laneCounters, resetLaneCountersForTests } = await import("../hold.js")
const { registerServerShareWaker, resetServerShareForTests, serverShare, serverShareOccupancy } = await import("../server-share.js")
type WorkerRow = import("../worker-admit.js").WorkerRow
type AdmittedJob = import("../worker-admit.js").AdmittedJob

let store: FakeLaneStore
let gate: ConcurrencyGate

const row = (over: Partial<WorkerRow> = {}): WorkerRow => ({
  id: "job-1", user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
  pipeline_id: null, workspace_id: null, org_id: null, source: "editor", source_detail: null, mcp_client: null, ...over,
})
const bull = (name: string, data: Record<string, unknown> = {}, id = "bull-1") => ({ id, name, data: { jobId: "job-1", ...data } })

const otherMeta = (jobId: string, lane: "provider" | "local" | "run", payer: PayerKey = "user:U") => ({
  jobId, userId: "U", payer, lane, provider: lane === "provider" ? "kie" : lane === "local" ? "local" : null, source: null,
  sourceDetail: null, jobType: "x", model: null, queue: "video-generation" as const, bullJobId: jobId,
})

/** Fill the user's `lane` (size 1) with another job. */
async function fill(lane: "provider" | "local" | "run", payer: PayerKey = "user:U"): Promise<string> {
  const r = await gate.acquire({ meta: otherMeta(`other-${lane}`, lane, payer), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

const laneOf = async (lane: "provider" | "local" | "run", payer = "user:U") =>
  (await gate.snapshot()).lines.find((l) => l.payer === payer)?.lanes[lane]

const admitted = (a: Awaited<ReturnType<typeof admitWorkerJob>>): AdmittedJob => {
  if (!a.admitted) throw new Error(`expected an admission, got a wait: ${JSON.stringify(a.wait)}`)
  return a
}

beforeEach(async () => {
  store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 2, local: 1, run: 1 }
  refs.sizeSubjects = []
  refs.provider = "kie"
  resetLaneCountersForTests()
  resetServerShareForTests()
  resetWorkerAdmitHooksForTests()
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("admitWorkerJob", () => {
  it("a drained or stalled re-pick of a processing row is readmitted at once without parking", async () => {
    await fill("provider")
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ status: "processing" }) }))
    expect(acquire.mock.calls[0]![0].mode).toBe("readmit")
    expect(a.leaseId).toEqual(expect.any(String))
    expect(a.hold).toMatchObject({ role: "leaf", lane: "provider", userId: "U", payer: "user:U", jobId: "job-1", leaseId: a.leaseId })
    expect(await laneOf("provider")).toMatchObject({ running: 2, queued: 0 })
    await a.release("completed")
  })

  it("a pending row with started_at set (a sync row) is not readmitted", async () => {
    await fill("provider")
    const acquire = vi.spyOn(gate, "acquire")
    const a = await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ started_at: "2026-10-30T10:00:00Z" }) })
    expect(acquire.mock.calls[0]![0].mode).toBe("fresh")
    expect(a.admitted).toBe(false)
    if (!a.admitted) expect(a.wait).toMatchObject({ reason: "user_lane", position: 1 })
    // A refused job leaves the server share again.
    expect(serverShareOccupancy().video?.byUser ?? {}).toEqual({})
  })

  it("a child of a leaf-holding parent borrows the parent's slot", async () => {
    const parent = await gate.acquire({ meta: { ...otherMeta("parent", "provider"), jobId: "parent" }, size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!parent.granted) throw new Error("expected a grant")
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ parent_job_id: "parent" }) }))
    expect(acquire).not.toHaveBeenCalled()
    expect(a.leaseId).toBe(parent.leaseId)
    expect(a.hold).toMatchObject({ role: "leaf", lane: "provider", leaseId: parent.leaseId })
  })

  it("a borrowed admission's release leaves the parent's lease held", async () => {
    const parent = await gate.acquire({ meta: { ...otherMeta("parent", "provider"), jobId: "parent" }, size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!parent.granted) throw new Error("expected a grant")
    const release = vi.spyOn(gate, "release")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ parent_job_id: "parent" }) }))
    await a.release("completed")
    expect(release).not.toHaveBeenCalled()
    expect(await laneOf("provider")).toMatchObject({ running: 1 })
    expect(await gate.renew(parent.leaseId, 60_000, { ...otherMeta("parent", "provider"), jobId: "parent" })).toBe("renewed")
  })

  it("a coordinator child of a leaf-holding parent keeps a coordinator hold", async () => {
    const parent = await gate.acquire({ meta: { ...otherMeta("parent", "provider"), jobId: "parent" }, size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!parent.granted) throw new Error("expected a grant")
    const acquire = vi.spyOn(gate, "acquire")
    const borrow = vi.spyOn(gate, "borrow")
    // Under a leaf hold its whole fan-out would run on the one borrowed slot;
    // as a coordinator each of its calls takes its own.
    const a = admitted(await admitWorkerJob({ job: bull("generate-video-pro"), queue: "video-generation", row: row({ parent_job_id: "parent" }) }))
    expect(borrow).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(a.leaseId).toBeNull()
    expect(a.hold).toMatchObject({ role: "coordinator", lane: null, leaseId: null })
    await a.release("completed")
    expect(await gate.renew(parent.leaseId, 60_000, { ...otherMeta("parent", "provider"), jobId: "parent" })).toBe("renewed")
  })

  it("a child of a running coordinator acquires front", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    // The parent holds no leaf lease (a coordinator): nothing to borrow.
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ parent_job_id: "coordinator-job" }) }))
    expect(acquire.mock.calls[0]![0].mode).toBe("front")
    expect(a.hold).toMatchObject({ role: "leaf", lane: "provider" })
    await a.release("completed")
  })

  it("a director's child, marked by the lane-only payload marker, acquires front", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("text-to-speech", { laneParent: { kind: "director", id: "dir-1" } }), queue: "video-generation", row: row() }))
    expect(acquire.mock.calls[0]![0].mode).toBe("front")
    await a.release("completed")
  })

  it("a pipeline stage row is admitted front from its pipeline_id", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ pipeline_id: "pipe-1" }) }))
    expect(acquire.mock.calls[0]![0].mode).toBe("front")
    await a.release("completed")
  })

  it("a scene-render-child of a workspace parent uses the workspace line", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({
      job: { id: "bull-c", name: "scene-render-child", data: { jobId: "job-1", sceneRenderChild: true } },
      queue: "video-render",
      row: row({ parent_job_id: "scene-parent", workspace_id: "W1", org_id: "O1" }),
    }))
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { payer: "workspace:W1", userId: "U", lane: "local", provider: "local", queue: "video-render" } })
    expect(refs.sizeSubjects[0]).toEqual({ userId: "U", payer: "workspace:W1", tier: "business" })
    expect(a.hold).toMatchObject({ payer: "workspace:W1", lane: "local" })
    await a.release("completed")
  })

  it("a nested coordinator takes no slot and gets a coordinator hold", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("generate-video-pro"), queue: "video-generation", row: row({ workflow_execution_id: "exec-1", status: "processing" }) }))
    expect(acquire).not.toHaveBeenCalled()
    expect(a.leaseId).toBeNull()
    expect(a.hold).toMatchObject({ role: "coordinator", lane: null, leaseId: null, jobId: "job-1" })
  })

  it("a top-level coordinator takes a run slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("generate-video-pro"), queue: "video-generation", row: row() }))
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "fresh", size: 1, meta: { lane: "run", provider: null } })
    expect(a.hold).toMatchObject({ role: "run", lane: "run", leaseId: a.leaseId })
    expect(await laneOf("run")).toMatchObject({ running: 1 })
    await a.release("completed")
    expect(await laneOf("run")).toBeUndefined()
  })

  it("the payer line comes from the payload billing context", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const billingContext = {
      payer: "workspace", userId: "U", workspaceId: "W9", orgId: "O9", memberCap: null,
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 12, tierForGates: "business" },
    }
    // The row says personal: the payload's context wins.
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video", { userId: "U", billingContext }), queue: "video-generation", row: row() }))
    expect(acquire.mock.calls[0]![0].meta.payer).toBe("workspace:W9")
    expect(refs.sizeSubjects[0]).toEqual({ userId: "U", payer: "workspace:W9", tier: "business" })
    await a.release("completed")
    // A payload naming its user but no context is the personal line.
    const b = admitted(await admitWorkerJob({ job: bull("image-to-video", { userId: "U" }), queue: "video-generation", row: row({ id: "job-2", workspace_id: "W1" }) }))
    expect(acquire.mock.calls[1]![0].meta.payer).toBe("user:U")
    await b.release("completed")
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await fill("provider")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row() }))
    expect(a.leaseId).toEqual(expect.any(String))
    // Granted over the limit: counted as running, marked over-limit, nothing waits.
    expect(await laneOf("provider")).toMatchObject({ running: 2, overLimit: 1, queued: 0 })
    await a.release("completed")
    expect(await laneOf("provider")).toMatchObject({ running: 1, overLimit: 0 })
  })

  it("releases exactly once and hands the wakes it reserved to the wake handler", async () => {
    const wakes: WakeTarget[][] = []
    registerWakeTargetsHandler(async (t) => { wakes.push(t) })
    const release = vi.spyOn(gate, "release")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row() }))
    // Another job of the user waits behind it.
    const waiter = await gate.acquire({ meta: otherMeta("waiter", "provider"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    expect(waiter.granted).toBe(false)
    await a.release("failed")
    await a.release("completed")
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(a.leaseId, "failed")
    expect(wakes).toEqual([[{ jobId: "waiter", queue: "video-generation", bullJobId: "waiter" }]])
  })

  it("the captions render hand-off is readmitted and the video job released with handoff", async () => {
    const release = vi.spyOn(gate, "release")
    const video = admitted(await admitWorkerJob({ job: bull("add-captions"), queue: "video-generation", row: row() }))
    // The handler hands the slot over BEFORE it enqueues the render.
    await handOffConcurrencySlot("job-1")
    expect(release).toHaveBeenCalledWith(video.leaseId, "handoff")
    // The render job: same jobs.id, the row still `processing`, its line full of another job.
    await fill("local")
    const acquire = vi.spyOn(gate, "acquire")
    const render = admitted(await admitWorkerJob({
      job: { id: "render-job-1", name: "render", data: { jobId: "job-1", planType: "burn-captions" } },
      queue: "video-render",
      row: row({ status: "processing" }),
    }))
    expect(acquire.mock.calls[0]![0].mode).toBe("readmit")
    expect(render.leaseId).not.toBe(video.leaseId)
    expect(await laneOf("local")).toMatchObject({ running: 2 })
    // The video worker's own release after the hand-off does nothing.
    await video.release("completed")
    expect(release).toHaveBeenCalledTimes(1)
    expect(await laneOf("local")).toMatchObject({ running: 2 })
    await render.release("completed")
    expect(await laneOf("local")).toMatchObject({ running: 1 })
  })

  it("a video job re-picked after handing its slot to the render never releases or hands off the render's lease", async () => {
    const release = vi.spyOn(gate, "release")
    // The render picked up after the hand-off: the job's lease, under the render's own BullMQ entry.
    const render = await gate.acquire({
      meta: { ...otherMeta("job-1", "local"), queue: "video-render", bullJobId: "render-job-1" }, size: 1, mode: "readmit", leaseTtlMs: 3_600_000,
    })
    if (!render.granted) throw new Error("expected a grant")
    // The video job died after the hand-off and is picked up again: its row is `processing`.
    const video = admitted(await admitWorkerJob({ job: bull("add-captions"), queue: "video-generation", row: row({ status: "processing" }) }))
    expect(video.leaseId).toBe(render.leaseId)
    expect(video.hold).toMatchObject({ role: "leaf", lane: "local", leaseId: render.leaseId })
    await handOffConcurrencySlot("job-1")
    await video.release("completed")
    expect(release).not.toHaveBeenCalled()
    expect(await laneOf("local")).toMatchObject({ running: 1 })
  })

  it("a job admitted ungated on a gate failure counts in the server share until it is released", async () => {
    vi.spyOn(gate, "acquire").mockRejectedValue(new Error("redis down"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row() }))
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
    await a.release("completed")
    expect(serverShareOccupancy().video?.byUser ?? {}).toEqual({})
  })

  it("a gate that does not answer admits the job ungated, counted, and withdraws its entry", async () => {
    vi.spyOn(gate, "acquire").mockRejectedValue(new LaneGateTimeoutError("acquire", 5_000))
    const withdraw = vi.spyOn(gate, "withdraw")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row() }))
    expect(a.leaseId).toBeNull()
    expect(a.hold).toMatchObject({ role: "leaf", lane: "provider", leaseId: null })
    expect(laneCounters()).toMatchObject({ ungated: { "image-to-video": 1 }, failOpen: { "gate-timeout": 1 } })
    await vi.waitFor(() => expect(withdraw).toHaveBeenCalledWith("job-1"))
    await a.release("completed")
  })

  it("a row with no user runs ungated without touching the gate", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const a = admitted(await admitWorkerJob({ job: bull("image-to-video"), queue: "video-generation", row: row({ user_id: "" }) }))
    expect(acquire).not.toHaveBeenCalled()
    expect(a.leaseId).toBeNull()
  })
})

describe("admitOrPark", () => {
  it("until parking exists, a refused job runs ungated and leaves no waiter behind", async () => {
    await fill("provider")
    const a = await admitOrPark({ job: bull("image-to-video"), token: "t", queue: "video-generation", row: row() })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toBeNull()
    expect(laneCounters().ungated).toEqual({ "image-to-video": 1 })
    expect(await laneOf("provider")).toMatchObject({ running: 1, queued: 0 })
    // It runs, so it counts in the server share until released.
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
    await a!.release("completed")
    expect(serverShareOccupancy().video?.byUser ?? {}).toEqual({})
  })

  it("a park that fails runs the job ungated, counted in the share, with no waiter behind", async () => {
    await fill("provider")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    registerNotAdmittedHandler(async () => { throw new Error("could not move the job") })
    const a = await admitOrPark({ job: bull("image-to-video"), token: "t", queue: "video-generation", row: row() })
    expect(a).not.toBeNull()
    expect(a!.leaseId).toBeNull()
    expect(await laneOf("provider")).toMatchObject({ running: 1, queued: 0 })
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
    await a!.release("failed")
    expect(serverShareOccupancy().video?.byUser ?? {}).toEqual({})
  })

  it("a registered park ends the attempt (null)", async () => {
    await fill("provider")
    const park = vi.fn(async () => "parked" as const)
    registerNotAdmittedHandler(park)
    expect(await admitOrPark({ job: bull("image-to-video"), token: "t", queue: "video-generation", row: row() })).toBeNull()
    expect(park).toHaveBeenCalledWith(expect.objectContaining({ token: "t", queue: "video-generation", wait: expect.objectContaining({ position: 1 }) }))
  })
})

describe("the server share at pickup", () => {
  // A video pool of 4: one job per user; the user's lanes are wide, so only the share can refuse.
  beforeEach(() => {
    serverShare("video", 4)
    refs.sizes = { provider: 10, llm: 10, local: 10, run: 10 }
  })

  const jobOf = (id: string, name = "image-to-video", data: Record<string, unknown> = {}) =>
    ({ ...bull(name, { jobId: id, ...data }, `bull-${id}`) })

  /** The user's one place in the pool, taken by a running leaf. */
  async function holdShare(id = "job-a"): Promise<AdmittedJob> {
    return admitted(await admitWorkerJob({ job: jobOf(id), queue: "video-generation", row: row({ id }) }))
  }

  it("a leaf job over its user's server share waits as queued with reason server_busy", async () => {
    await holdShare()
    const a = await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) })
    expect(a.admitted).toBe(false)
    if (!a.admitted) expect(a.wait).toMatchObject({ reason: "server_busy", position: 1, lane: "provider" })
    // Handed to the park, which puts the row back as `queued`.
    const park = vi.fn(async () => "parked" as const)
    registerNotAdmittedHandler(park)
    expect(await admitOrPark({ job: jobOf("job-b"), token: "t", queue: "video-generation", row: row({ id: "job-b" }) })).toBeNull()
    expect(park).toHaveBeenCalledWith(expect.objectContaining({ wait: expect.objectContaining({ reason: "server_busy" }) }))
    // Another user's leaf enters.
    admitted(await admitWorkerJob({ job: jobOf("job-v"), queue: "video-generation", row: row({ id: "job-v", user_id: "V" }) }))
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1, V: 1 })
  })

  it("the 25% cap counts all payer lines of a user together", async () => {
    const billingContext = {
      payer: "workspace", userId: "U", workspaceId: "W9", orgId: "O9", memberCap: null,
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 12, tierForGates: "business" },
    }
    admitted(await admitWorkerJob({ job: jobOf("job-a", "image-to-video", { userId: "U", billingContext }), queue: "video-generation", row: row({ id: "job-a" }) }))
    // Personal line, same user: the share is full.
    const a = await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) })
    expect(a.admitted).toBe(false)
    if (!a.admitted) expect(a.wait.reason).toBe("server_busy")
  })

  it("a child of a running parent is never refused by the share even when its user's share is full", async () => {
    await holdShare()
    // Not borrowed: the parent is a coordinator holding no leaf lease.
    const child = admitted(await admitWorkerJob({ job: jobOf("child-1"), queue: "video-generation", row: row({ id: "child-1", parent_job_id: "coordinator-job" }) }))
    // Borrowed: the parent holds a leaf lease.
    const parent = await gate.acquire({ meta: { ...otherMeta("parent", "provider"), jobId: "parent" }, size: 10, mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!parent.granted) throw new Error("expected a grant")
    const borrowed = admitted(await admitWorkerJob({ job: jobOf("child-2"), queue: "video-generation", row: row({ id: "child-2", parent_job_id: "parent" }) }))
    expect(borrowed.leaseId).toBe(parent.leaseId)
    // Both counted.
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 3 })
    await child.release("completed")
    await borrowed.release("completed")
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
  })

  it("a readmitted job is never refused by the share", async () => {
    await holdShare()
    const a = admitted(await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b", status: "processing" }) }))
    expect(a.leaseId).toEqual(expect.any(String))
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 2 })
  })

  it("a job refused by the share holds no lane or run lease", async () => {
    await holdShare()
    const acquire = vi.spyOn(gate, "acquire")
    const leaf = await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) })
    const run = await admitWorkerJob({ job: jobOf("job-c", "generate-video-pro"), queue: "video-generation", row: row({ id: "job-c" }) })
    expect(leaf.admitted).toBe(false)
    expect(run.admitted).toBe(false)
    if (!run.admitted) expect(run.wait).toMatchObject({ reason: "server_busy", lane: "run" })
    expect(acquire).not.toHaveBeenCalled()
    expect(await laneOf("provider")).toMatchObject({ running: 1, queued: 0 })
    expect(await laneOf("run") ?? { running: 0, queued: 0 }).toMatchObject({ running: 0, queued: 0 })
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
  })

  it("a server-busy job reports server_busy in describeWait and reads as busy across the platform", async () => {
    await holdShare()
    await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) })
    // The platform-wide reason (not the user's own lane): no plan limit to name.
    expect(await gate.describeWait("job-b")).toMatchObject({ reason: "server_busy", position: 1, limit: 0, running: 0 })
  })

  it("leaving promotes the oldest server_busy waiter of the same user on this process", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    registerNotAdmittedHandler(async () => "parked")
    const running = await holdShare()
    for (const id of ["job-b", "job-c"]) {
      expect(await admitOrPark({ job: jobOf(id), token: "t", queue: "video-generation", row: row({ id }) })).toBeNull()
    }
    expect(await admitOrPark({ job: jobOf("job-x"), token: "t", queue: "video-generation", row: row({ id: "job-x", user_id: "V" }) })).not.toBeNull()
    await running.release("completed")
    await vi.waitFor(() => expect(woken).toEqual([[{ jobId: "job-b", queue: "video-generation", bullJobId: "bull-job-b" }]]))
  })

  it("a parked job that enters without a lane acquire leaves no server wait behind", async () => {
    const running = await holdShare()
    // A nested coordinator (a workflow node) refused by the share, then let in.
    const nested = { id: "job-n", workflow_execution_id: "exec-1" }
    expect((await admitWorkerJob({ job: jobOf("job-n", "generate-video-pro"), queue: "video-generation", row: row(nested) })).admitted).toBe(false)
    expect(await gate.describeWait("job-n")).toMatchObject({ reason: "server_busy" })
    await running.release("completed")
    const a = admitted(await admitWorkerJob({ job: jobOf("job-n", "generate-video-pro"), queue: "video-generation", row: row({ ...nested, status: "queued" }) }))
    expect(a.leaseId).toBeNull()
    await vi.waitFor(async () => expect(await gate.describeWait("job-n")).toBeNull())
  })

  it("a server wait that cannot be recorded runs the job, counted", async () => {
    await holdShare()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(gate, "markServerWait").mockRejectedValue(new Error("redis down"))
    const a = admitted(await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) }))
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 2 })
    await a.release("completed")
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 1 })
  })

  it("an enforcement flag that cannot be read lets the job in, counted", async () => {
    await holdShare()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(gate, "isEnforced").mockRejectedValue(new Error("redis down"))
    const markServerWait = vi.spyOn(gate, "markServerWait")
    admitted(await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) }))
    expect(markServerWait).not.toHaveBeenCalled()
    expect(serverShareOccupancy().video?.byUser).toEqual({ U: 2 })
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    const markServerWait = vi.spyOn(gate, "markServerWait")
    await holdShare()
    const a = admitted(await admitWorkerJob({ job: jobOf("job-b"), queue: "video-generation", row: row({ id: "job-b" }) }))
    expect(a.leaseId).toEqual(expect.any(String))
    // Entered over the cap: counted, nothing waits.
    expect(serverShareOccupancy().video).toMatchObject({ byUser: { U: 2 }, userCap: 1 })
    expect(markServerWait).not.toHaveBeenCalled()
    expect(await gate.describeWait("job-b")).toBeNull()
  })
})

describe("pickupStatusesFor", () => {
  it("a job re-added after Redis lost it runs only from queued; anything else also from pending and processing", () => {
    expect(pickupStatusesFor("lane-readd-job-1")).toEqual(["queued"])
    expect(pickupStatusesFor("bull-1")).toEqual(["pending", "queued", "processing"])
    expect(pickupStatusesFor(undefined)).toEqual(["pending", "queued", "processing"])
  })
})
