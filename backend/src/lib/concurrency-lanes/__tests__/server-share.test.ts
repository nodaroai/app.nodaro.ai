// The per-process server share: no user — all payer lines together — holds
// more than a quarter of a pool, coordinator-class jobs together at most 40 %
// of the video pool; an exempt job (re-admitted, or a child of a running
// parent) is counted but never refused; leaving promotes the oldest job this
// process parked for the same user.
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WakeTarget } from "../gate.js"
import {
  noteServerWaiter, registerServerShareWaker, resetServerShareForTests, serverShare, serverShareOccupancy, serverShareOf,
} from "../server-share.js"

beforeEach(() => resetServerShareForTests())

const leaf = (userId: string, jobId: string, exempt = false) => ({ userId, jobId, coordinator: false, exempt })
const coord = (userId: string, jobId: string, exempt = false) => ({ userId, jobId, coordinator: true, exempt })

describe("serverShare caps", () => {
  it("one user cannot hold more than 25% of the video pool with leaf jobs", () => {
    const video = serverShare("video", 50)
    const entries = Array.from({ length: 12 }, (_, i) => video.tryEnter(leaf("U", `j${i}`)))
    expect(entries.every((e) => e.entered)).toBe(true)
    // The 13th leaf of the same user is refused; another user's leaf enters.
    expect(video.tryEnter(leaf("U", "j12")).entered).toBe(false)
    expect(video.tryEnter(leaf("V", "v1")).entered).toBe(true)
    expect(video.occupancy()).toMatchObject({ held: 13, byUser: { U: 12, V: 1 }, userCap: 12, coordinatorCap: 20 })
  })

  it("the render pool applies the same 25% rule", () => {
    const render = serverShare("render", 8)
    expect(render.tryEnter(leaf("U", "a")).entered).toBe(true)
    expect(render.tryEnter(leaf("U", "b")).entered).toBe(true)
    expect(render.tryEnter(leaf("U", "c")).entered).toBe(false)
    expect(render.occupancy().userCap).toBe(2)
  })

  it("a pool of 2 still admits one per user", () => {
    const render = serverShare("render", 2)
    expect(render.occupancy().userCap).toBe(1)
    expect(render.tryEnter(leaf("U", "a")).entered).toBe(true)
    expect(render.tryEnter(leaf("U", "b")).entered).toBe(false)
    expect(render.tryEnter(leaf("V", "c")).entered).toBe(true)
    // The other pools' sizes: orchestrator 20 → 5, pipeline 5 → 1, director 2 → 1.
    expect(serverShare("orchestrator", 20).occupancy().userCap).toBe(5)
    expect(serverShare("pipeline", 5).occupancy().userCap).toBe(1)
    expect(serverShare("director", 2).occupancy().userCap).toBe(1)
  })

  it("coordinators beyond 40% of the video pool wait as server_busy", () => {
    const video = serverShare("video", 50)
    for (let i = 0; i < 20; i++) expect(video.tryEnter(coord(`u${i}`, `c${i}`)).entered).toBe(true)
    // A 21st coordinator, of a user holding nothing, is refused; a leaf is not.
    expect(video.tryEnter(coord("fresh", "c20")).entered).toBe(false)
    expect(video.tryEnter(leaf("fresh", "l1")).entered).toBe(true)
    expect(video.occupancy()).toMatchObject({ coordinators: 20, coordinatorCap: 20 })
    // The coordinator cap is the video pool's only.
    const orchestrator = serverShare("orchestrator", 4)
    expect(orchestrator.tryEnter(coord("a", "o1")).entered).toBe(true)
    expect(orchestrator.tryEnter(coord("b", "o2")).entered).toBe(true)
    expect(orchestrator.tryEnter(coord("c", "o3")).entered).toBe(true)
  })

  it("an exempt job is never refused, and counts", () => {
    const video = serverShare("video", 4)
    expect(video.tryEnter(leaf("U", "a")).entered).toBe(true)
    expect(video.tryEnter(leaf("U", "b")).entered).toBe(false)
    expect(video.tryEnter(leaf("U", "b", true)).entered).toBe(true)
    expect(video.occupancy().byUser).toEqual({ U: 2 })
  })

  it("leave is idempotent and frees the place", () => {
    const video = serverShare("video", 4)
    const a = video.tryEnter(leaf("U", "a"))
    if (!a.entered) throw new Error("expected an entry")
    a.leave()
    a.leave()
    expect(video.occupancy()).toMatchObject({ held: 0, byUser: {} })
    expect(video.tryEnter(leaf("U", "b")).entered).toBe(true)
  })

  it("a pool whose size is not known only counts", () => {
    const pipeline = serverShareOf("pipeline")
    for (let i = 0; i < 30; i++) expect(pipeline.tryEnter(coord("U", `p${i}`)).entered).toBe(true)
    expect(pipeline.occupancy()).toMatchObject({ held: 30, userCap: null, coordinatorCap: null })
    // A size that is not a positive number is not known either.
    expect(serverShare("render", Number.NaN).tryEnter(leaf("U", "r")).entered).toBe(true)
    expect(serverShare("render", Number.NaN).tryEnter(leaf("U", "r2")).entered).toBe(true)
  })

  it("serverShareOccupancy reports every pool this process holds", () => {
    serverShare("video", 8).tryEnter(coord("U", "a"))
    serverShare("render", 2)
    expect(serverShareOccupancy()).toEqual({
      video: { poolSize: 8, held: 1, byUser: { U: 1 }, coordinators: 1, userCap: 2, coordinatorCap: 4 },
      render: { poolSize: 2, held: 0, byUser: {}, coordinators: 0, userCap: 1, coordinatorCap: null },
    })
  })
})

describe("serverShare wakes", () => {
  const target = (jobId: string): WakeTarget => ({ jobId, queue: "video-generation", bullJobId: `bull-${jobId}` })

  it("leaving promotes the oldest server_busy waiter of the same user on this process", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    const video = serverShare("video", 4)
    const running = video.tryEnter(leaf("U", "run-1"))
    const other = video.tryEnter(leaf("V", "run-2"))
    if (!running.entered || !other.entered) throw new Error("expected entries")
    noteServerWaiter("video", "U", target("w1"))
    noteServerWaiter("video", "V", target("x1"))
    noteServerWaiter("video", "U", target("w2"))
    // Parked again before any wake: keeps its place.
    noteServerWaiter("video", "U", target("w1"))
    running.leave()
    await vi.waitFor(() => expect(woken).toEqual([[target("w1")]]))
    // The next leave of U wakes the next of U's waiters, never V's.
    const again = video.tryEnter(leaf("U", "run-3"))
    if (!again.entered) throw new Error("expected an entry")
    again.leave()
    await vi.waitFor(() => expect(woken).toEqual([[target("w1")], [target("w2")]]))
  })

  it("a waiter that enters is no longer woken", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    const video = serverShare("video", 4)
    const a = video.tryEnter(leaf("U", "a"))
    if (!a.entered) throw new Error("expected an entry")
    noteServerWaiter("video", "U", target("w1"))
    // It got in some other way (a child of a running parent is never refused).
    const w1 = video.tryEnter(leaf("U", "w1", true))
    if (!w1.entered) throw new Error("expected an entry")
    a.leave()
    w1.leave()
    await new Promise((r) => setTimeout(r, 0))
    expect(woken).toEqual([])
  })

  it("a waiter noted while its user already has room again is woken at once", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    serverShare("video", 4)
    // Its user's running job left while it was being parked: no leave is left to wake it.
    noteServerWaiter("video", "U", target("w1"))
    await vi.waitFor(() => expect(woken).toEqual([[target("w1")]]))
  })

  it("a coordinator held back by the coordinator share does not absorb its user's wakes", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    // A pool of 8: 2 per user, 4 coordinators.
    const video = serverShare("video", 8)
    for (const u of ["A", "B", "C", "D"]) expect(video.tryEnter(coord(u, `c-${u}`)).entered).toBe(true)
    const l1 = video.tryEnter(leaf("U", "l1"))
    expect(video.tryEnter(leaf("U", "l2")).entered).toBe(true)
    if (!l1.entered) throw new Error("expected an entry")
    // U's coordinator waits first, its leaf behind it.
    noteServerWaiter("video", "U", target("w-coord"), true)
    noteServerWaiter("video", "U", target("w-leaf"))
    l1.leave()
    // The coordinator share is still full: the leaf is woken, not the coordinator.
    await vi.waitFor(() => expect(woken).toEqual([[target("w-leaf")]]))
  })

  it("a coordinator leaving the video pool wakes the oldest coordinator waiter of another user", async () => {
    const woken: WakeTarget[][] = []
    registerServerShareWaker(async (t) => { woken.push(t) })
    const video = serverShare("video", 8)
    const entries = ["A", "B", "C", "D"].map((u) => video.tryEnter(coord(u, `c-${u}`)))
    // V holds nothing; its coordinator is held back by the coordinator share alone.
    expect(video.tryEnter(coord("V", "v1")).entered).toBe(false)
    noteServerWaiter("video", "V", target("v1"), true)
    noteServerWaiter("video", "W", target("w1"), true)
    expect(woken).toEqual([])
    const a = entries[0]!
    if (!a.entered) throw new Error("expected an entry")
    a.leave()
    await vi.waitFor(() => expect(woken).toEqual([[target("v1")]]))
    await new Promise((r) => setTimeout(r, 0))
    expect(woken).toEqual([[target("v1")]])
  })

  it("a wake that moved nothing falls through to the next waiter", async () => {
    const woken: WakeTarget[][] = []
    // w1 is no longer parked (already picked up elsewhere, or gone): nothing moved.
    registerServerShareWaker(async (t) => { woken.push(t); return t[0]!.jobId === "w1" ? 0 : 1 })
    const video = serverShare("video", 4)
    const a = video.tryEnter(leaf("U", "a"))
    if (!a.entered) throw new Error("expected an entry")
    noteServerWaiter("video", "U", target("w1"))
    noteServerWaiter("video", "U", target("w2"))
    noteServerWaiter("video", "U", target("w3"))
    a.leave()
    await vi.waitFor(() => expect(woken).toEqual([[target("w1")], [target("w2")]]))
    await new Promise((r) => setTimeout(r, 0))
    expect(woken).toHaveLength(2)
  })

  it("a waker that fails never breaks a leave", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    registerServerShareWaker(async () => { throw new Error("redis down") })
    const video = serverShare("video", 4)
    const a = video.tryEnter(leaf("U", "a"))
    if (!a.entered) throw new Error("expected an entry")
    noteServerWaiter("video", "U", target("w1"))
    expect(() => a.leave()).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })
})
