import type { MessageKey } from "@/lib/i18n"
import { personalFreeCreditsShown } from "@/lib/surface-selectors"

/**
 * The words on the button a viewer short of credits gets. "Get Free Credits"
 * promises credits of one's own, so it is only said where the deployment has
 * them to give (`personalFreeCreditsShown`); anywhere else, and for every plan
 * but free, the button says what it does.
 */
export function getCreditsCtaKey(tier: string | undefined, deploymentPayer: boolean | undefined): MessageKey {
  return tier === "free" && personalFreeCreditsShown(deploymentPayer) ? "present.getFreeCredits" : "runner.getCredits"
}
