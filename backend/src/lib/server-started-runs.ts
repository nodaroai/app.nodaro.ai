/**
 * Which executions' `trigger_data` stamps are the platform's own: the ONE
 * place that decides it.
 *
 * `workflow_executions.trigger_data` holds two kinds of thing. The platform's
 * stamps — a continue-from-failed's lineage (`continueFromFailed`), an app
 * run's (`appRun`), a Render final's (`appRenderFinal`) — are read back as
 * fact: which run a continuation goes to, which version a run executed,
 * which executions an app run owns. And the data a trigger lane received from
 * outside — a webhook's posted body, a schedule's tick, a Telegram message, a
 * plugin trigger's event — which a caller shapes.
 *
 * A stamp is written only at insert, by the lanes that start a run
 * themselves: the run route (`POST /v1/workflows/:id/run`, `manual` or
 * `mcp`) and the app lanes (`app_run`, and the app runner's re-run, which
 * runs as `manual`). None of those lanes stores caller data in `trigger_data`
 * (`__tests__/trigger-data-stamps.test.ts` holds every write to that), and
 * clients cannot write the table at all (migration 474). So a stamp is trusted
 * only on an execution of one of those lanes; on any other row —
 * `webhook`, `schedule`, `telegram`, a plugin lane, `api`, `use_case` — it
 * reads as absent, whatever the row holds.
 *
 * Readers never parse `trigger_data` for a stamp themselves: a row goes
 * through `serverTriggerData` (or `serverStamps`, lib/trigger-data-stamps.ts),
 * and a query that FINDS rows by a stamp narrows itself with
 * `onlyServerStampedRows`. `__tests__/server-stamp-readers-totality.test.ts`
 * fails a reader that does not.
 *
 * No imports: the stamp modules themselves use it.
 */

/** The trigger types of the lanes that write the platform's stamps. */
export const SERVER_STAMPED_TRIGGER_TYPES: readonly string[] = Object.freeze(["manual", "mcp", "app_run"])

/** Was this execution started by a lane that writes the platform's stamps? */
export function isServerStartedRun(row: { readonly trigger_type?: unknown } | null | undefined): boolean {
  return typeof row?.trigger_type === "string" && SERVER_STAMPED_TRIGGER_TYPES.includes(row.trigger_type)
}

/**
 * A row's `trigger_data` for a stamp reader: the value itself on a run a
 * stamp-writing lane started, `null` on any other (its stamps read as absent).
 * The row must carry its `trigger_type`: a read that did not select it trusts
 * nothing.
 */
export function serverTriggerData(row: { readonly trigger_type?: unknown; readonly trigger_data?: unknown } | null | undefined): unknown {
  return isServerStartedRun(row) ? (row!.trigger_data ?? null) : null
}

/**
 * Narrow a `workflow_executions` query that finds rows BY a stamp
 * (`trigger_data->…`) to the lanes that write stamps, so a row another lane
 * stored cannot be found by one it carries.
 */
export function onlyServerStampedRows<Q>(query: Q): Q {
  return (query as unknown as { in: (column: string, values: string[]) => Q }).in("trigger_type", [...SERVER_STAMPED_TRIGGER_TYPES])
}
