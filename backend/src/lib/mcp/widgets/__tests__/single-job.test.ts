import { describe, it, expect } from "vitest"
import { buildImageWidget, buildVideoWidget, buildAudioWidget } from "../single-job.js"

describe("single-job widget snapshots", () => {
  it("image widget — no output yet", () => {
    const html = buildImageWidget({
      jobId: "j-1",
      prompt: "test",
      model: "nano-banana",
      aspectRatio: "16:9",
    })
    expect(html).toContain("window.__INIT__")
    expect(html).toContain("Open in Nodaro")
    expect(html).toMatchSnapshot()
  })

  it("does NOT contain innerHTML usage in runtime JS (safe DOM only)", () => {
    const widgets = [
      buildImageWidget({ jobId: "j-1", prompt: "test", model: "flux", aspectRatio: "1:1" }),
      buildVideoWidget({ jobId: "j-2", prompt: "test", model: "veo3" }),
      buildAudioWidget({ jobId: "j-3", prompt: "test", model: "suno-v5" }),
    ]
    for (const html of widgets) {
      const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
      for (const block of scriptBlocks) {
        expect(block).not.toMatch(/\.innerHTML\s*=/)
      }
    }
  })

  it("escapes user prompt to prevent JSON breakout", () => {
    const html = buildImageWidget({
      jobId: "j-1",
      prompt: "</script><script>alert(1)</script>",
      model: "flux",
      aspectRatio: "1:1",
    })
    const initSegment = html.match(/window\.__INIT__\s*=\s*[^;]+;/)?.[0] ?? ""
    expect(initSegment).not.toMatch(/<\/script>(?!<\\)/i)
  })
})
