import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CreditsService } from "../../../ee/billing/credits.js"
import type { TutorialTemplateDoc } from "../types.js"

/**
 * Every built-in template that stores a listing price stores the estimator's
 * figure — never a hand-typed one (decided 2026-10-06). The seeder writes
 * `estimatedCredits` straight into `workflow_templates.estimated_credits`, the
 * price the Tutorials tab and the marketplace card show, so a figure typed by
 * hand drifts the moment a node's price or the graph moves on.
 *
 * The enumeration is the seeder's own (`loadDocs` in ../index.ts): every
 * `*.json` in the templates directory, marketplace and tutorial alike.
 * Operator packs (NODARO_TUTORIAL_PACKS) are not in this repository and are
 * outside this guard.
 *
 * The price is the LISTING scope (every node counted, as a published
 * template's stored price is) at STATIC_CREDIT_COSTS' base prices — what the
 * doc can know without a database. Unknown recording lengths price at the
 * ceilings.
 */
const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json")).sort()

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

function load(file: string): TutorialTemplateDoc {
  return JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as TutorialTemplateDoc
}

const priced = files.filter((f) => load(f).estimatedCredits !== undefined)

describe("built-in template listing prices", () => {
  it("finds the templates the seeder reads, and the ones that store a price", () => {
    // A guard against an empty glob passing every case below vacuously.
    expect(files.length).toBeGreaterThan(40)
    expect(priced.length).toBeGreaterThan(30)
  })

  it.each(priced)("%s stores the estimate the pricing functions derive for its whole graph", (file) => {
    const t = load(file)
    const derived = CreditsService.estimateWorkflowBaseCredits(
      t.nodes as Node[],
      t.edges as Edge[],
      { scope: "whole-graph" },
    )
    expect(derived).toBeGreaterThan(0)
    expect(t.estimatedCredits).toBe(derived)
  })
})
