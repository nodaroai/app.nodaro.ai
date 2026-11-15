import { hasCredits } from "./config.js"
import { configureDeploymentPayer } from "./deployment-payer.js"

/**
 * Whether this process has an external wallet configured: any of its three
 * variables set, read as `ee/billing/external-wallet-client.ts ::
 * externalWalletConfig` reads them (trimmed). Boot refuses a partial set, so a
 * running process that answers true has all three. For core code that may not
 * load the wallet module (the MCP lane's amounts, `lib/mcp/amounts.ts`).
 */
export function externalWalletConfigured(): boolean {
  return [process.env.DEPLOYMENT_WALLET_URL, process.env.DEPLOYMENT_WALLET_TOKEN, process.env.DEPLOYMENT_WALLET_SSO_PROVIDER].some((v) => Boolean(v?.trim()))
}

/** Workers have their own singleton state; a queued payer context is not boot configuration. */
export async function initializeExternalWallet(initializePayer = false): Promise<void> {
  if (![process.env.DEPLOYMENT_WALLET_URL, process.env.DEPLOYMENT_WALLET_TOKEN, process.env.DEPLOYMENT_WALLET_SSO_PROVIDER].some(Boolean)) return
  if (!hasCredits()) throw new Error("External wallet requires the cloud credit system")
  if (initializePayer) {
    const result = await configureDeploymentPayer()
    if (!result.ok) throw new Error("External wallet payer could not be initialized")
  }
  const wallet = await import("../ee/billing/external-wallet.js")
  wallet.validateExternalWallet()
}
