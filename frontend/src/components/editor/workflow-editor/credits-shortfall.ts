/**
 * A node's run the server refused for a credits shortfall: the editor's
 * not-enough-credits dialog opens with the refusal's own figures, instead of
 * the "Failed to start …" toast (`checkStorageError`, the blocking-dialog
 * check every node-run catch already asks first).
 *
 * The figures are the server's, RAW credits, never the client's: a dialog
 * that quotes a different number than the one that refused the run is how a
 * person learns not to trust either (the toolbar Run's check says the same,
 * run-handlers.ts `checkRunBalance`). So the dialog opens only for a refusal
 * that names both of them and shows a real shortfall:
 *  - a deployment payer's 402 names `required` and withholds `balance` (the
 *    pool is the operator's) — it keeps its toast, like a UGC call's
 *    (lib/api.ts `ugcApi`);
 *  - a 402 refused for another reason (the model is not on the plan, a daily
 *    cap) names no figure, or a balance that covers the run — it keeps its toast;
 *  - the per-user allowance (`UserAllowanceExceededError`), the app-credits
 *    refusal and the free-plan video limit are not this dialog's: unchanged.
 */
import { InsufficientCreditsError, UserAllowanceExceededError } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import type { CreditsShortfall } from "@/lib/insufficient-credits-dialog"
import type { ExecutionContext } from "./types"

// The dialog's figures and its one opener live in src/lib, beside the other
// run that opens it (UGC Creator's credits stop): re-exported for the editor.
export { openInsufficientCreditsDialog, type CreditsShortfall } from "@/lib/insufficient-credits-dialog"

const isFigure = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/** The refusal's figures when it is a credits shortfall the dialog may show, else null. */
export function creditsShortfallOf(err: unknown): CreditsShortfall | null {
  if (!hasCredits()) return null
  if (!(err instanceof InsufficientCreditsError) || err instanceof UserAllowanceExceededError) return null
  if (err.code !== "insufficient_credits") return null
  const { required, balance } = err
  if (!isFigure(required) || !isFigure(balance) || required <= balance) return null
  return { required, available: balance }
}

/**
 * Open the dialog for `err` when it is such a refusal and this run's context
 * mounts the dialog (`openCreditsDialog`: only the editor sets it). True when
 * it opened — the caller then skips its own toast.
 */
export function promptCreditsShortfall(err: unknown, ctx: Pick<ExecutionContext, "openCreditsDialog">): boolean {
  // The capability first: a context without the dialog never inspects the error.
  if (!ctx.openCreditsDialog) return false
  const shortfall = creditsShortfallOf(err)
  if (!shortfall) return false
  ctx.openCreditsDialog(shortfall)
  return true
}
