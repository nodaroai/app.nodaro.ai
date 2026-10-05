/**
 * Apply EDL's two price rows: `apply-edl` (a final render) and
 * `apply-edl:proxy` (a preview), both per minute of rendered output, chosen by
 * `applyEdlCreditId(quality)` for a video and an audio output alike.
 *
 * The rows mirror ONE constant each in `lib/apply-edl-plan.ts`; the
 * `model_pricing` rows (migration 431; 454, repriced by 455) are pinned to the
 * same values
 * by `credit-pricing-migration-sync.test.ts`, and the editor's cold-cache rows
 * by `lib/__tests__/frontend-credit-fallback-parity.test.ts`.
 *
 * Both rates are decided, and the comments that state them say so: a rate
 * still labelled a placeholder would send the next reader to re-derive a
 * settled price or hold its promotion. Migrations 454 and 455 are applied once
 * and then read forever, so they must not call their value "not final" either.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { applyEdlCreditId } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, CreditsService } from "../credits.js"
import {
  APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
  APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE,
} from "../../../lib/apply-edl-plan.js"

describe("apply-edl price rows", () => {
  it("each row is its one constant", () => {
    expect(STATIC_CREDIT_COSTS["apply-edl"]).toBe(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE)
    expect(STATIC_CREDIT_COSTS["apply-edl:proxy"]).toBe(APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE)
  })

  it("a preview costs less than the final, per minute of output", () => {
    expect(APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE).toBeGreaterThan(0)
    expect(APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE).toBeLessThan(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE)
    expect(STATIC_CREDIT_COSTS["apply-edl:proxy"]!).toBeLessThan(STATIC_CREDIT_COSTS["apply-edl"]!)
  })

  it("every id applyEdlCreditId can name has a row", () => {
    for (const quality of ["proxy", "final", undefined]) {
      expect(STATIC_CREDIT_COSTS[applyEdlCreditId(quality)]).toBeDefined()
    }
  })
})

describe("the workflow estimate quotes the row of the node's quality", () => {
  it.each([
    { name: "a video proxy", data: { output: "video", quality: "proxy" }, id: "apply-edl:proxy" },
    { name: "an audio proxy", data: { output: "audio", quality: "proxy" }, id: "apply-edl:proxy" },
    { name: "a final", data: { quality: "final" }, id: "apply-edl" },
    { name: "no quality (the final)", data: {}, id: "apply-edl" },
  ])("$name → $id", ({ data, id }) => {
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "apply-edl", data }])).toBe(STATIC_CREDIT_COSTS[id])
  })
})

// backend/src/ee/billing/__tests__/ → up 5 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")

/** The JSDoc block directly above `export const <name>`. The tempered body
 *  cannot cross a block's close, so it never reaches back into an earlier one. */
function docblockAbove(source: string, name: string): string {
  const m = source.match(new RegExp(String.raw`\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export const ${name}\b`))
  if (!m) throw new Error(`no docblock directly above export const ${name}`)
  return m[1]!
}

/** The run of `//` lines directly above the first line, after `anchor`, that
 *  opens with `key` — the comment a table row carries. */
function lineCommentsAbove(source: string, anchor: string, key: string): string {
  const lines = source.split("\n")
  const from = lines.findIndex((l) => l.includes(anchor))
  if (from < 0) throw new Error(`anchor not found: ${anchor}`)
  const at = lines.findIndex((l, i) => i > from && l.trimStart().startsWith(key))
  if (at < 0) throw new Error(`no ${key} row after ${anchor}`)
  const run: string[] = []
  for (let i = at - 1; i >= 0 && lines[i]!.trimStart().startsWith("//"); i--) run.unshift(lines[i]!)
  return run.join("\n")
}

describe("both rates read as decided wherever their value is written", () => {
  const plan = readRepoFile("backend/src/lib/apply-edl-plan.ts")
  const credits = readRepoFile("backend/src/ee/billing/credits.ts")
  const editor = readRepoFile("frontend/src/components/editor/workflow-editor/types.ts")
  const HOLD_WORDING = /\b(placeholder|provisional|not final|must not ship|pending)\b/i

  it.each([
    { site: "the final's constant", text: () => docblockAbove(plan, "APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE") },
    { site: "the preview's constant", text: () => docblockAbove(plan, "APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE") },
    { site: "the final's STATIC_CREDIT_COSTS row", text: () => lineCommentsAbove(credits, "export const STATIC_CREDIT_COSTS", `"apply-edl":`) },
    { site: "the preview's STATIC_CREDIT_COSTS row", text: () => lineCommentsAbove(credits, "export const STATIC_CREDIT_COSTS", `"apply-edl:proxy":`) },
    { site: "the editor's cold-cache rows", text: () => lineCommentsAbove(editor, "export const NODE_CREDIT_COSTS", `"apply-edl":`) },
    { site: "migration 454", text: () => readRepoFile("supabase/migrations/454_apply_edl_proxy_pricing.sql") },
    { site: "migration 455", text: () => readRepoFile("supabase/migrations/455_apply_edl_proxy_reprice.sql") },
  ])("$site", ({ text }) => {
    const comment = text()
    expect(comment).toMatch(/\bdecided\b/i)
    expect(comment).not.toMatch(HOLD_WORDING)
  })
})
