import { FACTORY_PRESET_PREVIEW_FILES, FACTORY_PRESET_PREVIEW_LARGE_FILES } from "./preview-files.generated.js"

export { FACTORY_PRESET_PREVIEW_FILES, FACTORY_PRESET_PREVIEW_LARGE_FILES }

/**
 * Where the factory preset previews live, relative to the app's origin:
 * `frontend/public/preset-previews/` is served at `/preset-previews/` in every
 * edition. Each name carries its content hash (`<slug>.<hash8>.webp`), so the
 * server caches them as immutable and a regenerated picture is a new URL.
 */
export const PRESET_PREVIEW_PATH = "/preset-previews/"

/** The tile picture (`previewUrl`) is this wide. */
export const PRESET_PREVIEW_WIDTH = 512
/** The full-screen picture (the second entry of `previewSrcSet`) is at most this wide; the map records its real width. */
export const PRESET_PREVIEW_LARGE_WIDTH = 1024

/** A full-screen picture as the large map records it: its file under /preset-previews/ and its real width. */
export interface PresetPreviewLargeFile {
  readonly file: string
  readonly width: number
}

function originOf(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

/**
 * The absolute URL of a factory preset's example picture on the installation
 * at `baseUrl` (its public origin, e.g. "https://app.nodaro.ai"), or null when
 * the preset has none. Only a preset whose file is in the committed map gets a
 * URL, so it never points at a file that does not exist.
 *
 * @param files the preset id → file map; defaults to the committed one
 */
export function factoryPresetPreviewUrl(
  presetId: string,
  baseUrl: string,
  files: Readonly<Record<string, string>> = FACTORY_PRESET_PREVIEW_FILES,
): string | null {
  const file = Object.prototype.hasOwnProperty.call(files, presetId) ? files[presetId] : undefined
  if (!file) return null
  const origin = originOf(baseUrl)
  return origin ? `${origin}${PRESET_PREVIEW_PATH}${file}` : null
}

/**
 * The same picture at its two sizes as an `<img srcset>` value — the tile
 * picture at 512w and the full-screen one at its real width (up to 1024w) —
 * so a client lets the browser pick by the room it has. Null when either size
 * is missing, so a srcset never names a file that does not exist.
 *
 * @param files the small map; @param largeFiles the large map — both default to the committed ones
 */
export function factoryPresetPreviewSrcSet(
  presetId: string,
  baseUrl: string,
  files: Readonly<Record<string, string>> = FACTORY_PRESET_PREVIEW_FILES,
  largeFiles: Readonly<Record<string, PresetPreviewLargeFile>> = FACTORY_PRESET_PREVIEW_LARGE_FILES,
): string | null {
  const small = factoryPresetPreviewUrl(presetId, baseUrl, files)
  const big = Object.prototype.hasOwnProperty.call(largeFiles, presetId) ? largeFiles[presetId] : undefined
  const large = big ? factoryPresetPreviewUrl(presetId, baseUrl, { [presetId]: big.file }) : null
  if (!small || !large || !big) return null
  return `${small} ${PRESET_PREVIEW_WIDTH}w, ${large} ${big.width}w`
}
