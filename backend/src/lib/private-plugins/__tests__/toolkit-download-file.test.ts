import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `tk.ffmpeg.downloadFile` takes optional bounds (`PluginDownloadFileOptions`,
 * advertised as `tk.capabilities.downloadFileBounds`): only `timeoutMs` and
 * `signal` reach the host's `downloadFile`; a plugin that passes none keeps
 * the host's defaults.
 */
const dl = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  downloadFile: dl.downloadFile,
}))

const { buildToolkit } = await import("../toolkit.js")

beforeEach(() => {
  dl.downloadFile.mockReset()
  dl.downloadFile.mockResolvedValue(undefined)
})

describe("tk.ffmpeg.downloadFile", () => {
  it("without options: the host's defaults (nothing passed on)", async () => {
    await buildToolkit().ffmpeg.downloadFile("https://files.example.test/a.mp4", "/tmp/a.mp4")
    expect(dl.downloadFile).toHaveBeenCalledWith("https://files.example.test/a.mp4", "/tmp/a.mp4", {})
  })

  it("hands on its timeoutMs and signal — and nothing else a plugin might put in", async () => {
    const stop = new AbortController()
    const opts = { timeoutMs: 90_000, signal: stop.signal, limits: { maxMs: 1 }, maxBytes: 1 } as unknown as { timeoutMs: number; signal: AbortSignal }
    await buildToolkit().ffmpeg.downloadFile("https://files.example.test/a.mp4", "/tmp/a.mp4", opts)
    expect(dl.downloadFile).toHaveBeenCalledWith("https://files.example.test/a.mp4", "/tmp/a.mp4", { timeoutMs: 90_000, signal: stop.signal })
  })
})
