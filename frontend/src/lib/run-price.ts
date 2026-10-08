/**
 * What the app runner's Run button prices (decided 2026-10-07). An app whose
 * listed price follows the length of the recording it is given shows that
 * listing, fixed + per minute ("82 + 14/min"), until the user's recording is
 * chosen and its length is known; from then on it shows the exact figure the
 * live estimate prices for that length. An app with no per-minute part shows
 * the live figure, as before. The balance gate reads the live estimate in
 * every case: it is never priced from the per-minute label.
 */
import { isDirectVideoFileUrl, isSocialVideoUrl, videoLinkDownloadedFile } from "@nodaro/shared"
import { creditUnits, formatCreditUnits } from "@/lib/credit-units"

/**
 * The node types whose input is a recording with a length. A Video URL node
 * the app exposes is the replaced episode like an upload (the server's listing
 * counts it the same way, `RECORDING_SOURCE_TYPES`).
 */
export const RECORDING_INPUT_TYPES: ReadonlySet<string> = new Set(["upload-video", "upload-audio", "youtube-video"])

/**
 * The file a Video URL input holds for the link the user gave: the downloaded
 * file that belongs to that link, else the link itself when it is a direct
 * video file. A post link whose file is not made yet has none (its output is a
 * web page, which has no length to read).
 */
function videoLinkRecordingUrl(vals: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!vals) return undefined
  const file = videoLinkDownloadedFile(vals)
  if (file !== undefined) return file
  const link = typeof vals.youtubeUrl === "string" ? vals.youtubeUrl.trim() : ""
  return link !== "" && !isSocialVideoUrl(link) && isDirectVideoFileUrl(link) ? link : undefined
}

/** The recording a user chose for an input node: its run-time `url` (a Video URL: its file), if any. */
export function chosenRecordingUrl(
  node: { readonly id: string; readonly type?: string },
  inputValues: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): string | undefined {
  if (!RECORDING_INPUT_TYPES.has(node.type ?? "")) return undefined
  if (node.type === "youtube-video") return videoLinkRecordingUrl(inputValues?.[node.id])
  const url = inputValues?.[node.id]?.url
  return typeof url === "string" && url !== "" ? url : undefined
}

/**
 * True while any of the app's recording inputs has no recording chosen by the
 * user (the creator's sample is not theirs), or one whose length is not known
 * yet. False for an app with no recording input.
 */
export function recordingLengthPending(
  inputNodes: ReadonlyArray<{ readonly id: string; readonly type?: string }>,
  inputValues: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  mediaLengths: ReadonlyMap<string, number>,
): boolean {
  return inputNodes.some((node) => {
    if (!RECORDING_INPUT_TYPES.has(node.type ?? "")) return false
    const url = chosenRecordingUrl(node, inputValues)
    return url === undefined || mediaLengths.get(url) === undefined
  })
}

/** A listing's two parts, as the app's card shows them (with the creator's fee). */
export interface ListedPrice {
  readonly fixed: number
  readonly perMinute: number
  /** Per item beyond the saved count of a List the user fills (decided 2026-10-07); 0 when none. */
  readonly perItem?: number
}

/**
 * The listing the Run button shows (review round F4, decided 2026-10-07): the
 * app run ALONE — the listed price less its Render final part, which is run
 * and charged separately — so the exact figure that replaces it once the
 * recording's length is known prices the same run. The server sends that pair
 * as `runEstimatedCredits` / `runPerMinuteCredits`; a response without them
 * (a server before this) shows the full listing, which never under-quotes.
 * Marketplace cards keep the full listing.
 */
export function appRunListedPrice(app: {
  readonly estimatedCredits?: number | null
  readonly perMinuteCredits?: number | null
  readonly runEstimatedCredits?: number | null
  readonly runPerMinuteCredits?: number | null
  readonly perItemCredits?: number | null
  readonly runPerItemCredits?: number | null
}): ListedPrice {
  return {
    fixed: app.runEstimatedCredits ?? app.estimatedCredits ?? 0,
    perMinute: app.runPerMinuteCredits ?? app.perMinuteCredits ?? 0,
    perItem: app.runPerItemCredits ?? app.perItemCredits ?? 0,
  }
}

/**
 * The Run button's price, as the " (…)" after its label: the listing while a
 * recording's length is pending and the listing has a per-minute part, else
 * the exact figure. Empty when there is nothing to show.
 */
export function runCostLabel(args: {
  readonly exact: number
  readonly listing: ListedPrice | null | undefined
  readonly pending: boolean
  /** The localized "+ {n}/min" (`credits.plusPerMinute`), given the converted per-minute figure. */
  readonly plusPerMinute: (n: number) => string
  /** The localized "+ {n}/item" (`credits.plusPerItem`). While the listing shows,
   *  a List's per-item part follows its per-minute one; the exact figure needs
   *  none (the live estimate counts the items entered). */
  readonly plusPerItem?: (n: number) => string
}): string {
  const { exact, listing, pending, plusPerMinute, plusPerItem } = args
  if (pending && listing && listing.perMinute > 0) {
    const perItem = (listing.perItem ?? 0) > 0 && plusPerItem ? ` ${plusPerItem(creditUnits(listing.perItem ?? 0))}` : ""
    return ` (${formatCreditUnits(listing.fixed)} ${plusPerMinute(creditUnits(listing.perMinute))}${perItem})`
  }
  return exact > 0 ? ` (${formatCreditUnits(exact)})` : ""
}
