import { getAppSettings } from "../../lib/app-settings.js"
import { settingsReadFailed } from "../../lib/app-settings-read-status.js"
import { PriceNotConfiguredError } from "./price-not-configured.js"

/** A failed settings read cannot authorize a supplier or a price. A successful read with no policy can. */
export async function getVideoRouteSettings(priceId: string) {
  const settings = await getAppSettings()
  if (settingsReadFailed(settings)) throw new PriceNotConfiguredError(priceId)
  return settings
}
