// A template the database refuses is only a line in the boot log: the seeder
// carries on, and the template never appears. These hold a shipped template to
// the column's own rules, so that shows up here instead.
//
// @test-watches backend/src/lib/tutorial-seed/templates/*.json supabase/migrations/076_workflow_templates.sql
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { validatePackDoc } from "../pack-validator.js"
import { TEMPLATE_COMPLEXITIES, type TutorialPackManifest, type TutorialTemplateDoc } from "../types.js"

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const migration = join(here, "..", "..", "..", "..", "..", "supabase", "migrations", "076_workflow_templates.sql")

const docs = readdirSync(templatesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, doc: JSON.parse(readFileSync(join(templatesDir, f), "utf8")) as TutorialTemplateDoc }))

const manifest: TutorialPackManifest = {
  name: "test-pack",
  categories: [{ slug: "getting-started", name: "Getting started" }],
}
const minimalDoc = {
  slug: "pack-template",
  name: "Pack template",
  nodes: [],
  edges: [],
  tutorialCategorySlug: "getting-started",
  tutorialSortOrder: 1,
}

describe("built-in templates and the database's rules", () => {
  it("finds the templates", () => {
    expect(docs.length).toBeGreaterThan(0)
  })

  it("gives every template a complexity the column accepts", () => {
    const refused = docs
      .filter(({ doc }) => doc.complexity !== undefined && !(TEMPLATE_COMPLEXITIES as readonly string[]).includes(doc.complexity))
      .map(({ file, doc }) => `${file}: ${doc.complexity}`)
    expect(refused).toEqual([])
  })

  it("keeps every description within the column's 500 characters", () => {
    const tooLong = docs
      .filter(({ doc }) => (doc.description ?? "").length > 500)
      .map(({ file, doc }) => `${file}: ${doc.description?.length}`)
    expect(tooLong).toEqual([])
  })

  it("lists the same complexities as the column's CHECK", () => {
    const sql = readFileSync(migration, "utf8")
    const check = sql.match(/complexity\s+TEXT[^\n]*CHECK\s*\(complexity IN \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    const allowed = (check as RegExpMatchArray)[1].split(",").map((v) => v.trim().replace(/'/g, ""))
    expect([...TEMPLATE_COMPLEXITIES].sort()).toEqual(allowed.sort())
  })
})

describe("an operator pack's complexity", () => {
  it.each(TEMPLATE_COMPLEXITIES)("accepts %s", (complexity) => {
    const { issues } = validatePackDoc({ ...minimalDoc, complexity }, manifest)
    expect(issues.filter((i) => i.code === "doc_invalid")).toEqual([])
  })

  it("refuses a value the column would reject, naming the field", () => {
    const { doc, issues } = validatePackDoc({ ...minimalDoc, complexity: "beginner" }, manifest)
    expect(doc).toBeNull()
    expect(issues[0]?.code).toBe("doc_invalid")
    expect(issues[0]?.message).toContain("complexity")
  })

  it("still allows leaving it out", () => {
    const { issues } = validatePackDoc(minimalDoc, manifest)
    expect(issues.filter((i) => i.code === "doc_invalid")).toEqual([])
  })
})
