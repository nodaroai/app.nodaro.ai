import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * Dates and times the user reads follow the language chosen in the app's
 * language menu, not the browser's locale — a bare `toLocaleDateString()`
 * prints "9/24/2026" beside Hebrew text. This guard parses the user-facing
 * sources and fails on a date/time formatting call whose locale (its FIRST
 * argument) is not `uiLocale()` from `lib/i18n/format.ts`:
 *
 *   x.toLocaleDateString(…)            x.toLocaleTimeString(…)
 *   new Date(…).toLocaleString(…)      new Intl.DateTimeFormat(…) / Intl.DateTimeFormat(…)
 *
 * Fix a hit with the helpers (`formatDate` / `formatTime` / `formatDateTime`)
 * or by passing `uiLocale()` as the locale — never by pinning "en-US", which
 * is exactly the bug. A number's `.toLocaleString()` is not policed (it is
 * indistinguishable from a date's without types); neither is a Date held in
 * a variable and printed with `.toLocaleString()` — use `formatDateTime`.
 *
 * `Intl.DateTimeFormat(…).resolvedOptions()` never formats anything (it
 * reads the browser's time zone), so that chain is exempt by construction.
 *
 * Real parser, not a regex: multi-line calls, comments and strings that
 * merely mention these names are where a grep-based scan goes wrong.
 * Scope is every source a user sees: all of `src/` minus tests and the
 * operator-only admin pages.
 */
const SRC = path.resolve(__dirname, "../../..")
const TIMEOUT = 60_000
const SKIP_DIR = new Set(["__tests__", "node_modules", "(admin)"])
/** The test harness, operator-only admin surfaces outside the `(admin)` route group, and the helper module itself. */
const SKIP_PATHS = ["test/", "ee/components/admin/", "ee/layouts/admin-layout.tsx", "lib/i18n/format.ts"]

/**
 * Files whose date formatting is correct without `uiLocale()`. Reviewed one
 * by one — the last test fails when an entry is no longer needed.
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly reason: string }> = [
  {
    file: "lib/schedule-words.ts",
    reason:
      "the locale is a parameter, and every caller (schedule-trigger-node, schedule-trigger-config, schedule-rule-editor, " +
      "schedule-when-it-runs) passes the chosen language from useLocaleStore — explicit so its tests can pin a locale",
  },
]

/** Cheap pre-filter: only files that mention a policed name are parsed. */
const CANDIDATE = /toLocale(?:Date|Time)?String|DateTimeFormat/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(path.join(dir, entry.name), out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

function inScope(rel: string): boolean {
  return !SKIP_PATHS.some((p) => rel === p || rel.startsWith(p)) && !rel.split("/").some((seg) => SKIP_DIR.has(seg))
}

function unwrap(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e
}

/** `uiLocale()` — the only locale argument the scan accepts. */
function isUiLocale(arg: ts.Expression | undefined): boolean {
  if (!arg) return false
  const e = unwrap(arg)
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "uiLocale" && e.arguments.length === 0
}

function isNewDate(e: ts.Expression): boolean {
  const u = unwrap(e)
  return ts.isNewExpression(u) && ts.isIdentifier(u.expression) && u.expression.text === "Date"
}

function isIntlDateTimeFormat(callee: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "DateTimeFormat" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Intl"
  )
}

/** `Intl.DateTimeFormat(…).resolvedOptions()` — reads the zone, formats nothing. */
function onlyReadsResolvedOptions(node: ts.Node): boolean {
  const parent = node.parent
  return ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === "resolvedOptions"
}

/** Every policed call in one file whose locale is not `uiLocale()`, as `file:line  call`. */
function offenders(rel: string, source: string): string[] {
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind)
  const hits: string[] = []
  const flag = (node: ts.Node, call: string, args: ts.NodeArray<ts.Expression> | undefined) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    hits.push(`${rel}:${line}  ${call}(${args?.[0]?.getText(sf) ?? ""}…)`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text
      const policed =
        name === "toLocaleDateString" ||
        name === "toLocaleTimeString" ||
        (name === "toLocaleString" && isNewDate(node.expression.expression))
      if (policed && !isUiLocale(node.arguments[0])) flag(node, `.${name}`, node.arguments)
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      isIntlDateTimeFormat(node.expression) &&
      !isUiLocale(node.arguments?.[0]) &&
      !onlyReadsResolvedOptions(node)
    ) {
      flag(node, "Intl.DateTimeFormat", node.arguments)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

function offendersIn(rel: string): string[] {
  const source = fs.readFileSync(path.join(SRC, rel), "utf8")
  return CANDIDATE.test(source) ? offenders(rel, source) : []
}

describe("dates and times follow the chosen language", () => {
  it(
    "every date/time formatting call passes uiLocale() as its locale",
    () => {
      const allowed = new Set(ALLOWED.map((a) => a.file))
      const hits = walk(SRC)
        .map((abs) => path.relative(SRC, abs).split(path.sep).join("/"))
        .filter((rel) => inScope(rel) && !allowed.has(rel))
        .flatMap(offendersIn)
      expect(
        hits,
        "date/time formatted in the browser's locale instead of the chosen language — use formatDate / formatTime / " +
          `formatDateTime from "@/lib/i18n/format", or pass uiLocale() as the locale:\n${hits.join("\n")}`,
      ).toEqual([])
    },
    TIMEOUT,
  )

  it("recognises every policed form, and only those", () => {
    const hits = offenders(
      "probe.tsx",
      [
        "d.toLocaleDateString()",
        "d.toLocaleTimeString([], { hour: '2-digit' })",
        "new Date(x).toLocaleString()",
        "new Intl.DateTimeFormat('en-US', { month: 'short' })",
        "Intl.DateTimeFormat(undefined).format(d)",
        "d.toLocaleDateString(uiLocale(), { month: 'short' })",
        "new Date(x).toLocaleString(uiLocale())",
        "new Intl.DateTimeFormat(uiLocale())",
        "Intl.DateTimeFormat().resolvedOptions().timeZone",
        "n.toLocaleString()",
        "// d.toLocaleDateString() in a comment",
        "const s = 'x.toLocaleDateString()'",
      ].join("\n"),
    )
    expect(hits.map((h) => Number(h.split(":")[1].split(" ")[0]))).toEqual([1, 2, 3, 4, 5])
  })

  it("every allowlist entry names a real, in-scope file that still needs it", () => {
    for (const { file, reason } of ALLOWED) {
      expect(fs.existsSync(path.join(SRC, file)), file).toBe(true)
      expect(inScope(file), file).toBe(true)
      expect(reason.length, file).toBeGreaterThan(20)
      expect(offendersIn(file), `${file} no longer needs its allowlist entry — remove it`).not.toEqual([])
    }
  })
})
