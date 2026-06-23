import vm from "node:vm"
import { describe, it, expect } from "vitest"
import { buildSingleJobWidget } from "../widgets/single-job.js"
import { buildWorkflowWidgetTemplate } from "../widgets/workflow.js"
import { buildGalleryWidgetTemplate } from "../widgets/gallery.js"
import { buildAppRunWidgetTemplate } from "../widgets/app-run.js"
import { buildUploadWidget } from "../widgets/upload.js"

// Regression guard for the "single-job widget stuck on Initializing…" outage.
//
// The widgets are HTML strings built inside TS template literals, then served
// to Claude.ai which writes them into a sandboxed iframe. A SINGLE malformed
// JS string in the inline <script> — e.g. an unescaped apostrophe, or a `\'`
// that collapses to a bare `'` inside the template literal ('Couldn\'t' →
// 'Couldn't') — is a fatal SyntaxError. The browser then fails to parse the
// ENTIRE <script>, so none of the widget JS runs: no handshake, no
// tool-result handling, no fallback — the card freezes on "Initializing…"
// forever, and the host logs "Failed to execute 'write' on 'Document'".
//
// tsc does NOT catch this: the bug only exists in the *rendered* string, not
// in the TS source. So compile each rendered inline script here. `new
// vm.Script(code)` PARSES/compiles without executing (it never runs the IIFE,
// so undefined globals like `window`/`document` are irrelevant), throwing on
// any syntax error. The input is our own first-party widget code built from
// repo source — not untrusted/interpolated input.

function scriptBlocks(html: string): string[] {
  const blocks: string[] = []
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const body = (m[1] ?? "").trim()
    if (body) blocks.push(body)
  }
  return blocks
}

const WIDGETS: Array<[string, string]> = [
  ["job-image", buildSingleJobWidget("image")],
  ["job-video", buildSingleJobWidget("video")],
  ["job-audio", buildSingleJobWidget("audio")],
  ["job-generic", buildSingleJobWidget("generic")],
  ["workflow", buildWorkflowWidgetTemplate()],
  ["gallery", buildGalleryWidgetTemplate()],
  ["app-run", buildAppRunWidgetTemplate()],
  ["upload-image", buildUploadWidget("image")],
  ["upload-audio", buildUploadWidget("audio")],
  ["upload-video", buildUploadWidget("video")],
]

describe("every MCP widget ships syntactically valid inline JS", () => {
  for (const [name, html] of WIDGETS) {
    it(`${name}: every inline <script> compiles`, () => {
      const blocks = scriptBlocks(html)
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        // Parse-only: throws SyntaxError if the rendered JS is malformed.
        // Never executed, so the IIFE's window/document refs don't run.
        expect(() => new vm.Script(block)).not.toThrow()
      }
    })
  }
})
