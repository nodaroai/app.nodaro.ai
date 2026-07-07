import { describe, it, expect, vi, beforeAll } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock().
//
// `buildToolkit()` (unlike `load.ts`) has no injection points — it always
// imports its own real modules. Per the task brief: toolkit.ts itself MUST
// import the real `lib/supabase.js` / `lib/queue.js` (that's the point of
// this test — proving the REAL client/queue satisfy the contract), but
// mocking those two modules' IMPLEMENTATIONS here is fine and necessary:
// `lib/queue.ts` opens a real IORedis connection at module-eval time, and
// `lib/supabase.ts` constructs a real client — neither should touch the
// network in a unit test. This mirrors the established convention used
// throughout backend/src (e.g. `workers/__tests__/shared.test.ts`,
// `workers/handlers/__tests__/audio-ai.test.ts`): mock supabase.js/queue.js,
// leave the rest of the module graph real.
// ---------------------------------------------------------------------------

const { mockFrom, mockAdd } = vi.hoisted(() => {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
  const mockAdd = vi.fn().mockResolvedValue({ id: "bull-job-1" })
  return { mockFrom, mockAdd }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockAdd } }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"
import { safeFetch } from "../../safe-fetch.js"
import { applyImageWatermark } from "../../../utils/watermark.js"

describe("buildToolkit", () => {
  let tk: PluginToolkit

  beforeAll(() => {
    tk = buildToolkit()
  })

  // -------------------------------------------------------------------------
  // Step 1 (brief): walk every leaf of the PluginToolkit shape — each member
  // defined (fn or value), no undefined. One assertion group per toolkit
  // group so a failure pinpoints exactly which group/member regressed.
  // -------------------------------------------------------------------------

  it("providers: every member is a function", () => {
    expect(typeof tk.providers.directVoiceChanger).toBe("function")
    expect(typeof tk.providers.separateAudio).toBe("function")
  })

  it("ffmpeg: every member is a function", () => {
    expect(typeof tk.ffmpeg.runFfmpeg).toBe("function")
    expect(typeof tk.ffmpeg.runFfmpegCapture).toBe("function")
    expect(typeof tk.ffmpeg.createWorkDir).toBe("function")
    expect(typeof tk.ffmpeg.cleanupWorkDir).toBe("function")
    expect(typeof tk.ffmpeg.downloadFile).toBe("function")
  })

  it("media: every member is a function", () => {
    expect(typeof tk.media.extractAudio).toBe("function")
    expect(typeof tk.media.mixAudio).toBe("function")
    expect(typeof tk.media.mergeVideoAudio).toBe("function")
    expect(typeof tk.media.applyAudioFx).toBe("function")
    expect(typeof tk.media.applyImageWatermark).toBe("function")
  })

  it("storage: every member is a function", () => {
    expect(typeof tk.storage.uploadBufferToR2).toBe("function")
    expect(typeof tk.storage.uploadFileToR2).toBe("function")
    expect(typeof tk.storage.runPostProcessing).toBe("function")
  })

  it("jobs: every member is a function", () => {
    expect(typeof tk.jobs.markJobCompleted).toBe("function")
    expect(typeof tk.jobs.setJobProgress).toBe("function")
    expect(typeof tk.jobs.withProgressRamp).toBe("function")
    expect(typeof tk.jobs.commitJobCredits).toBe("function")
  })

  it("http: function members are functions, value members are defined objects", () => {
    expect(typeof tk.http.creditGuard).toBe("function")
    expect(typeof tk.http.reserveCreditsForJob).toBe("function")
    expect(typeof tk.http.extractWorkflowId).toBe("function")
    expect(typeof tk.http.extractNodeId).toBe("function")
    expect(typeof tk.http.extractForcePrivate).toBe("function")
    expect(typeof tk.http.extractMcpClient).toBe("function")
    expect(typeof tk.http.buildJobInputData).toBe("function")
    expect(typeof tk.http.formatZodError).toBe("function")
    expect(typeof tk.http.safeFetch).toBe("function")
    // Value (non-function) members: must exist, not be undefined.
    expect(tk.http.supabase).toBeDefined()
    expect(tk.http.videoQueue).toBeDefined()
    expect(tk.http.safeUrlSchema).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // Task-2 carry-forward FIRST-CLASS check: the real supabase client and the
  // real videoQueue are structurally assignable to the contract types. The
  // primary check is compile-time — this file typechecking (`tsc --noEmit`)
  // IS the proof that `lib/supabase.ts`'s `supabase` and `lib/queue.ts`'s
  // `videoQueue` satisfy `PluginSupabaseClient` / the toolkit's `videoQueue`
  // shape. This is the runtime smoke half: the wiring actually surfaces a
  // `.from`/`.add` method (i.e. toolkit.ts didn't drop/alias the reference).
  // -------------------------------------------------------------------------

  it("Task-2 carry-forward: real supabase client and real videoQueue are wired through (runtime smoke)", () => {
    expect(typeof tk.http.supabase.from).toBe("function")
    expect(typeof tk.http.videoQueue.add).toBe("function")
  })

  // -------------------------------------------------------------------------
  // S8 plumbing: safeFetch (PluginHttpToolkit) + applyImageWatermark
  // (PluginMediaToolkit) are direct references to the real functions — no
  // wrapping needed since both real signatures already match the contract.
  // -------------------------------------------------------------------------

  it("S8 plumbing: tk.http.safeFetch and tk.media.applyImageWatermark are the real imported functions", () => {
    expect(tk.http.safeFetch).toBe(safeFetch)
    expect(tk.media.applyImageWatermark).toBe(applyImageWatermark)
  })

  // -------------------------------------------------------------------------
  // Full-shape walk: no leaf across any group is undefined. This is the
  // general form of the brief's Step 1 requirement — the per-group tests
  // above pin down WHICH member regresses; this one guards against a new
  // member silently being added to PluginToolkit without a matching
  // assertion ever being added above (it still enumerates whatever
  // buildToolkit() actually returns, so it can't miss a real leaf).
  // -------------------------------------------------------------------------

  it("walks every leaf of every group with no undefined values", () => {
    // `object` (not `Record<string, unknown>`): each toolkit group is a
    // concrete method-shaped interface with no index signature, so it isn't
    // assignable to `Record<string, unknown>` — but every real object is
    // assignable to `object`, and `Object.entries` still enumerates it fine.
    const groups: Record<string, object> = {
      providers: tk.providers,
      ffmpeg: tk.ffmpeg,
      media: tk.media,
      storage: tk.storage,
      jobs: tk.jobs,
      http: tk.http,
    }
    for (const [groupName, group] of Object.entries(groups)) {
      expect(group, `group "${groupName}" must not be undefined`).toBeDefined()
      for (const [key, value] of Object.entries(group)) {
        expect(value, `${groupName}.${key} must not be undefined`).not.toBeUndefined()
      }
    }
  })
})
