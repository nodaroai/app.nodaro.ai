import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `tk.storage.uploadFileToR2` takes `{ uncounted: true }`
 * (`PluginUploadFileOptions`, advertised as `tk.capabilities.uncountedUploads`):
 * only that option reaches the host's `uploadFileToR2` (lib/storage.ts,
 * UNCOUNTED FILES); a plugin that passes none uploads exactly as before.
 */
const st = vi.hoisted(() => ({ uploadFileToR2: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage.js")>()),
  uploadFileToR2: st.uploadFileToR2,
}))

const { buildToolkit } = await import("../toolkit.js")
const JOB = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  st.uploadFileToR2.mockReset()
  st.uploadFileToR2.mockResolvedValue(`https://cdn.example/videos/${JOB}-engine.mp4`)
})

describe("tk.storage.uploadFileToR2", () => {
  it("without options: as before (the user id charged, no option passed on)", async () => {
    await buildToolkit().storage.uploadFileToR2("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1")
    expect(st.uploadFileToR2).toHaveBeenCalledWith("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1", {})
  })

  it("hands on uncounted — and nothing else a plugin might put in", async () => {
    const opts = { uncounted: true, ext: "mov", signal: new AbortController().signal } as unknown as { uncounted: boolean }
    await expect(buildToolkit().storage.uploadFileToR2("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1", opts)).resolves.toBe(`https://cdn.example/videos/${JOB}-engine.mp4`)
    expect(st.uploadFileToR2).toHaveBeenCalledWith("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1", { uncounted: true })
  })

  it("anything but uncounted: true is a counted upload", async () => {
    await buildToolkit().storage.uploadFileToR2("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1", { uncounted: "yes" } as unknown as { uncounted: boolean })
    expect(st.uploadFileToR2).toHaveBeenCalledWith("/tmp/e.mp4", `${JOB}-engine`, "video", "user-1", {})
  })
})
