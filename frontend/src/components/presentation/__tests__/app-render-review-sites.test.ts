/**
 * Render final in the app runner (A6.3, decided 2026-10-04) reaches every
 * surface that shows an app run's output cards: the Run tab and Presentation
 * (the presentation view, in the app runner page and the embed page) and the
 * mobile shell. One provider (`AppRenderReviewProvider`), read by the ONE
 * output card; a new surface fails here until it is wired.
 *
 * - every `<OutputCard` names its node's type (`RENDER_REVIEW_TYPES` is asked
 *   of it — a card without one could never carry Render final);
 * - every page that mounts the presentation view or the mobile shell for an
 *   app run mounts the provider around it;
 * - the surfaces that fall back to the creator's snapshot output for a node
 *   with no result first ask whether the node waited for Render final;
 * - `RENDER_REVIEW_TYPES` is the render registry, never a hand-kept list.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PREVIEW_RENDER_NODE_TYPES, RENDER_NODE_TYPE_IDS } from "@nodaro/shared"
import { RENDER_REVIEW_TYPES } from "@/components/render/app-render-review"

const SRC = join(__dirname, "..", "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

/** Each `<OutputCard … />` element's own text. */
function cards(text: string): string[] {
  const out: string[] = []
  let at = text.indexOf("<OutputCard")
  while (at >= 0) {
    const end = text.indexOf("/>", at)
    out.push(text.slice(at, end))
    at = text.indexOf("<OutputCard", end)
  }
  return out
}

const CARD_SITES = [
  "components/presentation/presentation-view.tsx",
  "components/app-runner/mobile-app-shell.tsx",
  "components/presentation/views/chat-view.tsx",
]

describe("Render final in the app runner — every surface is wired", () => {
  it("RENDER_REVIEW_TYPES is the render registry", () => {
    expect([...RENDER_REVIEW_TYPES].sort()).toEqual([...RENDER_NODE_TYPE_IDS].sort())
    expect(RENDER_REVIEW_TYPES).toBe(PREVIEW_RENDER_NODE_TYPES)
  })

  it.each(CARD_SITES)("%s: every OutputCard names its node type", (rel) => {
    const found = cards(read(rel))
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((c) => !/\bnodeType=\{/.test(c))).toEqual([])
  })

  it("the chat thread scopes each card to its own run", () => {
    expect(cards(read("components/presentation/views/chat-view.tsx")).filter((c) => !/\brunId=\{slot\.id\}/.test(c))).toEqual([])
  })

  it("the output card reads the review and shows a waiting card instead of any output", () => {
    const src = read("components/presentation/output-card.tsx")
    expect(src).toMatch(/useAppRenderReview\(nodeId, nodeType, runId\)/)
    expect(src.indexOf('review?.kind === "gated"')).toBeGreaterThan(-1)
    // Asked before any media card is built.
    expect(src.indexOf('review?.kind === "gated"')).toBeLessThan(src.indexOf("<GalleryOutputCard"))
  })

  it.each([
    ["routes/app-runner-page.tsx", ["<MobileAppShell", "<PresentationView"]],
    ["routes/embed-page.tsx", ["<PresentationView"]],
  ])("%s mounts the provider around its app surfaces", (rel, surfaces) => {
    const src = read(rel)
    expect(src).toContain("AppRenderReviewProvider")
    for (const surface of surfaces as string[]) {
      const at = src.indexOf(surface)
      expect(at, surface).toBeGreaterThan(-1)
      const before = src.slice(0, at)
      // Inside the provider: opened before the surface (directly, or through the page's `withReview`).
      expect(before.lastIndexOf("withReview(") > -1 || before.lastIndexOf("<AppRenderReviewProvider") > -1, surface).toBe(true)
    }
  })

  it.each(["components/presentation/presentation-view.tsx", "components/app-runner/mobile-app-shell.tsx"])(
    "%s asks the gate before any snapshot fallback",
    (rel) => {
      const src = read(rel)
      const fn = src.slice(src.indexOf("const getFullscreenResult = useCallback("))
      const gate = fn.indexOf("gatedNodeIds?.has(nodeId)")
      expect(gate).toBeGreaterThan(-1)
      expect(gate).toBeLessThan(fn.indexOf("getNodeResultWithInputFallback(node)"))
    },
  )
})
