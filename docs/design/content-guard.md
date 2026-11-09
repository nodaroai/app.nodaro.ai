# Content Guard — Design Note

## Summary

Some requests must never run, whatever a provider's own filters would do with
them and however a deployment has set those filters. The **content guard**
makes that a registration: a deployment registers one synchronous check, and
the platform asks it at each place a request's content becomes final, before
any credit is reserved and before any provider is called.

The check's wording is the deployment's own. Nothing in this repository names
what the check looks for; a public list would describe exactly how to get
around it. With **no** guard registered every funnel returns at its first line
and the platform is byte-identical.

## Where it is asked

A job row does not always hold what a provider will be sent: a workflow step's
row is a placeholder, a route assembles the final prompt from fields and
pickers, a plugin assembles its own prompts mid-run. So the guard is asked in
each of the places the content is final:

| Where | What it sees | When |
|---|---|---|
| The prompt funnel (`applyPromptPolicies`) | the final assembled prompt, with prefix, suffix and field mappings; every route, worker and workflow step reaches it, and plugins through `tk.prompts.applyPolicies` | before the row on a route; before the provider on a worker |
| The insert funnel (`gateJobInsert`) | every text a row carries, and any structured signal on it | before the row exists |
| The workflow engine (`node-executor.ts`) | the built payload of a workflow step | after the placeholder row, before the reservation |
| Character training | what the character row says, because the request has no prompt | before the job row |

## What a refusal is

The same shape as a job-policy request block: `422 { error: { code:
"job_blocked", message } }` on a route, a failed node in a workflow, a failed
job with a `policy-block` hint on a worker. The message is the platform's own
sentence and names no rule. The refusal is recorded in `job_policy_decisions`
(policy id, a machine reason, a hash of the text); the text itself is never
stored, logged or echoed. A guard that throws refuses, as every job policy
does.

## Signals

The guard is told what the platform's own catalogs already say: whether a
Person value is a minor by the catalog's age or type, whether a minor-age hint
the catalog produces appears in the text, and whether a route marked the
subject a minor. Words beyond that are the deployment's.

## Loading

A deployment's guard ships as a small module of pure functions and is loaded
in every process that can reach a funnel, including the standalone workflow
orchestrator and the plugin daemon host. A guard has to prove at registration
that it can refuse something, so "a guard is present" means a working one. On
Cloud a missing, broken or older module stops the boot, so a bad deploy fails
its health check and the running version keeps serving; the plugin build has
to be released and pinned before the platform build that needs it. Other
editions have no guard and nothing changes for them.

## Totality

`lib/__tests__/content-guard-totality.test.ts` fails the build if one of the
places above stops asking, or asks after the row or the reservation. The funnels
it relies on have their own totality guards (`prompt-policy-totality`,
`no-direct-job-insert`, `job-policy-request-totality`).
