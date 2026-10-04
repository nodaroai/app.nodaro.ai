import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * The browser reads a workflow's CONTENT only as its owner, or through the
 * server (T76).
 *
 * A studio production keeps its owner's working state in the row — empty media
 * slots, runs in flight and drafts in the bin under `settings.studio`, a
 * finished take's voice plan on the nodes' result rows — and a reader the owner
 * only let LOOK may not hold any of it (studio rulings T11 / T21 / T42). The
 * row policies let that reader SELECT the row, so the browser's own PostgREST
 * client hands it over whole unless the query itself prevents it. The server
 * strips it on every door a `view` reader uses; `lib/workflow-content.ts` is
 * the browser's one way to reach those doors.
 *
 * So every `.from("workflows")` read in the app that selects content —
 * `*`, `nodes`, the whole `settings` column, or a path into `settings->studio`
 * — must be one of:
 *
 *   (a) OWNER-SCOPED — its own chain carries `.eq("user_id", …)`, so it cannot
 *       return somebody else's row. (The guard checks that the filter is there,
 *       not whose id it names; the funnel uses the session's own.)
 *   (b) EXEMPTED — a `workflow-content-read:` comment just above it says why no
 *       `view` reader reaches it, and the count per file is pinned below, so a
 *       copied marker fails too.
 *
 * Anything else selecting content fails the build: route it through
 * `readWorkflowContent`, or select only the keys it needs
 * (`characterDefinitions:settings->characterDefinitions` reads one key and
 * nothing else). A projection the guard cannot resolve to a literal counts as
 * content — it fails closed.
 *
 * Realtime is the other way a row reaches the browser: the one subscription to
 * `workflows` is pinned to its hook, which adopts a broadcast's content only
 * for the row's owner (its own tests prove it).
 */

const ROOT = join(__dirname, "..", "..")

const MARKER = "workflow-content-read:"

/** Exempted reads, by file, and how many each holds. */
const EXEMPT: Readonly<Record<string, number>> = {
  // The save path's conflict rebase: writers only (save() returns before it
  // for a read-only canvas, and a `view` reader's canvas is read-only from
  // its load); an `edit` collaborator rebases onto the stored row.
  "hooks/use-workflow-persistence.ts": 1,
}

/** The one Realtime subscription to `workflows`. */
const REALTIME = new Set(["components/editor/workflow-editor/use-workflow-realtime-sync.ts"])

const FROM_WORKFLOWS = /\.from\(\s*["'`]workflows["'`]\s*\)/g
const REALTIME_WORKFLOWS = /\btable:\s*["'`]workflows["'`]/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") && !/\.test\.tsx?$/.test(e.name)) out.push(full)
  }
  return out
}

/** Index just past the string literal opening at `i`. */
function skipString(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    const ch = src[j]
    if (ch === "\\") { j += 2; continue }
    if (quote === "`" && ch === "$" && src[j + 1] === "{") {
      let depth = 1
      j += 2
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++
        else if (src[j] === "}") depth--
        j++
      }
      continue
    }
    if (ch === quote) return j + 1
    j++
  }
  return j
}

/** Index of the next character that is not whitespace or a comment. */
function skipTrivia(src: string, i: number): number {
  let j = i
  while (j < src.length) {
    if (/\s/.test(src[j]!)) { j++; continue }
    if (src.startsWith("//", j)) { const nl = src.indexOf("\n", j); j = nl < 0 ? src.length : nl + 1; continue }
    if (src.startsWith("/*", j)) { const end = src.indexOf("*/", j + 2); j = end < 0 ? src.length : end + 2; continue }
    break
  }
  return j
}

/** Index just past the bracketed group opening at `open`, strings and comments skipped. */
function skipBalanced(src: string, open: number): number {
  const close = ({ "(": ")", "[": "]", "{": "}", "<": ">" } as Record<string, string>)[src[open]!]!
  let depth = 0
  let i = open
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(src, i); continue }
    if (src.startsWith("//", i) || src.startsWith("/*", i)) { i = skipTrivia(src, i); continue }
    if (ch === src[open]) depth++
    else if (ch === close && --depth === 0) return i + 1
    i++
  }
  return i
}

/**
 * The method chain that follows `.from("workflows")` at `start` — every
 * `.name(args)` link up to where the expression stops continuing with `.`,
 * across lines and comments, with each argument list (a multi-line insert
 * body included) skipped as one unit.
 */
function chainAt(src: string, start: number): string {
  let i = start
  for (;;) {
    const dot = skipTrivia(src, i)
    if (src[dot] !== "." || src[dot + 1] === ".") return src.slice(start, i)
    let j = dot + 1
    while (j < src.length && /[\w$]/.test(src[j]!)) j++
    if (j === dot + 1) return src.slice(start, i)
    let k = skipTrivia(src, j)
    if (src[k] === "<") k = skipTrivia(src, skipBalanced(src, k))
    i = src[k] === "(" ? skipBalanced(src, k) : j
  }
}

/** The raw argument text of every `.select(…)` in a chain. */
function selectArgs(chain: string): string[] {
  const out: string[] = []
  let at = chain.indexOf(".select(")
  while (at >= 0) {
    let i = at + ".select(".length
    const begin = i
    let depth = 0
    while (i < chain.length) {
      const ch = chain[i]!
      if (ch === '"' || ch === "'" || ch === "`") { i = skipString(chain, i); continue }
      if (ch === "(") depth++
      else if (ch === ")") { if (depth === 0) break; depth-- }
      i++
    }
    out.push(chain.slice(begin, i).trim())
    at = chain.indexOf(".select(", i)
  }
  return out
}

/** Same-file string constants: `const NAME = "…"` (or a template of others). */
function fileConstants(src: string): Map<string, string> {
  const raw = new Map<string, string>()
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(["'`])/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1
    const end = skipString(src, open)
    raw.set(m[1]!, src.slice(open + 1, end - 1))
  }
  return raw
}

/** A projection argument as the column list it evaluates to, or null. */
function resolveProjection(arg: string, consts: Map<string, string>, seen = new Set<string>()): string | null {
  const text = arg.trim()
  if (text === "") return "*"
  const quote = text[0]
  if (quote === '"' || quote === "'") return text.endsWith(quote) ? text.slice(1, -1) : null
  if (quote === "`") {
    if (!text.endsWith("`")) return null
    let failed = false
    const body = text.slice(1, -1).replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name: string) => {
      const v = resolveName(name, consts, seen)
      if (v === null) failed = true
      return v ?? ""
    })
    return failed || /\$\{/.test(body) ? null : body
  }
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return resolveName(text, consts, seen)
  return null
}

function resolveName(name: string, consts: Map<string, string>, seen: Set<string>): string | null {
  if (seen.has(name)) return null
  const value = consts.get(name)
  if (value === undefined) return null
  return resolveProjection("`" + value + "`", consts, new Set([...seen, name]))
}

/** A column list's top-level items — `projects(id, name)` embeds another table, so its insides are not this row's columns. */
function topLevelItems(projection: string): string[] {
  const items: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of projection) {
    if (ch === "(") { depth++; continue }
    if (ch === ")") { depth--; continue }
    if (depth > 0) continue
    if (ch === ",") { items.push(cur); cur = ""; continue }
    cur += ch
  }
  items.push(cur)
  return items
}

/** Whether a resolved column list selects workflow content. */
function selectsContent(projection: string): boolean {
  return topLevelItems(projection).some((item) => {
    const expr = item.trim().replace(/^[A-Za-z_$][\w$]*\s*:(?!:)\s*/, "").replace(/::\w+$/, "").trim()
    if (expr === "*") return true
    const [column, ...path] = expr.split(/->>?/).map((part) => part.trim())
    if (column === "nodes") return true
    if (column === "settings") return path.length === 0 || path[0] === "studio"
    return false
  })
}

interface Read {
  readonly file: string
  readonly line: number
  readonly projection: string | null
  readonly ownerScoped: boolean
  readonly marked: boolean
}

function workflowReads(rel: string, src: string): Read[] {
  const consts = fileConstants(src)
  const reads: Read[] = []
  for (const m of src.matchAll(FROM_WORKFLOWS)) {
    const chain = chainAt(src, m.index! + m[0].length)
    const args = selectArgs(chain)
    if (args.length === 0) continue
    const line = src.slice(0, m.index).split("\n").length
    const above = src.slice(0, m.index).split("\n").slice(-12).join("\n")
    for (const arg of args) {
      reads.push({
        file: rel,
        line,
        projection: resolveProjection(arg, consts),
        ownerScoped: /\.eq\(\s*["'`]user_id["'`]/.test(chain),
        marked: above.includes(MARKER),
      })
    }
  }
  return reads
}

const files = sourceFiles(ROOT).map((f) => relative(ROOT, f).split("\\").join("/"))
const allReads = files.flatMap((rel) => workflowReads(rel, readFileSync(join(ROOT, rel), "utf8")))
const contentReads = allReads.filter((r) => r.projection === null || selectsContent(r.projection))

describe("the browser reads workflow content only as its owner, or through the server (T76)", () => {
  it("finds the reads it guards (the scanner is wired to something)", () => {
    expect(files.length).toBeGreaterThan(500)
    // The funnel's own owner read, and the narrowed character list.
    expect(allReads.some((r) => r.file === "lib/workflow-content.ts" && r.ownerScoped)).toBe(true)
    expect(allReads.some((r) => r.file === "hooks/queries/use-editor-queries.ts" && r.projection?.includes("settings->characterDefinitions"))).toBe(true)
  })

  it("every read that selects content is owner-scoped or a pinned exemption", () => {
    const offenders = contentReads
      .filter((r) => !r.ownerScoped && !r.marked)
      .map((r) => `  - frontend/src/${r.file}:${r.line}  select(${r.projection ?? "<unresolved>"})`)
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : "These read a workflow's content with the browser Supabase client, and nothing keeps " +
          "them to the caller's own rows. A `view` reader would receive a studio production's " +
          "owner drafts, runs in flight and take voice records (T11 / T21 / T42):\n" +
          offenders.join("\n") +
          "\n\nRead it through `readWorkflowContent` (lib/workflow-content.ts), or select only " +
          "the keys you need. If no `view` reader can reach it, say so in a `" + MARKER + "` " +
          "comment above it and pin it in EXEMPT here.",
    ).toEqual([])
  })

  it("the exemptions are exactly the pinned ones", () => {
    const counts: Record<string, number> = {}
    for (const r of contentReads.filter((r) => !r.ownerScoped && r.marked)) counts[r.file] = (counts[r.file] ?? 0) + 1
    expect(counts).toEqual(EXEMPT)
  })

  it("only the Realtime hook subscribes to `workflows`", () => {
    const subscribers = files.filter((rel) => REALTIME_WORKFLOWS.test(readFileSync(join(ROOT, rel), "utf8")))
    expect(new Set(subscribers)).toEqual(REALTIME)
    for (const rel of REALTIME) expect(statSync(join(ROOT, rel)).isFile()).toBe(true)
  })
})

describe("the scanner itself", () => {
  const consts = new Map([
    ["META", "id, name, updated_at"],
    ["FULL", "id, nodes, edges"],
  ])

  it("knows content when it sees it", () => {
    expect(selectsContent("*")).toBe(true)
    expect(selectsContent("id, name, settings")).toBe(true)
    expect(selectsContent("nodes, edges, settings, name, version, updated_at")).toBe(true)
    expect(selectsContent("id, nodes, edges")).toBe(true)
    expect(selectsContent("studio:settings->studio")).toBe(true)
    expect(selectsContent("settings->>studio")).toBe(true)
    expect(selectsContent("first:nodes->0")).toBe(true)
  })

  it("knows a projection that holds none", () => {
    expect(selectsContent("id, name, characterDefinitions:settings->characterDefinitions")).toBe(false)
    expect(selectsContent("id, demo_seed:settings->>demoSeed, cover_node_types")).toBe(false)
    expect(selectsContent("id, name, project_id, created_at, projects(name)")).toBe(false)
    expect(selectsContent("id, projects(id, nodes)")).toBe(false)
    expect(selectsContent("updated_at, version")).toBe(false)
  })

  it("resolves literals, constants and templates — and fails closed on anything else", () => {
    expect(resolveProjection('"id, name"', consts)).toBe("id, name")
    expect(resolveProjection("META", consts)).toBe("id, name, updated_at")
    expect(resolveProjection("`${META}, cover_node_types`", consts)).toBe("id, name, updated_at, cover_node_types")
    expect(resolveProjection("`${FULL}`", consts)).toBe("id, nodes, edges")
    expect(resolveProjection("", consts)).toBe("*")
    expect(resolveProjection("cols", consts)).toBeNull()
    expect(resolveProjection("`${cols}`", consts)).toBeNull()
    expect(resolveProjection("pick()", consts)).toBeNull()
  })

  it("follows a chain across lines, comments and a multi-line insert body", () => {
    const src = `
      const { data } = await supabase
        .from("workflows")
        // a comment inside the chain
        .insert({
          name: "x",
          nodes: original.nodes,
        })
        .select(META)
        .single()
      const other = 1
    `
    const start = src.indexOf('.from("workflows")') + '.from("workflows")'.length
    const chain = chainAt(src, start)
    expect(selectArgs(chain)).toEqual(["META"])
    expect(chain).not.toContain("other")
  })

  it("sees the owner filter only on its own chain", () => {
    const src = `
      let q = supabase.from("workflows").select("*").order("updated_at")
      q = q.eq("user_id", me)
    `
    const [read] = workflowReads("x.ts", src)
    expect(read!.ownerScoped).toBe(false)
    const scoped = workflowReads("y.ts", `supabase.from("workflows").select("*").eq("id", id).eq("user_id", me).maybeSingle()`)
    expect(scoped[0]!.ownerScoped).toBe(true)
  })
})
