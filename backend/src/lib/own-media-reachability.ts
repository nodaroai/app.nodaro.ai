import { config } from "./config.js"
import { isUnroutableMediaUrl } from "./media-portability.js"

/**
 * Whether an outside provider (KIE, Replicate, fal) can fetch a file this
 * install stores: its storage's public base (`R2_PUBLIC_URL`, under which every
 * stored file and provider-input copy is addressed) is an http(s) link on a
 * host outside this machine and its network (`isUnroutableMediaUrl`, the one
 * list the workflow export check and the nodaro.ai relay read).
 *
 * False on an install with no publicly reachable media host — the community
 * edition's default (`docker-compose.community.yml` serves storage on
 * localhost), or a base not set at all. Nodaro Cloud's base is its public CDN,
 * so there it is always true.
 */
export function providersCanFetchOwnMedia(): boolean {
  const base = config.R2_PUBLIC_URL
  return typeof base === "string" && base.length > 0 && !isUnroutableMediaUrl(base)
}
