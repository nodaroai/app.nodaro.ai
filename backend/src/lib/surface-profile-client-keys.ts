import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import {
  SURFACE_CATALOG_IMAGES,
  isBrandLogoRef,
  isSameSitePath,
  isWorldId,
  type SurfaceCatalogImages,
  type SurfaceHeaderMode,
  type WorldId,
} from "@nodaro/shared/runtime-config"
import type { SurfaceWorlds } from "./surface-profile.js"

/**
 * The surface-profile keys the client apps read through /config.js (worlds,
 * imports.links, catalogs.images, locale.offered, header, brand.logo,
 * auth.requireSignIn) — their validators, composed into SurfaceProfileSchema
 * by surface-profile.ts.
 *
 * Each key is ABSENT unless configured (never in SURFACE_PROFILE_DEFAULT), so a
 * deployment that sets none keeps the /config.js it has today; readers apply
 * the defaults (@nodaro/shared/runtime-config). Each degrades ALONE — a
 * transform that never fails, so a bad value cannot take its block's sibling
 * keys down. A malformed SAFETY control (worlds, imports.links,
 * catalogs.images, auth.requireSignIn) falls to its restrictive side: a typo
 * must never offer more than the deployment asked for.
 *
 * `.optional()` BEFORE `.transform()` is load-bearing (Zod 4): see lenientFlag
 * in surface-profile.ts. The schema object also uses each one as
 * `<schema>.optional()`; that trailing call only makes the KEY optional in the
 * inferred type, so an enclosing block's `.catch` literal may leave it out.
 */

/** A boolean in one of its accepted forms (true/false, "true"/"false", "1"/"0"), else undefined. */
export function parseFlag(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v
  if (v === "true" || v === "1") return true
  if (v === "false" || v === "0") return false
  return undefined
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** An optional boolean whose unparseable value takes the restrictive side, loudly. */
function safetyFlag(name: string, v: unknown, restrictive: boolean): boolean | undefined {
  if (v === undefined) return undefined
  const parsed = parseFlag(v)
  if (parsed !== undefined) return parsed
  console.warn(`[surface-profile] ${name} unparseable (${JSON.stringify(v)}) — using the restrictive ${restrictive}`)
  return restrictive
}

/** The known world ids in `list`, each once, and what was dropped. */
function knownWorldIds(list: readonly unknown[]): { known: WorldId[]; dropped: unknown[] } {
  const known: WorldId[] = []
  const dropped: unknown[] = []
  for (const id of list) {
    if (!isWorldId(id)) dropped.push(id)
    else if (!known.includes(id)) known.push(id)
  }
  return { known, dropped }
}

export const surfaceWorldsSchema = z
  .unknown()
  .optional()
  .transform((raw): SurfaceWorlds | undefined => {
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      console.warn("[surface-profile] worlds must be an object { allow?, home?, order? } — no world is offered")
      return { allow: [] }
    }
    const out: SurfaceWorlds = {}
    if (raw.allow !== undefined) {
      if (!Array.isArray(raw.allow)) {
        console.warn("[surface-profile] worlds.allow must be an array of world ids — no world is offered")
        out.allow = []
      } else {
        const { known, dropped } = knownWorldIds(raw.allow)
        if (dropped.length) {
          console.warn(`[surface-profile] worlds.allow dropped unknown world ids ${JSON.stringify(dropped)}${known.length ? "" : " — no world is offered"}`)
        }
        out.allow = known
      }
    }
    if (raw.order !== undefined) {
      const { known, dropped } = knownWorldIds(Array.isArray(raw.order) ? raw.order : [raw.order])
      if (dropped.length) console.warn(`[surface-profile] worlds.order dropped unknown world ids ${JSON.stringify(dropped)}`)
      if (known.length) out.order = known
    }
    if (raw.home !== undefined) {
      if (!isWorldId(raw.home)) console.warn(`[surface-profile] worlds.home ${JSON.stringify(raw.home)} is not a world id — dropped`)
      else if (out.allow && !out.allow.includes(raw.home)) console.warn(`[surface-profile] worlds.home "${raw.home}" is not in worlds.allow — dropped`)
      else out.home = raw.home
    }
    return out
  })

export const surfaceImportsSchema = z
  .unknown()
  .optional()
  .transform((raw): { links: boolean } | undefined => {
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      console.warn("[surface-profile] imports must be an object { links } — link imports refused")
      return { links: false }
    }
    const links = safetyFlag("imports.links", raw.links, false)
    return links === undefined ? undefined : { links }
  })

/** A set header other than the two modes still says "not the platform's": white-label. */
export const surfaceHeaderSchema = z
  .unknown()
  .optional()
  .transform((v): SurfaceHeaderMode | undefined => {
    if (v === undefined) return undefined
    if (v === "default" || v === "white-label") return v
    console.warn(`[surface-profile] header ${JSON.stringify(v)} is not "default" or "white-label" — using "white-label"`)
    return "white-label"
  })

export const catalogImagesSchema = z
  .unknown()
  .optional()
  .transform((v): SurfaceCatalogImages | undefined => {
    if (v === undefined) return undefined
    if ((SURFACE_CATALOG_IMAGES as readonly unknown[]).includes(v)) return v as SurfaceCatalogImages
    console.warn(`[surface-profile] catalogs.images ${JSON.stringify(v)} is not one of ${SURFACE_CATALOG_IMAGES.join(" | ")} — using "none"`)
    return "none"
  })

/** A locale id as the platform ships it ("pt-br" → "pt-BR"), or undefined. Read lazily: some suites mock the i18n entry empty. */
export function canonicalLocaleId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const lower = v.trim().toLowerCase()
  return (LANGUAGES ?? []).find((l) => l.id.toLowerCase() === lower)?.id
}

/** Cosmetic: nothing usable leaves the key out, so every language stays offered. */
export const localeOfferedSchema = z
  .unknown()
  .optional()
  .transform((raw): string[] | undefined => {
    if (raw === undefined) return undefined
    if (!Array.isArray(raw)) {
      console.warn("[surface-profile] locale.offered must be an array of locale ids — ignored")
      return undefined
    }
    const kept: string[] = []
    const dropped: unknown[] = []
    for (const x of raw) {
      const id = canonicalLocaleId(x)
      if (!id) dropped.push(x)
      else if (!kept.includes(id)) kept.push(id)
    }
    if (dropped.length) console.warn(`[surface-profile] locale.offered dropped unknown locale ids ${JSON.stringify(dropped)}`)
    return kept.length ? kept : undefined
  })

/** Warn (never drop: readers resolve it) when the default locale is not among those offered. */
export function noteLocaleCoherence<T extends { default?: string; offered?: string[] }>(l: T): T {
  if (l.offered && l.default !== undefined) {
    const id = canonicalLocaleId(l.default)
    if (!id || !l.offered.includes(id)) {
      console.warn(`[surface-profile] locale.default "${l.default}" is not in locale.offered ${JSON.stringify(l.offered)}`)
    }
  }
  return l
}

/**
 * `billing.unitLabels`: the unit's word per interface language, keyed by locale
 * id in the platform's own spelling. A relabelling only, so it degrades softly
 * and alone, and the unit keeps working on its single `unitLabel`: anything but
 * an object drops whole, an entry with an unknown language or no word drops
 * alone, and nothing usable leaves the key out. Whether the key may stand at
 * all is `coherentBilling`'s call (surface-profile.ts): it rides with the unit.
 */
export function coherentUnitLabels(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    console.warn('[surface-profile] billing.unitLabels dropped — must be an object { "<locale id>": "<word>" }')
    return undefined
  }
  const kept: [string, string][] = []
  const dropped: string[] = []
  for (const [locale, word] of Object.entries(raw)) {
    const id = canonicalLocaleId(locale)
    const text = typeof word === "string" ? word.trim() : ""
    if (id && text) kept.push([id, text])
    else dropped.push(locale)
  }
  if (dropped.length) console.warn(`[surface-profile] billing.unitLabels dropped ${JSON.stringify(dropped)} — each entry needs a known locale id and a non-empty word`)
  return kept.length ? Object.fromEntries(kept) : undefined
}

export const brandLogoSchema = z
  .unknown()
  .optional()
  .transform((v): string | undefined => {
    if (v === undefined) return undefined
    const ref = typeof v === "string" ? v.trim() : v
    if (isBrandLogoRef(ref)) return ref
    console.warn('[surface-profile] brand.logo dropped — must be a path on this site ("/…") or an https URL')
    return undefined
  })

/** The most icons `brand.favicon` may list; the platform's own head has three. */
export const MAX_BRAND_FAVICONS = 4

/**
 * The page's icons: one path on this site, or a list (`/brand/favicon.svg`,
 * `/brand/favicon.png`). A path that is not one is dropped alone, with a
 * warning. Nothing usable leaves the key out, and the platform's icons stay.
 */
export const brandFaviconSchema = z
  .unknown()
  .optional()
  .transform((v): string[] | undefined => {
    if (v === undefined) return undefined
    const kept: string[] = []
    const dropped: unknown[] = []
    for (const x of Array.isArray(v) ? v : [v]) {
      const path = typeof x === "string" ? x.trim() : x
      if (!isSameSitePath(path)) dropped.push(x)
      else if (!kept.includes(path)) kept.push(path)
    }
    if (dropped.length) console.warn(`[surface-profile] brand.favicon dropped ${JSON.stringify(dropped)} — each icon must be a path on this site ("/…")`)
    if (kept.length > MAX_BRAND_FAVICONS) {
      console.warn(`[surface-profile] brand.favicon keeps its first ${MAX_BRAND_FAVICONS} icons of ${kept.length}`)
      kept.length = MAX_BRAND_FAVICONS
    }
    return kept.length ? kept : undefined
  })

export const requireSignInSchema = z
  .unknown()
  .optional()
  .transform((v) => safetyFlag("auth.requireSignIn", v, true))
