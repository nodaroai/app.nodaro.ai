/**
 * The settings that move a deployment's pages to their own host
 * (docs/deployment.md, "Moving the app's pages to their own host"):
 * FLOW_UI_ORIGIN (where the pages go), LEGACY_UI_HOSTS (the hosts they leave)
 * and PUBLIC_URL (the host the API, OAuth and published pages keep).
 * FLOW_PUBLIC_URL is the Flow host's other name, the one the API's links read:
 * either one gives the Flow origin, both set must agree, and the image's
 * start.sh hands FLOW_PUBLIC_URL to the proxy as FLOW_UI_ORIGIN when that is
 * unset.
 *
 * ONE RULE for whether the move is on, the proxy's (tools/gen-route-homes.mjs),
 * also read by the /config.js writer and the browser: a Flow origin, a legacy
 * host that is not the Flow host, and PUBLIC_URL another https origin. The
 * server's links follow it (movedFlowOrigin), and any partial set is refused
 * at boot, naming the setting (lib/config.ts): a typo must not leave the move
 * half on, with links or redirects naming the wrong host.
 *
 * Pure, and kept in step with the proxy's reading: the same origin pattern
 * (a trailing slash allowed, the value read whole) and the same host-list rule.
 */

import { isLegacyUiHost } from "@nodaro/shared/runtime-config"

const BARE_HTTPS_ORIGIN = /^(https:\/\/[a-z0-9.-]+)\/?$/

/**
 * The https origin a setting names (`https://host`, a trailing slash allowed),
 * or null. The value is read whole, as the proxy reads it: spaces around it
 * make it no origin at all.
 */
export function httpsOriginOf(value: string | undefined): string | null {
  const match = BARE_HTTPS_ORIGIN.exec(value ?? "")
  return match ? match[1] : null
}

/** LEGACY_UI_HOSTS as a list: ASCII letter case is ignored, commas are spaces, runs of spaces separate. */
export function legacyUiHostList(value: string | undefined): string[] {
  return (value ?? "").replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(/,/g, " ").split(" ").filter((host) => host !== "")
}

interface MovedPagesSettings {
  readonly FLOW_UI_ORIGIN?: string
  readonly FLOW_PUBLIC_URL?: string
  readonly LEGACY_UI_HOSTS?: string
  readonly PUBLIC_URL?: string
}

// Unset is empty, exactly as start.sh's `${FLOW_UI_ORIGIN:-$FLOW_PUBLIC_URL}` reads it: a value of spaces is set (and no origin).
const isUnset = (value: string | undefined): boolean => (value ?? "") === ""

/** The Flow host's setting as given: FLOW_UI_ORIGIN, else FLOW_PUBLIC_URL (its other name), with the name it came from. */
function flowSetting(env: MovedPagesSettings): { readonly name: "FLOW_UI_ORIGIN" | "FLOW_PUBLIC_URL"; readonly value: string } | null {
  if (!isUnset(env.FLOW_UI_ORIGIN)) return { name: "FLOW_UI_ORIGIN", value: env.FLOW_UI_ORIGIN ?? "" }
  return isUnset(env.FLOW_PUBLIC_URL) ? null : { name: "FLOW_PUBLIC_URL", value: env.FLOW_PUBLIC_URL ?? "" }
}

/**
 * The origin the app's pages have moved to, when the move is on by the one
 * rule (a Flow origin from either name, a legacy host that is not the Flow
 * host, PUBLIC_URL another https origin); else null, and every link stays on
 * PUBLIC_URL. A partial set never gets this far: the server refuses it at boot.
 */
export function movedFlowOrigin(env: MovedPagesSettings): string | null {
  const setting = flowSetting(env)
  const flow = setting ? httpsOriginOf(setting.value) : null
  if (flow === null) return null
  const kept = httpsOriginOf(env.PUBLIC_URL)
  if (kept === null || kept === flow) return null
  return legacyUiHostList(env.LEGACY_UI_HOSTS).some((host) => `https://${host}` !== flow) ? flow : null
}

/**
 * Why these settings cannot run, starting with the setting's name; null when
 * they can, or are all unset. Anything short of the move being on by the one
 * rule is refused, so no part of it is ever on alone.
 */
export function movedPagesSettingsProblem(env: MovedPagesSettings): string | null {
  const setting = flowSetting(env)
  const hosts = legacyUiHostList(env.LEGACY_UI_HOSTS)
  if (setting === null && hosts.length === 0) return null
  if (setting === null) return "LEGACY_UI_HOSTS is set without FLOW_UI_ORIGIN (or FLOW_PUBLIC_URL): set both to move the app's pages to their own host, or neither"
  const flow = httpsOriginOf(setting.value)
  if (flow === null) return `${setting.name} must be an https origin with no path, like https://flow.example.com`
  if (!isUnset(env.FLOW_UI_ORIGIN) && !isUnset(env.FLOW_PUBLIC_URL) && httpsOriginOf(env.FLOW_PUBLIC_URL) !== flow) {
    return "FLOW_PUBLIC_URL and FLOW_UI_ORIGIN are two names for the same origin and must agree: set one of them (the other follows), or both to the same https origin"
  }
  const kept = httpsOriginOf(env.PUBLIC_URL)
  if (kept === null || kept === flow) {
    return `PUBLIC_URL must be the https origin the API keeps (not ${setting.name}'s) while ${setting.name} is set: published apps, embeds and API addresses name it`
  }
  const notAHost = hosts.find((host) => !isLegacyUiHost(host))
  if (notAHost !== undefined) {
    return `LEGACY_UI_HOSTS must list bare host names (no scheme, port, path, tab or line break), separated by commas or spaces: ${JSON.stringify(notAHost)} is not one`
  }
  if (!hosts.some((host) => `https://${host}` !== flow)) {
    return `LEGACY_UI_HOSTS must name at least one host the pages move away from (not ${setting.name}'s) while ${setting.name} is set: set both, or neither`
  }
  return null
}
