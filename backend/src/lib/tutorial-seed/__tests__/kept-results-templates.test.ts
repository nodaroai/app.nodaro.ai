/**
 * The built-in templates whose copy shows a kept example run carry
 * `requiresKeptResults`, so the seeder never writes them (types.ts, index.ts).
 *
 * A template published with "Include this run's results" keeps that run on its
 * published row only; the doc shipped here is content-free. Seeded, it would
 * open an empty canvas under notes and a description that promise a finished
 * example run. The flag is the one thing the seeder reads, and this guard ties
 * it to the copy in both directions: a doc whose texts claim an example run must
 * carry it, and a doc carrying it must be one whose texts say so. A new
 * template-with-data that forgets the flag fails here, not on a self-hoster's
 * canvas.
 *
 * `tools/community-smoke.mjs` asserts the same phrase never reaches a booted
 * community install's Tutorials list; keep the two patterns together.
 */
import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TutorialTemplateDoc } from "../types.js"

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates")

/** How the copy of a template-with-data names its kept run. */
const CLAIMS_EXAMPLE_RUN = /\bexample run\b/i

type Node = { type?: string; data?: { text?: unknown } }

/** Every text a reader of the seeded template sees: the card, the markdown, the notes, and their rule-off variants. */
function textsOf(doc: TutorialTemplateDoc): string[] {
  const notes = (doc.nodes as Node[])
    .filter((n) => n.type === "sticky-note" && typeof n.data?.text === "string")
    .map((n) => n.data!.text as string)
  const off = doc.withoutPreviewStopRule
  return [
    doc.name,
    doc.description ?? "",
    doc.markdownDescription ?? "",
    ...notes,
    off?.description ?? "",
    off?.markdownDescription ?? "",
    ...Object.values(off?.notes ?? {}).map((n) => n.text),
  ]
}

async function loadAll(): Promise<TutorialTemplateDoc[]> {
  const files = (await readdir(TEMPLATES_DIR)).filter((f) => f.endsWith(".json")).sort()
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(TEMPLATES_DIR, f), "utf8")) as TutorialTemplateDoc))
}

describe("built-in templates that show a kept example run", () => {
  it("carry requiresKeptResults exactly when their copy claims an example run", async () => {
    const docs = await loadAll()
    const claiming = docs.filter((d) => textsOf(d).some((t) => CLAIMS_EXAMPLE_RUN.test(t))).map((d) => d.slug)
    const flagged = docs.filter((d) => d.requiresKeptResults === true).map((d) => d.slug)
    expect(flagged).toEqual(claiming)
  })

  it("include the three UGC templates (the guard is not vacuous)", async () => {
    const flagged = (await loadAll()).filter((d) => d.requiresKeptResults === true).map((d) => d.slug)
    expect(flagged).toEqual(expect.arrayContaining(["ugc-website-video", "ugc-product-in-hand", "ugc-app-demo"]))
  })

  it("never set the flag to anything but true", async () => {
    for (const d of await loadAll()) {
      if ("requiresKeptResults" in d) expect(d.requiresKeptResults, d.slug).toBe(true)
    }
  })
})
