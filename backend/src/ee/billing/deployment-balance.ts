// @registry-enumerates reads an account's balance through CreditsService — no node type is looked up, so not a @registry-lookup
import { allowanceEnforcementActive, deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { allowanceFor } from "./deployment-allowance-service.js"
import { externalWalletActive, externalWalletBalance } from "./external-wallet.js"
import { CreditsService } from "./credits.js"
import { withBalanceDisplay, type BalanceDisplay } from "./credit-display.js"

/** The deployment's own figures of a balance read, beside the account's. */
export interface DeploymentBalanceFields {
  externalWallet?: { available: number | null }
  allowance?: { granted: number; remaining: number; enforced: boolean } | null
}

/**
 * The balance payload with the deployment's own figures added: what an
 * external wallet holds for the user, or the user's allowance under a single
 * payer. ONE assembly for `GET /v1/user/credits` and MCP `check_balance`, so
 * the two can not disagree. With no payer the payload is returned as it is.
 *
 * D12 — the per-user allowance rides ALONGSIDE the balance; `total` is
 * never overloaded to mean it (getBalance has five non-test callers and
 * three of them mean something else by that field).
 *
 * The key is ABSENT on mainline and PRESENT under a payer, where `null`
 * is a real answer: the payer reading its own balance (D13 — it holds
 * the real credits, not an allocation), or the figure was unavailable.
 * It is NOT null merely because enforcement is off — under the ruling
 * the allowance is visible from the moment a payer exists, which is what
 * lets the sidebar stop rendering the frozen signup grant at rollout
 * step 5. The client renders null as an em dash and falls back to
 * `total`; it must never render it as 0.
 *
 * The fields are named explicitly rather than spread: `UserAllowance`
 * also carries `spent` for the admin list, and this body is fixed at the
 * three the sidebar, /usage and the canvas gate consume.
 *
 * `enforced` IS THE SWITCH, and the figures alone are not it. Under the
 * ruling above, an allowance is VISIBLE from the moment a payer exists,
 * while `reserve_credits` only refuses over it once `billing.allowances`
 * is "enforce" — so a browser gating a run on `remaining` would refuse
 * runs the payer's pool would happily have paid for, and the canvas Run
 * would roll back on a limit the server does not apply. `billing
 * .allowances` is stripped from /config.js by design, so this field is
 * the browser's ONLY way to tell a displayed allowance from an enforced
 * one; display surfaces ignore it and keep rendering the figures.
 */
export async function withDeploymentBalance<T extends object>(userId: string, data: T): Promise<T | (T & DeploymentBalanceFields)> {
  const dep = deploymentPayerActive()
  if (!dep) return data
  const wallet = externalWalletActive()
  const allowance = !wallet ? await allowanceFor(userId) : null
  // ONE null, TWO causes — and only here is the payer's identity beside the
  // requester's. The payer's own null is CORRECT (D13) and silent; anybody
  // else's means the figure could not be read (a settings row that would not
  // load, a PostgREST blip), and that fault is otherwise invisible: the client
  // is forbidden to refuse on it (it gates on nothing but a PRESENT, ENFORCED
  // allowance), so a deployment whose allowance reads are failing looks
  // exactly like one running normally, for the 15 s of every cached balance.
  // The wire shape does not grow a field to say so — the browser has no use
  // for one — so the log is where it is said.
  if (!wallet && allowance === null && userId !== deploymentPayerId()) {
    console.error("[credits] allowance unavailable under a deployment payer — sending null for user", userId)
  }
  return {
    ...data,
    ...(wallet ? { externalWallet: { available: await externalWalletBalance(userId) } } : {}),
    allowance: allowance
      ? {
          granted: allowance.granted,
          remaining: allowance.remaining,
          enforced: allowanceEnforcementActive(),
        }
      : null,
  }
}

/**
 * The balance as MCP `check_balance` states it on a deployment in its own
 * terms: the account's figures with the deployment's added (above), and the
 * same figures converted into the deployment's unit by the REST route's own
 * projection (`withBalanceDisplay`) — `converted` is absent where that
 * projection sends no `display` (no unit, or the billing account's own read).
 */
export async function readDeploymentBalance(userId: string): Promise<{
  raw: Awaited<ReturnType<typeof CreditsService.getBalance>> & DeploymentBalanceFields
  converted: BalanceDisplay | undefined
}> {
  const raw = await withDeploymentBalance(userId, await CreditsService.getBalance(userId))
  const shown = withBalanceDisplay(raw, userId)
  return { raw, converted: "display" in shown ? shown.display : undefined }
}
