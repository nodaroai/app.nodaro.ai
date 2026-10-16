import type { FastifyBaseLogger } from "fastify"
import type { PluginSignupGateDecision, PluginSignupGateInput, PluginSignupGateService } from "../../lib/private-plugins/types.js"

/**
 * The free signup grant's decision, as a seam: the private plugin answers
 * when it is loaded and provides the member; otherwise null, and the caller
 * keeps today's answer. Member-probed, not only `?.`-guarded, the
 * `workflow-access.ts` discipline: `CLOUD_PLUGINS_VERSION` is a build
 * argument tracked nowhere in git, and an older plugin simply has no gate.
 *
 * Reads the services from their leaf (`services-registry.ts`, which `load.ts`
 * writes and re-exports), never from the loader: the loader pulls in the whole
 * toolkit graph, and this module is imported by the billing surface every
 * route reaches. Still loaded on demand, as before.
 */
export async function signupGateService(): Promise<PluginSignupGateService | null> {
  const { getPluginServices } = await import("../../lib/private-plugins/services-registry.js")
  const gate = getPluginServices().signupGate
  return typeof gate?.evaluate === "function" ? gate : null
}

/**
 * The transition's parity check. While the decision still lives in this
 * repo, every claim is ALSO put to the plugin's gate, and the two answers are
 * compared: agreement is logged, a disagreement is logged with both answers,
 * and nothing else happens — the claim is decided by `evaluateSignupGrant`
 * exactly as before. Callers do not await this (the corpus it reads excludes
 * the account, so it runs beside the claim's own writes), and it swallows
 * every failure: a plugin that is absent, slow or throwing changes nothing
 * for the person signing up.
 *
 * What the two log lines are for: the day this repo's copy is deleted and
 * the seam decides alone, "N agreed, 0 differed" is the evidence that nothing
 * moves for anyone — a silent log alone would also mean the plugin was never
 * asked.
 */
export async function compareWithPluginGate(
  input: PluginSignupGateInput,
  decision: PluginSignupGateDecision,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const gate = await signupGateService()
    if (!gate) return
    const theirs = await gate.evaluate(input, log)
    if (theirs.decision === decision.decision && sameReasons(theirs.reasons, decision.reasons)) {
      log.info({ userId: input.userId, decision: decision.decision }, "signup gate: the plugin agrees")
      return
    }
    log.warn(
      { userId: input.userId, ours: decision, plugin: theirs },
      "signup gate: the plugin's decision differs from this repo's",
    )
  } catch (err) {
    log.warn({ err, userId: input.userId }, "signup gate: the plugin's decision threw")
  }
}

function sameReasons(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i])
}
