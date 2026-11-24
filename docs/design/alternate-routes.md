# Alternate routes

An **alternate route** lets a deployment run a fully prepared video generation
through another upstream it operates, instead of the platform's default one.
The person sees the same node, the same options and the same price; only where
the work runs changes. The deployment supplies the route through a private
plugin, and the public platform never names it.

The core module is `backend/src/lib/alternate-route.ts`; its recovery is
`backend/src/lib/reconcile/alternate-route.ts`.

## The two halves

| The platform (this repository) | The deployment's plugin |
|---|---|
| Prepares the default request (prompt policies, reference sizing and re-encodes, the request's shape) | Decides which runs it takes (`accepts`, pure and synchronous) |
| Builds a neutral request from it, through a key table that fails closed | Submits the run and returns an opaque task reference (`start`) |
| Claims the job before `start`, saves the reference, reads the task to its end | Reads the task's status (`poll`) |
| Falls back to the default request, recovers a job whose worker died | Holds the upstream's client, key, request shape and rates |
| Settles the charge exactly as for the default route | Reports what the upstream billed (`providerCostUsd`) |

The plugin member is `PluginServices.alternateRoutes` (additive-optional). With
no service registered the seam returns at once: no database read, no log line,
and the default request is sent byte for byte as before.

## Opt-in, never ambient

The seam runs only when the caller states the job it generates for
(`reconcileOpts.routeJob`, set by the image-to-video and text-to-video
handlers). It is never read from the job context in scope: a plugin's toolkit
call runs inside its PARENT job's context, and a claim written there would land
on the parent's row. `routeJob` is removed before the default upstream is
called.

## The neutral request

The neutral request is built from the default route's prepared body through an
explicit table: every key is mapped or deliberately dropped. A key the table
does not list, or a value a mapper cannot carry (an "on" lever the route cannot
honour), makes the run "not offered", so a lever added to the body later can
never silently go missing on the route. The job's parent and its type are read
only when a service exists, because the plugin's rule may depend on them.

## One task per job

- **Claim.** Before `start`, one compare-and-set on `provider_task_id IS NULL`
  writes `provider_kind = "alternate-route"`, a claim marker, and the route's
  record on `input_data.__alternateRoute`, including the default request exactly
  as it was prepared. The kind deliberately does not start with `kie-`, which
  reads as "ran on the default upstream".
- **Reference.** The task reference replaces the claim (`alt:<ref>`) with a
  second compare-and-set on the claim. From then on a queue re-pick finds a
  task id, and the worker's stall guard sends it to the recovery, which never
  starts a task.
- A job that already holds this route's reference is read, never started
  again. A job that holds only the claim may have a `start` in flight, so it is
  left to the recovery. A job that holds another kind's task is not the route's.

`__alternateRoute` is a server-only key: it is dropped from every job read.

## Fallback

| What happened | What the platform does |
|---|---|
| `start` refused before a task existed (`created: "none"`) | falls back |
| `start` got no answer (`created: "unknown"`), or resolved with no reference | falls back, and raises an alert naming the job (a paid task may exist) |
| The task failed or expired (not charged) | falls back |
| The task is still running past the worker's budget, or its status cannot be read here (after a few reads ~40 s apart) | **never** falls back: the run is left to the recovery |
| The task reads done with no result file | **never** falls back (done means charged): one alert per job, the run is left as it is, and the age bound below fails and refunds it |

A fallback is ONE compare-and-set on the exact value the run holds: it clears
the claim, puts the row back on the pickup kind with a fresh stamp, and records
the decision. Only when it lands does the default request go out. A job that
recorded a fallback never tries the route again.

## Recovery

The reconcile cron and the worker's stall re-pick dispatch the kind to
`reconcileAlternateRouteJob`:

- **done**: the shared recovered-generation delivery (`finalizeRecoveredMedia`,
  also used by the default upstream's recovery) delivers the file and settles
  the charge from it;
- **failed / expired**: the saved default request is sent to the default
  upstream once, and the row moves to that upstream's kind, where its own
  recovery takes over. The resend's claim replaces the held task id with a
  fresh, never-repeated token (`alt:resending:<uuid>`) in the same
  compare-and-set, so a worker's fallback, a reference save or a second
  resend — every write keyed on the old value — misses from then on, and no
  other writer can restore the value it compares on. The new default task is
  read at once: to its end inside a re-pick, or on the cron's next tick (the
  row is stamped past its kind's threshold). A resend that dies after its claim
  is never sent again: the job is failed and refunded with the default
  upstream's own refusal classification;
- **running**: attempts are bumped, toward the usual exhaustion refund;
- **claimed with no reference** (the worker died around `start`): after a
  grace, the same resend, with an alert. A worker whose reference save then
  misses treats its task as an orphan (alert) and stops;
- **done with no result file**: never resent; left as it is with one alert;
- **no service in this process** (any row of the kind, a bare claim included),
  **or a status this process cannot read**: the row is left alone — never
  resent, attempts not bumped — so the process that can read it
  recovers it. Several environments may share one database and only some may
  carry the plugin. A row left alone for two hours past its stamp is failed and
  refunded, so none lives forever.

## Money

The person's charge is unchanged: it is settled from the delivered clip exactly
as on the default route. The recorded provider cost is the route's own figure
(`ProviderResult.routedVia` marks such a result, so no handler re-derives the
default upstream's rates), and `jobs.provider` records a generic value. The
result carries no default-upstream task id, so no chain (extend, upscale)
mistakes it for one.
