/**
 * Every credit reservation asks "is this account blocked?" FIRST.
 *
 * A blocked account must reserve nothing, on any lane — the route guard, the
 * orchestrator's nodes, pipelines, scene helpers, publish workers. The check is
 * not a property of each caller remembering it: it sits at the reserve SITES,
 * the few functions that call the `reserve_credits` / `reserve_job_credits`
 * RPC, and this guard fails the build on a site that does not make it.
 *
 * The rule, per site: the function that calls `.rpc(<reserve rpc>, …)` itself
 * awaits `refuseBlockedReservation(…)` (throwing lanes) or uses the awaited
 * answer of `blockedReservationRefusal(…)` ({ ok: false } lanes) EARLIER in its
 * own body. Not in a nested callback (which may never run), not after the RPC
 * (the money has moved), not un-awaited (a no-op plus an unhandled rejection),
 * and not with the refusal discarded.
 *
 * Parsed with the TypeScript compiler (`source-scan.ts`), not regexed, so
 * comments and log strings that merely mention an RPC name are not sites. And a
 * guard that quietly stops matching reads as coverage, so the scan also fails on
 * any reserve-RPC name it sees spelled somewhere it cannot follow ("teach the
 * guard"), and on finding fewer sites than exist today.
 *
 * The samples in the self-test below spell the RPC names inside strings; they
 * never reach the real scan because `sourceFiles()` skips `__tests__` dirs.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText } from "./source-scan.js"

const RESERVE_RPCS: ReadonlySet<string> = new Set(["reserve_credits", "reserve_job_credits"])
const GUARDS: ReadonlySet<string> = new Set(["refuseBlockedReservation", "blockedReservationRefusal"])
/** Guards whose ANSWER is the refusal: awaiting one and dropping the result refuses nothing. */
const ANSWER_GUARDS: ReadonlySet<string> = new Set(["blockedReservationRefusal"])

interface Site {
  where: string
  names: string[]
  guarded: boolean
}

interface ScanResult {
  sites: Site[]
  /** Reserve-RPC names spelled where no recognised `.rpc(` call consumes them. */
  orphans: string[]
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  )
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isTypeAssertionExpression(x) ||
    ts.isSatisfiesExpression(x) ||
    ts.isNonNullExpression(x)
  ) {
    x = x.expression
  }
  return x
}

function isLiteral(n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
}

/** `name(…)` or `x.name(…)` → "name". */
function calleeName(e: ts.Expression): string | null {
  const x = unwrap(e)
  if (ts.isIdentifier(x)) return x.text
  if (ts.isPropertyAccessExpression(x)) return x.name.text
  return null
}

/** `<anything>.rpc(…)`. */
function isRpcCall(n: ts.CallExpression): boolean {
  const callee = unwrap(n.expression)
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "rpc"
}

/** `const NAME = <expr>` anywhere in the file, so a name hoisted into a const is still followed. */
function constInitializers(sf: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>()
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Const) !== 0) {
      for (const d of n.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer)
      }
    }
    n.forEachChild(visit)
  }
  visit(sf)
  return out
}

/**
 * The literal spellings an rpc-name argument can evaluate to: a literal, either
 * branch of a conditional, either side of `??` / `||`, or a const holding one.
 * Anything else contributes nothing (and the orphan rule catches a reserve name
 * spelled in a shape this does not follow).
 */
function nameLiterals(
  e: ts.Expression,
  consts: Map<string, ts.Expression>,
  seen: Set<string> = new Set(),
): Array<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral> {
  const x = unwrap(e)
  if (isLiteral(x)) return [x]
  if (ts.isConditionalExpression(x)) {
    return [...nameLiterals(x.whenTrue, consts, seen), ...nameLiterals(x.whenFalse, consts, seen)]
  }
  if (
    ts.isBinaryExpression(x) &&
    (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...nameLiterals(x.left, consts, seen), ...nameLiterals(x.right, consts, seen)]
  }
  if (ts.isIdentifier(x) && !seen.has(x.text)) {
    const init = consts.get(x.text)
    if (init) {
      seen.add(x.text)
      return nameLiterals(init, consts, seen)
    }
  }
  return []
}

function scan(sf: ts.SourceFile, rel: string): ScanResult {
  const consts = constInitializers(sf)
  const guards: Array<{ fn: ts.Node | null; pos: number }> = []
  const calls: Array<{ fn: ts.Node | null; pos: number; node: ts.CallExpression; names: string[] }> = []
  const consumed = new Set<ts.Node>()
  const reserveLiterals: ts.Node[] = []
  /** `await x(...)` as a whole statement — its answer is thrown away. */
  const discarded = new Set<ts.Node>()

  // A hand-rolled walk (parseText sets no parent pointers) that carries the
  // innermost enclosing function, so "the same function" can be compared.
  const visit = (n: ts.Node, fn: ts.Node | null): void => {
    if (ts.isExpressionStatement(n)) {
      const e = unwrap(n.expression)
      if (ts.isAwaitExpression(e)) discarded.add(e)
    }
    if (isLiteral(n) && RESERVE_RPCS.has(n.text)) reserveLiterals.push(n)
    if (ts.isAwaitExpression(n)) {
      const inner = unwrap(n.expression)
      if (ts.isCallExpression(inner)) {
        const name = calleeName(inner.expression)
        if (name !== null && GUARDS.has(name) && !(ANSWER_GUARDS.has(name) && discarded.has(n))) {
          guards.push({ fn, pos: inner.getStart(sf) })
        }
      }
    }
    if (ts.isCallExpression(n) && isRpcCall(n) && n.arguments.length > 0) {
      const literals = nameLiterals(n.arguments[0]!, consts)
      const names = literals.map((l) => l.text).filter((t) => RESERVE_RPCS.has(t))
      if (names.length > 0) {
        for (const l of literals) consumed.add(l)
        calls.push({ fn, pos: n.getStart(sf), node: n, names })
      }
    }
    const inner = isFunctionLike(n) ? n : fn
    n.forEachChild((c) => visit(c, inner))
  }
  visit(sf, null)

  return {
    sites: calls.map((c) => ({
      where: `${rel}:${lineOf(sf, c.node)}`,
      names: c.names,
      guarded: guards.some((g) => g.fn === c.fn && g.pos < c.pos),
    })),
    orphans: reserveLiterals
      .filter((l) => !consumed.has(l))
      .map((l) => `${rel}:${lineOf(sf, l)}: "${(l as ts.StringLiteral).text}"`),
  }
}

function scanSample(code: string): { sites: number; unguarded: number; orphans: number } {
  const r = scan(parseText("probe.ts", code), "probe.ts")
  return { sites: r.sites.length, unguarded: r.sites.filter((s) => !s.guarded).length, orphans: r.orphans.length }
}

let real: ScanResult | null = null
function realScan(): ScanResult {
  if (real) return real
  const out: ScanResult = { sites: [], orphans: [] }
  eachSourceFile([...RESERVE_RPCS], (sf, rel) => {
    const r = scan(sf, rel)
    out.sites.push(...r.sites)
    out.orphans.push(...r.orphans)
  })
  real = out
  return out
}

describe("every credit reservation refuses a blocked account first", { timeout: SCAN_TIMEOUT_MS }, () => {
  it("finds the reserve sites (the guard is wired to something)", () => {
    const { sites } = realScan()
    expect(sites.length, "the reserve sites moved or the scan went blind — update this guard").toBeGreaterThanOrEqual(3)
    // `reserve_job_credits` is spelled ONLY inside CreditsService's conditional
    // rpc name: seeing it proves the conditional is followed in the real code.
    const names = new Set(sites.flatMap((s) => s.names))
    expect([...names].sort()).toEqual(["reserve_credits", "reserve_job_credits"])
  })

  it("every site awaits the block check in its own body, before the RPC", () => {
    const unguarded = realScan()
      .sites.filter((s) => !s.guarded)
      .map((s) => s.where)
    expect(
      unguarded,
      unguarded.length === 0
        ? ""
        : `These reserve credits without first asking whether the account is blocked:\n` +
            unguarded.map((u) => `  - src/${u}`).join("\n") +
            `\n\nAt the top of the reserving function, before the rpc: ` +
            `\`await refuseBlockedReservation(userId)\` (lanes that throw), or ` +
            `\`const blocked = await blockedReservationRefusal(userId); if (blocked) return { ok: false, reason: blocked.code, detail: blocked.message }\` ` +
            `(lanes that answer { ok: false }). Both come from lib/access-blocks.ts.`,
    ).toEqual([])
  })

  it("no reserve RPC name is spelled anywhere the guard cannot follow", () => {
    const { orphans } = realScan()
    expect(
      orphans,
      orphans.length === 0
        ? ""
        : `A reserve RPC name appears outside a \`.rpc(<name>, …)\` call this guard understands:\n` +
            orphans.map((o) => `  - src/${o}`).join("\n") +
            `\n\nPass the name to .rpc() directly (a literal, a conditional of literals, or a const ` +
            `holding one), or teach this guard the new shape — otherwise the site it reaches is unchecked.`,
    ).toEqual([])
  })

  describe("self-test", () => {
    it("passes a guarded site in every shape the real code uses", () => {
      // The throwing lane — a static method, conditional rpc name.
      expect(
        scanSample(`
          class CreditsService {
            static async reserveCredits(userId: string, options?: { oncePerJob?: boolean }) {
              await refuseBlockedReservation(userId)
              const { data } = await supabase.rpc(options?.oncePerJob ? "reserve_job_credits" : "reserve_credits", { p_user_id: userId })
              return data
            }
          }`),
      ).toEqual({ sites: 1, unguarded: 0, orphans: 0 })

      // The { ok: false } lane — the answer is used.
      expect(
        scanSample(`
          export async function reservePipelineCredits(args: { userId: string; supabase: any }) {
            const blocked = await blockedReservationRefusal(args.userId)
            if (blocked) return { ok: false, reason: blocked.code, detail: blocked.message }
            const { data, error } = await args.supabase.rpc("reserve_credits", { p_user_id: args.userId })
            return { ok: !error, data }
          }`),
      ).toEqual({ sites: 1, unguarded: 0, orphans: 0 })

      // A name hoisted into a const is followed, and still has to be guarded.
      expect(
        scanSample(`
          const RESERVE = "reserve_credits"
          export const reserve = async (userId: string) => {
            await refuseBlockedReservation(userId)
            return (client ?? supabase).rpc(RESERVE, {})
          }`),
      ).toEqual({ sites: 1, unguarded: 0, orphans: 0 })
    })

    it("fails a site that does not refuse first", () => {
      const failing: Record<string, string> = {
        "no check at all": `async function r(u: string) { return supabase.rpc("reserve_credits", {}) }`,
        "check AFTER the rpc": `
          async function r(u: string) {
            const out = await supabase.rpc("reserve_credits", {})
            await refuseBlockedReservation(u)
            return out
          }`,
        "check in ANOTHER function": `
          async function check(u: string) { await refuseBlockedReservation(u) }
          async function r(u: string) { await check(u); return supabase.rpc("reserve_job_credits", {}) }`,
        "check in a nested callback that may never run": `
          async function r(u: string) {
            const later = async () => { await refuseBlockedReservation(u) }
            return supabase.rpc("reserve_credits", {})
          }`,
        "check not awaited": `
          async function r(u: string) {
            refuseBlockedReservation(u)
            return supabase.rpc("reserve_credits", {})
          }`,
        "refusal awaited and thrown away": `
          async function r(u: string) {
            await blockedReservationRefusal(u)
            return supabase.rpc("reserve_credits", {})
          }`,
        "only one branch of a conditional is a reserve rpc": `
          async function r(u: string, dry: boolean) { return supabase.rpc(dry ? "get_credit_summary" : "reserve_credits", {}) }`,
      }
      for (const [label, code] of Object.entries(failing)) {
        expect(scanSample(code), label).toEqual({ sites: 1, unguarded: 1, orphans: 0 })
      }
    })

    it("fails a reserve name spelled where it cannot be followed", () => {
      expect(
        scanSample(`
          const NAMES = { reserve: "reserve_credits" }
          async function r(u: string) { await refuseBlockedReservation(u); return supabase.rpc(NAMES.reserve, {}) }`),
      ).toEqual({ sites: 0, unguarded: 0, orphans: 1 })
      expect(
        scanSample(`async function r(u: string) { return supabase["rpc"]("reserve_job_credits", {}) }`),
      ).toEqual({ sites: 0, unguarded: 0, orphans: 1 })
    })

    it("ignores comments, log text and other RPCs", () => {
      expect(
        scanSample(`
          // supabase.rpc("reserve_credits") is called by CreditsService
          /** reserve_job_credits: the once-per-job lane */
          async function f(msg: string) {
            console.error("[credits] reserve_credits RPC failed:", msg)
            await supabase.rpc("refund_credits", {})
          }`),
      ).toEqual({ sites: 0, unguarded: 0, orphans: 0 })
    })
  })
})
