import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Every route that CREATES workspace-scoped content must refuse an archived
 * workspace.
 *
 * This exists because the list was wrong the first time. Four create paths
 * refused and the fifth did not — a sub-workflow, which did not look like a
 * create because it inherits its project from its parent instead of naming
 * one. It answered 201 and wrote the row, while the docs already claimed all
 * five refused. Nothing failed; a human had to notice.
 *
 * So the rule is derived from the code rather than remembered: any handler
 * that inserts into a workspace-scoped table either consults the refusal or
 * says in one line why it does not. A sixth create path added a year from now
 * fails this test on the day it is written, which is the only time the fix is
 * cheap.
 *
 * Deliberately NOT covered: updates. Archiving makes a workspace read-only for
 * NEW work; editing what is already inside is a different question with a
 * different answer, decided per object rather than per route.
 */

const ROUTE_FILES = ["workflows.ts", "projects.ts", "sub-workflows.ts"]
const WORKSPACE_SCOPED_TABLES = ["workflows", "projects"]

const REFUSAL = "refuseIfWorkspaceArchived"
/** `// archived-ok: <reason>` — an explicit, reviewed exemption. */
const EXEMPTION = /\/\/\s*archived-ok:\s*\S/

/**
 * Comments out, code only.
 *
 * Written after this guard failed its own mutation test: commenting the
 * refusal out left the identifier sitting in the file, the guard read it as a
 * live call, and the deleted protection passed. A guard a comment can satisfy
 * protects comments.
 *
 * Block comments go first — a `//` inside one is not a line comment — and the
 * carriage-return strip matters because `.` does not match `\r`, so on CRLF
 * the line stripper would silently do nothing at all. That exact bug shipped
 * in a sibling scanner and misaligned every file it read.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\r/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const at = l.indexOf("//")
      return at === -1 ? l : l.slice(0, at)
    })
    .join("\n")
}

interface Handler {
  readonly file: string
  readonly route: string
  readonly line: number
  readonly body: string
}

/** Split a route file into one block per `app.post(...)` / `app.patch(...)`. */
function handlers(file: string): Handler[] {
  const src = readFileSync(join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n")
  const lines = src.split("\n")
  const starts: Array<{ route: string; line: number }> = []

  lines.forEach((l, i) => {
    const m = l.match(/^\s*app\.(post|patch|put)(?:<[^>]*>)?\(\s*"([^"]+)"/)
    if (m) starts.push({ route: `${m[1].toUpperCase()} ${m[2]}`, line: i })
  })

  return starts.map((s, idx) => ({
    file,
    route: s.route,
    line: s.line + 1,
    body: lines.slice(s.line, idx + 1 < starts.length ? starts[idx + 1].line : lines.length).join("\n"),
  }))
}

/** Does this handler insert a row into a table the workspace owns? */
function insertsScopedContent(body: string): boolean {
  // `.from("workflows")` … `.insert(` within the same handler. Cheap and
  // deliberately over-eager: a false positive costs one `archived-ok` line,
  // a false negative costs an archive that is not read-only.
  const code = codeOnly(body)
  return WORKSPACE_SCOPED_TABLES.some(
    (t) => code.includes(`.from("${t}")`) && /\.insert\s*\(/.test(code),
  )
}

describe("an archived workspace is read-only for every create path", () => {
  const all = ROUTE_FILES.flatMap(handlers)

  it("finds the handlers at all — a silent zero would pass vacuously", () => {
    expect(all.length).toBeGreaterThan(5)
    expect(all.map((h) => h.route)).toContain("POST /v1/workflows")
  })

  it("every content-creating handler consults the refusal", () => {
    const creators = all.filter((h) => insertsScopedContent(h.body))
    // The five known today. If this number moves, a create path was added or
    // removed and the list below is the thing to read, not to silence.
    expect(creators.length).toBeGreaterThanOrEqual(5)

    const unguarded = creators
      .filter((h) => !codeOnly(h.body).includes(REFUSAL) && !EXEMPTION.test(h.body))
      .map((h) => `${h.file}:${h.line}  ${h.route}`)

    expect(unguarded, "creates that would write into an archived workspace").toEqual([])
  })

  it("the refusal is reached before anything is written", () => {
    // Refusing after the insert is not refusing. Every guarded handler must
    // call it before its first `.insert(`.
    const outOfOrder = all
      .filter((h) => codeOnly(h.body).includes(REFUSAL))
      .filter((h) => {
        const code = codeOnly(h.body)
        const guard = code.indexOf(REFUSAL)
        const write = code.search(/\.insert\s*\(/)
        return write !== -1 && write < guard
      })
      .map((h) => `${h.file}:${h.line}  ${h.route}`)

    expect(outOfOrder, "refusal placed after the write it is meant to prevent").toEqual([])
  })

  it("the comment stripper actually strips — the guard's own load-bearing part", () => {
    // Asserted directly, because when this is wrong every check above passes
    // for the wrong reason and reports a protection that is not there.
    expect(codeOnly("a // b").trim()).toBe("a")
    expect(codeOnly("a /* b */ c")).toBe("a  c")
    expect(codeOnly("keep\r\n// drop\r\nkeep2")).toBe("keep\n\nkeep2")
    expect(codeOnly("/*\n" + REFUSAL + "\n*/")).not.toContain(REFUSAL)
  })
})
