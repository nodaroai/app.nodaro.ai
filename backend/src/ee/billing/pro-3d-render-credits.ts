import { PRO3D_RENDER_CREDIT_ID } from "@nodaro/shared"
import { PriceNotConfiguredError, getModelCreditBaseCost } from "./credits.js"

/** Require an enabled configured price before entering the private engine. */
export async function assertPro3DRenderPriceConfigured(): Promise<void> {
  const pricing = await getModelCreditBaseCost(PRO3D_RENDER_CREDIT_ID)
  if (!pricing.isEnabled) throw new PriceNotConfiguredError(PRO3D_RENDER_CREDIT_ID)
}
