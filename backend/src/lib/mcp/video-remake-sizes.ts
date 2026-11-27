// @reads-none reads the app settings and the loaded engine's declaration, no repo file
/**
 * The sizes `video_remake` names in its description (decided 2026-11-27): the
 * sizes this deployment's engine really offers per engine choice, from the
 * same source `GET /v1/video-remake/style-choice` answers `resolutions` from
 * (`deliveredResolutionsOffered`: the engine's declared delivered sizes less
 * the steps the admin switched off), so the tool never names a size the route
 * would refuse.
 *
 * Resolved once per MCP request with the session (lib/mcp/server.ts
 * `resolveMcpSession`), handed to the registration and part of the shared
 * builds' shape (tools-built-once.ts `buildShapeOf`), so an admin's change is
 * in the next request's tool list. Three answers:
 *
 *   delivered  the engine reads `resolution` as the size delivered: each
 *              engine choice's sizes, smallest (the default) first;
 *   engine     the engine does not deliver resolutions yet: `resolution` is
 *              the size the engine makes, named from the shared catalog as
 *              before the change;
 *   unread     the settings could not be read: no size is named, only that a
 *              size not offered is refused with the sizes offered.
 */
import { NODARO_MOTION_ENGINES, VIDEO_REMAKE_FLASH_ENGINES } from "@nodaro/shared/models"
import { hasCredits } from "../config.js"
import { getAppSettings, settingsReadFailed } from "../app-settings.js"
import { getPluginSupports } from "../private-plugins/supports-registry.js"
import { enginePreciseUpscale } from "../video-remake-upscale-choice.js"
import {
  deliveredResolutionsOffered,
  deliveredResolutionsReadSettings,
  engineDeliversResolution,
  engineMadeSizes,
  type VideoRemakeDeliveredSize,
  type VideoRemakeEngineChoice,
  type VideoRemakeResolutions,
} from "../video-remake-delivered-resolution.js"

export type VideoRemakeSizesHere =
  | { readonly kind: "delivered"; readonly resolutions: VideoRemakeResolutions }
  | { readonly kind: "engine" }
  | { readonly kind: "unread" }

const ENGINE_CHOICES: readonly VideoRemakeEngineChoice[] = [...NODARO_MOTION_ENGINES, ...VIDEO_REMAKE_FLASH_ENGINES]
const SIZE_ORDER: readonly VideoRemakeDeliveredSize[] = ["480p", "720p", "1080p", "4k"]

/**
 * What this deployment offers, for `video_remake`'s description. Undefined off Nodaro Cloud (the tool is not
 * registered there). Reads the settings only where the sizes depend on them (as `style-choice` does); a read that
 * fails, or throws, answers `unread`. Never throws.
 */
export async function resolveVideoRemakeSizes(): Promise<VideoRemakeSizesHere | undefined> {
  if (!hasCredits()) return undefined
  const cs = getPluginSupports().castSwap
  if (!engineDeliversResolution(cs)) return { kind: "engine" }
  if (!deliveredResolutionsReadSettings(cs)) return { kind: "delivered", resolutions: deliveredResolutionsOffered(cs, null) }
  try {
    const settings = await getAppSettings()
    if (settingsReadFailed(settings)) return { kind: "unread" }
    return { kind: "delivered", resolutions: deliveredResolutionsOffered(cs, enginePreciseUpscale(settings.nodaro_motion_precise_upscale, cs)) }
  } catch {
    return { kind: "unread" }
  }
}

const quoted = (size: VideoRemakeDeliveredSize) => `"${size}"`

/** `"720p" (default), "1080p" or "4k"`: a list's sizes, the first the default. */
function sizesInWords(sizes: readonly VideoRemakeDeliveredSize[]): string {
  const [first, ...rest] = sizes
  if (first === undefined) return ""
  const head = `${quoted(first)} (default)`
  if (rest.length === 0) return `${head} only`
  const words = [head, ...rest.map(quoted)]
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`
}

/** Each engine choice and its sizes, choices with the same sizes named together; null when a choice has none. */
function perChoice(
  sizesOf: (choice: VideoRemakeEngineChoice) => readonly VideoRemakeDeliveredSize[] | undefined,
  choices: readonly VideoRemakeEngineChoice[] = ENGINE_CHOICES,
): string | null {
  const groups: { choices: VideoRemakeEngineChoice[]; sizes: readonly VideoRemakeDeliveredSize[] }[] = []
  for (const choice of choices) {
    const sizes = sizesOf(choice)
    if (!sizes || sizes.length === 0) return null
    const same = groups.find((g) => g.sizes.join() === sizes.join())
    if (same) same.choices.push(choice)
    else groups.push({ choices: [choice], sizes })
  }
  return groups.map((g) => `${g.choices.join(" and ")}: ${sizesInWords(g.sizes)}`).join("; ")
}

const REFUSED = "A size not offered is refused (resolution_not_offered, its offered naming the sizes offered)."

/** The engine's own sizes, per engine choice (an engine that does not deliver resolutions). */
const engineSizes = () => perChoice((choice) => engineMadeSizes(choice))

/** The `resolution` argument's description. */
export function videoRemakeResolutionArg(here: VideoRemakeSizesHere | undefined): string {
  if (here?.kind === "delivered") {
    const named = perChoice((choice) => here.resolutions[choice])
    if (named) return `The size delivered: ${named}. ${REFUSED}`
  }
  // An engine from before the delivered sizes: as the tool said before them, and no refusal it may not give.
  if (here?.kind === "engine") return `The size the engine makes: ${engineSizes()}; any other is refused.`
  return `The size delivered, by engine choice. ${REFUSED}`
}

/**
 * `modify_video`'s clause on the two engines' `resolution` (it offers the engines, not their Flash choices): the sizes
 * each delivers here, the engine's own where it does not deliver resolutions, none where the settings were not read.
 */
export function videoRemakeEnginesSizes(here: VideoRemakeSizesHere | undefined): string {
  // Short, as this tool's other models are listed: "nodaro-prism and nodaro-pulse 720p (default)/1080p/4k".
  const compact = (sizesOf: (choice: VideoRemakeEngineChoice) => readonly VideoRemakeDeliveredSize[] | undefined): string | null => {
    const groups: { choices: string[]; sizes: string }[] = []
    for (const choice of NODARO_MOTION_ENGINES) {
      const sizes = sizesOf(choice)
      if (!sizes || sizes.length === 0) return null
      const words = sizes.map((size, i) => (i === 0 ? `${size} (default)` : size)).join("/")
      const same = groups.find((g) => g.sizes === words)
      if (same) same.choices.push(choice)
      else groups.push({ choices: [choice], sizes: words })
    }
    return groups.map((g) => `${g.choices.join(" and ")} ${g.sizes}`).join(", ")
  }
  if (here?.kind === "delivered") {
    const named = compact((choice) => here.resolutions[choice])
    if (named) return `delivered: ${named}`
  }
  if (here?.kind === "engine") return `the engine's size: ${compact((choice) => engineMadeSizes(choice))}`
  return "nodaro-prism / nodaro-pulse: the size delivered, as offered here (else resolution_not_offered)"
}

/** The description's sentence on `resolution`, after the engine's ("…; " + this + ". "). */
export function videoRemakeResolutionSentence(here: VideoRemakeSizesHere | undefined): string {
  if (here?.kind === "delivered") {
    const prism = here.resolutions["nodaro-prism"]
    const all = ENGINE_CHOICES.flatMap((choice) => here.resolutions[choice] ?? [])
    const largest = [...SIZE_ORDER].reverse().find((size) => all.includes(size))
    if (prism && prism.length > 0 && largest !== undefined) {
      return prism[0] === largest
        ? `resolution is the size delivered, ${prism[0]}`
        : `resolution is the size delivered, ${prism[0]} by default, up to ${largest}`
    }
  }
  if (here?.kind === "engine") return "resolution is the size the engine makes (see resolution)"
  return "resolution is the size delivered (see resolution)"
}

/** A stable key of the answer, for the shared builds' shape. */
export function videoRemakeSizesShape(here: VideoRemakeSizesHere | undefined): unknown {
  if (here?.kind !== "delivered") return here?.kind ?? null
  return ENGINE_CHOICES.map((choice) => [choice, here.resolutions[choice] ?? []])
}
