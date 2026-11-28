import vm from "node:vm"
import { describe, expect, it } from "vitest"
import { downloadLinkShim } from "../_common.js"
import { buildSingleJobWidget } from "../single-job.js"
import { buildJobAutoWidget } from "../job-auto.js"
import { buildGalleryWidgetTemplate } from "../gallery.js"
import { buildAppRunWidgetTemplate } from "../app-run.js"

/**
 * A widget's Download of a video result (decided 2026-11-22: Download gives
 * the original video file). The widget holds the playable address only, so
 * its Download opens the app's download route, which saves the original kept
 * beside it when its job names one and otherwise sends the tab on to the
 * file itself — what the button opened before. Every other address is opened
 * as it always was.
 */

const PAGES = "https://app.example.test"
const JOB = "11111111-2222-4333-8444-555555555555"
const PREVIEW = `https://cdn.example.test/videos/${JOB}.mp4`

/** Run the shim and hand back the function it defines. */
function downloadUrlOf(pagesBase: string, storageOrigins: readonly string[] = ["https://cdn.example.test"]): (url: string) => string {
  const script = /<script>([\s\S]*?)<\/script>/.exec(downloadLinkShim(pagesBase, storageOrigins))![1]!
  const window: { resultDownloadUrl?: (url: string) => string } = {}
  vm.runInNewContext(script, { window, URL, encodeURIComponent })
  return window.resultDownloadUrl!
}

describe("a widget's Download link", () => {
  const link = downloadUrlOf(`${PAGES}/`)

  it("a stored video result opens the app's download route, asking for the original", () => {
    expect(link(PREVIEW)).toBe(`${PAGES}/v1/download?url=${encodeURIComponent(PREVIEW)}&original=1&open=1`)
    const original = `https://cdn.example.test/videos/${JOB}-master.mov`
    expect(link(original)).toBe(`${PAGES}/v1/download?url=${encodeURIComponent(original)}&original=1&open=1`)
  })

  it("anything else is opened as before: an image, a sound, an upload, a plain http address, no address", () => {
    for (const url of [
      `https://cdn.example.test/images/${JOB}.png`,
      `https://cdn.example.test/audio/${JOB}.mp3`,
      "https://cdn.example.test/uploads/u1/clip.mp4",
      `http://localhost:3000/storage/nodaro-assets/videos/${JOB}.mp4`,
      "not a url",
    ]) {
      expect(link(url)).toBe(url)
    }
  })

  it("only a video on the deployment's own storage, with a path headed by a job id, goes to the route", () => {
    expect(link(`https://other.example.test/videos/${JOB}.mp4`)).toBe(`https://other.example.test/videos/${JOB}.mp4`)
    expect(link(`https://cdn.example.test.evil.test/videos/${JOB}.mp4`)).toBe(`https://cdn.example.test.evil.test/videos/${JOB}.mp4`)
    expect(link("https://cdn.example.test/videos/clip.mp4")).toBe("https://cdn.example.test/videos/clip.mp4")
    // A deployment whose storage is on plain http (no origin the route accepts): nothing goes to the route.
    expect(downloadUrlOf(PAGES, [])(PREVIEW)).toBe(PREVIEW)
  })

  it.each([
    ["job card", buildSingleJobWidget("video", PAGES)],
    ["universal job card", buildJobAutoWidget(PAGES)],
    ["gallery", buildGalleryWidgetTemplate(PAGES)],
    ["app run", buildAppRunWidgetTemplate(PAGES)],
  ])("the %s widget carries the link and every Download goes through it", (_name, html) => {
    expect(html).toContain(`${PAGES}/v1/download`)
    // No Download opens a raw address any more.
    expect(html).not.toMatch(/openLink\((?:item\.assetUrl|item\.value|state\.outputUrl)\)/)
    expect(html).toContain("resultDownloadUrl(")
  })
})
