// The job-budget registry is read by the WORKFLOW ENGINE (node-executor sizes a
// node's ceilings from it) and by the reconcile sweeps — so the budget it
// reaches must stay a pure leaf. `apply-edl.ts` itself pulls `child_process`,
// the R2 client and `config` through `ffmpeg-utils.ts`; if the registry ever
// reached it again, every importer of the engine would load the ffmpeg runtime
// (and the engine's tests, which mock only their own boundaries, would start
// needing ffmpeg-shaped mocks). Every heavy module below throws on load: the
// registry and the budget leaf must import cleanly anyway.
import { describe, it, expect, vi } from "vitest"

vi.mock("node:child_process", () => {
  throw new Error("the job-budget leaf must not load child_process")
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => {
  throw new Error("the job-budget leaf must not load ffmpeg-utils")
})
vi.mock("../../providers/video/apply-edl.js", () => {
  throw new Error("the job-budget leaf must not load the apply-edl renderer")
})
vi.mock("../storage.js", () => {
  throw new Error("the job-budget leaf must not load storage")
})
vi.mock("../supabase.js", () => {
  throw new Error("the job-budget leaf must not load supabase")
})
vi.mock("../config.js", () => {
  throw new Error("the job-budget leaf must not load config")
})

describe("job-budget import graph", () => {
  it("the registry and the apply-edl budget leaf load without the ffmpeg runtime, storage, supabase or config", async () => {
    const registry = await import("../job-budget.js")
    const leaf = await import("../../providers/video/apply-edl-budget.js")
    const timeouts = await import("../../providers/video/ffmpeg-timeouts.js")
    expect(typeof registry.declaredJobBudgetMs).toBe("function")
    expect(typeof leaf.applyEdlRenderBudgetMs).toBe("function")
    expect(timeouts.DEFAULT_FFMPEG_TIMEOUT_MS).toBe(10 * 60 * 1000)
  })
})

// audio-sync's runtime (`audio-sync.ts`) pulls ffmpeg-utils and the media
// proxy; the mocks above throw on either, so the registry importing it at all
// would fail this load.
describe("the audio-sync budget leaf", () => {
  it("the registry reaches audio-sync's budget without loading its ffmpeg runtime", async () => {
    const leaf = await import("../../providers/audio/audio-sync-budget.js")
    const registry = await import("../job-budget.js")
    expect(typeof leaf.audioSyncJobBudgetMs).toBe("function")
    expect(registry.BUDGETED_JOB_NAMES).toContain("audio-sync")
  })
})
