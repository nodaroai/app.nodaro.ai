import { FACTORY_PRESET_PREVIEW_FILES } from "./preview-files.generated.js"

export { FACTORY_PRESET_PREVIEW_FILES }

/**
 * Where the factory preset previews live, relative to the app's origin:
 * `frontend/public/preset-previews/` is served at `/preset-previews/` in every
 * edition. Each name carries its content hash (`<slug>.<hash8>.webp`), so the
 * server caches them as immutable and a regenerated picture is a new URL.
 */
export const PRESET_PREVIEW_PATH = "/preset-previews/"

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
