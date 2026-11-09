/**
 * `tk.imports` — the deployment's switch for links to outside content, for the
 * links a plugin route fetches itself or hands to a provider: the same answer
 * the platform's own import routes give (lib/link-imports.ts), read at call
 * time. A refusal is a `PluginHttpError` the route sends verbatim (403
 * link_imports_disabled); own media passes; with the switch on, nothing is
 * read. The toolkit's own metadata probes ask the switch too, so a plugin that
 * has not adopted `tk.imports` still reaches no outside site from them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const yt = vi.hoisted(() => ({
  ytMetadataProbe: vi.fn(),
  probeSocialPostVideo: vi.fn(),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/providers/video/youtube-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/youtube-video.js")>()),
  ytMetadataProbe: yt.ytMetadataProbe,
}))
vi.mock("@/providers/video/social-post-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/social-post-video.js")>()),
  probeSocialPostVideo: yt.probeSocialPostVideo,
}))

import { buildToolkit } from "../toolkit.js"
import { OWN_MEDIA_URL, withLinkImportsOff } from "@/test/link-imports-off.js"

const OUTSIDE = "https://example.com/talk.mp4"

function imports() {
  const member = buildToolkit().imports
  expect(member).toBeDefined()
  return member!
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe("tk.imports", () => {
  it("allows everything while the switch is on: nothing refused", () => {
    expect(imports().linksAllowed()).toBe(true)
    expect(() => imports().assertLinkAllowed(OUTSIDE)).not.toThrow()
  })

  describe("on a deployment that turned link imports off", () => {
    withLinkImportsOff()

    it("linksAllowed answers false", () => {
      expect(imports().linksAllowed()).toBe(false)
    })

    it("a link to outside content throws a PluginHttpError the route sends verbatim", () => {
      let refusal: unknown
      try {
        imports().assertLinkAllowed(OUTSIDE)
      } catch (e) {
        refusal = e
      }
      expect(refusal).toMatchObject({ name: "PluginHttpError", statusCode: 403, body: { error: { code: "link_imports_disabled" } } })
      expect((refusal as { body: { error: { message: string } } }).body.error.message).toBeTruthy()
    })

    it("a file of this deployment's own storage passes", () => {
      expect(() => imports().assertLinkAllowed(OWN_MEDIA_URL)).not.toThrow()
    })

    it("the toolkit's metadata probes refuse first, and reach no site", async () => {
      const tk = buildToolkit()
      const refused = { name: "PluginHttpError", statusCode: 403, body: { error: { code: "link_imports_disabled" } } }
      await expect(tk.providers.ytMetadataProbe(OUTSIDE)).rejects.toMatchObject(refused)
      await expect(tk.providers.probeSocialPostVideo!("https://www.tiktok.com/@a/video/1")).rejects.toMatchObject(refused)
      expect(yt.ytMetadataProbe).not.toHaveBeenCalled()
      expect(yt.probeSocialPostVideo).not.toHaveBeenCalled()
    })
  })

  it("the toolkit's probes run with the switch on", async () => {
    yt.ytMetadataProbe.mockResolvedValue({ durationSec: 1, title: null, isLive: false })
    await buildToolkit().providers.ytMetadataProbe(OUTSIDE)
    expect(yt.ytMetadataProbe).toHaveBeenCalledWith(OUTSIDE)
  })
})
