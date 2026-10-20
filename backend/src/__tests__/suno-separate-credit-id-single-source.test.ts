// @test-watches backend/src/** frontend/src/**
/**
 * Suno Separate's mode → credit id rule has one home: `sunoSeparateCreditId`
 * in `@nodaro/shared/models`. The route guard, the reservation, the workflow
 * payload, both estimators and the node's price badge used to spell the rule
 * out themselves (`type === "split_stem" ? "suno-separate-stem" : …`), and a
 * mode added to one copy was priced as the cheapest mode by the others.
 *
 * So the full-stems and one-instrument ids are each written in exactly one
 * place outside that function: their `STATIC_CREDIT_COSTS` rows. A
 * hand-written mapping anywhere else in the backend or editor sources fails
 * here.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO = join(__dirname, "..", "..", "..")
const ROOTS = ["backend/src", "frontend/src"]

/** Credit id → file → how many times it may write the id, and why. */
const ALLOWED: Record<string, Record<string, { count: number; reason: string }>> = {
  "suno-separate-stem": {
    "backend/src/ee/billing/credits.ts": { count: 1, reason: "the STATIC_CREDIT_COSTS row" },
  },
  "suno-separate-single": {
    "backend/src/ee/billing/credits.ts": { count: 1, reason: "the STATIC_CREDIT_COSTS row" },
  },
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "generated" ? [] : sources(path)
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".generated.ts")) return []
    return [path]
  })
}

// Any quote style, so a reformat cannot hide a copy.
function occurrences(text: string, id: string): number {
  return text.match(new RegExp(`["'\`]${id}["'\`]`, "g"))?.length ?? 0
}

const files = ROOTS.flatMap((root) => sources(join(REPO, root))).map(
  (path) => [relative(REPO, path), readFileSync(path, "utf8")] as const,
)

describe.each(Object.entries(ALLOWED))("suno separate credit id %s — one mapping", (id, allowed) => {
  const counts = new Map(
    files.map(([file, text]) => [file, occurrences(text, id)] as const).filter(([, n]) => n > 0),
  )

  it("no hand-written suno separate type→id mapping outside the shared function", () => {
    const offenders = [...counts]
      .filter(([file, n]) => n > (allowed[file]?.count ?? 0))
      .map(([file, n]) => `${file} (${n}×)`)
    expect(offenders, `call sunoSeparateCreditId from @nodaro/shared/models instead of writing "${id}"`).toEqual([])
  })

  it("every allowed file still writes the literal (a stale entry is removed, not kept)", () => {
    const stale = Object.entries(allowed)
      .filter(([file, { count }]) => counts.get(file) !== count)
      .map(([file]) => file)
    expect(stale).toEqual([])
  })
})
