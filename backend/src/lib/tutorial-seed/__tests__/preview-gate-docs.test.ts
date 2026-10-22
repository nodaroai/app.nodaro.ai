/**
 * The public docs describe the podcast templates in both states of the preview
 * stop rule, because the sync writes them differently in each (preview-gate.ts):
 * at Preview with the run-plus-Render-final listing where the rule is on, at
 * Final with the Final graph's listing where it is off (the default). A
 * sentence that gives only the rule-on behaviour or price is false on every
 * deployment that leaves the rule off.
 *
 * The figures are read from the templates themselves (the authored listing and
 * its `withoutPreviewStopRule`), never typed here, so a repricing fails this
 * test until the docs follow.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { TutorialTemplateDoc } from "../types.js"

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const repoRoot = join(here, "..", "..", "..", "..", "..")
const docsDir = join(repoRoot, "docs")

const read = (...p: string[]) => readFileSync(join(docsDir, ...p), "utf8")
const applyEdl = read("nodes", "processing-video", "apply-edl.md")
const speakerView = read("nodes", "processing-video", "speaker-view.md")
const sdkReference = read("sdk-reference.md")

type Gated = { slug: string; name: string; on: [number, number]; off: [number, number]; rendersThroughApplyEdl: boolean }
const allGated: Gated[] = readdirSync(templatesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(templatesDir, f), "utf8")) as TutorialTemplateDoc & { slug: string })
  .filter((d) => d.withoutPreviewStopRule)
  .map((d) => ({
    slug: d.slug,
    name: d.name,
    on: [d.estimatedCredits ?? 0, d.estimatedPerMinuteCredits ?? 0],
    off: [d.withoutPreviewStopRule!.estimatedCredits, d.withoutPreviewStopRule!.estimatedPerMinuteCredits ?? 0],
    rendersThroughApplyEdl: (d.nodes as Array<{ type?: string }>).some((n) => n.type === "apply-edl"),
  }))
// apply-edl.md#podcast-templates lists the templates that end in an Apply EDL
// render; the vertical speaker clip ends in Speaker View and is documented on
// that node's page (below).
const gated = allGated.filter((g) => g.rendersThroughApplyEdl)
const verticalClip = allGated.find((g) => g.slug === "podcast-vertical-speaker-clip")!

const tighten = gated.find((g) => g.slug === "podcast-tighten-episode")!

const paragraphAt = (doc: string, anchor: string): string => {
  const start = doc.indexOf(anchor)
  expect(start, `anchor ${anchor}`).toBeGreaterThan(-1)
  const end = doc.indexOf("\n", start)
  return doc.slice(start, end === -1 ? undefined : end)
}

const allDocs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allDocs(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  )

describe("podcast template docs give both states of the preview stop rule", () => {
  it("covers the four gated templates", () => {
    expect(gated.map((g) => g.slug).sort()).toEqual([
      "podcast-clip-pack",
      "podcast-multicam-cut",
      "podcast-tighten-episode",
      "podcast-trailer-formats",
    ])
  })

  it.each(gated.map((g) => [g.slug, g] as const))("apply-edl.md#podcast-templates lists %s at both", (_s, g) => {
    const para = paragraphAt(applyEdl, '<a id="podcast-templates"></a>')
    expect(para).toContain(`**${g.on[0]} + ${g.on[1]}/min**`)
    expect(para).toContain(`**${g.off[0]} + ${g.off[1]}/min**`)
  })

  it("the Tighten Episode worked example in apply-edl.md gives both listings", () => {
    const para = paragraphAt(applyEdl, "The cost on the node, the **Run** button")
    const at = para.indexOf("Tighten Episode template")
    expect(at).toBeGreaterThan(-1)
    const sentence = para.slice(para.lastIndexOf(". ", at) + 2, para.indexOf("An app's or a template's Render final", at))
    expect(sentence).toContain(`**${tighten.on[0]} + ${tighten.on[1]}/min**`)
    expect(sentence).toContain(`**${tighten.off[0]} + ${tighten.off[1]}/min**`)
    expect(sentence).toContain("preview stop rule")
  })

  it("sdk-reference.md gives the Tighten Episode card and its 60-minute sort key in both states", () => {
    const at = sdkReference.indexOf("A card's `estimatedCredits` is the template's listed price.")
    expect(at).toBeGreaterThan(-1)
    const passage = sdkReference.slice(at, sdkReference.indexOf("```ts", at))
    for (const [fixed, perMin] of [tighten.on, tighten.off]) {
      expect(passage).toContain(`\`${fixed}\` and \`${perMin}\``)
      expect(passage).toContain(`\`${fixed + 60 * perMin}\``)
    }
    expect(passage).toContain("preview stop rule")
  })

  it("speaker-view.md documents the Vertical speaker clip template in both states of the stop rule, at both listings", () => {
    expect(allGated.filter((g) => !g.rendersThroughApplyEdl).map((g) => g.slug)).toEqual(["podcast-vertical-speaker-clip"])
    const at = speakerView.indexOf("### The Vertical speaker clip template")
    expect(at, "the template has a section").toBeGreaterThan(-1)
    const section = speakerView.slice(at, speakerView.indexOf("\n### ", at + 5))
    expect(section).toContain("PREVIEW_STOP_RULE_ENABLED")
    expect(section).toMatch(/Where the rule is off/)
    expect(section).toContain(`**${verticalClip.on[0]} + ${verticalClip.on[1]}/min**`)
    expect(section).toContain(`**${verticalClip.off[0]} + ${verticalClip.off[1]}/min**`)
    // Both ways to repair the framing, in the docs and on the template's own note.
    expect(section).toContain("Correcting a track")
    const doc = JSON.parse(readFileSync(join(templatesDir, "podcast-vertical-speaker-clip.json"), "utf8")) as {
      nodes: Array<{ id: string; data?: { text?: string } }>
    }
    const note = doc.nodes.find((n) => n.id === "vsc-note-fix")?.data?.text ?? ""
    expect(note).toMatch(/which face/i)
    expect(note).toMatch(/draw a box/i)
  })

  it("deployment.md names every built-in template the stop rule writes", () => {
    const deployment = read("deployment.md")
    const row = deployment.split("\n").find((l) => l.startsWith("| `PREVIEW_STOP_RULE_ENABLED`"))
    expect(row, "the PREVIEW_STOP_RULE_ENABLED row").toBeDefined()
    for (const { name } of allGated) expect(row, name).toContain(name)
    // The stop is not only at an Apply EDL render: Speaker View's render stops the same way.
    expect(row).toMatch(/Speaker View/)
  })

  it("every docs line that says a template renders a Preview first names the stop rule", () => {
    const offenders = allDocs(docsDir).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${relative(repoRoot, file)}:${i + 1}` }))
        .filter(({ line }) => line.includes("#podcast-templates") && /preview first/i.test(line))
        .filter(({ line }) => !/preview stop rule/i.test(line))
        .map(({ at }) => at),
    )
    expect(offenders).toEqual([])
  })
})
