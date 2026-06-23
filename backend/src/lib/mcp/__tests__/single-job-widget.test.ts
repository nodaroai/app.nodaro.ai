import { describe, it, expect } from "vitest"
import { buildSingleJobWidget } from "../widgets/single-job.js"

// Regression guard for the stuck-card recovery path. The single-job widget
// only advances when the host delivers tool-result; if Claude.ai never does
// (rejected ui/initialize handshake / dropped notification), the card must
// NOT sit on "Initializing…" forever — after a grace period it surfaces a
// library link so the user can still reach the finished result.
describe("single-job widget stuck-card recovery", () => {
  for (const kind of ["image", "video", "audio", "generic"] as const) {
    const html = buildSingleJobWidget(kind)

    it(`${kind}: includes the no-tool-result grace fallback`, () => {
      // The flag the recovery timer checks, the grace delay, and the CTA.
      expect(html).toContain("sawToolResult")
      expect(html).toContain("15000")
      expect(html).toContain("Open Nodaro library")
      expect(html).toContain("https://app.nodaro.ai/gallery")
    })

    it(`${kind}: recovery is gated so it never fires once a result/url exists`, () => {
      // Must early-return when a tool-result arrived OR media is already shown,
      // otherwise it would clobber a working widget.
      expect(html).toContain("if (sawToolResult || state.outputUrl) return;")
    })

    it(`${kind}: stays free of template-literal interpolation leaks`, () => {
      // The widget JS lives inside a TS template literal — a stray "${" would
      // mean an unescaped interpolation shipped to the browser.
      expect(html).not.toContain("${")
    })
  }
})
