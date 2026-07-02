import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const files = ["subtitle-overlay", "karaoke-overlay", "word-highlight-overlay", "word-pop-overlay",
  "bouncy-overlay", "tiktok-pages-overlay", "scene-text-segment", "text-overlay"]

describe("overlays are RTL-wired", () => {
  it.each(files)("%s.tsx imports directionStyle", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("directionStyle")
  })
})
