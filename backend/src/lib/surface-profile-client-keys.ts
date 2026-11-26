import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import {
  MAX_APP_EXAMPLES,
  MAX_APP_EXAMPLE_ASK,
  MAX_APP_EXAMPLE_TEXT,
  MAX_APP_EXAMPLE_TITLE,
  MAX_SAMPLE_REFERENCES,
  MAX_SURFACE_SAMPLES,
  MAX_TOOL_APP_PICTURES,
  MAX_TOOL_APPS,
  MAX_VIDEO_SAMPLE_PROMPT,
  SURFACE_CATALOG_IMAGES,
  isBrandLogoRef,
  isSameSitePath,
  isToolAppId,
  isWorldId,
  ownPictureAddress,
  type SurfaceCatalogImages,
  type SurfaceHeaderMode,
  type WorldId,
} from "@nodaro/shared/runtime-config"
import type { SurfaceAppExample, SurfaceSample, SurfaceSamples, SurfaceToolApps, SurfaceVideoSample, SurfaceWorlds } from "./surface-profile.js"

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
    if (raw.soon !== undefined) {
      const { known, dropped } = knownWorldIds(Array.isArray(raw.soon) ? raw.soon : [raw.soon])
      if (dropped.length) console.warn(`[surface-profile] worlds.soon dropped unknown world ids ${JSON.stringify(dropped)}`)
      if (known.length) out.soon = known
    }
    return out
  })

/**
 * The tools app's mini apps on a white-label deployment (`toolApps`): `pages`
 * serves their pages, `menus` opens the header's apps-first menus. Each widens
 * what such a deployment shows, so only the literal `true` asks for it: a
 * value that is not a boolean is refused, loudly, as off.
 */
export const surfaceToolAppsSchema = z
  .unknown()
  .optional()
  .transform((raw): SurfaceToolApps | undefined => {
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      console.warn("[surface-profile] toolApps must be an object { menus?, pages?, pictures? } — nothing of it is offered")
      return { menus: false, pages: false }
    }
    const asked = (key: "menus" | "pages"): boolean => {
      const value = raw[key]
      if (value === undefined || typeof value === "boolean") return value === true
      console.warn(`[surface-profile] toolApps.${key} ${JSON.stringify(value)} is not true or false — off`)
      return false
    }
    const pictures = toolAppPictures(raw.pictures)
    const apps = toolAppIds(raw.apps)
    const examples = toolAppExamples(raw.examples)
    return { menus: asked("menus"), pages: asked("pages"), ...(pictures ? { pictures } : {}), ...(apps ? { apps } : {}), ...(examples ? { examples } : {}) }
  })

/**
 * `toolApps.apps`: the mini apps the deployment offers, by id. Like
 * `worlds.allow`, presence is what narrows: absent, there is no list (every
 * app the viewer may run); a list offers exactly its apps, `[]` none. A value
 * that is not a list offers none, and an entry that is not an app id is
 * dropped, both loudly.
 */
function toolAppIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    console.warn("[surface-profile] toolApps.apps must be an array of app ids — no app is offered")
    return []
  }
  const known = [...new Set(raw.filter(isToolAppId))]
  const dropped = raw.filter((id) => !isToolAppId(id))
  if (dropped.length) console.warn(`[surface-profile] toolApps.apps dropped ${JSON.stringify(dropped)}: not app ids`)
  if (known.length > MAX_TOOL_APPS) console.warn(`[surface-profile] toolApps.apps names ${known.length} apps — only the first ${MAX_TOOL_APPS} are kept`)
  return known.slice(0, MAX_TOOL_APPS)
}

/** `toolApps.pictures`: the deployment's own picture per key. An entry that is not a path on the site or an https address is dropped, loudly. */
function toolAppPictures(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    console.warn("[surface-profile] toolApps.pictures must be an object { <key>: <address> } — no picture is given")
    return undefined
  }
  const entries = Object.entries(raw)
  if (entries.length > MAX_TOOL_APP_PICTURES) console.warn(`[surface-profile] toolApps.pictures names ${entries.length} pictures — only the first ${MAX_TOOL_APP_PICTURES} are kept`)
  const out: Record<string, string> = {}
  for (const [key, value] of entries.slice(0, MAX_TOOL_APP_PICTURES)) {
    const address = ownPictureAddress(value)
    if (address === undefined || key.length === 0 || key.length > 80) console.warn(`[surface-profile] toolApps.pictures[${JSON.stringify(key)}] is not a path on the site or an https address — dropped`)
    else out[key] = address
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * `toolApps.examples`: the deployment's own before-and-after examples for a
 * mini app, by app id, which the app's page shows. A key that is not an app
 * id, a value that is not a list and an entry without two pictures a
 * deployment may name are each dropped alone, loudly. An app left with no
 * example is left out, and nothing usable leaves the key out.
 */
function toolAppExamples(raw: unknown): Record<string, SurfaceAppExample[]> | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    console.warn("[surface-profile] toolApps.examples must be an object { <app id>: [{ before, after }] } — no example is given")
    return undefined
  }
  const kept: [string, SurfaceAppExample[]][] = []
  let beyond = 0
  for (const [id, given] of Object.entries(raw)) {
    if (!isToolAppId(id)) {
      console.warn(`[surface-profile] toolApps.examples[${JSON.stringify(id)}] is not an app id — dropped`)
      continue
    }
    if (kept.length === MAX_TOOL_APPS) {
      beyond++
      continue
    }
    const examples = appExamples(id, given)
    if (examples.length) kept.push([id, examples])
  }
  if (beyond) console.warn(`[surface-profile] toolApps.examples: ${beyond} more app ids were not read — only the first ${MAX_TOOL_APPS} apps with an example are kept`)
  return kept.length ? Object.fromEntries(kept) : undefined
}

/** One mini app's examples: each a before and an after, and the ask, title and text it gives within their limits. */
function appExamples(id: string, raw: unknown): SurfaceAppExample[] {
  const where = `toolApps.examples[${JSON.stringify(id)}]`
  if (!Array.isArray(raw)) {
    console.warn(`[surface-profile] ${where} must be an array of { before, after } — dropped`)
    return []
  }
  if (raw.length > MAX_APP_EXAMPLES) console.warn(`[surface-profile] ${where} has ${raw.length} entries — only the first ${MAX_APP_EXAMPLES} valid ones are kept`)
  const out: SurfaceAppExample[] = []
  raw.forEach((entry, index) => {
    if (out.length === MAX_APP_EXAMPLES) return
    const given = isPlainObject(entry) ? entry : {}
    const before = ownPictureAddress(given.before)
    const after = ownPictureAddress(given.after)
    if (before === undefined || after === undefined) {
      console.warn(`[surface-profile] ${where}[${index}] needs a before and an after (each a path on the site or an https address) — dropped`)
      return
    }
    const words = (key: "ask" | "title" | "text", max: number): string | undefined => {
      const text = sampleText(given[key], max)
      if (given[key] !== undefined && text === undefined) console.warn(`[surface-profile] ${where}[${index}].${key} is not a text of 1 to ${max} characters — left out`)
      return text
    }
    const ask = words("ask", MAX_APP_EXAMPLE_ASK)
    const title = words("title", MAX_APP_EXAMPLE_TITLE)
    const text = words("text", MAX_APP_EXAMPLE_TEXT)
    out.push({ before, after, ...(ask ? { ask } : {}), ...(title ? { title } : {}), ...(text ? { text } : {}) })
  })
  return out
}

/**
 * The deployment's own welcome samples (`samples.<world>`): what a white-label
 * deployment shows in place of the platform's samples. An entry needs a prompt
 * and a picture a deployment may name; one without either is dropped, loudly.
 */
export const surfaceSamplesSchema = z
  .unknown()
  .optional()
  .transform((raw): SurfaceSamples | undefined => {
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      console.warn("[surface-profile] samples must be an object { image?, video? } — no sample is given")
      return undefined
    }
    const image = ownSamples("image", raw.image)
    const video = ownVideoSamples(raw.video)
    return image.length || video.length ? { image, ...(video.length ? { video } : {}) } : undefined
  })

const sampleText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
}

/**
 * `samples.video`: the Video world's own finished clips. An entry needs a
 * title, a prompt, a clip and a still, each address one a deployment may name;
 * one without is dropped, loudly. A reference picture that is no such address
 * is dropped alone.
 */
function ownVideoSamples(raw: unknown): SurfaceVideoSample[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    console.warn("[surface-profile] samples.video must be an array — no sample is given")
    return []
  }
  if (raw.length > MAX_SURFACE_SAMPLES) console.warn(`[surface-profile] samples.video has ${raw.length} entries — only the first ${MAX_SURFACE_SAMPLES} valid ones are kept`)
  const out: SurfaceVideoSample[] = []
  raw.forEach((entry, index) => {
    if (out.length === MAX_SURFACE_SAMPLES) return
    const given = isPlainObject(entry) ? entry : {}
    const title = sampleText(given.title, 120)
    const prompt = sampleText(given.prompt, MAX_VIDEO_SAMPLE_PROMPT)
    const video = ownPictureAddress(given.video)
    const picture = ownPictureAddress(given.picture)
    if (title === undefined || prompt === undefined || video === undefined || picture === undefined) {
      console.warn(`[surface-profile] samples.video[${index}] needs a title, a prompt, a video and a picture (each a path on the site or an https address) — dropped`)
      return
    }
    const original = ownPictureAddress(given.original)
    if (given.original !== undefined && original === undefined) console.warn(`[surface-profile] samples.video[${index}].original is not a path on the site or an https address — full screen plays its video`)
    const model = sampleText(given.model, 80)
    const aspectRatio = sampleText(given.aspectRatio, 20)
    const resolution = sampleText(given.resolution, 20)
    const duration = typeof given.duration === "number" && Number.isFinite(given.duration) && given.duration > 0 && given.duration <= 3600 ? given.duration : undefined
    if (given.duration !== undefined && duration === undefined) console.warn(`[surface-profile] samples.video[${index}].duration ${JSON.stringify(given.duration)} is not a number of seconds — left out`)
    const references = videoSampleReferences(index, given.references)
    out.push({
      title,
      prompt,
      video,
      picture,
      ...(original ? { original } : {}),
      ...(model ? { model } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(references.length ? { references } : {}),
    })
  })
  return out
}

function videoSampleReferences(index: number, raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    console.warn(`[surface-profile] samples.video[${index}].references must be an array of addresses — none is given`)
    return []
  }
  const kept = raw.flatMap((entry) => ownPictureAddress(entry) ?? [])
  if (kept.length < raw.length) console.warn(`[surface-profile] samples.video[${index}].references: ${raw.length - kept.length} entries are not a path on the site or an https address — dropped`)
  if (kept.length > MAX_SAMPLE_REFERENCES) console.warn(`[surface-profile] samples.video[${index}].references names ${kept.length} pictures — only the first ${MAX_SAMPLE_REFERENCES} are kept`)
  return kept.slice(0, MAX_SAMPLE_REFERENCES)
}

function ownSamples(world: string, raw: unknown): SurfaceSample[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    console.warn(`[surface-profile] samples.${world} must be an array — no sample is given`)
    return []
  }
  if (raw.length > MAX_SURFACE_SAMPLES) console.warn(`[surface-profile] samples.${world} has ${raw.length} entries — only the first ${MAX_SURFACE_SAMPLES} valid ones are kept`)
  const text = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
  }
  const out: SurfaceSample[] = []
  raw.forEach((entry, index) => {
    if (out.length === MAX_SURFACE_SAMPLES) return
    const given = isPlainObject(entry) ? entry : {}
    const prompt = text(given.prompt, 4000)
    const picture = ownPictureAddress(given.picture)
    if (prompt === undefined || picture === undefined) {
      console.warn(`[surface-profile] samples.${world}[${index}] needs a prompt and a picture (a path on the site or an https address) — dropped`)
      return
    }
    const model = text(given.model, 80)
    const aspectRatio = text(given.aspectRatio, 20)
    if (given.center !== undefined && typeof given.center !== "boolean") console.warn(`[surface-profile] samples.${world}[${index}].center ${JSON.stringify(given.center)} is not true or false — not the centre`)
    out.push({ prompt, picture, ...(model ? { model } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(given.center === true ? { center: true as const } : {}) })
  })
  return out
}

/**
 * What a media INPUT given as a link to another site does where link imports
 * are off (`imports.inputLinks`, decided 2026-11-16): `"allow"` — today, runs
 * as before; `"report"` — runs as before, and each link that would be refused
 * is recorded; `"refuse"` — refused like an import (`lib/input-links.ts`).
 * Meaningful only while `imports.links` is `false`.
 */
export const INPUT_LINKS_MODES = ["allow", "report", "refuse"] as const
export type InputLinksMode = (typeof INPUT_LINKS_MODES)[number]

/** The lever as given, or undefined when it is absent; a value that is not a mode takes the restrictive side, loudly. */
function inputLinksLever(v: unknown): InputLinksMode | undefined {
  if (v === undefined) return undefined
  const mode = typeof v === "string" ? v.trim().toLowerCase() : v
  if ((INPUT_LINKS_MODES as readonly unknown[]).includes(mode)) return mode as InputLinksMode
  console.warn(`[surface-profile] imports.inputLinks ${JSON.stringify(v)} is not one of ${INPUT_LINKS_MODES.join(" | ")} — using the restrictive "refuse"`)
  return "refuse"
}

export const surfaceImportsSchema = z
  .unknown()
  .optional()
  .transform((raw): { links: boolean; inputLinks?: InputLinksMode } | undefined => {
    if (raw === undefined) return undefined
    if (!isPlainObject(raw)) {
      console.warn("[surface-profile] imports must be an object { links, inputLinks? } — link imports refused")
      return { links: false }
    }
    const links = safetyFlag("imports.links", raw.links, false)
    const inputLinks = inputLinksLever(raw.inputLinks)
    if (inputLinks === undefined) return links === undefined ? undefined : { links }
    if (links !== false) console.warn(`[surface-profile] imports.inputLinks "${inputLinks}" has no effect while imports.links is not false`)
    // `links` absent reads as allowed, as it does without the lever.
    return { links: links ?? true, inputLinks }
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
