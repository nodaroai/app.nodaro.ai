import { parseEditPlanMode } from "@nodaro/shared"
import type { HandlerFn } from "../../workers/shared.js"
import { DeterministicJobError } from "../deterministic-job-error.js"
import type { PluginSupports } from "./types.js"

/**
 * Edit Plan mode gate (Track D1, trailer mode).
 *
 * A workflow run reserves an edit-plan job at its MODE's price
 * (`edit-plan:<mode>:<tier>:<bucket>m`), then the video worker hands the job to
 * the cloud plugin's `edit-plan` handler. A plugin built before a mode existed
 * does not refuse it: it plans the job as `tighten`. The person would pay the
 * new mode's price for a tighten cut. So the worker refuses a job in a mode
 * the loaded plugin has not declared (`PluginSupports.editPlanModes`) before
 * the plugin's handler runs. The refusal is deterministic, so the worker fails
 * the job and refunds the reservation on this attempt.
 *
 * Round 4 (decided 2026-10-06): an UNKNOWN mode (not in `EDIT_PLAN_MODES`) or
 * an undeclared one is refused EVERYWHERE the app dispatches a plan, before
 * any charge, with the one message below (`editPlanModeRefusal`):
 *   - `POST /v1/edit-plan` — a root `preValidation` hook (`edit-plan-mode-guard.ts`)
 *     in front of the cloud plugin's route and the self-host shim alike;
 *   - workflow runs — `payload-builder` refuses an unknown mode before the
 *     reservation (the standalone orchestrator loads no plugin, so it cannot
 *     know the declaration; the worker gate here refuses and refunds that);
 *   - MCP `plan_edit` — before dispatch;
 *   - the self-host relay to nodaro.ai — the worker wraps the relay handlers in
 *     this same gate.
 * Round 6 (decided 2026-10-06): every one of those lanes, and
 * `GET /v1/edit-plan/capabilities`, reads the plannable set from ONE helper,
 * `plannableEditPlanModes()` (`plannable-edit-plan-modes.ts`): the loaded
 * plugin's declaration on nodaro.ai, nodaro.ai's own answer on a self-host
 * connected to it (failing closed to the three original modes), and the three
 * original modes on an unconnected self-host.
 * Round 7 (decided 2026-10-06): when a connected self-host can't reach
 * nodaro.ai to learn its modes (an error, a timeout or a malformed reply), that
 * is a TEMPORARY state, not a refusal. The helper's answer says so
 * (`source: "nodaro.ai-unreachable"`, the list still failing closed for
 * display), and `editPlanModeVerdict` turns it into `nodaro-unreachable` for a
 * KNOWN mode: the worker gate throws `NodaroUnreachableError` ("could not reach
 * nodaro.ai") — the retryable path, bounded by the queue's job retry policy —
 * and the REST guard and MCP `plan_edit` let the job be created so that gate
 * decides. Refusing an unsupported mode stays with nodaro.ai's own answer: a
 * mode nodaro.ai answered it does not plan is still refused permanently, and an
 * unknown mode always is.
 * Every dispatch site parses with the STRICT `parseEditPlanMode`; the coercing
 * `asEditPlanMode` is for display and estimates only
 * (`lib/__tests__/edit-plan-mode-census.test.ts`).
 */

/** What every plugin plans for, declared or not: the three Phase-1 modes. */
const PHASE1_EDIT_PLAN_MODES: readonly string[] = ["tighten", "clips", "chapters"]

/** The modes the loaded plugin's `edit-plan` handler plans for: the Phase-1
 *  three plus whatever it declares that this app knows (`EDIT_PLAN_MODES`) —
 *  a mode the app does not know is refused even when a plugin declares it.
 *  A declaration only ever ADDS — a plugin cannot drop a published mode
 *  without a contract bump — so a list naming only the new mode never refuses
 *  the old ones. */
export function editPlanModesOf(supports: PluginSupports | undefined): ReadonlySet<string> {
  const declared = supports?.editPlanModes
  return new Set([
    ...PHASE1_EDIT_PLAN_MODES,
    ...(Array.isArray(declared) ? declared.flatMap((m) => parseEditPlanMode(m) ?? []) : []),
  ])
}

const MODE_NAMES: Readonly<Record<string, string>> = { trailer: "Trailer" }

/** Why a mode the loaded plugin does not plan is refused. ONE message for every lane
 *  that refuses (REST, workflow runs, MCP, the worker and the relay), so they never drift. */
export function editPlanModeRefusalMessage(mode: string): string {
  const name = MODE_NAMES[mode] ?? mode
  return `${name} mode is not available on this server yet. Choose another mode, or try again after the next update. You were not charged.`
}

/** How much of a refused value the message quotes. */
const MAX_QUOTED_MODE = 64

/**
 * The refusal for `mode` on a server that plans `plannable`, or `null` when it
 * may be planned. An ABSENT mode (`undefined`) passes: the planner's default
 * (`tighten`) applies. Anything else must be a KNOWN mode (`parseEditPlanMode`
 * — a plugin declaring a mode this app does not know does not make it
 * plannable) that the server declares.
 */
export function editPlanModeRefusal(mode: unknown, plannable: ReadonlySet<string>): string | null {
  if (mode === undefined) return null
  const known = parseEditPlanMode(mode)
  if (known && plannable.has(known)) return null
  const raw = typeof mode === "string" ? mode : (JSON.stringify(mode) ?? String(mode))
  // An empty or blank value (an empty Text node mapped into the field, `"mode": ""`
  // in workflow JSON) has nothing to quote: name it, so the sentence still reads.
  if (raw.trim() === "") return editPlanModeRefusalMessage("An empty")
  const quoted = raw.length > MAX_QUOTED_MODE ? `${raw.slice(0, MAX_QUOTED_MODE)}…` : raw
  return editPlanModeRefusalMessage(quoted)
}

/**
 * Who answered which modes are plannable (round 7, decided 2026-10-06):
 *   - `server` — this server plans for itself: the loaded plugin's declaration
 *     on nodaro.ai, or the three original modes on an unconnected self-host;
 *   - `nodaro.ai` — a connected self-host, and nodaro.ai answered;
 *   - `nodaro.ai-unreachable` — a connected self-host that could not ask
 *     nodaro.ai; `modes` fails closed to the three original modes (what the
 *     editor shows), and a known mode outside it is a temporary error.
 */
export type EditPlanModesSource = "server" | "nodaro.ai" | "nodaro.ai-unreachable"

export interface EditPlanModesAnswer {
  readonly modes: ReadonlySet<string>
  readonly source: EditPlanModesSource
}

/** Which modes the server plans right now — `plannableEditPlanModes()`
 *  (`plannable-edit-plan-modes.ts`) in the worker; asked once per job. */
export type PlannableEditPlanModes = () => Promise<EditPlanModesAnswer>

/** What a job fails with when nodaro.ai could not be asked (decided 2026-10-06). */
export const NODARO_UNREACHABLE_MESSAGE = "could not reach nodaro.ai"

/**
 * A connected self-host could not learn nodaro.ai's modes. Deliberately NOT a
 * `DeterministicJobError`: the worker leaves the reservation in place and the
 * queue retries the job under its own policy (`attempts`, backoff), failing it
 * with this message only on the final attempt.
 */
export class NodaroUnreachableError extends Error {
  constructor() {
    super(NODARO_UNREACHABLE_MESSAGE)
    this.name = "NodaroUnreachableError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export type EditPlanModeVerdict =
  | { readonly kind: "plan" }
  | { readonly kind: "refuse"; readonly message: string }
  | { readonly kind: "nodaro-unreachable" }

/**
 * What to do with `mode` given `answer`: plan it, refuse it (permanently, with
 * the one shared message), or — a KNOWN mode on a connected self-host that
 * could not ask nodaro.ai — treat it as the temporary `nodaro-unreachable`.
 * An unknown mode is refused whoever answered.
 */
export function editPlanModeVerdict(mode: unknown, answer: EditPlanModesAnswer): EditPlanModeVerdict {
  const refusal = editPlanModeRefusal(mode, answer.modes)
  if (!refusal) return { kind: "plan" }
  if (answer.source === "nodaro.ai-unreachable" && parseEditPlanMode(mode) !== undefined) {
    return { kind: "nodaro-unreachable" }
  }
  return { kind: "refuse", message: refusal }
}

/**
 * The handler map, with its `edit-plan` handler (when there is one) refusing
 * an unknown mode or one the server does not plan. The worker applies it to the
 * plugin's handlers on nodaro.ai and to the relay's on a self-host. The
 * plannable set is asked PER JOB (round 6, decided 2026-10-06): a connected
 * self-host plans what nodaro.ai plans, which can change while the worker runs.
 * A resolver that throws fails closed to the three original modes. Round 7: a
 * known mode nodaro.ai could not be asked about throws `NodaroUnreachableError`,
 * which the queue retries. Every other handler is passed through unchanged. A
 * fresh map; the input is not mutated.
 */
export function withEditPlanModeGate(
  handlers: Readonly<Record<string, HandlerFn>>,
  plannable: PlannableEditPlanModes,
): Record<string, HandlerFn> {
  const inner = handlers["edit-plan"]
  if (!inner) return { ...handlers }
  const gated: HandlerFn = Object.assign(
    async (job: Parameters<HandlerFn>[0], ctx: Parameters<HandlerFn>[1]) => {
      const answer = await plannable().catch(
        (): EditPlanModesAnswer => ({ modes: editPlanModesOf({}), source: "server" }),
      )
      const verdict = editPlanModeVerdict((job.data as { mode?: unknown } | undefined)?.mode, answer)
      if (verdict.kind === "nodaro-unreachable") throw new NodaroUnreachableError()
      if (verdict.kind === "refuse") throw new DeterministicJobError(verdict.message)
      return inner(job, ctx)
    },
    inner.livenessBudgetMs ? { livenessBudgetMs: inner.livenessBudgetMs } : {},
  )
  return { ...handlers, "edit-plan": gated }
}
