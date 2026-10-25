import type { NodaroClientCore } from "../core.js"

/**
 * A published app — a workflow wrapped in a curated input/output presentation.
 * Returned by the public `/v1/apps/browse` endpoint.
 */
export interface PublishedApp {
  id: string
  slug: string
  name: string
  description?: string | null
  creatorId: string
  creatorName?: string | null
  thumbnailUrl?: string | null
  category?: string | null
  isFeatured?: boolean
  runCount?: number
  /** The listed price per run; when `perMinuteCredits` is above 0, its fixed part. */
  estimatedCredits?: number | null
  /** The listed price holds a metered LLM call's ESTIMATE (its model's typical
   *  call, charged its actual usage per token): show it `≈N`. Absent for a
   *  fixed price, and on a deployment running the tier-pricing rollback. */
  estimatedCreditsIsEstimate?: true
  /**
   * Credits per minute of the recording the app is given, when its price
   * follows that recording's length: the price is `estimatedCredits` plus
   * this per minute. 0 or absent when the price does not depend on a
   * recording's length.
   */
  perMinuteCredits?: number
  /**
   * Credits for each item beyond the creator's saved items of a list input
   * the app's user fills: the price is the listed one plus this per further
   * item. 0 or absent when the app has no such input.
   */
  perItemCredits?: number
  /**
   * The listed price is a range: `estimatedCredits` (with `perMinuteCredits` /
   * `perItemCredits`) is "from" — the app's saved settings — and these are
   * "up to": the most a run can cost over the choices the app's user has (every
   * exposed field, at the creator's restricted values where set). Present only
   * when they differ from "from"; absent on an app published before the range
   * existed until its next publish.
   */
  maxEstimatedCredits?: number
  maxPerMinuteCredits?: number
  maxPerItemCredits?: number
  createdAt: string
  updatedAt: string
}

export interface ListAppsParams {
  /** Substring search across app name + description. */
  search?: string
  /** Page size; backend caps at 50. */
  limit?: number
  /** Cursor token returned by the previous page. */
  cursor?: string
  /** Filter to a single category slug. */
  category?: string
}

export interface ListAppsResult {
  data: PublishedApp[]
  nextCursor?: string | null
}

/**
 * App detail — includes the input schema (required + optional fields end users
 * fill in) and the output mapping (which workflow nodes produce which display
 * cards).
 */
export interface PublishedAppDetail extends PublishedApp {
  inputSchema: Record<string, unknown>
  outputs: Array<{ nodeId: string; label: string; type: string }>
  /**
   * The app run alone: the listed price less its Render final part (run and
   * charged separately) — fixed, per minute of the recording and per further
   * list item. Absent from a server that predates them; read the listed
   * `estimatedCredits` / `perMinuteCredits` / `perItemCredits` instead.
   */
  runEstimatedCredits?: number
  runPerMinuteCredits?: number
  runPerItemCredits?: number
  /**
   * Whether this server charges Edit Plan per started minute of the recording
   * (otherwise in 15/30/60/90/120/180-minute steps). Absent from a server that
   * predates it: read it as the steps.
   */
  editPlanPerMinute?: boolean
}

export interface AppRunResult {
  /** The execution-id that was started — poll via client.executions.get(). */
  executionId: string
  status: "pending" | "running"
  /** App-run id (distinct from executionId — used by listRuns/getRun). */
  runId?: string
}

export interface AppRun {
  id: string
  appSlug: string
  executionId: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  inputs: Record<string, unknown>
  outputs?: Array<{ nodeId: string; type: string; url?: string; text?: string }>
  startedAt: string
  finishedAt?: string | null
}

export interface ListAppRunsParams {
  limit?: number
  cursor?: string
}

/**
 * Result of a soft-delete (archive) operation. The run is moved to the user's
 * archive in the Nodaro UI; restoration and permanent deletion are UI-only by
 * design — SDK / MCP / API delete callers can't accidentally destroy data.
 */
export interface DeleteAppRunResult {
  success: true
  archived: true
}

/** Advanced per-run options for `apps.run`. */
export interface RunAppOptions {
  /**
   * Raw node-data overrides keyed by node id → field → value, merged onto the
   * app's workflow for THIS run only. Reaches fields that are NOT exposed as app
   * inputs — e.g. `{ [nodeId]: { promptPrefix: "…", promptSuffix: "…" } }` to
   * wrap the end user's prompt with text they never see.
   */
  inputOverrides?: Record<string, Record<string, unknown>>
}

/** Options for `apps.resume` — the Retry of a failed app run. */
export interface ResumeAppRunOptions {
  /** Answer what the Retry would run and charge, and start nothing. */
  dryRun?: boolean
  /**
   * The app version you expect the Retry to run — the one starting over would
   * run. Absent: the app's latest. A run of another version is refused with
   * `app_run_version_changed`; send the run's own version (the refusal's
   * `runVersion`) to continue on it anyway.
   */
  version?: number
}

/** One step a Retry runs again. */
export interface AppRunResumeStep {
  nodeId: string
  type: string
  /** The node's label, or `null` when it has none. */
  label: string | null
}

/** What a Retry would do (`apps.resume(…, { dryRun: true })`); nothing is started. */
export interface AppRunResumePlan {
  runId: string
  /** The failed execution the Retry continues. */
  continuesExecutionId: string
  /** The app version the Retry runs (the run's own). */
  appVersion: number | null
  /** Every node the Retry runs, in graph order. */
  nodeIds: string[]
  /** The steps that run again. */
  steps: AppRunResumeStep[]
  /** What the Retry is expected to charge, the creator's fee included; `null` without credits. */
  estimatedCredits: number | null
  /** Clips handed back at no cost. */
  reusedClips: number
  /** Whether your balance and your app credits cover what the Retry holds while it runs; `null` without credits. */
  sufficient: boolean | null
  /** Your spendable balance; `null` without credits. */
  available: number | null
  /** Your app credits, present only when they are what stops the Retry (it would be refused `insufficient_app_credits`). */
  appCreditsAllowance?: number
}

/**
 * A Retry that started. `deduped: true` when a concurrent double press reached
 * the same Retry; a second call made while the first is pending is refused
 * with `already_running` (`AlreadyRunningError`) instead.
 */
export interface AppRunResumeResult {
  /** The Retry's execution — the run now points at it. Poll via client.executions.get(). */
  executionId: string
  runId: string
  status: "pending"
  /** Every node the Retry runs. */
  nodeIds: string[]
  /** `true` when a concurrent press had already started this Retry. */
  deduped?: true
}

/**
 * The `code` the server gives an `apps.resume` refusal. Nothing is written or
 * billed when a Retry is refused. How each arrives:
 * - `app_run_version_changed` as `AppRunVersionChangedError`;
 * - `already_running` as `AlreadyRunningError` (with the live `executionId`);
 * - `not_found` and `continuation_not_found` as `NotFoundError`, whose `code`
 *   is always `not_found` (the server's message is kept);
 * - `insufficient_credits` and `insufficient_app_credits` as
 *   `InsufficientCreditsError`, whose `code` is always `insufficient_credits`
 *   (the server's message says which);
 * - the rest as `NodaroError` carrying this code.
 */
export type AppRunResumeRefusalCode =
  /** No such run of yours under this app. */
  | "not_found"
  /** The run's execution is not yours. */
  | "continuation_not_found"
  /** A malformed run id or body, or a component's run (continued by the run that called it). */
  | "validation_error"
  /** The app version the run ran is gone: start the run over. */
  | "app_run_version_unavailable"
  /** The app is on another version than the run ran: start over, or send `version` = the run's. */
  | "app_run_version_changed"
  /** The run's execution ran another workflow, or another version of it (rare). */
  | "continuation_workflow_mismatch"
  | "continuation_version_mismatch"
  /** The run did not fail (it completed or was stopped): start it over. */
  | "continuation_not_failed"
  /** The run is still running, a Retry of it is pending, or it was started again elsewhere. */
  | "already_running"
  /** Nothing is left to retry: every step completed (409), or the app runs no step (400). */
  | "continuation_subset_required"
  /** An input the run applied sets a field the app does not let a runner set. */
  | "locked_field"
  /**
   * The Retry would stop at a Preview with nobody to review it: retry it from the app page.
   * (The same refusal arrives under the other preview refusal codes when a review-on use-case
   * node holds the run; `isPreviewRefusalCode` in `@nodaro/shared/nodes` asks for all of them.)
   */
  | "preview_review_required"
  /** Your app credits cannot cover it. */
  | "insufficient_app_credits"
  /** Your balance cannot cover it. */
  | "insufficient_credits"
  /** Billing is briefly unavailable for a workspace run (503): try again shortly. */
  | "billing_unavailable"

export class AppsResource {
  constructor(private client: NodaroClientCore) {}

  /** List published apps. Public — no auth required for community apps. */
  list(params: ListAppsParams = {}): Promise<ListAppsResult> {
    const qs = new URLSearchParams()
    if (params.search) qs.set("search", params.search)
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.category) qs.set("category", params.category)
    const query = qs.toString()
    return this.client.request("GET", `/v1/apps/browse${query ? `?${query}` : ""}`)
  }

  /** Get one app's metadata + input schema by slug. */
  get(slug: string): Promise<{ data: PublishedAppDetail }> {
    return this.client.request("GET", `/v1/app/${encodeURIComponent(slug)}`)
  }

  /**
   * Trigger an app run with the given input values. The keys in `inputs` must
   * match the app's input-schema field names (see `get(slug).inputSchema`).
   * `opts.inputOverrides` adds raw per-node overrides (see {@link RunAppOptions}).
   * Returns the execution-id for status polling via client.executions.get().
   */
  run(
    slug: string,
    inputs: Record<string, unknown> = {},
    opts: RunAppOptions = {},
  ): Promise<AppRunResult> {
    return this.client.request("POST", `/v1/app/${encodeURIComponent(slug)}/run`, {
      body: { inputs, ...(opts.inputOverrides ? { inputOverrides: opts.inputOverrides } : {}) },
    })
  }

  /** List past runs for an app (the caller must own the app or the runs). */
  listRuns(slug: string, params: ListAppRunsParams = {}): Promise<{ data: AppRun[]; nextCursor?: string | null }> {
    const qs = new URLSearchParams()
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    const query = qs.toString()
    return this.client.request(
      "GET",
      `/v1/app/${encodeURIComponent(slug)}/runs${query ? `?${query}` : ""}`,
    )
  }

  /** Get one app-run by id. */
  getRun(slug: string, runId: string): Promise<{ data: AppRun }> {
    return this.client.request(
      "GET",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    )
  }

  /**
   * Retry a FAILED app run from where it stopped: only the steps it did not
   * complete run, and only those are charged; every step it completed hands
   * on its result. It runs the version the run ran, with the inputs the run
   * applied (it takes none of its own). The run's execution moves to the
   * Retry's.
   *
   * `{ dryRun: true }` answers what the Retry would run and charge
   * ({@link AppRunResumePlan}) and starts nothing — show it before a Retry.
   * Refusals are listed in {@link AppRunResumeRefusalCode}; to run with other
   * inputs or on the app's current version, start over with
   * `run(slug, inputs)` instead.
   *
   * @param slug   The published app's slug.
   * @param runId  The run's UUID (`AppRunResult.runId`, `AppRun.id`).
   */
  resume(slug: string, runId: string, opts: ResumeAppRunOptions & { dryRun: true }): Promise<{ data: AppRunResumePlan }>
  resume(slug: string, runId: string, opts?: ResumeAppRunOptions & { dryRun?: false }): Promise<AppRunResumeResult>
  resume(slug: string, runId: string, opts?: ResumeAppRunOptions): Promise<{ data: AppRunResumePlan } | AppRunResumeResult>
  resume(slug: string, runId: string, opts: ResumeAppRunOptions = {}): Promise<{ data: AppRunResumePlan } | AppRunResumeResult> {
    return this.client.request(
      "POST",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/resume`,
      {
        body: {
          ...(opts.dryRun ? { dryRun: true } : {}),
          ...(opts.version !== undefined ? { version: opts.version } : {}),
        },
      },
    )
  }

  /**
   * Archive (soft-delete) a published-app run. The run is hidden from the
   * default run list and can be restored or permanently deleted from the
   * archive view at https://app.nodaro.ai/archived-runs.
   *
   * @param slug   The published app's slug (the last path segment of its URL).
   * @param runId  The run's UUID.
   */
  deleteRun(slug: string, runId: string): Promise<DeleteAppRunResult> {
    return this.client.request(
      "DELETE",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    )
  }
}
