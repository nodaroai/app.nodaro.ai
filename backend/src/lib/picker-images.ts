import type { PickerImageOptions } from "@nodaro/prompts"
import { isCloud } from "./config.js"
import { appBaseUrl } from "./deployment-urls.js"

/**
 * How the API pictures picker options (the `imageUrl` of every catalog
 * option, the Person / Styling topic pictures, the directory's `imageCount`):
 *
 * - self-hosted pictures on THIS installation's public origin — PUBLIC_URL,
 *   the same base every other generated link uses (the community stack sets
 *   it; Nodaro Cloud's app host when unset), so an external app always gets
 *   absolute URLs on the install it asked, never on Nodaro's servers;
 * - the rendered look previews, which live on the Nodaro CDN, on Nodaro Cloud
 *   only — the same rule the editor follows (look-previews-bootstrap.ts).
 */
export function pickerImageOptions(): PickerImageOptions {
  return { baseUrl: appBaseUrl(), lookPreviews: isCloud() }
}
