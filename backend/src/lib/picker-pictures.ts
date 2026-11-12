import { config } from "./config.js"
import { isOurCdnUrl } from "./cdn-host.js"

/**
 * A deployment's own pictures for picker options, shown when its surface
 * profile says `catalogs.images: "own"` (decided 2026-11-11/12).
 *
 * A content-free registry: a deployment registers into it at its composition
 * root (a deployment overlay's `register()`, lib/overlay/load.ts), the same
 * way it registers preset packs and catalog packs. The platform registers
 * nothing, so with no overlay every catalog reply is exactly what it was
 * before this seam existed. Only lib/picker-images.ts — the one place that
 * decides which pictures a catalog reply carries — reads it for serving, and
 * lib/picker-pictures-check.ts checks it at boot (picker-images-totality.test.ts).
 *
 * Which value of `catalogs.images` shows what: `"own"` shows these and nothing
 * else (an option without one shows no picture); `"none"` shows none of them;
 * `"default"` shows the platform's pictures and ignores these.
 */
export interface PickerPictureEntry {
  /** The picker catalog's id, e.g. "style" or "person" (a catalog of `GET /v1/picker-catalogs`). */
  readonly catalogId: string
  /** The option's id in that catalog, e.g. "film-noir". */
  readonly optionId: string
  /** The option's picture: an absolute https address on this install's media host. */
  readonly pictureUrl: string
  /**
   * Its enlarged version, shown where a picker shows a larger picture of the
   * option; on the same host. Optional: without one, the picture serves there too.
   */
  readonly enlargedPictureUrl?: string
}

/**
 * The keys an entry carries. A key outside it is refused, so a misspelt one
 * cannot pass silently; a later member (a motion clip) is added here, which
 * leaves every entry registered today valid.
 */
const ENTRY_KEYS: ReadonlySet<string> = new Set(["catalogId", "optionId", "pictureUrl", "enlargedPictureUrl"])
const ADDRESS_KEYS = ["pictureUrl", "enlargedPictureUrl"] as const

/** A path that names a clip: an entry carries pictures only. */
const CLIP_PATH = /\.(mp4|webm|mov|m4v)$/i

let entries: readonly PickerPictureEntry[] = []
let byOption: ReadonlyMap<string, PickerPictureEntry> = new Map()

const keyOf = (catalogId: string, optionId: string): string => `${catalogId}/${optionId}`

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isName(v: unknown): v is string {
  return typeof v === "string" && v !== "" && v === v.trim()
}

/** The media host an address must be on, for the messages: R2_PUBLIC_URL's origin (and the fallback domain). */
function mediaHostLabel(): string {
  const hosts: string[] = []
  try {
    if (config.R2_PUBLIC_URL) hosts.push(new URL(config.R2_PUBLIC_URL).origin)
  } catch {
    /* an unparseable R2_PUBLIC_URL names no host */
  }
  if (config.R2_PUBLIC_FALLBACK_DOMAIN) hosts.push(`https://${config.R2_PUBLIC_FALLBACK_DOMAIN}`)
  return hosts.join(" or ")
}

/** The problem with one address, or undefined when it is on this install's media host. */
function addressProblem(key: (typeof ADDRESS_KEYS)[number], value: unknown): string | undefined {
  const host = mediaHostLabel()
  if (host === "") return `${key}: this install has no media host (R2_PUBLIC_URL), so no address can be registered`
  if (typeof value !== "string") return `${key} must be an https address on this install's media host (${host})`
  if (!isOurCdnUrl(value, config.R2_PUBLIC_URL ?? "", config.R2_PUBLIC_FALLBACK_DOMAIN ?? "")) {
    return `${key} ${JSON.stringify(value)} is not an https address on this install's media host (${host})`
  }
  if (CLIP_PATH.test(new URL(value).pathname)) return `${key} ${JSON.stringify(value)} is a clip, not a picture`
  return undefined
}

function entryProblems(raw: unknown, index: number): string[] {
  const where = `entry ${index + 1}`
  if (!isPlainObject(raw)) return [`${where} is not an object`]
  const named = isName(raw.catalogId) && isName(raw.optionId) ? `${where} ("${raw.catalogId}/${raw.optionId}")` : where
  const problems: string[] = []
  for (const key of Object.keys(raw)) {
    if (!ENTRY_KEYS.has(key)) problems.push(`unknown key "${key}" (an entry carries ${[...ENTRY_KEYS].join(", ")})`)
  }
  if (!isName(raw.catalogId)) problems.push("catalogId must be a non-empty string without surrounding spaces")
  if (!isName(raw.optionId)) problems.push("optionId must be a non-empty string without surrounding spaces")
  const picture = addressProblem("pictureUrl", raw.pictureUrl)
  if (picture) problems.push(picture)
  if (raw.enlargedPictureUrl !== undefined) {
    const enlarged = addressProblem("enlargedPictureUrl", raw.enlargedPictureUrl)
    if (enlarged) problems.push(enlarged)
  }
  return problems.map((p) => `${named}: ${p}`)
}

/**
 * Register a deployment's own pictures, one entry per picker option. Several
 * calls add up.
 *
 * THROWS (the overlay loader turns that into a refused boot), registering none
 * of the call's entries and naming every problem in one message, on:
 *   - a list that is not an array, or an entry that is not an object;
 *   - a catalogId or optionId that is not a plain non-empty string;
 *   - a key an entry does not carry;
 *   - a picture or enlarged-picture address that is not an https address on
 *     this install's media host — the origin of `R2_PUBLIC_URL`, or the
 *     `R2_PUBLIC_FALLBACK_DOMAIN` host (lib/cdn-host.ts, the same rule as every
 *     other "our own media" check) — or that names a clip;
 *   - an option registered twice, in this call or an earlier one.
 *
 * Whether each catalog and option exists is checked once `register()` has
 * returned, against the catalogs as the deployment's own catalog packs left
 * them (lib/picker-pictures-check.ts).
 *
 * Each entry is stored as a COPY of its known keys, so what was checked is
 * what is served, whatever the caller does with its own objects afterwards.
 */
export function registerPickerPictures(list: readonly PickerPictureEntry[]): void {
  if (!Array.isArray(list)) throw new Error("picker pictures: the entries must be an array")
  const problems: string[] = []
  const copies: PickerPictureEntry[] = []
  const inCall = new Set<string>()
  list.forEach((raw: unknown, index) => {
    const found = entryProblems(raw, index)
    if (found.length > 0) {
      problems.push(...found)
      return
    }
    const e = raw as PickerPictureEntry
    const key = keyOf(e.catalogId, e.optionId)
    if (inCall.has(key)) problems.push(`"${key}" is registered twice`)
    else if (byOption.has(key)) problems.push(`"${key}" is already registered`)
    inCall.add(key)
    copies.push({
      catalogId: e.catalogId,
      optionId: e.optionId,
      pictureUrl: e.pictureUrl,
      ...(e.enlargedPictureUrl !== undefined ? { enlargedPictureUrl: e.enlargedPictureUrl } : {}),
    })
  })
  if (problems.length > 0) throw new Error(`picker pictures: ${problems.join("; ")}`)
  entries = [...entries, ...copies]
  byOption = new Map(entries.map((e) => [keyOf(e.catalogId, e.optionId), e]))
}

/** Every registered entry, in registration order (the boot check). */
export function getRegisteredPickerPictures(): readonly PickerPictureEntry[] {
  return entries
}

/** Whether any picture is registered. */
export function hasRegisteredPickerPictures(): boolean {
  return entries.length > 0
}

/** The entry registered for one option, or undefined. */
export function registeredPickerPicture(catalogId: string, optionId: string): PickerPictureEntry | undefined {
  return byOption.get(keyOf(catalogId, optionId))
}

/** Drop every registered entry (tests). */
export function resetPickerPicturesForTests(): void {
  entries = []
  byOption = new Map()
}
