/**
 * The result check: a deployment's own check of what a model actually made.
 *
 * Loosening a provider's content filter waits for one. The content guard reads
 * what was asked for and cannot see what came back, so a filter that has been
 * turned down needs something looking at the output as well.
 *
 * CONTENT-FREE, like `lib/content-guard.ts`: no rule lives here, and nothing in
 * this repository registers one, so with nothing else changing every loosening
 * control stays locked. A check is a job policy with a result hook. Registering
 * it adds it to the job-policy registry, so it runs in the result funnel every
 * completion already passes, fail-closed, with nothing further to wire: a check
 * that nothing calls could otherwise unlock loosening on a false promise.
 *
 * It is also remembered here by name because the loosening rule asks for this
 * check specifically. A deployment's other result policies vouch for nothing
 * here. A deployment registers it in every process that can send a provider
 * request, the same as the content guard.
 */
import { getRegisteredJobPolicyIds, registerJobPolicy, type JobPolicy } from "./job-policy.js"

export interface ResultCheck extends JobPolicy {
  readonly checkResult: NonNullable<JobPolicy["checkResult"]>
}

let registeredCheck: ResultCheck | null = null

export function registerResultCheck(check: ResultCheck): void {
  if (typeof check.checkResult !== "function") {
    throw new Error(`[result-check] "${check.id}" has no checkResult: a result check has to look at the result.`)
  }
  if (registeredCheck?.id === check.id) return
  if (registeredCheck) {
    throw new Error(`[result-check] "${registeredCheck.id}" is already registered; a deployment has one result check.`)
  }
  registerJobPolicy(check)
  registeredCheck = check
}

/** True only while the registered check is still in the result funnel: only a check that runs counts. */
export function hasResultCheck(): boolean {
  return registeredCheck !== null && getRegisteredJobPolicyIds().includes(registeredCheck.id)
}

export function getResultCheckId(): string | null {
  return hasResultCheck() ? (registeredCheck?.id ?? null) : null
}

/** Test hook: forget the check. Pair with `clearJobPolicies` to take it out of the funnel too. */
export function clearResultCheck(): void {
  registeredCheck = null
}
