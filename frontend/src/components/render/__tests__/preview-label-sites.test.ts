/**
 * The Preview label (A1b, F1) — read from what a take IS, at every surface that
 * lists a render's output:
 *   - the Apply EDL node            → the selected result's stamped `quality`
 *   - an app's output cards         → output-card-preview-sites.test.ts
 *   - My Library and the editor's library browser → the asset's `metadata.quality`
 *     (written by the worker when it records the generated asset)
 * Census (this PR): the public gallery and MCP `browse_gallery` / `list_jobs`
 * never list an Apply EDL output (processing, not a generation), and previews
 * are private; MCP `browse_uploads` lists assets and labels them server-side.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isPreviewQuality } from "../preview-badge"

const SRC = join(__dirname, "..", "..", "..")

describe("isPreviewQuality", () => {
  it("is a Preview only at exactly proxy quality", () => {
    expect(isPreviewQuality({ quality: "proxy" })).toBe(true)
    expect(isPreviewQuality({ quality: "final" })).toBe(false)
    expect(isPreviewQuality({})).toBe(false)
    expect(isPreviewQuality(undefined)).toBe(false)
  })
})

describe("the asset lists label a Preview from the asset itself", () => {
  for (const where of ["app/(dashboard)/library/page.tsx", "components/editor/library-media-browser.tsx"]) {
    it(where, () => {
      const text = readFileSync(join(SRC, where), "utf8")
      expect(text).toMatch(/isPreviewQuality\(asset\.metadata\) && <PreviewBadge/)
    })
  }

  it("the Apply EDL node labels the take on show", () => {
    const text = readFileSync(join(SRC, "components/nodes/apply-edl-node.tsx"), "utf8")
    expect(text).toMatch(/isPreviewQuality\(activeResult\)/)
  })
})
