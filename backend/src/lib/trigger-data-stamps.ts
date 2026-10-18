/**
 * The keys of `workflow_executions.trigger_data` that only the platform writes: the stamps a run is
 * found and continued by. An app run's (`appRun`), a Render final's (`appRenderFinal`), a
 * continue-from-failed's lineage (`continueFromFailed`) and a continuation chain's root (`runRoot`).
 * Each is read back as fact — which app run an execution belongs to, which version it ran, which
 * run a continuation goes to — so none may ever come from a caller.
 *
 * Two locks on that door:
 * - a stamp is READ only on an execution a stamp-writing lane started (`serverStamps`, over
 *   lib/server-started-runs.ts) — the one that holds;
 * - a lane that stores caller-controlled data in `trigger_data` (a webhook's posted body, a plugin
 *   trigger's event payload) passes it through `withoutReservedStamps` first, so the stored row
 *   never carries one either.
 *
 * The totality guards (`__tests__/trigger-data-stamps.test.ts`, every `trigger_data` write;
 * `__tests__/server-stamp-readers-totality.test.ts`, every stamp read) fail a new site that does
 * neither.
 */
import { APP_RUN_STAMP_KEY, appRunResumedFromOf, appRunStampOf } from "./app-run-stamp.js"
import { APP_RENDER_FINAL_STAMP_KEY, appRenderFinalStampOf, type AppRenderFinalStamp } from "./app-run-final-column.js"
import {
  CONTINUE_FROM_FAILED_STAMP_KEY,
  continueFromFailedStampOf,
  type ContinueFromFailedStamp,
} from "./continue-from-failed-lineage.js"
import { RUN_ROOT_STAMP_KEY, runRootOf } from "./continuation-run-root.js"
import { serverTriggerData } from "./server-started-runs.js"

/** Every `trigger_data` key only the platform writes. */
export const RESERVED_TRIGGER_DATA_KEYS: readonly string[] = [
  APP_RUN_STAMP_KEY,
  APP_RENDER_FINAL_STAMP_KEY,
  CONTINUE_FROM_FAILED_STAMP_KEY,
  RUN_ROOT_STAMP_KEY,
]

/** Caller-controlled `trigger_data` without any reserved stamp key (a copy; the input is left as it is). */
export function withoutReservedStamps(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !RESERVED_TRIGGER_DATA_KEYS.includes(key)))
}

/** The platform's stamps an execution carries — each `null` when it carries none it can be trusted with. */
export interface ServerStamps {
  readonly continueFromFailed: ContinueFromFailedStamp | null
  /** The app run it was started for (`appRun.appRunId`). */
  readonly appRun: string | null
  readonly appRenderFinal: AppRenderFinalStamp | null
  /** The root of the continuation chain it belongs to (`runRoot.executionId`, lib/continuation-run-root.ts). */
  readonly runRoot: string | null
  /** The execution an app run's Retry continued (`appRun.resumedFrom`, lib/app-run-stamp.ts). */
  readonly resumedFrom: string | null
}

/**
 * The stamps on `row`, read only when a stamp-writing lane started it (lib/server-started-runs.ts):
 * on a webhook's, a schedule's, a plugin trigger's or any other row every one is `null`, whatever
 * its `trigger_data` holds. The row must carry `trigger_type`.
 */
export function serverStamps(row: { readonly trigger_type?: unknown; readonly trigger_data?: unknown } | null | undefined): ServerStamps {
  return {
    continueFromFailed: continueFromFailedStampOf(serverTriggerData(row)),
    appRun: appRunStampOf(serverTriggerData(row)),
    appRenderFinal: appRenderFinalStampOf(serverTriggerData(row)),
    runRoot: runRootOf(serverTriggerData(row)),
    resumedFrom: appRunResumedFromOf(serverTriggerData(row)),
  }
}
