/**
 * The podcast templates' Preview is gated in code (decided 2026-10-08): the
 * sync writes a template's render at Preview only where the preview stop rule
 * (PREVIEW_STOP_RULE_ENABLED) is on. Where it is off, the render is written at
 * Final, as before the templates rendered a Preview first, with the listing a
 * Final run of that graph quotes. Turning the flag on (then a restart) flips
 * them, because the gated doc is what the seeder fingerprints.
 *
 * Which nodes flip is read off the template itself (every render set to
 * Preview, `rendersAsPreview`), never a node-id list. A doc opts in by carrying
 * the listing of its Final graph (`withoutPreviewStopRule`): the seeder is core
 * and cannot price a graph, so the figure is authored and pinned here against
 * the estimator, for every built-in template.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { rendersAsPreview } from "@nodaro/shared"
import { CreditsService } from "../../../ee/billing/credits.js"
import { templateForPreviewStopRule } from "../preview-gate.js"
import type { TutorialTemplateDoc } from "../types.js"

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json")).sort()

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const load = (file: string): TutorialTemplateDoc =>
  JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as TutorialTemplateDoc
const previewRenders = (doc: TutorialTemplateDoc): Node[] => (doc.nodes as Node[]).filter((n) => rendersAsPreview(n))
const listing = (doc: TutorialTemplateDoc) =>
  CreditsService.estimateWorkflowBaseListing(doc.nodes as Node[], doc.edges as Edge[], "template")

const PODCAST = ["podcast-clip-pack", "podcast-multicam-cut", "podcast-tighten-episode", "podcast-trailer-formats"]
const gated = files.filter((f) => previewRenders(load(f)).length > 0)

describe("which built-in templates the gate flips", () => {
  it("the four podcast templates, read off their renders", () => {
    expect(gated.map((f) => load(f).slug).sort()).toEqual(PODCAST)
  })

  it.each(files)("%s: carries the Final graph's listing exactly when it holds a render set to Preview", (file) => {
    const doc = load(file)
    if (previewRenders(doc).length > 0) expect(doc.withoutPreviewStopRule, file).toBeDefined()
    else expect(doc.withoutPreviewStopRule, file).toBeUndefined()
  })
})

describe("with the preview stop rule on, the sync writes the template as authored", () => {
  it.each(files)("%s", (file) => {
    const doc = load(file)
    expect(templateForPreviewStopRule(doc, true)).toBe(doc)
  })
})

describe("with the preview stop rule off, the sync writes the render at Final", () => {
  it.each(gated)("%s: only the renders set to Preview change, to Final", (file) => {
    const doc = load(file)
    const off = templateForPreviewStopRule(doc, false)
    const flipped = new Set(previewRenders(doc).map((n) => n.id))
    expect(previewRenders(off)).toEqual([])
    const before = doc.nodes as Node[]
    const after = off.nodes as Node[]
    expect(after.map((n) => n.id)).toEqual(before.map((n) => n.id))
    const reworded = new Set(Object.keys(doc.withoutPreviewStopRule?.notes ?? {}))
    after.forEach((n, i) => {
      const was = before[i]!
      if (flipped.has(n.id)) expect(n).toEqual({ ...was, data: { ...was.data, quality: "final" } })
      // A note reworded for the Final graph changes its text, its height and
      // its y only.
      else if (reworded.has(n.id)) {
        const { text: _t, height: _h, ...rest } = n.data ?? {}
        const { text: _wt, height: _wh, ...wasRest } = was.data ?? {}
        expect(rest).toEqual(wasRest)
        const pos = (m: Node) => (m as Node & { position?: { x?: number } }).position
        expect(pos(n)?.x).toBe(pos(was)?.x)
        const frame = (m: Node) => ({ ...m, data: undefined, measured: undefined, position: undefined })
        expect(frame(n)).toEqual(frame(was))
      } else expect(n).toBe(was)
    })
    expect(off.edges).toBe(doc.edges)
  })

  it.each(gated)("%s: stores the listing the pricing functions derive for the Final graph", (file) => {
    const off = templateForPreviewStopRule(load(file), false)
    const l = listing(off)
    // A Final render has no Render final of its own: the listing is one part.
    expect({ final: l.final, finalPerMinute: l.finalPerMinute }).toEqual({ final: 0, finalPerMinute: 0 })
    expect({ fixed: off.estimatedCredits, perMinute: off.estimatedPerMinuteCredits ?? 0 }).toEqual({
      fixed: l.preview,
      perMinute: l.previewPerMinute,
    })
  })

  it("pins the four: the listing they stored before they rendered a Preview first", () => {
    const off = (slug: string) => {
      const doc = templateForPreviewStopRule(load(`${slug}.json`), false)
      return [doc.estimatedCredits, doc.estimatedPerMinuteCredits ?? 0]
    }
    expect(Object.fromEntries(PODCAST.map((slug) => [slug, off(slug)]))).toEqual({
      "podcast-clip-pack": [392, 4],
      "podcast-multicam-cut": [62, 14],
      "podcast-tighten-episode": [82, 14],
      "podcast-trailer-formats": [382, 4],
    })
  })

  // Rule off, a template is the graph it was before it rendered a Preview
  // first, byte for byte (decided 2026-10-08, round 4): every node, every note
  // (its text, height and position) and every edge. The fixtures are those
  // templates as they stood on dev before the Preview flip, frozen.
  it.each(gated)("%s: rule off, the graph is byte for byte the one before the Preview flip", (file) => {
    const before = JSON.parse(readFileSync(join(here, "fixtures", "pre-g2-2", file), "utf8")) as TutorialTemplateDoc
    const off = templateForPreviewStopRule(load(file), false)
    expect(JSON.stringify(off.nodes, null, 2)).toBe(JSON.stringify(before.nodes, null, 2))
    expect(JSON.stringify(off.edges)).toBe(JSON.stringify(before.edges))
    expect(JSON.stringify(off.settings)).toBe(JSON.stringify(before.settings))
    expect([off.estimatedCredits, off.estimatedPerMinuteCredits ?? 0]).toEqual([
      before.estimatedCredits,
      before.estimatedPerMinuteCredits ?? 0,
    ])
  })

  it.each(files.filter((f) => !gated.includes(f)))("%s: a template with no Preview render is written as authored", (file) => {
    const doc = load(file)
    expect(templateForPreviewStopRule(doc, false)).toBe(doc)
  })

  it("never mutates the doc it is given", () => {
    const doc = load(gated[0]!)
    const copy = structuredClone(doc)
    templateForPreviewStopRule(doc, false)
    expect(doc).toEqual(copy)
  })

  it("a doc that does not carry the Final listing is written as authored (an operator pack that did not opt in)", () => {
    const { withoutPreviewStopRule: _omit, ...doc } = load(gated[0]!)
    expect(templateForPreviewStopRule(doc, false)).toBe(doc)
  })
})

// Two wordings (decided 2026-10-08, round 3): each gated template carries its
// description and canvas notes for BOTH states of the preview stop rule, and
// the same gate that picks the render's quality picks the true texts. The
// authored doc holds the rule-on wording (Preview first, review, then Render
// final); `withoutPreviewStopRule` holds the rule-off wording (renders at
// Final, no review step).
const stickies = (doc: TutorialTemplateDoc): Array<Node & { data: { text: string } }> =>
  (doc.nodes as Node[]).filter(
    (n): n is Node & { data: { text: string } } => n.type === "sticky-note" && typeof n.data?.text === "string",
  )
/**
 * Copy that only holds where a run stops at a Preview for review: it names the
 * Preview, the Render final step, or the review itself ("review", "reviewed",
 * "reviewing" — the word boundary keeps "preview" from counting twice and
 * "overview" from counting at all).
 */
const NAMES_THE_REVIEW = /preview|render final|\breview/i

describe("each template the gate flips carries both wordings", () => {
  it("the review-naming match counts a bare mention of the review step", () => {
    for (const text of [
      "To skip the review, set Apply Cut's Quality to Final.",
      "Render the reviewed cut.",
      "Keep reviewing until it reads right.",
      "Run the Preview first.",
      "Then Render final.",
    ]) {
      expect(text, text).toMatch(NAMES_THE_REVIEW)
    }
    for (const text of ["An overview of the cut.", "Renders at Final quality in one pass."]) {
      expect(text, text).not.toMatch(NAMES_THE_REVIEW)
    }
  })

  it.each(gated)("%s: a rule-off description, differing from the rule-on one", (file) => {
    const doc = load(file)
    const off = doc.withoutPreviewStopRule!
    expect(off.description, file).toEqual(expect.any(String))
    expect(off.description!.trim().length, file).toBeGreaterThan(0)
    expect(off.description, file).not.toBe(doc.description)
  })

  it.each(gated)("%s: a rule-off markdown description whenever the template has one", (file) => {
    const doc = load(file)
    if (doc.markdownDescription == null) return
    expect(doc.withoutPreviewStopRule!.markdownDescription, file).toEqual(expect.any(String))
    expect(doc.withoutPreviewStopRule!.markdownDescription, file).not.toBe(doc.markdownDescription)
  })

  it.each(gated)("%s: a rule-off text for every note that names the review", (file) => {
    const doc = load(file)
    const notes = doc.withoutPreviewStopRule!.notes ?? {}
    const naming = stickies(doc).filter((n) => NAMES_THE_REVIEW.test(n.data.text)).map((n) => n.id)
    expect(naming.length, `${file}: the rule-on notes name the review`).toBeGreaterThan(0)
    expect(naming.filter((id) => !notes[id]), file).toEqual([])
  })

  it.each(gated)("%s: every rule-off note names a sticky note of the template, with a new text", (file) => {
    const doc = load(file)
    const byId = new Map(stickies(doc).map((n) => [n.id, n]))
    for (const [id, note] of Object.entries(doc.withoutPreviewStopRule!.notes ?? {})) {
      expect(byId.has(id), `${file}: ${id} is a sticky note`).toBe(true)
      expect(note.text.trim().length, `${file}: ${id}`).toBeGreaterThan(0)
      expect(note.text, `${file}: ${id}`).not.toBe(byId.get(id)!.data.text)
    }
  })

  it.each(gated)("%s: rule on, the description says a Preview renders first", (file) => {
    const on = templateForPreviewStopRule(load(file), true)
    expect(on.description ?? "", file).toMatch(/Preview/)
  })

  it.each(gated)("%s: rule off, no text names a Preview or Render final", (file) => {
    const off = templateForPreviewStopRule(load(file), false)
    expect(off.description ?? "", file).not.toMatch(NAMES_THE_REVIEW)
    expect(off.markdownDescription ?? "", file).not.toMatch(NAMES_THE_REVIEW)
    for (const n of stickies(off)) expect(n.data.text, `${file}: ${n.id}`).not.toMatch(NAMES_THE_REVIEW)
  })

  it.each(gated)("%s: rule off, each reworded note is written with its text and height", (file) => {
    const doc = load(file)
    const off = templateForPreviewStopRule(doc, false)
    const byId = new Map((off.nodes as Array<Node & { measured?: { height?: number } }>).map((n) => [n.id, n]))
    for (const [id, note] of Object.entries(doc.withoutPreviewStopRule!.notes ?? {})) {
      const n = byId.get(id)!
      expect(n.data?.text).toBe(note.text)
      if (note.height !== undefined) {
        expect(n.data?.height).toBe(note.height)
        if (n.measured) expect(n.measured.height).toBe(note.height)
      }
    }
  })

  it("a doc that carries only the Final listing keeps its texts (an operator pack's older opt-in)", () => {
    const doc = load(gated[0]!)
    const { estimatedCredits, estimatedPerMinuteCredits } = doc.withoutPreviewStopRule!
    const listingOnly = { ...doc, withoutPreviewStopRule: { estimatedCredits, estimatedPerMinuteCredits } }
    const off = templateForPreviewStopRule(listingOnly, false)
    expect(off.description).toBe(doc.description)
    expect(stickies(off).map((n) => n.data.text)).toEqual(stickies(doc).map((n) => n.data.text))
  })
})
