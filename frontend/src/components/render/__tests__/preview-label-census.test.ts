/**
 * The Preview label's census (decided 2026-10-05): every surface that shows a
 * render result either shows the label or is listed here with the reason it
 * does not. A new surface that shows media through the fullscreen preview, or
 * a new reader of an Apply EDL render, fails here until it says which.
 *
 * Discovery is two greps: files that contain `<MediaPreviewModal` (the fullscreen
 * preview), and every file under the app's own surfaces (components/presentation
 * and components/app-runner) that renders media itself (`<video`, `<audio`,
 * `WaveformAudioPlayer`): the views, the cards, the run slots. Each must be listed.
 *
 * Three kinds of entry:
 *   LABELLED     the surface reads the take's own stamped quality (never the
 *                node's Quality setting) and shows the badge.
 *   EXEMPT       it cannot show a render, with the reason; the reason is checked
 *                where it can be (a file that must not render media, a node that
 *                declares no fullscreen output).
 *   BARE_URL     (EXEMPT, with its own check) it shows a media URL that reached it
 *                over a wire — a component's output, a loop cell, a port, a run's
 *                thumbnail, wired-in media. A URL carries no take stamp, so there
 *                is nothing to label from. Decided 2026-10-06.
 *
 * The backend halves (job reads, library lists, MCP browse_uploads) are held by
 * backend/src/lib/__tests__/render-label-fill-sites.test.ts.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getFocusedNodeMedia } from "@/lib/focused-node-media"

const SRC = join(__dirname, "..", "..", "..")
const read = (where: string): string => readFileSync(join(SRC, where), "utf8")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Surfaces that show the label, with the text that proves each reads it. */
const LABELLED: Record<string, readonly RegExp[]> = {
  // The node, the app output cards and the app's two lightboxes (A1b + this change).
  "components/nodes/apply-edl-node.tsx": [/isPreviewQuality\(/, /<PreviewBadge/],
  "components/presentation/output-card.tsx": [/<PreviewBadge/],
  "components/presentation/output-cards/video-output-card.tsx": [/<PreviewBadge/],
  "components/presentation/output-cards/audio-output-card.tsx": [/<PreviewBadge/],
  "components/presentation/presentation-view.tsx": [/outputIsPreview\(/, /quality=\{lightboxItem\.quality\}/, /^\s+isPreview,$/m],
  "components/app-runner/mobile-app-shell.tsx": [/outputIsPreview\(/, /quality=\{lightboxItem\?\.quality\}/, /^\s+isPreview,$/m],
  // The owner's own gallery view lists Apply EDL renders (round 3, decided 2026-10-06):
  // the server marks a proxy render (`preview`), the card and the lightbox show it.
  // The page renders media outside the auto-discovered directories, so it is listed on purpose.
  "components/gallery/gallery-grid-card.tsx": [/item\.preview/, /<PreviewBadge/],
  "app/gallery/page.tsx": [/selectedItem\.preview/, /<PreviewBadge/],
  // The app's gallery, fullscreen and compare views read `isPreview` (ViewProps)
  // for the take on show; the chat view's frozen-run viewer reads the slot's output.
  "components/presentation/views/gallery-view.tsx": [/isPreview\?\.\(node\.id, result\.url\)/, /<PreviewBadge/],
  "components/presentation/views/fullscreen-view.tsx": [/isPreview\?\.\(node\.id, result\.url\)/, /<PreviewBadge/],
  "components/presentation/views/compare-view.tsx": [/isPreview\?\.\(node\.id, r\.url\)/, /<PreviewBadge/],
  "components/presentation/views/chat-view.tsx": [/isPreview=\{\(nodeId, url\)/, /preview=\{outputIsPreview\(/],
  // The libraries (stored label, else the job's order: backend render-label-fill.ts).
  "app/(dashboard)/library/page.tsx": [/isPreviewQuality\(asset\.metadata\)/, /quality=\{qualityOf\(/],
  "components/editor/library-media-browser.tsx": [/isPreviewQuality\(asset\.metadata\)/, /quality=\{qualityOf\(/],
  // This change: Latest Results, the Executions tab and the fullscreen preview.
  "components/editor/config-panels/results-gallery.tsx": [/isPreviewTake\(nodeType, r\)/, /isPreviewTake\(nodeType, results\[activeIndex\]\)/],
  "components/editor/execution-detail-modal.tsx": [/isPreviewOutput\(job\.job_type, job\.output_data\)/, /isPreviewOutput\(state\.nodeType, state\.output\)/],
  "components/editor/media-preview-modal.tsx": [/isPreviewQuality\(\{ quality \}\)/, /<PreviewBadge/],
}

/** Files that show media through the fullscreen preview and say why they do not
 *  label it. Every `components/nodes/*-node.tsx` not named here falls under
 *  NODE_OWN_RESULTS below. */
const EXEMPT: Record<string, string> = {
  "components/editor/scene-editor-modal.tsx": "previews a scene's own stills and takes; never an Apply EDL render",
  "components/editor/workflow-canvas.tsx": "Alt+F shows the focused node's media; Apply EDL declares no exposable output, so it is never offered (asserted below)",
  "components/presentation/input-cards/loop-input-card.tsx": "an app INPUT the user supplied, not a node's result",
  "components/presentation/input-cards/video-upload-card.tsx": "an app INPUT the user uploaded, not a node's result",
  "components/presentation/input-cards/audio-upload-card.tsx": "an app INPUT the user uploaded, not a node's result",
  "components/presentation/workflow-thumbnail-button.tsx": "the workflow's cover picture the author uploads; never a node's result",
  "components/presentation/output-cards/video-carousel-output.tsx": "the body of a gallery OutputCard, whose header carries the label (output-card.tsx, asserted below)",
  "components/presentation/output-cards/audio-list-output.tsx": "the body of a gallery OutputCard, whose header carries the label (output-card.tsx, asserted below)",
  "components/nodes/results-thumbnails-panel.tsx": "a node's own thumbnail strip; only Apply EDL makes a render and its node does not render the strip (asserted below)",
}

/** A node's own results in its own fullscreen preview: only Apply EDL makes a
 *  render, and its file does not open this modal (asserted below). */
const NODE_OWN_RESULTS = "a node's own result; only Apply EDL makes a render and its node does not use this modal"

/** Surfaces that show a bare URL a wire handed them (decided 2026-10-06): no take
 *  stamp travels with a URL, so they stay unlabelled. Each is checked to still not
 *  label (when one starts to, move it to LABELLED). */
const BARE_URL: Record<string, string> = {
  "components/nodes/component-node.tsx": "shows a bare URL a component hands out; the render's stamp does not travel on a wire",
  "components/nodes/sub-workflow-views/ports-view.tsx": "shows a bare URL on a sub-workflow port; no stamp travels with it",
  "components/nodes/loop-node.tsx": "previews the loop's URL cells; no stamp travels with them",
  "components/nodes/preview-node.tsx": "the Preview node collects upstream items as bare URLs (A1b's output-card census already exempts its cards)",
  "components/app-runner/run-slot-item.tsx": "a run's 44px thumbnail in the runs list: the first image or video output of the run, a bare URL with no take stamp on the slot",
  "components/editor/config-panels/connected-media-list.tsx": "thumbnails of the media wired INTO a node: bare URLs of upstream results",
}

describe("Preview label census", () => {
  it("every labelled surface reads the take's own stamp and shows the badge", () => {
    for (const [where, patterns] of Object.entries(LABELLED)) {
      expect(existsSync(join(SRC, where)), `${where} no longer exists: update the census`).toBe(true)
      const text = read(where)
      for (const re of patterns) expect(text, `${where} no longer matches ${re}`).toMatch(re)
    }
  })

  it("every surface that opens the fullscreen media preview is labelled or exempt", () => {
    const callers = sourceFiles(SRC)
      .filter((f) => /<MediaPreviewModal\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
    const unlisted = callers.filter((c) => {
      if (c in LABELLED || c in EXEMPT || c in BARE_URL) return false
      return !(/^components\/nodes\/[^/]+-node\.tsx$/.test(c))
    })
    expect(unlisted, "a surface opens the media preview without saying whether it labels a Preview").toEqual([])
    for (const where of [...Object.keys(EXEMPT), ...Object.keys(BARE_URL)]) {
      expect(existsSync(join(SRC, where)), `${where} no longer exists: update the census`).toBe(true)
    }
  })

  it("every surface of the app that renders media itself is labelled or exempt", () => {
    const rendersMedia = /<video\b|<audio\b|<WaveformAudioPlayer\b/
    const surfaces = [...sourceFiles(join(SRC, "components", "presentation")), ...sourceFiles(join(SRC, "components", "app-runner"))]
      .filter((f) => rendersMedia.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
    expect(surfaces.length, "the discovery found nothing: the grep is broken").toBeGreaterThan(5)
    const unlisted = surfaces.filter((c) => !(c in LABELLED || c in EXEMPT || c in BARE_URL))
    expect(unlisted, "a surface renders media without saying whether it labels a Preview").toEqual([])
  })

  it("the reasons that can be checked, are", () => {
    // The gallery card body is framed by an OutputCard that carries the label.
    expect(read("components/presentation/output-card.tsx")).toMatch(/<PreviewBadge/)
    // Apply EDL's node renders no thumbnail strip.
    expect(read("components/nodes/apply-edl-node.tsx")).not.toMatch(/ResultsThumbnailsPanel/)
    // Apply EDL's node never opens the fullscreen preview (so NODE_OWN_RESULTS holds).
    expect(read("components/nodes/apply-edl-node.tsx")).not.toMatch(/<MediaPreviewModal\b/)
    expect(NODE_OWN_RESULTS).toBeTruthy()
    // Alt+F is never offered for Apply EDL: it declares no exposable output.
    expect(getFocusedNodeMedia({ type: "apply-edl", data: { generatedResults: [{ url: "https://m/cut.mp4", quality: "proxy" }] } })).toBeNull()
  })

  it("the Executions list rows show no media of their own: they open the labelled detail modal", () => {
    for (const where of ["components/editor/executions-tab.tsx", "app/(dashboard)/executions/page.tsx"]) {
      const text = read(where)
      expect(text, `${where} opens the job detail`).toMatch(/<ExecutionDetailModal/)
      expect(text, `${where} renders media itself: label it`).not.toMatch(/<video\b|<CachedImage\b|<img\b|<audio\b/)
    }
  })

  it("every bare-URL surface still does not label (when one starts to, move it to LABELLED)", () => {
    for (const where of Object.keys(BARE_URL)) {
      expect(read(where), `${where} labels a Preview now: move it to LABELLED`).not.toMatch(/PreviewBadge|isPreviewQuality|isPreviewOutput/)
    }
  })
})
