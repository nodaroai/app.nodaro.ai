import { isWorldId, type SurfaceWorlds, type WorldId } from "./worlds.js"

/**
 * The deployment runtime config — the object a Nodaro platform container
 * writes to `/config.js` at boot as `window.__NODARO_RUNTIME__`, and that every
 * product served from the same site reads before its app starts. One published
 * build then serves any deployment without a rebuild.
 *
 * This module is the contract between that writer and its readers: the key
 * names, their shapes, and a lenient parser. Structural vocabulary only: no
 * content, no prices, nothing about any one deployment. The platform's own
 * schema stays the authority on what a deployment may set. What reaches the
 * page has already been validated there and stripped of every server-only
 * value; this parser only refuses to hand a reader a value of the wrong type.
 */

/** The global `/config.js` assigns. */
export const RUNTIME_CONFIG_GLOBAL = "__NODARO_RUNTIME__"

/** Every top-level key `/config.js` can carry. */
export const RUNTIME_CONFIG_KEYS = Object.freeze([
  "apiUrl",
  "supabaseUrl",
  "supabaseAnonKey",
  "freecutUrl",
  "audiomassUrl",
  "defaultLocale",
  "surface",
  "moderation",
  "previewStopRule",
  "mediaOrigin",
] as const)
export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number]

export const SURFACE_HEADER_MODES = Object.freeze(["default", "white-label"] as const)
/** `white-label`: the deployment's own header, with no platform links or art. */
export type SurfaceHeaderMode = (typeof SURFACE_HEADER_MODES)[number]

export const SURFACE_CATALOG_IMAGES = Object.freeze(["default", "none", "own"] as const)
/** Pictures on picker options: the platform's (`default`), none, or the deployment's own (`own`). */
export type SurfaceCatalogImages = (typeof SURFACE_CATALOG_IMAGES)[number]

export interface RuntimeSurfaceSibling {
  readonly label: string
  readonly url: string
  readonly urlByHost?: Readonly<Record<string, string>>
}

export interface RuntimeSurfaceBrand {
  readonly productName: string
  readonly description?: string
  readonly wordmark?: string
  readonly platformLinks?: boolean
  /** A same-site path (`/brand/logo.svg`) or an https URL. */
  readonly logo?: string
  /** The page's icons, each a path on this site (`/brand/favicon.svg`): see `isSameSitePath`. */
  readonly favicon?: readonly string[]
}

/**
 * Overrides of a product's UI strings, `product → locale id → message key →
 * text`. Each product reads only its own namespace (`UI_STRING_PRODUCTS`). The
 * platform checks every entry against that product's dictionary before it
 * reaches a page: the key exists, the locale is one the deployment offers, the
 * text is plain and keeps the base string's `{placeholders}`.
 */
export type RuntimeSurfaceStrings = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>

/** The display side of billing. The server-only billing keys never reach a page. */
export interface RuntimeSurfaceBilling {
  readonly costTab: "inherit" | "hidden"
  readonly sidebarCard: "inherit" | "hidden"
  readonly selfServe: boolean
  readonly unitLabel?: string
  readonly unitRate?: number
  readonly unitDecimals?: number
}

/**
 * The deployment's surface profile as a page receives it, with every default
 * applied. Lists that are empty keep the product's own default, except
 * `worlds.allow` (see `SurfaceWorlds`).
 */
export interface RuntimeSurface {
  readonly nav: { readonly hide: readonly string[] }
  readonly features: { readonly hide: readonly string[] }
  readonly dashboard: { readonly tabs: readonly string[] }
  readonly nodes: { readonly deny: readonly string[]; readonly allow: readonly string[] }
  readonly models: { readonly deny: readonly string[]; readonly allow: readonly string[] }
  /** `requireSignIn`: no guest visits. When the deployment does not say, true exactly when sign-in is SSO-only. */
  readonly auth: { readonly methods: readonly string[]; readonly ssoLabel?: string; readonly requireSignIn: boolean }
  readonly siblings: { readonly apps: readonly RuntimeSurfaceSibling[] }
  readonly brand: RuntimeSurfaceBrand
  /** `offered`: the languages a visitor may pick from; absent = every language the product ships. */
  readonly locale: { readonly default?: string; readonly picker: boolean; readonly offered?: readonly string[] }
  readonly outputs: { readonly allowPublic: boolean }
  readonly voice: { readonly allowedGenders: readonly string[] }
  readonly billing: RuntimeSurfaceBilling
  readonly catalogs: { readonly required: boolean; readonly factoryPresets: boolean; readonly images: SurfaceCatalogImages }
  /** `links`: whether media may be imported from a link to another site. */
  readonly imports: { readonly links: boolean }
  readonly header: SurfaceHeaderMode
  readonly worlds: SurfaceWorlds
  /** The deployment's own wording for UI strings; `{}` = none. Read with `surfaceStringOverride`. */
  readonly strings: RuntimeSurfaceStrings
  /** Carried as given; no reader acts on it. */
  readonly catalogPolicy?: unknown
}

export interface NodaroRuntimeConfig {
  /** The API base. `"/"` means this page's own origin: see `resolveRuntimeApiBase`. */
  readonly apiUrl?: string
  /** The Supabase URL. `"/supabase"` means this page's own origin: see `resolveRuntimeSupabaseUrl`. */
  readonly supabaseUrl?: string
  readonly supabaseAnonKey?: string
  /** The platform editor's embedded video editor. */
  readonly freecutUrl?: string
  /** The platform editor's embedded audio editor. */
  readonly audiomassUrl?: string
  /** The language a first-time visitor starts in. */
  readonly defaultLocale?: string
  /** Present only when the deployment configured a surface profile. */
  readonly surface?: RuntimeSurface
  /** The platform editor's upload-moderation capability. */
  readonly moderation?: { readonly uploadImage?: boolean }
  /** A platform editor rollout flag. */
  readonly previewStopRule?: boolean
  /**
   * The https origin this deployment serves user media from
   * (`https://media.example.com`). Present only on a white-label deployment
   * whose public media URL is https; absent, a reader trusts no media host
   * beyond its own site.
   */
  readonly mediaOrigin?: string
}

// ── Rules shared by the platform and its readers ─────────────────────────────

/** Sign-in is SSO-only when SSO is the one method offered. */
export function isSsoOnly(methods: readonly unknown[]): boolean {
  return methods.length > 0 && methods.every((m) => m === "sso")
}

/** An explicit `requireSignIn` wins; otherwise a deployment requires sign-in exactly when it is SSO-only. */
export function surfaceRequiresSignIn(auth: { readonly methods?: unknown; readonly requireSignIn?: unknown } | undefined): boolean {
  if (typeof auth?.requireSignIn === "boolean") return auth.requireSignIn
  return isSsoOnly(strings(auth?.methods))
}

// Whitespace, control characters and backslashes never belong in a logo
// reference, and a browser reads `/\host` as `//host`: another site.
const UNSAFE_REF_CHARS = /[\s\u0000-\u001f\u007f\\]/
const PROBE_ORIGIN = "https://origin.invalid"

/**
 * A brand logo reference a page may load: a path on the page's own site
 * (`/brand/logo.svg`), or an https URL without credentials. A protocol-relative
 * `//host/…`, any other scheme (`http:`, `data:`, `javascript:`) and anything
 * with whitespace or a backslash is not one.
 */
export function isBrandLogoRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || UNSAFE_REF_CHARS.test(value)) return false
  try {
    if (value.startsWith("/")) return !value.startsWith("//") && new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password
  } catch {
    return false
  }
}

// Quotes, angle brackets and backticks would end an HTML attribute that holds
// the path, and none belongs in a path anyway.
const HTML_SPECIAL_CHARS = /["'<>`]/

/**
 * A path on the page's own site (`/brand/favicon.svg`, `/icon.png?v=2`): what
 * `brand.favicon` holds, written into the page's `<head>` as a link. Stricter
 * than `isBrandLogoRef`: no URL to another site at all, and no character that
 * could end an HTML attribute.
 */
export function isSameSitePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !HTML_SPECIAL_CHARS.test(value) && isBrandLogoRef(value)
}

/**
 * The products whose UI strings a deployment may override, each keyed in
 * `surface.strings` by its id and checked against that product's own
 * dictionary. `flow`: the platform's workflow editor. A product adopts the
 * overrides by adding its id here and giving the platform its key manifest.
 */
export const UI_STRING_PRODUCTS = Object.freeze(["flow"] as const)
export type UiStringProduct = (typeof UI_STRING_PRODUCTS)[number]

/**
 * What a product's build emits beside its output so the platform can check a
 * deployment's overrides at boot: every key of its base (English) dictionary
 * with the placeholder names that key's text uses, and the locales the product
 * offers. Keys and names only, never the text.
 */
export interface UiStringManifest {
  /** The `surface.strings` namespace the dictionary answers to (`UI_STRING_PRODUCTS`). */
  readonly product: string
  /** The locales overrides may target when the deployment sets no `locale.offered`. */
  readonly locales: readonly string[]
  /** Every key a deployment may override → the placeholder names its base text uses, sorted. */
  readonly keys: Readonly<Record<string, readonly string[]>>
}

/** The manifest's file name, at the root of the product's build output. */
export function uiStringManifestFile(product: string): string {
  return `ui-strings-manifest.${product}.json`
}

// `{name}`: anything else in braces (`{{now}}`, `{image:1}`, `{ variables`) is
// text, the same way the dictionaries' interpolation reads it.
const UI_STRING_PLACEHOLDER = /\{(\w+)\}/g

/** The placeholder names `text` uses, each once, sorted. */
export function uiStringPlaceholders(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(UI_STRING_PLACEHOLDER), (m) => m[1]))].sort()
}

/**
 * The manifest of a base dictionary. A key whose base text is blank is left
 * out: it is grammar data (a word's grammatical gender, the gap between two
 * joined fragments), not wording, and overriding it would only break the
 * sentences built from it.
 */
export function buildUiStringManifest(product: string, dict: Readonly<Record<string, string>>, locales: readonly string[]): UiStringManifest {
  const keys = Object.entries(dict)
    .filter(([, text]) => text.trim() !== "")
    .map(([key, text]): [string, string[]] => [key, uiStringPlaceholders(text)])
  return { product, locales: [...locales], keys: Object.fromEntries(keys) }
}

/** The deployment's text for `key` in `locale` of `product`, or undefined. */
export function surfaceStringOverride(strings: RuntimeSurfaceStrings | undefined, product: string, locale: string, key: string): string | undefined {
  const byLocale = strings && Object.hasOwn(strings, product) ? strings[product] : undefined
  const texts = byLocale && Object.hasOwn(byLocale, locale) ? byLocale[locale] : undefined
  const text = texts && Object.hasOwn(texts, key) ? texts[key] : undefined
  return typeof text === "string" ? text : undefined
}

/**
 * An https origin, spelled exactly as a browser spells one
 * (`https://media.example.com`, a port only when it is not 443): what
 * `new URL(src).origin` is compared with, so a path, a trailing slash,
 * credentials, another letter case or any other scheme could never match, and
 * is not one.
 */
export function isHttpsOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.origin === value
  } catch {
    return false
  }
}

/**
 * The base a client builds API URLs on. `"/"` is the same-origin sentinel (a
 * site answering on more than one hostname cannot name one) and resolves to
 * `""`: build every URL relative to the page. `undefined` when the config names
 * none, so the app keeps its own build-time value. It never makes up a URL.
 */
export function resolveRuntimeApiBase(cfg: Pick<NodaroRuntimeConfig, "apiUrl"> | undefined): string | undefined {
  const value = typeof cfg?.apiUrl === "string" ? cfg.apiUrl.trim() : ""
  if (!value) return undefined
  return value === "/" ? "" : value
}

/**
 * The Supabase URL a browser client uses. supabase-js needs an absolute URL, so
 * the same-origin sentinel `"/supabase"` resolves against `origin`, the page's
 * own (`location.origin`). `undefined` when the config names none.
 */
export function resolveRuntimeSupabaseUrl(cfg: Pick<NodaroRuntimeConfig, "supabaseUrl"> | undefined, origin: string): string | undefined {
  const value = typeof cfg?.supabaseUrl === "string" ? cfg.supabaseUrl.trim() : ""
  if (!value) return undefined
  return value === "/supabase" ? `${origin.replace(/\/+$/, "")}/supabase` : value
}

// ── The parser ───────────────────────────────────────────────────────────────

type Rec = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
const record = (value: unknown): Rec => (isRecord(value) ? value : {})
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
}
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const asBoolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)

function siblingApps(value: unknown): RuntimeSurfaceSibling[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.label !== "string" || typeof raw.url !== "string") return []
    const byHost = isRecord(raw.urlByHost)
      ? Object.fromEntries(Object.entries(raw.urlByHost).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {}
    return [{ label: raw.label, url: raw.url, ...optional("urlByHost", Object.keys(byHost).length ? byHost : undefined) }]
  })
}

function faviconsOf(value: unknown): string[] | undefined {
  const paths = (Array.isArray(value) ? value : [value]).filter(isSameSitePath)
  return paths.length ? [...new Set(paths)] : undefined
}

function brandOf(value: unknown): RuntimeSurfaceBrand {
  const b = record(value)
  return {
    productName: typeof b.productName === "string" && b.productName ? b.productName : "Nodaro",
    ...optional("description", asString(b.description)),
    ...optional("wordmark", asString(b.wordmark)),
    ...optional("platformLinks", asBoolean(b.platformLinks)),
    ...optional("logo", isBrandLogoRef(b.logo) ? b.logo : undefined),
    ...optional("favicon", faviconsOf(b.favicon)),
  }
}

/**
 * `surface.strings`, keeping only text: a product, locale or key whose value
 * has the wrong type is left out, and an emptied level with it. Built from
 * entries, so a `"__proto__"` key stays an ordinary key. Never throws.
 */
export function parseRuntimeStrings(raw: unknown): RuntimeSurfaceStrings {
  const products: [string, Record<string, Record<string, string>>][] = []
  for (const [product, byLocale] of Object.entries(record(raw))) {
    const locales: [string, Record<string, string>][] = []
    for (const [locale, texts] of Object.entries(record(byLocale))) {
      const kept = Object.entries(record(texts)).filter((e): e is [string, string] => typeof e[1] === "string")
      if (kept.length) locales.push([locale, Object.fromEntries(kept)])
    }
    if (locales.length) products.push([product, Object.fromEntries(locales)])
  }
  return Object.fromEntries(products)
}

function localeOf(value: unknown): RuntimeSurface["locale"] {
  const l = record(value)
  return {
    ...optional("default", asString(l.default)),
    picker: l.picker !== false,
    ...optional("offered", Array.isArray(l.offered) ? strings(l.offered) : undefined),
  }
}

function billingOf(value: unknown): RuntimeSurfaceBilling {
  const b = record(value)
  // Both or neither: a label without a rate (or the reverse) would put one
  // unit's name on another unit's numbers.
  const coherent = typeof b.unitLabel === "string" && b.unitLabel.length > 0 && typeof b.unitRate === "number" && Number.isFinite(b.unitRate) && b.unitRate > 0
  const decimals = typeof b.unitDecimals === "number" && Number.isInteger(b.unitDecimals) && b.unitDecimals >= 0 && b.unitDecimals <= 4 ? b.unitDecimals : undefined
  return {
    costTab: b.costTab === "hidden" ? "hidden" : "inherit",
    sidebarCard: b.sidebarCard === "hidden" ? "hidden" : "inherit",
    selfServe: b.selfServe !== false,
    ...(coherent ? { unitLabel: b.unitLabel as string, unitRate: b.unitRate as number, ...optional("unitDecimals", decimals) } : {}),
  }
}

/** A value outside the known set reads as the restrictive one: a reader older than its platform must not show more. */
function catalogImagesOf(value: unknown): SurfaceCatalogImages {
  if (value === undefined) return "default"
  return (SURFACE_CATALOG_IMAGES as readonly unknown[]).includes(value) ? (value as SurfaceCatalogImages) : "none"
}

function linksAllowed(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return value.links === undefined ? true : value.links === true
}

function headerModeOf(value: unknown): SurfaceHeaderMode {
  return value === undefined || value === "default" ? "default" : "white-label"
}

function worldsOf(value: unknown): SurfaceWorlds {
  if (value === undefined) return {}
  // Present but not an object: offer none rather than everything.
  if (!isRecord(value)) return { allow: [] }
  const allow = value.allow === undefined ? undefined : strings(value.allow)
  const order = Array.isArray(value.order) ? [...new Set(value.order.filter(isWorldId))] : []
  const home: WorldId | undefined = isWorldId(value.home) && (allow === undefined || allow.includes(value.home)) ? value.home : undefined
  return { ...optional("allow", allow), ...optional("home", home), ...optional("order", order.length ? order : undefined) }
}

/** The surface block of `/config.js`, every default applied. Never throws. */
export function parseRuntimeSurface(raw: unknown): RuntimeSurface {
  const s = record(raw)
  const auth = record(s.auth)
  const methods = strings(auth.methods)
  const allowDeny = (v: unknown) => ({ deny: strings(record(v).deny), allow: strings(record(v).allow) })
  const catalogs = record(s.catalogs)
  return {
    nav: { hide: strings(record(s.nav).hide) },
    features: { hide: strings(record(s.features).hide) },
    dashboard: { tabs: strings(record(s.dashboard).tabs) },
    nodes: allowDeny(s.nodes),
    models: allowDeny(s.models),
    auth: { methods, ...optional("ssoLabel", asString(auth.ssoLabel)), requireSignIn: surfaceRequiresSignIn({ methods, requireSignIn: auth.requireSignIn }) },
    siblings: { apps: siblingApps(record(s.siblings).apps) },
    brand: brandOf(s.brand),
    locale: localeOf(s.locale),
    outputs: { allowPublic: record(s.outputs).allowPublic !== false },
    voice: { allowedGenders: strings(record(s.voice).allowedGenders) },
    billing: billingOf(s.billing),
    catalogs: { required: catalogs.required === true, factoryPresets: catalogs.factoryPresets !== false, images: catalogImagesOf(catalogs.images) },
    imports: { links: linksAllowed(s.imports) },
    header: headerModeOf(s.header),
    worlds: worldsOf(s.worlds),
    strings: parseRuntimeStrings(s.strings),
    ...optional("catalogPolicy", s.catalogPolicy),
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** The surface a deployment that configured none renders. */
export const RUNTIME_SURFACE_DEFAULT: RuntimeSurface = deepFreeze(parseRuntimeSurface(undefined))

const STRING_KEYS = ["apiUrl", "supabaseUrl", "supabaseAnonKey", "freecutUrl", "audiomassUrl", "defaultLocale"] as const

/**
 * `/config.js`'s object, typed. Keeps each key only when it has the expected
 * type; a blank string is no value. Never throws.
 */
export function parseRuntimeConfig(raw: unknown): NodaroRuntimeConfig {
  if (!isRecord(raw)) return {}
  const out: { -readonly [K in keyof NodaroRuntimeConfig]: NodaroRuntimeConfig[K] } = {}
  for (const key of STRING_KEYS) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) out[key] = value.trim()
  }
  if (isRecord(raw.surface)) out.surface = parseRuntimeSurface(raw.surface)
  if (isRecord(raw.moderation) && raw.moderation.uploadImage === true) out.moderation = { uploadImage: true }
  if (raw.previewStopRule === true) out.previewStopRule = true
  if (isHttpsOrigin(raw.mediaOrigin)) out.mediaOrigin = raw.mediaOrigin
  return out
}

/** Read and parse the runtime config `/config.js` set on `scope` (default: the global object). */
export function readRuntimeConfig(scope: unknown = globalThis): NodaroRuntimeConfig {
  try {
    return parseRuntimeConfig(isRecord(scope) || typeof scope === "function" ? (scope as Rec)[RUNTIME_CONFIG_GLOBAL] : undefined)
  } catch {
    return {}
  }
}
