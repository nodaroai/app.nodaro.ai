// @vitest-environment node
// @test-watches frontend/src/**/*.ts frontend/src/**/*.tsx
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * EVERY DOWNLOAD DECIDES WHETHER IT IS A VIDEO RESULT'S (decided 2026-11-22:
 * Download gives the kept original).
 *
 * A video result's Download must go through `lib/video-result-download.ts`,
 * which asks the server for the original kept beside the preview a surface
 * plays. There is no single place a browser download starts — each surface
 * builds its own link — so this guard holds every one of them, the way the
 * backend's trash-read guard holds every `jobs` read: each line that starts a
 * download (a `download=1` proxy link, a `/v1/download` link, a link's
 * `download` attribute set in code or in JSX, a `downloadFile(` call) outside
 * the helper module must either sit in a handler that routes a video through
 * the helper (a helper call within a few lines of it), or carry a
 * `download-site: <why>` comment just above it saying why it is not a video
 * result's (an image, a sound, a JSON export, an admin's review copy).
 *
 * A new download anywhere therefore fails here until it decides.
 */

const SRC = path.resolve(__dirname, "../..")
const HELPER_MODULE = path.join("lib", "video-result-download.ts")

/** A line that starts a browser download. */
const SITE = new RegExp(
  [
    String.raw`download=1`,
    String.raw`/v1/download(?![-\w])`,
    String.raw`\.download\s*=(?!=)`,
    // A JSX `download` attribute with a value (a boolean prop of a player is no link).
    String.raw`\bdownload=\{(?!\s*(?:true|false)\s*\})`,
    String.raw`<a\b[^>]*\sdownload(?=[\s>=/])`,
    String.raw`^\s*download\s*$`,
    // A call (its definition is no download: its body's link is the site).
    String.raw`(?<!function )\bdownloadFile\(`,
  ].join("|"),
)

/** A call into the helper module. */
const HELPER_CALL = /\b(?:downloadVideoFile|openVideoDownload|fetchVideoDownload|videoDownloadHref|videoDownloadLinkProps|isStoredVideoAddress)\(/

/** The reasoned marker of a site that is not a video result's. */
const MARKER = /download-site:\s*\S/

/** How far a helper call may sit from the site in the same handler (its fallback closure, its two branches). */
const HANDLER_REACH = 8
/** How far above a site its marker may sit. */
const MARKER_REACH = 3

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      sourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

interface Site {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly decided: boolean
}

/** Every download site outside the helper module, and whether it decided. */
function downloadSites(): Site[] {
  const sites: Site[] = []
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file)
    if (rel === HELPER_MODULE) continue
    const lines = fs.readFileSync(file, "utf8").split("\n")
    lines.forEach((text, i) => {
      if (!SITE.test(text)) return
      // A comment that mentions one is no site.
      if (/^\s*(?:\/\/|\*|\/\*)/.test(text)) return
      const near = lines.slice(Math.max(0, i - HANDLER_REACH), i + HANDLER_REACH + 1).join("\n")
      const above = lines.slice(Math.max(0, i - MARKER_REACH), i + 1).join("\n")
      sites.push({ file: rel, line: i + 1, text: text.trim(), decided: HELPER_CALL.test(near) || MARKER.test(above) })
    })
  }
  return sites
}

describe("every download decides whether it is a video result's", () => {
  const sites = downloadSites()

  it("finds the download sites (the scan works)", () => {
    // The canvas nodes alone hold dozens; a scan that finds a handful is broken.
    expect(sites.length).toBeGreaterThan(40)
    expect(sites.some((s) => s.file === path.join("components", "nodes", "generate-image-node.tsx"))).toBe(true)
  })

  it("each one routes a video through lib/video-result-download.ts, or says why it is not a video result's", () => {
    const undecided = sites.filter((s) => !s.decided).map((s) => `${s.file}:${s.line}  ${s.text.slice(0, 140)}`)
    expect(undecided, "route a video result's Download through lib/video-result-download.ts, or mark the line `download-site: <why it is not a video result>`").toEqual([])
  })

  it("no video Download names its file `.mp4` by hand through the proxy (the original may be .mov, .webm or .mkv)", () => {
    const handNamed = sites.filter((s) => /download=1|\/v1\/download/.test(s.text) && /\.mp4|video/i.test(s.text))
    expect(handNamed.map((s) => `${s.file}:${s.line}`)).toEqual([])
  })

  it("the video surfaces of the app use the helper", () => {
    const VIDEO_SURFACES = [
      "components/nodes/generate-video-node.tsx",
      "components/nodes/video-result-overlay.tsx",
      "components/nodes/video-unplayable-notice.tsx",
      "components/nodes/pro-clip-downloads.tsx",
      "components/nodes/loop-node.tsx",
      "components/nodes/component-node.tsx",
      "components/editor/library-media-browser.tsx",
      "components/editor/execution-detail-modal.tsx",
      "components/editor/iteration-results-panel.tsx",
      "components/editor/config-panels/results-gallery.tsx",
      "components/editor/config-panels/utility-configs.tsx",
      "components/editor/config-panels/processing-configs.tsx",
      "components/presentation/output-cards/video-output-card.tsx",
      "components/presentation/output-cards/action-bar.tsx",
      "components/presentation/views/chat-view.tsx",
      "app/gallery/page.tsx",
    ]
    const missing = VIDEO_SURFACES.filter((rel) => !HELPER_CALL.test(fs.readFileSync(path.join(SRC, rel), "utf8")))
    expect(missing).toEqual([])
  })
})
