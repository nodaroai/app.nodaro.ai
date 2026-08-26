/**
 * Billing payer coverage — the derived guard over every reserve/commit/refund
 * site (E2 §4). A hand-maintained list of reserve sites drifted twice in three
 * days between the design and the first implementation read; this guard is the
 * replacement, and it is bootstrapped from the tree, never maintained by hand.
 *
 * THE RULE. Every call site matching a billing marker —
 *   `.reserveCredits(` / `.commitCredits(` / `.refundCredits(` (the
 *   CreditsService methods), `reserveCreditsForJob(` (the per-route helper),
 *   or a raw `rpc("reserve_credits"|"commit_credits"|"refund_credits")`
 * — must satisfy ONE of:
 *
 *   (a) it hands over the REQUEST: `reserveCreditsForJob(req, …)`. The payer
 *       context rides `req` and is resolved inside the one implementation —
 *       that is where P14 threads `req.billingContext`, so the ~150 routes
 *       that pass `req` are correct by construction and need no marker each;
 *   (b) it references the payer explicitly nearby: `billingContext`,
 *       `p_workspace_id`, or `workspaceId` within ±10 lines — the shape a
 *       P14-threaded site actually has (the context is an argument);
 *   (c) it carries `// billing-payer-ok: <reason>` beside or directly above.
 *       A bare marker with no reason is itself a finding.
 *
 * ONE marker family is satisfied BY CONSTRUCTION and requires none of the
 * three: the service-method calls `.commitCredits(` / `.refundCredits(`.
 * Since migration 351, `commit_credits` / `refund_credits` read the payer
 * FROM THE usage_logs ROW before writing anything — a caller cannot route the
 * settlement to the wrong pool, because the caller never chooses. The places
 * that CAN still get it wrong are the raw `rpc("commit_credits"|
 * "refund_credits")` sites (the service wrapper's own fallback bodies — the
 * design's billing-04/H22), and those stay covered markers. This narrowing is
 * a deliberate refinement of the E2 handoff's §4 letter, made because 351
 * moved the payer decision into the row: blanket-annotating ~60 settlement
 * callers with one identical comment would be decoration, and decoration is
 * the failure §4 exists to prevent.
 *
 * Four requirements, each a guard that shipped broken in the P9 cycle:
 *   1. comments are stripped BEFORE matching, CRLF-safe, with offsets
 *      preserved (a commented-out call once satisfied a guard; a naive
 *      stripper silently no-ops on CRLF and misaligns every line);
 *   2. the exemption is accepted on the line above as well as beside;
 *   3. a CALL is required, not a mention — an import line or an interface
 *      method declaration satisfies nothing;
 *   4. the guard is proven able to fire (the acceptance block below), because
 *      a guard that passes its own removal is decoration.
 *
 * A floor on the discovered count keeps the scanner from passing vacuously.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

// ---------------------------------------------------------------------------
// The scanner — exported shape so the acceptance block can prove it fires.
// ---------------------------------------------------------------------------

/** Blank out comments, preserving every byte offset and line ending. */
export function blankComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n\r]/g, " "))
  // (?<!:) — never treat a URL scheme's // (https://…) as a comment opener:
  // a real call sharing a line with a URL literal went invisible otherwise.
  out = out.replace(/(?<!:)\/\/[^\n\r]*/g, (m) => {
    // The exemption marker must SURVIVE stripping — it is a comment on purpose.
    if (/^\/\/\s*billing-payer-ok:/.test(m)) return m
    return " ".repeat(m.length)
  })
  return out
}

// Dotless alternatives catch destructured/aliased calls (`const { reserveCredits }`),
// and the rpc-name quote class includes backticks — both second-review escapes.
const MARKER_RE =
  /\.(?:reserveCredits|commitCredits|refundCredits)\s*\(|(?<![.\w])(?<!async )(?:reserveCredits|commitCredits|refundCredits|reserveCreditsForJob)\s*\(|\.rpc\(\s*["'`](?:reserve_credits|commit_credits|refund_credits)["'`]/g

const CONTEXT_RE = /\bbillingContext\b|\bp_workspace_id\b|\bworkspaceId\b/
const REQ_FIRST_ARG_RE = /reserveCreditsForJob\s*\(\s*(?:req|request)\b/
const EXEMPT_RE = /\/\/\s*billing-payer-ok:\s*(\S.*)?$/

export interface PayerFinding {
  file: string
  line: number
  marker: string
  reason: string
}

export function findUncoveredBillingSites(source: string, file = "<fixture>"): PayerFinding[] {
  const blanked = blankComments(source)
  const lines = blanked.split(/\r?\n/)
  const findings: PayerFinding[] = []

  for (const m of blanked.matchAll(MARKER_RE)) {
    const upTo = blanked.slice(0, m.index)
    const lineIdx = upTo.split(/\r?\n/).length - 1
    const markerText = m[0].trim()

    // Settlement service methods are satisfied by construction: the payer is
    // read from the usage_logs row inside the RPC (migration 351), never
    // chosen by the caller. See the header — raw rpc() settlement strings do
    // NOT take this exit.
    if (/^\.?(commitCredits|refundCredits)\s*\($/.test(markerText)) continue

    // (a) the request itself is handed over — the payer rides it.
    const local = lines.slice(lineIdx, lineIdx + 3).join("\n")
    if (REQ_FIRST_ARG_RE.test(local)) continue

    // (b) an explicit payer reference nearby.
    const windowText = lines.slice(Math.max(0, lineIdx - 10), lineIdx + 11).join("\n")
    if (CONTEXT_RE.test(windowText)) continue

    // (c) an exemption beside or directly above (up to 2 lines).
    let exempt = false
    let bareExemption = false
    for (let i = lineIdx; i >= Math.max(0, lineIdx - 2); i--) {
      const em = lines[i].match(EXEMPT_RE)
      if (em) {
        if (em[1] && em[1].trim().length > 0) exempt = true
        else bareExemption = true
        break
      }
    }
    if (exempt) continue

    findings.push({
      file,
      line: lineIdx + 1,
      marker: markerText,
      reason: bareExemption
        ? "billing-payer-ok marker with NO reason — the reason is the exemption"
        : "no req handover, no payer reference nearby, no billing-payer-ok exemption",
    })
  }
  return findings
}

export function countBillingMarkers(source: string): number {
  return [...blankComments(source).matchAll(MARKER_RE)].length
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue
      walk(full, out)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The guard itself.
// ---------------------------------------------------------------------------

describe("billing payer coverage — every reserve/commit/refund site names its payer story", () => {
  const files = walk(SRC)

  it("no billing site is uncovered", () => {
    const findings: PayerFinding[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      findings.push(...findUncoveredBillingSites(source, relative(SRC, file)))
    }
    expect(
      findings.map((f) => `${f.file}:${f.line} [${f.marker}] — ${f.reason}`),
      "each of these calls reserves, commits, or refunds credits without handing over the request, referencing the payer, or carrying a reasoned `// billing-payer-ok:` exemption — the payer decision can silently drop here",
    ).toEqual([])
  })

  it("the scanner actually finds the fleet (floor, not vacuous)", () => {
    let total = 0
    for (const file of files) total += countBillingMarkers(readFileSync(file, "utf8"))
    // ~150 route helpers + the service/RPC/worker sites. If this ever drops
    // below the floor, the markers moved and the scanner is matching air.
    expect(total).toBeGreaterThanOrEqual(50)
  })

  // -------------------------------------------------------------------------
  // Acceptance: the guard can fire, and each requirement above really holds.
  // -------------------------------------------------------------------------
  it("fires on an unscoped site and honours every carve-out", () => {
    const uncovered = `
      const id = await creditsService.reserveCredits(userId, 10, jobId)
    `
    expect(findUncoveredBillingSites(uncovered)).toHaveLength(1)

    const commentedOut = [
      "// const id = await creditsService.reserveCredits(userId, 10, jobId)",
      "const x = 1",
    ].join("\r\n") // CRLF on purpose — the stripper must handle it
    expect(findUncoveredBillingSites(commentedOut)).toHaveLength(0)

    const reqHandover = `
      const reservation = await reserveCreditsForJob(req, reply, job.id, model)
    `
    expect(findUncoveredBillingSites(reqHandover)).toHaveLength(0)

    const threaded = `
      const ctx = req.billingContext
      const id = await creditsService.reserveCredits(userId, 10, jobId, ctx)
    `
    expect(findUncoveredBillingSites(threaded)).toHaveLength(0)

    const exemptAbove = `
      // billing-payer-ok: personal payer by definition — an account top-up has no workspace
      await creditsService.reserveCredits(userId, 10, jobId)
    `
    expect(findUncoveredBillingSites(exemptAbove)).toHaveLength(0)

    const bareExemption = `
      // billing-payer-ok:
      await creditsService.reserveCredits(userId, 10, jobId)
    `
    expect(findUncoveredBillingSites(bareExemption)).toHaveLength(1)

    const mentionOnly = `
      import { reserveCreditsForJob } from "../middleware/credit-guard.js"
      interface Toolkit { reserveCredits: (a: string) => Promise<void> }
    `
    // An import names it without calling it with (\`(\`); the interface member
    // is not a dot-call. Neither is a site.
    expect(findUncoveredBillingSites(mentionOnly)).toHaveLength(0)

    const rawRpc = `
      const { data } = await supabase.rpc("reserve_credits", { p_user_id: u })
    `
    expect(findUncoveredBillingSites(rawRpc)).toHaveLength(1)

    // Settlement through the service is payer-safe by construction (the RPC
    // reads the payer from the row) — but the RAW rpc string is not.
    const settlementViaService = `
      await creditsService.commitCredits(logId, actual)
      await creditsService.refundCredits(logId)
    `
    expect(findUncoveredBillingSites(settlementViaService)).toHaveLength(0)
    const settlementRawRpc = `
      const { error } = await supabase.rpc("refund_credits", { p_usage_log_id: id })
    `
    expect(findUncoveredBillingSites(settlementRawRpc)).toHaveLength(1)
  })
})
