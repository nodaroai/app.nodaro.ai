/**
 * What "Run from here" on a node will charge, for the price its button
 * quotes. It is the run's own estimate, not a second one: the same node set
 * the run's confirm gate prices (`runFromHereExecutable`) and the same
 * estimate the Execute button and that gate use (`estimateRunCredits` — the
 * price of the id each node will reserve, × fan-out × per-unit units). A Text
 * node's button used to sum its own static fallback figures instead: no
 * markup, and blind to a downstream node's tier (it quoted Pro's ten-minute
 * Video Analysis row for a Fast run).
 *
 * A run set that holds UGC nodes is priced with the server's figure for its
 * UGC part (`ugcRunCredits`), from the cached answers (one per UGC video) the
 * run's confirm and balance check read too. The button never waits for them:
 * until they land the figure is the editor's own, and `useRunSetPrice` says so
 * (`estimating`).
 *
 * Prices not cached yet are fetched, then the figure is recomputed. Mount it
 * only while the button shows — it recomputes on every graph change.
 */
import { useEffect, useMemo, useState } from "react"
import { hashKey, useQueries } from "@tanstack/react-query"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCachedModelCredits, prefetchModelCreditCosts } from "@/hooks/use-model-credit-cost"
import { runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import type { RunUnpriced } from "@/components/editor/workflow-editor/run-unpriced"
import { runFromHereExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import {
  ugcRunCredits,
  ugcRunEstimateQuery,
  ugcRunInputs,
  ugcRunTicketQuery,
  ugcRunTicketQuotes,
  type UgcAnswerOf,
  type UgcPriceState,
  type UgcTicketAnswerOf,
} from "@/components/editor/workflow-editor/ugc-run-estimate"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** A run set's price: the figure every surface quotes, what the run can hold, and why it is not the server's checked figure. */
export interface RunSetPrice {
  readonly credits: number
  readonly hold: number
  /** The figure is marked as an estimate: `unchecked` says why. */
  readonly estimating: boolean
  readonly unchecked?: UgcPriceState
  /**
   * The figure holds a metered LLM call's ESTIMATE (charged its actual usage after the run) — the
   * server's own flag, a UGC part's included: shown `~`, with no "unchecked" note.
   */
  readonly approx: boolean
  /**
   * A node of the set is a metered LLM call the server refuses to price (`llm_model_unpriced`): the
   * figure leaves it out and the run would be refused, so every surface says it is unpriced instead
   * of quoting it — with the server's sentence (`message`) on hover.
   */
  readonly unpriced?: RunUnpriced
}

const NO_PRICE: RunSetPrice = { credits: 0, hold: 0, estimating: false, approx: false }

/** The server's answers for a run set's UGC videos. */
export interface UgcRunAnswers {
  /** A video's answer, undefined until it lands or when it cannot be had. */
  readonly answerOf: UgcAnswerOf
  /** The quote of a UGC Clip's saved clips, undefined until it lands or when it cannot be had (the estimate prices them then). */
  readonly ticketAnswerOf: UgcTicketAnswerOf
  /** An answer could not be had at all: the figure is the editor's own. */
  readonly failed: boolean
  /** A re-check of an older answer failed: the figure is that answer, no longer checked. */
  readonly held: boolean
}

const NO_ANSWERS: UgcRunAnswers = { answerOf: () => undefined, ticketAnswerOf: () => undefined, failed: false, held: false }

/**
 * The server's answers for the UGC videos of a run set, one per video: the
 * cached answers every surface reads. The run handlers read the same client
 * outside React, so it is passed here rather than taken from context. Never
 * waits.
 */
export function useUgcRunAnswers(executable: WorkflowNode[], nodes: WorkflowNode[], edges: WorkflowEdge[]): UgcRunAnswers {
  const inputs = useMemo(() => (hasCredits() ? ugcRunInputs(executable, nodes, edges) : []), [executable, nodes, edges])
  const tickets = useMemo(() => (hasCredits() ? ugcRunTicketQuotes(executable, nodes, edges) : []), [executable, nodes, edges])
  const results = useQueries({ queries: inputs.map((input) => ugcRunEstimateQuery(input)) }, queryClient)
  const ticketResults = useQueries({ queries: tickets.map((quote) => ugcRunTicketQuery(quote)) }, queryClient)
  // Rebuilt only when an answer changes.
  const signature = [...results, ...ticketResults].map((r) => `${r.status}:${r.dataUpdatedAt}`).join("|")
  return useMemo(() => {
    if (inputs.length === 0) return NO_ANSWERS
    const byKey = new Map(inputs.map((input, i) => [hashKey(ugcRunEstimateQuery(input).queryKey), results[i]?.data] as const))
    const ticketsByKey = new Map(tickets.map((quote, i) => [hashKey(ugcRunTicketQuery(quote).queryKey), ticketResults[i]?.data] as const))
    return {
      answerOf: (input) => byKey.get(hashKey(ugcRunEstimateQuery(input).queryKey)),
      // A quote that cannot be had is not flagged: those clips are then priced at the estimate's full price.
      ticketAnswerOf: (quote) => ticketsByKey.get(hashKey(ugcRunTicketQuery(quote).queryKey)),
      failed: results.some((r) => r.isError && r.data === undefined),
      held: results.some((r) => r.isError && r.data !== undefined),
    }
    // `signature` stands for `results` and `ticketResults`, new arrays on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, tickets, signature])
}

/**
 * The price of running `executable` — the run's own estimate — with its prices
 * fetched when cold, for a button or a badge. `nodes` is the graph the run
 * executes: for a run with input overrides (Render final), the OVERRIDDEN
 * graph, never the canvas. Any run-set price (Run from here, Run up to here,
 * Render final, Update preview) is this hook over its own set. `estimating`:
 * the set has a UGC part whose server figure is not in (yet) or is not checked
 * (its re-check failed, or a saved script's length cannot be read). `hold`:
 * what the run can hold while it renders, the balance check's figure.
 */
export function useRunSetPrice(
  executable: WorkflowNode[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): RunSetPrice {
  const [pricesLoaded, setPricesLoaded] = useState(0)

  useEffect(() => {
    if (!hasCredits() || executable.length === 0) return
    // Every id the run is priced at: each of several providers' own too.
    const ids = runModelIds(executable, nodes, edges)
    const missing = ids.filter((id) => getCachedModelCredits(id) === undefined)
    if (missing.length === 0) return
    let cancelled = false
    void prefetchModelCreditCosts(missing).then(() => {
      if (!cancelled) setPricesLoaded((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [executable, nodes, edges])

  const answers = useUgcRunAnswers(executable, nodes, edges)

  return useMemo(() => {
    if (!hasCredits()) return NO_PRICE
    const figure = ugcRunCredits(executable, nodes, edges, getCachedModelCredits, answers.answerOf, answers.ticketAnswerOf)
    const unchecked = runSetPriceState(figure, answers)
    return {
      credits: figure.credits,
      hold: figure.hold,
      estimating: unchecked !== undefined,
      approx: figure.approx,
      ...(unchecked ? { unchecked } : {}),
      ...(figure.unpriced ? { unpriced: figure.unpriced } : {}),
    }
    // `pricesLoaded` re-reads the cache once fetched prices land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executable, nodes, edges, pricesLoaded, answers])
}

/** Why a figure that never waits is not the server's checked one, or undefined when it is (or has no UGC part). */
export function runSetPriceState(
  figure: { readonly estimate: "server" | "client" | "none"; readonly lengthUnread: boolean; readonly screenshotsUnread: boolean },
  answers: Pick<UgcRunAnswers, "failed" | "held">,
): UgcPriceState | undefined {
  if (figure.estimate === "client") return answers.failed ? "editor" : "checking"
  // A saved plan's cards that could not be read are the editor's guess: not the server's checked figure.
  if (figure.estimate === "server") return answers.held ? "held" : figure.lengthUnread ? "length" : figure.screenshotsUnread ? "editor" : undefined
  return undefined
}

/** The figure alone: `useRunSetPrice(...).credits`. */
export function useRunSetCredits(
  executable: WorkflowNode[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): number {
  return useRunSetPrice(executable, nodes, edges).credits
}

/** Run from here's price on a node, marked `estimating` as every run-set price is. */
export function useRunFromHerePrice(startId: string): RunSetPrice {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const executable = useMemo(() => runFromHereExecutable(startId, nodes, edges), [startId, nodes, edges])
  return useRunSetPrice(executable, nodes, edges)
}

export function useRunFromHereCredits(startId: string): number {
  return useRunFromHerePrice(startId).credits
}
