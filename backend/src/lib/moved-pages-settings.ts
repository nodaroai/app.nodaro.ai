/**
 * The settings that give a deployment's pages a host of their own
 * (docs/deployment.md, "Moving the app's pages to their own host"):
 * FLOW_UI_ORIGIN (the pages' own host), LEGACY_UI_HOSTS (the hosts they leave)
 * and PUBLIC_URL (the host the API, OAuth and published pages keep).
 * FLOW_PUBLIC_URL is the Flow host's other name, the one the API's links read:
 * either one gives the Flow origin, both set must agree, and the image's
 * start.sh hands FLOW_UI_ORIGIN to the proxy from FLOW_PUBLIC_URL when that is
 * unset.
 *
 * TWO STATES, each by one rule that the proxy (tools/gen-route-homes.mjs), the
 * /config.js writer and the browser also read:
 *   - The pages have their own host: a Flow origin, and PUBLIC_URL another https
 *     origin. Every host still serves every page; a browser's saved settings
 *     carry over to the Flow host once (the storage bridge), and each public
 *     page names its one home to search engines (a canonical link).
 *   - The move is on: that, plus a legacy host that is not the Flow host. The
 *     legacy hosts redirect the moved pages to the Flow host, and links name it.
 * The server's links follow the second (movedFlowOrigin). Anything that is
 * neither is refused at boot, naming the setting (lib/config.ts): a typo must
 * not leave a half-set state on, with links or redirects naming the wrong host.
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
 * The two origins when the deployment's pages have a host of their own (the
 * first state above: a Flow origin from either name, and PUBLIC_URL another
 * https origin), whether or not the move is on; else null.
 */
export function flowHostOrigins(env: MovedPagesSettings): { readonly flow: string; readonly kept: string } | null {
  const setting = flowSetting(env)
  const flow = setting ? httpsOriginOf(setting.value) : null
  if (flow === null) return null
  const kept = httpsOriginOf(env.PUBLIC_URL)
  return kept === null || kept === flow ? null : { flow, kept }
}

/**
 * The origin the app's pages have moved to, when the move is on by the one
 * rule (their own host, plus a legacy host that is not the Flow host); else
 * null, and every link stays on PUBLIC_URL. A half-set state never gets this
 * far: the server refuses it at boot.
 */
export function movedFlowOrigin(env: MovedPagesSettings): string | null {
  const origins = flowHostOrigins(env)
  if (origins === null) return null
  return legacyUiHostList(env.LEGACY_UI_HOSTS).some((host) => `https://${host}` !== origins.flow) ? origins.flow : null
}

/**
 * Why these settings cannot run, starting with the setting's name; null when
 * they can, or are all unset. Only the two states run: the pages' own host
 * alone (LEGACY_UI_HOSTS empty), or the whole move. Anything in between is
 * refused, so no part of either is ever on by accident.
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
  // The pages' own host alone: every host keeps serving them, and none redirects.
  if (hosts.length === 0) return null
  const notAHost = hosts.find((host) => !isLegacyUiHost(host))
  if (notAHost !== undefined) {
    return `LEGACY_UI_HOSTS must list bare host names (no scheme, port, path, tab or line break), separated by commas or spaces: ${JSON.stringify(notAHost)} is not one`
  }
  if (!hosts.some((host) => `https://${host}` !== flow)) {
    return `LEGACY_UI_HOSTS must name at least one host the pages move away from (not ${setting.name}'s), or be empty to keep every host serving them`
  }
  return null
}
