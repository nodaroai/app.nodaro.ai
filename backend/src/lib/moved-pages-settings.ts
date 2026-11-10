/**
 * The settings that move a deployment's pages to their own host
 * (docs/deployment.md, "Moving the app's pages to their own host"):
 * FLOW_UI_ORIGIN (where the pages go), LEGACY_UI_HOSTS (the hosts they leave)
 * and PUBLIC_URL (the host the API, OAuth and published pages keep).
 *
 * The bundled proxy reads them per request and stays inert on a value it
 * cannot use (frontend/Caddyfile, tools/gen-route-homes.mjs). This module is
 * where such a value is refused, at boot, naming the setting
 * (lib/config.ts): a typo must not leave the move half on, with links or
 * redirects naming the wrong host.
 *
 * Pure, and kept in step with the proxy's reading: the same origin pattern
 * (a trailing slash allowed) and the same host-list rule.
 */

import { isLegacyUiHost } from "@nodaro/shared/runtime-config"

const BARE_HTTPS_ORIGIN = /^(https:\/\/[a-z0-9.-]+)\/?$/

/** The https origin a setting names (`https://host`, a trailing slash allowed), or null. */
export function httpsOriginOf(value: string | undefined): string | null {
  const match = BARE_HTTPS_ORIGIN.exec((value ?? "").trim())
  return match ? match[1] : null
}

/** LEGACY_UI_HOSTS as a list: commas are spaces, runs of spaces separate, letter case is ignored. */
export function legacyUiHostList(value: string | undefined): string[] {
  return (value ?? "").toLowerCase().replace(/,/g, " ").split(" ").filter((host) => host !== "")
}

/**
 * Why these settings cannot run, starting with the setting's name; null when
 * they can, or are all unset. The move is on only with all of them usable,
 * exactly as the proxy reads them (tools/gen-route-homes.mjs): a Flow origin, a
 * legacy host that is not the Flow host, and PUBLIC_URL another https origin.
 * Anything less is refused, so no part of the move is ever on alone.
 */
export function movedPagesSettingsProblem(env: {
  readonly FLOW_UI_ORIGIN?: string
  readonly LEGACY_UI_HOSTS?: string
  readonly PUBLIC_URL?: string
}): string | null {
  const flowSetting = (env.FLOW_UI_ORIGIN ?? "").trim()
  const hosts = legacyUiHostList(env.LEGACY_UI_HOSTS)
  if (flowSetting === "" && hosts.length === 0) return null
  if (flowSetting === "") return "LEGACY_UI_HOSTS is set without FLOW_UI_ORIGIN: set both to move the app's pages to their own host, or neither"
  const flow = httpsOriginOf(flowSetting)
  if (flow === null) return "FLOW_UI_ORIGIN must be an https origin with no path, like https://flow.example.com"
  const kept = httpsOriginOf(env.PUBLIC_URL)
  if (kept === null || kept === flow) {
    return "PUBLIC_URL must be the https origin the API keeps (not FLOW_UI_ORIGIN's) while FLOW_UI_ORIGIN is set: published apps, embeds and API addresses name it"
  }
  const notAHost = hosts.find((host) => !isLegacyUiHost(host))
  if (notAHost !== undefined) {
    return `LEGACY_UI_HOSTS must list bare host names (no scheme, port, path, tab or line break), separated by commas or spaces: ${JSON.stringify(notAHost)} is not one`
  }
  if (!hosts.some((host) => `https://${host}` !== flow)) {
    return "LEGACY_UI_HOSTS must name at least one host the pages move away from (not FLOW_UI_ORIGIN's) while FLOW_UI_ORIGIN is set: set both, or neither"
  }
  return null
}
