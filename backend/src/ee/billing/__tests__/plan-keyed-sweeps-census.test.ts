// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { relPath, SCAN_TIMEOUT_MS, sourceFiles } from "../../../lib/__tests__/source-scan.js"

/**
 * Every sweep that clears media by a user's OWN plan asks the deployment-payer
 * rule first (decided 2026-11-08, ee/billing/payer-media-retention.ts).
 *
 * On a deployment with a payer every user is stored on the free tier while the
 * payer holds the plan, so any rule that reaps media by a user's own plan would
 * reap the whole instance. The two that exist, the free-tier sweep and the
 * canceled-subscription sweep, keep everyone's media while a payer is active.
 * This census fails the build on a third that does not.
 *
 * WHAT IS FLAGGED: a top-level function of a file in `backend/src` that BOTH
 *  - decides by plan: it filters a `profiles` query on a plan column (tier,
 *    subscription, top-ups, storage limit/usage), or a `subscriptions` query on
 *    its state; a query whose table the scan cannot see counts on the
 *    `profiles` columns. It also counts when it calls a plan derivation
 *    (`resolveEffectiveTier`, `resolveStoredTier`, `isPaygRetentionActive`);
 *  - clears media: it calls the delete funnel or a storage delete (under any
 *    local name), marks or blanks job outputs (`markJobOutputsCleaned`,
 *    `blankUrlsInEveryJobOutput`), writes `r2_key: null` / `r2_url: null`, or
 *    deletes `assets` / `jobs` rows.
 * Either half may sit in a function of the same file that it calls (the
 * sweeps' `reapAssetBatch`). A function that asks the rule is gated, so a
 * caller that reaches the halves only through it is not flagged.
 *
 * Each flagged function is listed below. `asks` means its FIRST statement is
 * `if (await mediaKeptByDeploymentPayer(...)) return …`, before it reads a
 * single user, and the scan holds it to that. `exempt` carries a reason why it
 * is not a sweep by plan. A new flagged function, or an `asks` entry that stops
 * asking first, fails here. What the rule then does is proved by
 * `cleanup-payer-retention.test.ts`.
 *
 * LIMITS, on purpose (the storage-delete census's scope): the halves are seen
 * within one file. A sweep that selects users through an RPC, or clears media
 * only through a helper exported from another file, is outside the scan. The
 * private plugin package is outside this repository.
 */
type Entry = { readonly payerRule: "asks" } | { readonly payerRule: "exempt"; readonly why: string }

const PLAN_KEYED_MEDIA_FUNCTIONS: Readonly<Record<string, Entry>> = {
  "ee/billing/cleanup-service.ts#cleanupFreeUserMedia": { payerRule: "asks" },
  "ee/billing/cleanup-service.ts#cleanupCanceledUserMedia": { payerRule: "asks" },
}

/** The deployment-payer rule (ee/billing/payer-media-retention.ts). */
const GATE = "mediaKeptByDeploymentPayer"
/** `profiles` columns that hold a user's own plan, or follow from it. */
const PROFILE_PLAN_COLUMNS = new Set([
  "tier",
  "subscription_tier",
  "subscription_ended_at",
  "subscription_credits",
  "credits_reset_at",
  "current_period_end",
  "lifetime_topup_credits",
  "last_topup_at",
  "storage_limit_bytes",
  "storage_used_bytes",
])
/** `subscriptions` columns that describe a subscription's state. */
const SUBSCRIPTION_PLAN_COLUMNS = new Set(["status", "tier", "current_period_start", "current_period_end", "canceled_at", "cancel_at_period_end"])
/** The PostgREST filters supabase-js chains. */
const FILTERS = new Set(["eq", "neq", "in", "is", "not", "lt", "lte", "gt", "gte", "like", "ilike", "contains", "containedBy", "overlaps", "match", "or", "filter"])
/** Plan derivations (@nodaro/shared): a decision made on one is a decision by plan. */
const PLAN_HELPERS = new Set(["resolveEffectiveTier", "resolveStoredTier", "isPaygRetentionActive"])
/** What deletes a file or clears a pointer to one. */
const CLEARING = new Set([
  "deleteKeysRecordingFailures",
  "deleteKeyRecordingFailure",
  "deleteFromR2",
  "batchDeleteFromR2",
  "DeleteObjectCommand",
  "DeleteObjectsCommand",
  "markJobOutputsCleaned",
  "blankUrlsInEveryJobOutput",
])
/** A library row's pointer to its file. */
const FILE_POINTERS = new Set(["r2_key", "r2_url"])
/** Tables whose row delete drops a library entry or a job's output. */
const MEDIA_TABLES = new Set(["assets", "jobs"])

/** What one top-level function does, on its own (before the same-file closure). */
interface Direct {
  readonly plan: boolean
  readonly clears: boolean
  readonly asks: boolean
  readonly callees: ReadonlySet<string>
}

/** What a top-level function reaches, once the same-file calls are followed. */
export interface FunctionVerdict {
  readonly planKeyed: boolean
  readonly clearsMedia: boolean
  readonly asks: boolean
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) return true
  return (
    (ts.isFunctionDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAccessExpression(p)) &&
    (p as { name?: ts.Node }).name === id
  )
}

/** Each local name the file binds to an imported one: `import { a as b }`, `const { a: b } = await import(…)`. */
function importedNames(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>()
  const visit = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n)) names.set(n.name.text, (n.propertyName ?? n.name).text)
    if (ts.isBindingElement(n) && n.propertyName && ts.isIdentifier(n.propertyName) && ts.isIdentifier(n.name)) {
      names.set(n.name.text, n.propertyName.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return names
}

/** The table a query chain reads (`supabase.from("t")…`), or null when the scan cannot see it. */
function chainTable(expr: ts.Expression): string | null {
  let e: ts.Node = expr
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) {
      e = e.expression
    } else if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const first = e.arguments[0]
      if (e.expression.name.text === "from" && first && ts.isStringLiteralLike(first)) return first.text
      e = e.expression.expression
    } else if (ts.isPropertyAccessExpression(e)) {
      e = e.expression
    } else {
      return null
    }
  }
}

/** A string or template argument's literal text (a substitution reads as a break). */
function literalText(e: ts.Expression): string | null {
  if (ts.isStringLiteralLike(e)) return e.text
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => `\u0000${s.literal.text}`).join("")
  return null
}

/** The columns a filter call names. */
function filterColumns(call: ts.CallExpression, method: string): string[] {
  const first = call.arguments[0]
  if (!first) return []
  if (method === "match") {
    if (!ts.isObjectLiteralExpression(first)) return []
    return first.properties.flatMap((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? [p.name.text] : []))
  }
  const text = literalText(first)
  if (text === null) return []
  // `.or("tier.eq.free,and(tier.is.null,…)")`: each `<column>.` that opens a condition.
  if (method === "or") return [...text.matchAll(/(?:^|[,(])\s*([a-z_][a-z0-9_]*)\./g)].map((m) => m[1]!)
  return [text]
}

/** Whether a filter call keys its query on a plan column. */
function isPlanFilter(call: ts.CallExpression): boolean {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || !FILTERS.has(callee.name.text)) return false
  const table = chainTable(callee.expression)
  const columns =
    table === "subscriptions" ? SUBSCRIPTION_PLAN_COLUMNS : table === "profiles" || table === null ? PROFILE_PLAN_COLUMNS : null
  if (!columns) return false
  return filterColumns(call, callee.name.text).some((c) => columns.has(c))
}

/** Whether a statement is `if (await <gate>(…)) return …` with no else. */
function asksTheRule(stmt: ts.Statement | undefined, canonical: (name: string) => string): boolean {
  if (!stmt || !ts.isIfStatement(stmt) || stmt.elseStatement) return false
  const cond = stmt.expression
  if (!ts.isAwaitExpression(cond) || !ts.isCallExpression(cond.expression)) return false
  const callee = cond.expression.expression
  const named =
    (ts.isIdentifier(callee) && canonical(callee.text) === GATE) || (ts.isPropertyAccessExpression(callee) && callee.name.text === GATE)
  if (!named) return false
  const then = stmt.thenStatement
  return ts.isReturnStatement(then) || (ts.isBlock(then) && then.statements.some(ts.isReturnStatement))
}

/** The file's top-level functions by name: declarations, and `const f = (…) => …` / `function` expressions. */
function topLevelFunctions(sf: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const fns = new Map<string, ts.FunctionLikeDeclaration>()
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body) fns.set(stmt.name?.text ?? "default", stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const init = unwrap(d.initializer)
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.set(d.name.text, init)
      }
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      for (const m of stmt.members) {
        if (ts.isMethodDeclaration(m) && m.body && ts.isIdentifier(m.name)) fns.set(`${stmt.name.text}.${m.name.text}`, m)
      }
    }
  }
  return fns
}

function directOf(fn: ts.FunctionLikeDeclaration, local: ReadonlySet<string>, canonical: (name: string) => string): Direct {
  let plan = false
  let clears = false
  const callees = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      if (isPlanFilter(n)) plan = true
      const callee = n.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "delete" && MEDIA_TABLES.has(chainTable(callee.expression) ?? "")) {
        clears = true
      }
    }
    if (ts.isIdentifier(n) && !isDeclarationName(n)) {
      const name = canonical(n.text)
      if (CLEARING.has(name)) clears = true
      if (PLAN_HELPERS.has(name)) plan = true
      if (local.has(n.text)) callees.add(n.text)
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (CLEARING.has(n.name.text)) clears = true
      if (PLAN_HELPERS.has(n.name.text)) plan = true
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && CLEARING.has(n.argumentExpression.text)) {
      clears = true
    }
    if (ts.isPropertyAssignment(n) && n.initializer.kind === ts.SyntaxKind.NullKeyword) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name) ? n.name.text : ""
      if (FILE_POINTERS.has(key)) clears = true
    }
    ts.forEachChild(n, visit)
  }
  if (fn.body) visit(fn.body)
  const first = fn.body && ts.isBlock(fn.body) ? fn.body.statements[0] : undefined
  return { plan, clears, asks: asksTheRule(first, canonical), callees }
}

/** Each top-level function of `text`, with what it reaches through the file's own calls. */
export function scanFunctions(file: string, text: string): Map<string, FunctionVerdict> {
  const sf = parse(file, text)
  const aliases = importedNames(sf)
  const canonical = (name: string): string => aliases.get(name) ?? name
  const fns = topLevelFunctions(sf)
  const local = new Set(fns.keys())
  const direct = new Map([...fns].map(([name, fn]) => [name, directOf(fn, local, canonical)]))
  const reaches = (start: string, half: "plan" | "clears"): boolean => {
    const seen = new Set([start])
    const stack = [start]
    while (stack.length > 0) {
      const d = direct.get(stack.pop()!)!
      if (d[half]) return true
      for (const callee of d.callees) {
        const dc = direct.get(callee)
        // A callee that asks the rule is gated: what it reaches is not its caller's.
        if (!dc || dc.asks || seen.has(callee)) continue
        seen.add(callee)
        stack.push(callee)
      }
    }
    return false
  }
  return new Map(
    [...direct].map(([name, d]) => [name, { planKeyed: reaches(name, "plan"), clearsMedia: reaches(name, "clears"), asks: d.asks }]),
  )
}

/** The flagged functions of `text`, by name. */
function flaggedIn(file: string, text: string): Map<string, FunctionVerdict> {
  return new Map([...scanFunctions(file, text)].filter(([, v]) => v.planKeyed && v.clearsMedia))
}

/** Every flagged function in backend/src, keyed `<file>#<function>`. */
function census(): Map<string, FunctionVerdict> {
  const found = new Map<string, FunctionVerdict>()
  for (const file of sourceFiles()) {
    if (file.endsWith(".d.ts")) continue
    const text = readFileSync(file, "utf8")
    // Cheap pre-filter, a superset of the AST match: both halves must appear as text at all.
    if (!/tier|subscription|lifetime_topup|last_topup|credits_reset|current_period|storage_(?:limit|used)_bytes|PaygRetention/.test(text)) continue
    if (!/RecordingFailure|eleteFromR2|DeleteObjects?Command|markJobOutputsCleaned|blankUrlsInEveryJobOutput|r2_key|r2_url|\.delete\(/.test(text)) continue
    for (const [name, verdict] of flaggedIn(file, text)) found.set(`${relPath(file)}#${name}`, verdict)
  }
  return found
}

describe("the plan-keyed media scan sees every spelling", () => {
  const flagged = (text: string): string[] => [...flaggedIn("x.ts", text).keys()]
  const FUNNEL = `import { deleteKeysRecordingFailures } from "../../lib/storage-delete.js"`

  it.each([
    ["an eq on profiles.tier, then the funnel", `${FUNNEL}\nexport async function sweep() {\n  const { data } = await supabase.from("profiles").select("id").eq("tier", "free").limit(10)\n  await deleteKeysRecordingFailures(keys(data), "retention")\n}`],
    ["an or() naming the tier, then a job-output mark", `import { markJobOutputsCleaned } from "../../lib/job-output-references.js"\nexport async function sweep() {\n  await supabase.from("profiles").select("id").or("tier.eq.free,tier.is.null").limit(10)\n  await markJobOutputsCleaned(ids, new Set())\n}`],
    ["a template or() on the cancellation date, then a pointer cleared", "export async function sweep() {\n  await supabase.from(\"profiles\").select(\"id\").or(`subscription_ended_at.is.null,subscription_ended_at.lt.${cutoff}`).limit(5)\n  await supabase.from(\"assets\").update({ r2_key: null }).in(\"id\", ids)\n}"],
    ["a subscriptions status filter, then rows deleted", `export async function sweep() {\n  await supabase.from("subscriptions").select("user_id").eq("status", "canceled").limit(5)\n  await supabase.from("jobs").delete().in("user_id", ids)\n}`],
    ["a match() on the tier, then a storage delete", `import { batchDeleteFromR2 } from "../../lib/storage.js"\nexport async function sweep() {\n  await supabase.from("profiles").select("id").match({ tier: "free" }).limit(5)\n  await batchDeleteFromR2(keys)\n}`],
    ["an aliased funnel", `import { deleteKeysRecordingFailures as drop } from "../../lib/storage-delete.js"\nexport async function sweep() {\n  await supabase.from("profiles").select("id").neq("tier", "pro").limit(5)\n  await drop(keys, "retention")\n}`],
    ["a storage-limit filter, then the funnel off a dynamic import", `export async function sweep() {\n  const { deleteKeysRecordingFailures: drop } = await import("../../lib/storage-delete.js")\n  await supabase.from("profiles").select("id").gt("storage_used_bytes", 0).limit(5)\n  await drop(keys, "retention")\n}`],
    ["a plan derivation, then a storage delete off a module", `export async function sweep(row: Row) {\n  if (resolveEffectiveTier(row) !== "free") return\n  const storage = await import("../../lib/storage.js")\n  await storage.deleteFromR2(key)\n}`],
    ["a query whose table the scan cannot see, on a plan column", `${FUNNEL}\nexport async function sweep() {\n  let q = supabase.from("profiles").select("id")\n  q = q.lt("subscription_ended_at", cutoff)\n  await deleteKeysRecordingFailures(await keysOf(q), "retention")\n}`],
    ["the plan half in a same-file helper", `${FUNNEL}\nasync function freeUsers() { return supabase.from("profiles").select("id").eq("tier", "free").limit(9) }\nexport async function sweep() {\n  const users = await freeUsers()\n  await deleteKeysRecordingFailures(keysOf(users), "retention")\n}`],
    ["the clearing half in a same-file helper", `${FUNNEL}\nconst reap = async (keys: string[]) => { await deleteKeysRecordingFailures(keys, "retention") }\nexport async function sweep() {\n  await supabase.from("profiles").select("id").eq("tier", "free").limit(9)\n  await reap(keys)\n}`],
  ])("flags %s", (_name, text) => {
    expect(flagged(text)).toEqual(["sweep"])
  })

  it.each([
    ["a plan filter that clears nothing (a downgrade, the expiry net's shape)", `export async function expire() {\n  await supabase.from("profiles").select("id").neq("tier", "free").limit(9)\n  await supabase.from("profiles").update({ tier: "free" }).in("id", ids)\n}`],
    ["a media clear that keys on no plan (the soft-delete purge's shape)", `${FUNNEL}\nexport async function purge() {\n  await supabase.from("locations").select("id").lt("deleted_at", cutoff).limit(9)\n  await deleteKeysRecordingFailures(keys, "location")\n}`],
    ["a tier read off a config table", `${FUNNEL}\nexport async function config() {\n  await supabase.from("tier_config").select("x").eq("tier", tier).single()\n  await deleteKeysRecordingFailures(keys, "retention")\n}`],
    ["the plan filter only in a comment or a string", `${FUNNEL}\n// supabase.from("profiles").eq("tier", "free")\nconst NOTE = 'or("tier.eq.free")'\nexport async function purge() { await deleteKeysRecordingFailures(keys, "x") }`],
    ["a caller that reaches both halves only through a sweep that asks", `import { mediaKeptByDeploymentPayer } from "./payer-media-retention.js"\n${FUNNEL}\nexport async function sweep() {\n  if (await mediaKeptByDeploymentPayer("s")) return\n  await supabase.from("profiles").select("id").eq("tier", "free").limit(9)\n  await deleteKeysRecordingFailures(keys, "retention")\n}\nexport async function nightly() { await sweep() }`],
  ])("does not flag %s", (_name, text) => {
    expect(flagged(text).filter((n) => n !== "sweep")).toEqual([])
  })

  const SWEEP_BODY = `await supabase.from("profiles").select("id").eq("tier", "free").limit(9)\n  await deleteKeysRecordingFailures(keys, "retention")`
  const GATE_IMPORT = `import { mediaKeptByDeploymentPayer } from "./payer-media-retention.js"\n${FUNNEL}`
  const asks = (text: string): boolean | undefined => scanFunctions("x.ts", text).get("sweep")?.asks

  it.each([
    ["first, returning", `${GATE_IMPORT}\nexport async function sweep() {\n  if (await mediaKeptByDeploymentPayer("s")) return ZERO\n  ${SWEEP_BODY}\n}`],
    ["first, returning from a block", `${GATE_IMPORT}\nexport async function sweep() {\n  if (await mediaKeptByDeploymentPayer("s")) {\n    return ZERO\n  }\n  ${SWEEP_BODY}\n}`],
    ["under an alias", `import { mediaKeptByDeploymentPayer as kept } from "./payer-media-retention.js"\n${FUNNEL}\nexport async function sweep() {\n  if (await kept("s")) return\n  ${SWEEP_BODY}\n}`],
  ])("counts the rule asked %s", (_name, text) => {
    expect(asks(text)).toBe(true)
  })

  it.each([
    ["after the users are read", `${GATE_IMPORT}\nexport async function sweep() {\n  const users = await supabase.from("profiles").select("id").eq("tier", "free").limit(9)\n  if (await mediaKeptByDeploymentPayer("s")) return\n  await deleteKeysRecordingFailures(keys, "retention")\n}`],
    ["negated", `${GATE_IMPORT}\nexport async function sweep() {\n  if (!(await mediaKeptByDeploymentPayer("s"))) return\n  ${SWEEP_BODY}\n}`],
    ["without await (a promise is always truthy)", `${GATE_IMPORT}\nexport async function sweep() {\n  if (mediaKeptByDeploymentPayer("s")) return\n  ${SWEEP_BODY}\n}`],
    ["without returning", `${GATE_IMPORT}\nexport async function sweep() {\n  if (await mediaKeptByDeploymentPayer("s")) console.info("kept")\n  ${SWEEP_BODY}\n}`],
    ["with an else", `${GATE_IMPORT}\nexport async function sweep() {\n  if (await mediaKeptByDeploymentPayer("s")) return\n  else console.info("swept")\n  ${SWEEP_BODY}\n}`],
    ["only in another function", `${GATE_IMPORT}\nasync function kept() { return mediaKeptByDeploymentPayer("s") }\nexport async function sweep() {\n  if (await kept()) return\n  ${SWEEP_BODY}\n}`],
  ])("does not count the rule asked %s", (_name, text) => {
    expect(asks(text)).toBe(false)
  })
})

describe("plan-keyed media census: every sweep by a user's own plan asks the deployment-payer rule", { timeout: SCAN_TIMEOUT_MS }, () => {
  const found = census()

  it("finds both media sweeps (the scan works)", () => {
    expect([...found.keys()]).toEqual(
      expect.arrayContaining(["ee/billing/cleanup-service.ts#cleanupFreeUserMedia", "ee/billing/cleanup-service.ts#cleanupCanceledUserMedia"]),
    )
  })

  it("lists every function that clears media by a user's own plan", () => {
    const unlisted = [...found.keys()].filter((key) => !(key in PLAN_KEYED_MEDIA_FUNCTIONS))
    expect(
      unlisted,
      `start these with \`if (await ${GATE}(…)) return …\` (ee/billing/payer-media-retention.ts) and list them as "asks", or list them as "exempt" with the reason they are not a sweep by plan`,
    ).toEqual([])
  })

  it("lists nothing the scan no longer finds", () => {
    const stale = Object.keys(PLAN_KEYED_MEDIA_FUNCTIONS).filter((key) => !found.has(key))
    expect(stale).toEqual([])
  })

  it("every `asks` entry asks the rule first, before it reads a single user", () => {
    const wrong = Object.entries(PLAN_KEYED_MEDIA_FUNCTIONS)
      .filter(([key, entry]) => entry.payerRule === "asks" && found.get(key)?.asks !== true)
      .map(([key]) => key)
    expect(wrong, `the first statement must be \`if (await ${GATE}(…)) return …\``).toEqual([])
  })

  it("every `exempt` entry says why", () => {
    for (const [key, entry] of Object.entries(PLAN_KEYED_MEDIA_FUNCTIONS)) {
      if (entry.payerRule === "exempt") expect(entry.why.length, key).toBeGreaterThan(20)
    }
  })
})
