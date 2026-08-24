import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
// @ts-expect-error — a .mjs script with no type declarations; scan() is exported
// for exactly this, and the file guards its own main block so importing it here
// does not run the lint (or call process.exit inside the test runner).
import { scan } from "../../scripts/check-tenant-scope.mjs"

/**
 * Acceptance tests for the tenant-scope lint's SECOND rule: a list on a
 * workspace-scoped table must say which side of the line it is on.
 *
 * The rule guards a failure with no error and no symptom: a personal list
 * filtered only by `user_id` starts including the caller's own workspace work
 * the moment they join one — the class's rows appearing beside their private
 * rows with nothing to tell them apart. It is a no-op on today's data, which
 * is precisely why it needs a test that can see it fail. A guard nobody has
 * watched fail is a guard nobody knows works; this repo has shipped two such
 * rules already.
 */

const dir = mkdtempSync(join(tmpdir(), "tenant-scope-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

interface Finding {
  kind: string
  table: string
  line: number
}

/** Write a fixture route file and scan it. */
function scanSource(name: string, src: string): Finding[] {
  const p = join(dir, name)
  writeFileSync(p, src)
  return scan(p) as Finding[]
}

const lists = (found: Finding[]): Finding[] => found.filter((f) => f.kind === "list")

describe("tenant-scope lint — a list must say which side of the workspace line it is on", () => {
  it("catches a personal list that only filters by user_id", () => {
    const found = lists(
      scanSource(
        "unscoped.ts",
        [
          "const { data } = await supabase",
          '  .from("workflows")',
          "  .select(COLS)",
          '  .eq("user_id", userId)',
          '  .order("updated_at", { ascending: false })',
        ].join("\n"),
      ),
    )
    expect(found).toHaveLength(1)
    expect(found[0].table).toBe("workflows")
    expect(found[0].line).toBe(2)
  })

  it("accepts a personal list that says so", () => {
    expect(
      lists(
        scanSource(
          "personal.ts",
          [
            "const { data } = await supabase",
            '  .from("workflows")',
            "  .select(COLS)",
            '  .eq("user_id", userId)',
            '  .is("workspace_id", null)',
          ].join("\n"),
        ),
      ),
    ).toEqual([])
  })

  it("accepts a workspace list that says so", () => {
    expect(
      lists(
        scanSource(
          "workspace.ts",
          [
            "const { data } = await supabase",
            '  .from("projects")',
            "  .select(COLS)",
            '  .eq("workspace_id", req.workspaceId)',
          ].join("\n"),
        ),
      ),
    ).toEqual([])
  })

  it("does not fire on a single-row read — that is the other rule's job", () => {
    expect(
      lists(
        scanSource(
          "byid.ts",
          [
            "const { data } = await supabase",
            '  .from("workflows")',
            "  .select(COLS)",
            '  .eq("id", id)',
            '  .eq("user_id", userId)',
            "  .single()",
          ].join("\n"),
        ),
      ),
    ).toEqual([])
  })

  it("honours an ignore comment directly above the .from() line", () => {
    expect(
      lists(
        scanSource(
          "ignored.ts",
          [
            "const { data } = await supabase",
            "  // tenant-scope-ignore: enrichment over ids already authorized above.",
            '  .from("workflows")',
            "  .select(COLS)",
            '  .in("id", ids)',
          ].join("\n"),
        ),
      ),
    ).toEqual([])
  })

  it("follows a query built across statements — the conditional-filter shape", () => {
    // `let q = …` then `q = q.eq(…)` is how this codebase writes a filter that
    // only sometimes applies. Reading the first statement alone, the scope
    // looks missing and the rule fires on correct code — and whoever hits that
    // reaches for an ignore comment, which is how a rule stops meaning
    // anything. Both directions are asserted, because a fix that stopped
    // reading continuations entirely would also pass the "scoped" half.
    const scoped = [
      'let q = supabase.from("workflows").select(COLS)',
      'q = q.eq("user_id", userId).is("workspace_id", null)',
      "const { data } = await q",
    ].join("\n")
    expect(lists(scanSource("cont-ok.ts", scoped))).toEqual([])

    const unscoped = [
      'let q = supabase.from("workflows").select(COLS)',
      'q = q.eq("user_id", userId)',
      'const { data } = await q.order("updated_at")',
    ].join("\n")
    expect(lists(scanSource("cont-bad.ts", unscoped))).toHaveLength(1)
  })

  it("follows a continuation broken after the assignment", () => {
    // `q = q` / newline / `.eq(…)` — what a formatter produces for a long
    // chain. Read as a consumption instead of a continuation, the walk stops
    // before the filters and correct code is flagged.
    const src = [
      'let q = supabase.from("workflows").select(COLS)',
      "q = q",
      '  .eq("user_id", userId)',
      '  .is("workspace_id", null)',
      "const { data } = await q",
    ].join("\n")
    expect(lists(scanSource("cont-wrapped.ts", src))).toEqual([])
  })

  it("does not let ANOTHER handler's continuation lend its scope", () => {
    // Both handlers use the same variable name; only the second is scoped.
    // The first must still be reported — a false negative here is the
    // direction that actually costs something.
    const src = [
      'app.get("/a", async (req, reply) => {',
      '  let dbQuery = supabase.from("workflows").select(COLS)',
      '  dbQuery = dbQuery.eq("user_id", userId)',
      "  return dbQuery",
      "})",
      'app.get("/b", async (req, reply) => {',
      '  let dbQuery = supabase.from("projects").select(COLS)',
      '  dbQuery = dbQuery.eq("user_id", userId).is("workspace_id", null)',
      "  const { data } = await dbQuery",
      "})",
    ].join("\n")
    const found = lists(scanSource("cross-handler.ts", src))
    expect(found).toHaveLength(1)
    expect(found[0].table).toBe("workflows")
  })

  it("does not read a continuation past the point the query is run", () => {
    // A later statement that reassigns the same name to a DIFFERENT query must
    // not lend its scope to this one.
    const src = [
      'let q = supabase.from("projects").select(COLS)',
      'q = q.eq("user_id", userId)',
      "const { data } = await q",
      'q = q.is("workspace_id", null)',
    ].join("\n")
    expect(lists(scanSource("cont-after.ts", src))).toHaveLength(1)
  })

  it("does not fire on tables that carry no workspace", () => {
    expect(
      lists(
        scanSource(
          "other.ts",
          ['const { data } = await supabase.from("characters").select(COLS).eq("user_id", userId)'].join("\n"),
        ),
      ),
    ).toEqual([])
  })

  it("still reports the id rule, so adding rule 2 did not shadow rule 1", () => {
    const found = scanSource(
      "both.ts",
      [
        "const { data } = await supabase",
        '  .from("workflows")',
        "  .select(COLS)",
        '  .eq("id", id)',
        "  .single()",
      ].join("\n"),
    )
    expect(found.filter((f) => f.kind === "id")).toHaveLength(1)
  })
})
