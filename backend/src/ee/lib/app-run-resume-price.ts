// @registry-enumerates prices a Retry's steps by estimateRunSetCreditsWithoutUgc over whatever node types the app graph holds, UGC chains priced by their parts
/**
 * What an app run's Retry costs (routes/app-run-resume.ts): only the steps the failed run did not
 * complete, each priced as the run will charge it — never the steps it hands on.
 *
 * - Every step but a UGC video's: the run set's estimate (`estimateRunSetCreditsWithoutUgc`).
 * - A UGC video's steps in the run set: their parts of the video's estimate, as every UGC run is
 *   priced. A UGC Clip whose UGC Clips completed (its tickets are seeded, never made again) is priced
 *   from those very tickets (the ticket quote), and a clip the failed run finished is free only when
 *   it is the runner's own finished take of exactly that clip under this run's key — the chain root
 *   the Retry sends (lib/continuation-run-root.ts) — checked against the runner's jobs
 *   (`verifiedReusedClips`). A clip that cannot be checked is priced in full.
 *
 * The hold is what the run reserves while its clips render (each at the plugin's hold factor), the
 * figure a balance is checked against. Neither is ever below what the run charges.
 */
import { ugcClipTicketQuote, ugcChainInput, ugcChains, ugcSumPerNode } from "@nodaro/render-rules"
import { ugcClipBody, ugcKeptOutputs } from "@nodaro/shared/ugc"
import { estimateRunSetCreditsWithoutUgc } from "../billing/credits.js"
import { estimateUgcRun, quoteUgcTickets } from "./ugc-estimate.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { verifiedReusedClips, type UgcReuseClaim } from "./ugc-clip-reuse-check.js"

type Node = { readonly id: string; readonly type: string; readonly data?: Record<string, unknown> }
type Edge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }
/** A node's state in the run the Retry continues, as far as pricing reads it. */
type State = { readonly status?: string; readonly output?: Record<string, unknown>; readonly jobIds?: readonly string[]; readonly jobRows?: readonly number[] }

export interface AppRunResumeCredits {
  /** What the Retry is expected to charge (base credits, before any creator markup). */
  readonly credits: number
  /** What it holds while its clips render: the figure the balance is checked against. */
  readonly hold: number
  /** The clips the failed run finished that the Retry hands back free (checked against the runner's jobs). */
  readonly reusedClips: number
}

/** The clips a failed UGC Clip finished, as claims at the Re-render count the Retry sends. */
function claimsOf(state: State | undefined, tickets: readonly string[], rerender: unknown): UgcReuseClaim[] {
  const jobs = state?.jobIds ?? []
  const rows = state?.jobRows ?? []
  if (jobs.length === 0 || rows.length !== jobs.length) return []
  const counts = rerender && typeof rerender === "object" ? (rerender as Readonly<Record<string, number>>) : undefined
  return jobs.flatMap((jobId, i) => {
    const row = rows[i]!
    const ticket = tickets[row]
    if (ticket === undefined) return []
    const body = ugcClipBody({ ticketWire: ticket, rerender: counts })
    return "error" in body ? [] : [{ clip: row + 1, jobId, nonce: body.body.nonce as number }]
  })
}

export async function appRunResumeCredits(input: {
  /** The runner, under the payer the Retry reserves from. */
  readonly caller: { userId: string; billingContext?: BillingContext }
  /** The graph the Retry executes: the version's snapshot with the run's overrides merged. */
  readonly nodes: readonly Node[]
  readonly edges: readonly Edge[]
  readonly runNodeIds: ReadonlySet<string>
  /** The failed run's node states (what the Retry is seeded from). */
  readonly sourceStates: Readonly<Record<string, State>>
  /** The run key the Retry's UGC Clip sends: the chain root. */
  readonly runKey: string
  /** The runner may use Speaker Map (`usecaseMulticamEstimateFor`): a use-case node is priced on every recording it reads. */
  readonly multicam?: boolean
}): Promise<AppRunResumeCredits> {
  const { caller, nodes, edges, runNodeIds, sourceStates, runKey } = input
  const rest = await (input.multicam ? estimateRunSetCreditsWithoutUgc(nodes, edges, runNodeIds, true) : estimateRunSetCreditsWithoutUgc(nodes, edges, runNodeIds))
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const keeps = (id: string, type: "ugc-script" | "ugc-creator") => ugcKeptOutputs(type, byId.get(id)?.data ?? {}) !== null
  const prices: Array<{ id: string; credits: number }> = []
  const holds: Array<{ id: string; credits: number }> = []
  let reusedClips = 0
  for (const chain of ugcChains(nodes, edges)) {
    const members = chain.members.filter(
      (m) =>
        m.part !== null &&
        runNodeIds.has(m.id) &&
        !(m.part === "script" && keeps(m.id, "ugc-script")) &&
        !(m.part === "creator" && keeps(m.id, "ugc-creator")),
    )
    if (members.length === 0) continue
    const estimate = await estimateUgcRun(caller, ugcChainInput(chain, nodes, edges).input)
    // The video's clips when they are fixed: its UGC Clips completed in the failed run and is seeded.
    const clipsState = chain.clipsId !== undefined && !runNodeIds.has(chain.clipsId) ? sourceStates[chain.clipsId] : undefined
    const saved =
      clipsState?.status === "completed" && clipsState.output
        ? ugcClipTicketQuote({ __listResults: clipsState.output.listResults, ugcOutputs: clipsState.output.ugcOutputs }, {})
        : null
    for (const m of members) {
      if (m.part === "clip" && saved) {
        const claims = claimsOf(sourceStates[m.id], saved.tickets, byId.get(m.id)?.data?.rerender)
        const handedBack = claims.length > 0 ? await verifiedReusedClips(caller.userId, saved.tickets, claims, runKey) : new Set<number>()
        reusedClips += handedBack.size
        // The ticket quote reads each ticket as the clip route receives it: the parsed wire.
        const tickets = saved.tickets.map((wire) => JSON.parse(wire) as unknown)
        const quote = await quoteUgcTickets(caller, tickets, false, saved.finishes, handedBack)
        prices.push({ id: m.id, credits: quote.parts.clip })
        holds.push({ id: m.id, credits: quote.holdParts.clip })
        continue
      }
      prices.push({ id: m.id, credits: estimate.parts[m.part!] })
      holds.push({ id: m.id, credits: estimate.holdParts[m.part!] })
    }
  }
  return { credits: rest + ugcSumPerNode(prices), hold: rest + ugcSumPerNode(holds), reusedClips }
}
