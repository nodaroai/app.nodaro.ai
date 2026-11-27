// @test-reads-none a mock factory; reads no file
/**
 * A stand-in for `../editing-source.js` in a provider's unit test that mocks
 * `../ffmpeg-utils.js` and sequences its probes: each door downloads the url
 * as given through the (mocked) `downloadFile`, as a plain read did, and
 * probes nothing — so the provider's own probes keep their order. What the
 * doors themselves do is `editing-source.test.ts`'s.
 *
 *   vi.mock("../editing-source.js", async () => (await import("./editing-source-passthrough.js")).editingSourcePassthrough())
 */
export async function editingSourcePassthrough(): Promise<Record<string, unknown>> {
  const { vi } = await import("vitest")
  const { downloadFile } = await import("../ffmpeg-utils.js")
  const read = async (url: string, dest: string, opts?: { download?: Parameters<typeof downloadFile>[2] }) => {
    await (opts?.download ? downloadFile(url, dest, opts.download) : downloadFile(url, dest))
  }
  return {
    EDITING_SOURCE_BUDGET_MS: 15 * 60 * 1000,
    // Spies, so a test can tell which reads went through a door.
    downloadEditingSource: vi.fn(async (url: string, dest: string, opts?: { download?: Parameters<typeof downloadFile>[2] }) => {
      await read(url, dest, opts)
      return { origin: "as-given", toneMapped: false }
    }),
    downloadVideoSource: vi.fn(async (url: string, dest: string, opts?: { download?: Parameters<typeof downloadFile>[2] }) => {
      await read(url, dest, opts)
      return { origin: "as-given" }
    }),
  }
}
