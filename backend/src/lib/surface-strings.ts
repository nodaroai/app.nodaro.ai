// @reads-none reads only a product build's key manifest (frontend/dist/, build output no commit holds)
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  UI_STRING_PRODUCTS,
  uiStringManifestFile,
  uiStringPlaceholders,
  type RuntimeSurfaceStrings,
  type UiStringManifest,
  type UiStringProduct,
} from "@nodaro/shared/runtime-config"
import { canonicalLocaleId } from "./surface-profile-client-keys.js"

/**
 * The deployment's UI-string overrides (`strings` in the surface profile),
 * validated for the browser:
 *
 *     "strings": { "flow": { "he": { "credits.allowanceExceeded": "…" } } }
 *
 * Every entry is checked against the product's key manifest, which its build
 * derives from its base (English) dictionary and leaves beside its output
 * (frontend/src/lib/i18n/ui-strings-manifest-plugin.ts for Flow): the key
 * exists there, the locale is one the deployment offers, the text is plain, its
 * {placeholders} are exactly the base string's, and its length is sane.
 *
 * Every product's manifest is read from one directory, Flow's build output. A
 * deployment that composes another product's app into the same image copies
 * that product's manifest there, next to Flow's own. A manifest that is not
 * there costs that one product its overrides, with one warning; the other
 * products keep theirs.
 *
 * INVALID INPUT IS DROPPED WITH A WARNING, never fatal. That is the profile's
 * convention for a field (a partial config is a first-class state): each bad
 * entry is dropped alone and the rest are kept. Nothing about `strings` can
 * fail a boot. A wrong word is cosmetic, and refusing to start a deployment
 * over one would be worse than showing the platform's own wording.
 *
 * Runs at container boot, in the /config.js projection that the boot printer
 * renders (surface-profile-runtime-config.ts), which is the one place
 * `strings` leaves the backend. The API never reads `strings`. With no
 * `strings` key the manifest is never opened.
 */

/** The frontend's build output: backend/{src,dist}/lib → frontend/dist, in a checkout and in the image alike. */
export const FRONTEND_BUILD_DIR = fileURLToPath(new URL("../../../frontend/dist/", import.meta.url))

export type UiStringManifestRead = { readonly manifest: UiStringManifest } | { readonly problem: string }
export type ReadUiStringManifest = (product: UiStringProduct) => UiStringManifestRead

/** Longest override, in characters. The longest base string is about 700; this leaves room for a longer language. */
export const UI_STRING_MAX_LENGTH = 1000

/**
 * All of one product's override text, in UTF-8 bytes. /config.js loads before
 * every page renders, and the whole printed surface must stay under
 * RUNTIME_SURFACE_MAX_BYTES (surface-profile-runtime-config.ts).
 */
export const UI_STRINGS_MAX_BYTES = 64 * 1024

/** Warnings printed one by one before the rest are summed up. */
const MAX_LISTED = 20

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string")

function isManifestOf(value: unknown, product: string): value is UiStringManifest {
  return isPlainObject(value) && value.product === product && isStringList(value.locales) && isPlainObject(value.keys) && Object.values(value.keys).every(isStringList)
}

/**
 * The key manifest `product`'s build left in `dir`, or why there is none to
 * check against. Never throws: a build without the file (a local dev run, for
 * one) costs the deployment its overrides, not its boot.
 */
export function readUiStringManifest(product: UiStringProduct, dir: string = FRONTEND_BUILD_DIR): UiStringManifestRead {
  const file = join(dir, uiStringManifestFile(product))
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { problem: code === "ENOENT" ? `there is no key manifest at ${file} (a local dev run, a build that did not emit it, or an image that did not copy it there)` : `the key manifest at ${file} cannot be read (${code ?? (err as Error).message})` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { problem: `the key manifest at ${file} is not valid JSON` }
  }
  return isManifestOf(parsed, product) ? { manifest: parsed } : { problem: `${file} is not a key manifest for ${product}` }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
// C0 (but \n, which three base strings use), DEL and C1.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/
// Embeddings and overrides (LRE RLE PDF LRO RLO) reorder the text that follows
// them. Marks (LRM RLM ALM) and isolates (LRI RLI FSI PDI), which right-to-left
// text uses, stay allowed.
const BIDI_EMBEDDING = /[\u202A-\u202E]/
const HTML_TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])/g
const HTML_ELEMENTS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo big blink blockquote body br button canvas caption center cite code col " +
    "colgroup data dd del details dfn dialog div dl dt em embed fieldset figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head " +
    "header hr html i iframe img input ins kbd label legend li link main mark marquee math menu meta meter nav noscript object ol " +
    "optgroup option output p param picture pre progress q rp rt ruby s samp script section select slot small source span strike strong " +
    "style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr"
  ).split(" "),
)
const HTML_DECLARATION = /<[!?]/
const CHARACTER_REFERENCE = /&(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);/

const list = (names: readonly string[]): string => names.map((n) => `{${n}}`).join(", ") || "none"

/**
 * Why `text` cannot replace a base string with these placeholders, or
 * undefined when it can. The interface renders strings as text, so markup
 * would show as written.
 */
export function uiStringTextProblem(text: unknown, basePlaceholders: readonly string[]): string | undefined {
  if (typeof text !== "string") return "is not text"
  if (text.trim() === "") return "is blank; an override must show something"
  if (LONE_SURROGATE.test(text)) return "is not valid Unicode (a lone surrogate)"
  const length = Array.from(text).length
  if (length > UI_STRING_MAX_LENGTH) return `is ${length} characters long; the limit is ${UI_STRING_MAX_LENGTH}`
  if (CONTROL.test(text)) return "contains a control character (only a line break is allowed)"
  if (BIDI_EMBEDDING.test(text)) return "contains a bidi embedding or override (U+202A to U+202E); use a mark or an isolate"
  const tag = Array.from(text.matchAll(HTML_TAG), (m) => m[1].toLowerCase()).find((name) => HTML_ELEMENTS.has(name))
  if (tag) return `contains HTML markup (<${tag}>); it would show as written`
  if (HTML_DECLARATION.test(text)) return "contains HTML markup (<! or <?); it would show as written"
  if (CHARACTER_REFERENCE.test(text)) return "contains an HTML character reference (such as &amp;); it would show as written"
  const used = uiStringPlaceholders(text)
  if (used.join("\u0000") !== basePlaceholders.join("\u0000")) {
    return `uses placeholders ${list(used)}, but the base string uses ${list(basePlaceholders)}`
  }
  return undefined
}

/**
 * The overrides the browser may receive, or undefined when none survive (so
 * the key stays out of /config.js). `offered` is the profile's resolved
 * `locale.offered`. When it is absent, a product's overrides may target the
 * locales that product offers. A manifest is read only for a product the
 * overrides name. Never throws.
 */
export function resolveSurfaceStrings(
  raw: unknown,
  offered: readonly string[] | undefined,
  readManifest: ReadUiStringManifest = readUiStringManifest,
): RuntimeSurfaceStrings | undefined {
  if (raw === undefined) return undefined
  const warnings: string[] = []
  const warn = (line: string): void => {
    warnings.push(line)
  }
  const out: [string, Record<string, Record<string, string>>][] = []
  if (!isPlainObject(raw)) {
    warn('strings must be an object { "<product>": { "<locale>": { "<key>": "text" } } } — ignored')
  } else {
    for (const [product, byLocale] of Object.entries(raw)) {
      const kept = resolveProduct(product, byLocale, offered, readManifest, warn)
      if (kept) out.push([product, kept])
    }
  }
  for (const line of warnings.slice(0, MAX_LISTED)) console.warn(`[surface-profile] ${line}`)
  if (warnings.length > MAX_LISTED) console.warn(`[surface-profile] strings: ${warnings.length - MAX_LISTED} more problems not shown`)
  return out.length ? Object.fromEntries(out) : undefined
}

function resolveProduct(
  product: string,
  byLocale: unknown,
  offered: readonly string[] | undefined,
  readManifest: ReadUiStringManifest,
  warn: (line: string) => void,
): Record<string, Record<string, string>> | undefined {
  if (!(UI_STRING_PRODUCTS as readonly string[]).includes(product)) {
    warn(`strings.${product} dropped — "${product}" is not a product that reads overrides (known: ${UI_STRING_PRODUCTS.join(", ")})`)
    return undefined
  }
  if (!isPlainObject(byLocale)) {
    warn(`strings.${product} dropped — must be an object { "<locale>": { "<key>": "text" } }`)
    return undefined
  }
  const found = readManifest(product as UiStringProduct)
  if ("problem" in found) {
    warn(`strings.${product}: every override dropped — ${found.problem}, so none can be checked`)
    return undefined
  }
  const { manifest } = found
  const allowed = offered ?? manifest.locales
  const locales: [string, Record<string, string>][] = []
  let bytes = 0
  for (const [given, texts] of Object.entries(byLocale)) {
    const locale = canonicalLocaleId(given)
    const at = `strings.${product}.${given}`
    if (!locale) {
      warn(`${at} dropped — "${given}" is not a locale id`)
      continue
    }
    if (!allowed.includes(locale)) {
      warn(`${at} dropped — ${locale} is not offered (${offered ? "locale.offered" : `${product} offers`}: ${allowed.join(", ")})`)
      continue
    }
    if (locales.some(([seen]) => seen === locale)) {
      warn(`${at} dropped — ${locale} is already given under another spelling`)
      continue
    }
    if (!isPlainObject(texts)) {
      warn(`${at} dropped — must be an object { "<key>": "text" }`)
      continue
    }
    const kept: [string, string][] = []
    for (const [key, text] of Object.entries(texts)) {
      const base = Object.hasOwn(manifest.keys, key) ? manifest.keys[key] : undefined
      const why = base === undefined ? `is not a key of the ${product} dictionary` : uiStringTextProblem(text, base)
      if (why) {
        warn(`${at}.${JSON.stringify(key)} dropped — ${why}`)
        continue
      }
      kept.push([key, text as string])
      bytes += Buffer.byteLength(text as string, "utf8")
    }
    if (kept.length) locales.push([locale, Object.fromEntries(kept)])
  }
  if (bytes > UI_STRINGS_MAX_BYTES) {
    warn(`strings.${product} dropped — ${bytes} bytes of text is over the ${UI_STRINGS_MAX_BYTES}-byte limit for one product`)
    return undefined
  }
  return locales.length ? Object.fromEntries(locales) : undefined
}
