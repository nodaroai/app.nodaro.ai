/**
 * Nodaro Motion's Precise art-style route: whether a DIRECT run on Nodaro
 * Motion Prism that resolves to Precise and carries an art style
 * (`direction.style`) runs as Flex, its estimate alike. A whole-world art style
 * holds only when the video model gets a full-frame depth map, which is the
 * Flex path. Set by an admin for the whole deployment, never by the person
 * running it.
 *
 * The `app_settings` row `nodaro_motion_precise_style_route`:
 * `{ routing?: "on" | "off"; bypassEmails?: string[]; photographicStyles?: "flex" | "precise"; styleRoutes?: Record<string, "precise" | "precise-gray">; routedDepthBlur?: number; describeColours?: boolean; faceMesh?: boolean;
 * faceMeshParts?: "full" | "features" | "mouth" | "contours"; faceMeshLayers?: VideoFaceMeshLayers; faceMeshWording?: "motion" | "shape" }`.
 *
 * - `routing`: "on" (the default; absent means it) runs such a run as Flex;
 *   "off" leaves it the Precise run of `nodaro-motion-precise-art-style.ts`.
 * - `bypassEmails`: the accounts that skip the route and run real Precise with
 *   a style, for testing. Stored trimmed, lowercased and without repeats; the
 *   engine compares them against the account's email as the server reads it.
 * - `photographicStyles` (2026-11-06): which path such a run takes when its
 *   art style is photographic (the style catalog's medium "photo",
 *   `@nodaro/prompts` `getStyleMedium`: Photorealistic, Cinematic, Noir, Early
 *   Color Photo, Retro / Vintage, Cyberpunk, Steampunk, Glitch Art). "flex"
 *   (the default; absent means it) routes it as every other style; "precise"
 *   leaves it the Precise run routing "off" makes, for that run alone, so an
 *   admin can compare both paths on the same sources (a person who wants more
 *   style can still choose Flex). Stored only when "precise". The engine
 *   decides it on the run's own style (`castSwap.preciseStyleRoutePhotographic`);
 *   one without the flag, or a platform from before it (its tolerant read drops
 *   the key), routes every style alike.
 * - `styleRoutes`: which path such a run takes, art style by art style: a
 *   style's id (the style catalog's, `/^[a-z0-9-]{1,64}$/`) to "precise"
 *   (left the Precise run, as routing "off" makes it, for that style alone) or
 *   "precise-gray" (left Precise, its sent clip in black and white). A style left out takes
 *   "flex", the default, routed as every style: "flex" is never stored, and
 *   the admin's save refuses it. Stored only when the map is not empty. The
 *   older `photographicStyles` stays readable beside it. The tolerant read
 *   keeps each valid entry and drops the others alone.
 * - `routedDepthBlur`: a routed run's OWN depth blur, in the Motion masking's
 *   `depthBlur` bounds (`CAST_SWAP_DEPTH_BLUR_BOUNDS`: 0–40 whole steps, the
 *   sigma at 1080 px tall). Absent or 0 is no blur. It applies only to a run the
 *   route makes Flex, in place of the Motion masking's blur; every other Flex
 *   run keeps that one. An engine from before it reads no blur either.
 * - `describeColours`: on (the default; absent means it) tells a routed run's
 *   shot list writer to describe, from the video, the colours the depth map it
 *   sends cannot carry. Only a run the route makes Flex. Stored only when off.
 * - `faceMesh`: whether a routed run's depth map carries the face mesh. Off by
 *   default (absent means off, and so does an engine from before it): the run's
 *   masking has no mesh, whatever the Flex masking says. Stored only when on.
 * - `faceMeshParts` and `faceMeshWording` (2026-11-06): while that mesh is on,
 *   what it draws (`VIDEO_FACE_MESH_PARTS`: the whole mesh, the eye and lip
 *   outlines, the lip outline, or the contours — the face oval, brows, nose,
 *   eyes and lips; absent: the Flex masking's, as before) and how the prompt
 *   words its line ("motion", the default and stored as nothing, or "shape").
 *   An engine from before them reads neither.
 * - `faceMeshLayers` (2026-11-06): what that mesh draws, layer by layer
 *   (`VIDEO_FACE_MESH_LAYERS`: the wireframe, eyes, lips, contours, irises,
 *   bold lines), in place of `faceMeshParts` (never both). A set a parts value
 *   names is stored and sent as that value; any other as layers. An engine
 *   from before them never reads the key (the row is read field by field), and
 *   draws the Flex masking's parts.
 *
 * A Precise run without a style, every Flex run, every Pulse run and every
 * trend run never read it. Prism alone takes an art style on a Precise run, so
 * the row is not keyed by engine.
 *
 * Its OWN row, not a key of `nodaro_motion_precise_art_style`: that row's entry
 * schema is strict, so an older app on the shared database would drop the
 * engine's whole entry over a key it does not know. For the same reason this
 * row is read field by field, never by a strict schema
 * (`parseNodaroMotionPreciseStyleRoute`): a key added here later drops nothing
 * for the code of today. The strict schema is what an admin saves.
 *
 * What is stored: `routing` only when "off", the list only when it is not empty.
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionPreciseStyleRoute()` (advertised as
 * `tk.capabilities.nodaroMotionPreciseStyleRoute`), which answers what differs
 * from the defaults, or null when nothing does (routing on, nobody bypassed) or
 * the engine does not declare `castSwap.preciseStyleRoute`. An engine without
 * the flag never reads the row and runs such a run as Precise, so no value can
 * be wrong there: unlike the other Nodaro Motion settings, no save waits for an
 * engine. Written only through `nodaro-motion-precise-style-route-store.ts`.
 * This module is pure (no database).
 */
import { z } from "zod"
import { CAST_SWAP_DEPTH_BLUR_BOUNDS } from "@nodaro/render-rules"
import {
  VIDEO_FACE_MESH_LAYERS,
  VIDEO_FACE_MESH_PARTS,
  videoFaceMeshLayersDrawLines,
  videoFaceMeshLayersOn,
  videoFaceMeshPartsOfLayers,
  type VideoFaceMeshLayer,
  type VideoFaceMeshLayers,
  type VideoFaceMeshParts,
} from "@nodaro/shared/media"

export const NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY = "nodaro_motion_precise_style_route"

/** The switch's two values; "on" when never saved. */
export const PRECISE_STYLE_ROUTINGS = ["on", "off"] as const
export type PreciseStyleRouting = (typeof PRECISE_STYLE_ROUTINGS)[number]

/** Which path a run with a photographic art style takes: routed as Flex ("flex", the default) or kept Precise. */
export const PHOTOGRAPHIC_STYLE_PATHS = ["flex", "precise"] as const
export type PhotographicStylePath = (typeof PHOTOGRAPHIC_STYLE_PATHS)[number]

/** What an art style can be routed to, besides "flex" (the default, never stored). */
export const STYLE_ROUTES = ["precise", "precise-gray"] as const
export type StyleRoute = (typeof STYLE_ROUTES)[number]

/** An art style's id, as the style catalog spells it. */
export const STYLE_ROUTE_ID_PATTERN = /^[a-z0-9-]{1,64}$/

/** How many accounts the bypass list holds: it is a test list, not an audience. */
export const PRECISE_STYLE_ROUTE_MAX_EMAILS = 200

/** The saved setting. Absent `routing` means "on"; absent `bypassEmails` means nobody. */
export interface NodaroMotionPreciseStyleRoute {
  routing?: PreciseStyleRouting
  bypassEmails?: string[]
  /** Which path a run with a photographic art style takes; absent: "flex" (routed as every style). */
  photographicStyles?: PhotographicStylePath
  /** Which path a run takes, art style by art style; a style left out (or no map): "flex". */
  styleRoutes?: Record<string, StyleRoute>
  /** A routed run's own depth blur (`CAST_SWAP_DEPTH_BLUR_BOUNDS`); absent or 0: none. */
  routedDepthBlur?: number
  /** A routed run's shot list is told the colours from the video; absent: on. */
  describeColours?: boolean
  /** A routed run's face mesh; absent: off. */
  faceMesh?: boolean
  /** What a routed run's mesh draws; absent: the Flex masking's. */
  faceMeshParts?: VideoFaceMeshParts
  /** What a routed run's mesh draws, layer by layer, in place of `faceMeshParts`; absent: `faceMeshParts` decides. */
  faceMeshLayers?: VideoFaceMeshLayers
  /** How a routed run's mesh line is worded; absent: "motion". */
  faceMeshWording?: FaceMeshWording
}

/** How a routed run's mesh line is worded: today's ("motion", the default) or the face's 3D shape ("shape"). */
export const FACE_MESH_WORDINGS = ["motion", "shape"] as const
export type FaceMeshWording = (typeof FACE_MESH_WORDINGS)[number]

const normalizeEmail = (email: string): string => email.trim().toLowerCase()
const withoutRepeats = (emails: readonly string[]): string[] => [...new Set(emails)]
const emailSchema = z.string().transform(normalizeEmail).pipe(z.email().max(254))
const routedDepthBlurSchema = z.int().min(CAST_SWAP_DEPTH_BLUR_BOUNDS.min).max(CAST_SWAP_DEPTH_BLUR_BOUNDS.max)

/** What an admin saves: strict (an unknown key, a third value or something that is not an email is refused), the emails normalized. */
const faceMeshLayersSchema = z.strictObject(
  Object.fromEntries(VIDEO_FACE_MESH_LAYERS.map((l) => [l, z.boolean().optional()])) as Record<VideoFaceMeshLayer, z.ZodOptional<z.ZodBoolean>>,
)

export const nodaroMotionPreciseStyleRouteSchema = z
  .strictObject({
    routing: z.enum(PRECISE_STYLE_ROUTINGS).optional(),
    bypassEmails: z.array(emailSchema).max(PRECISE_STYLE_ROUTE_MAX_EMAILS).transform(withoutRepeats).optional(),
    photographicStyles: z.enum(PHOTOGRAPHIC_STYLE_PATHS).optional(),
    styleRoutes: z.record(z.string().regex(STYLE_ROUTE_ID_PATTERN), z.enum(STYLE_ROUTES)).optional(),
    routedDepthBlur: routedDepthBlurSchema.optional(),
    describeColours: z.boolean().optional(),
    faceMesh: z.boolean().optional(),
    faceMeshParts: z.enum(VIDEO_FACE_MESH_PARTS).optional(),
    faceMeshLayers: faceMeshLayersSchema.optional(),
    faceMeshWording: z.enum(FACE_MESH_WORDINGS).optional(),
  })
  .refine((s) => s.faceMeshParts === undefined || s.faceMeshLayers === undefined, {
    path: ["faceMeshLayers"],
    message: "The face mesh's layers say what it draws in place of its parts: send one of them.",
  })
  .refine((s) => s.faceMeshLayers === undefined || videoFaceMeshLayersDrawLines(s.faceMeshLayers), {
    path: ["faceMeshLayers"],
    message: "The face mesh's layers draw nothing: turn on the wireframe, the eyes, the lips, the contours or the irises (bold only changes their lines).",
  })

/** The setting as stored and sent: `routing` only when "off", the list only when it is not empty, the photographic path only when "precise", the per-style routes only when there is one, the blur only above 0, the colours only when off, the mesh only when on. New objects. */
export function withoutDefaultPreciseStyleRoute(setting: NodaroMotionPreciseStyleRoute | null | undefined): NodaroMotionPreciseStyleRoute {
  const out: NodaroMotionPreciseStyleRoute = {}
  if (setting?.routing === "off") out.routing = "off"
  if (setting?.bypassEmails && setting.bypassEmails.length > 0) out.bypassEmails = [...setting.bypassEmails]
  if (setting?.photographicStyles === "precise") out.photographicStyles = "precise"
  if (setting?.styleRoutes && Object.keys(setting.styleRoutes).length > 0) out.styleRoutes = { ...setting.styleRoutes }
  if (typeof setting?.routedDepthBlur === "number" && setting.routedDepthBlur > 0) out.routedDepthBlur = setting.routedDepthBlur
  if (setting?.describeColours === false) out.describeColours = false
  if (setting?.faceMesh === true) out.faceMesh = true
  // Layers in place of the parts (a set a parts value names is that value); a set that draws nothing is no set.
  const layers = setting?.faceMeshLayers !== undefined && videoFaceMeshLayersDrawLines(setting.faceMeshLayers) ? setting.faceMeshLayers : undefined
  const parts = layers ? videoFaceMeshPartsOfLayers(layers) : setting?.faceMeshParts
  if (parts !== undefined) out.faceMeshParts = parts
  else if (layers) out.faceMeshLayers = videoFaceMeshLayersOn(layers)
  if (setting?.faceMeshWording === "shape") out.faceMeshWording = "shape"
  return out
}

/** What the plugin is answered: what differs from the defaults, a copy; null when nothing does. */
export function preciseStyleRouteForPlugin(setting: NodaroMotionPreciseStyleRoute | null | undefined): NodaroMotionPreciseStyleRoute | null {
  const kept = withoutDefaultPreciseStyleRoute(setting)
  return Object.keys(kept).length > 0 ? kept : null
}

/**
 * The tolerant read of the stored row, field by field: an unknown key is
 * ignored, a switch of neither value reads as on, a list that is not one as
 * empty, an entry that is not an email is dropped alone (each with a warning
 * naming no email), a per-style route that is not a style id to a known route
 * dropped alone too, the defaults left out. Not an object reads as never saved
 * (null).
 */
export function parseNodaroMotionPreciseStyleRoute(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionPreciseStyleRoute | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const { routing, bypassEmails, photographicStyles, styleRoutes, routedDepthBlur, describeColours, faceMesh, faceMeshParts, faceMeshLayers, faceMeshWording } = value as {
    routing?: unknown
    bypassEmails?: unknown
    photographicStyles?: unknown
    styleRoutes?: unknown
    routedDepthBlur?: unknown
    describeColours?: unknown
    faceMesh?: unknown
    faceMeshParts?: unknown
    faceMeshLayers?: unknown
    faceMeshWording?: unknown
  }
  const out: NodaroMotionPreciseStyleRoute = {}
  if (routing === "off" || routing === "on") out.routing = routing
  else if (routing !== undefined && routing !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the switch is not valid: it reads as on`)
  if (Array.isArray(bypassEmails)) {
    const valid = bypassEmails.map((e) => emailSchema.safeParse(e)).flatMap((e) => (e.success ? [e.data] : []))
    if (valid.length < bypassEmails.length) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] ${bypassEmails.length - valid.length} bypass entries are not emails: they are left out`)
    out.bypassEmails = withoutRepeats(valid)
  } else if (bypassEmails !== undefined && bypassEmails !== null) {
    warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the bypass list is not a list: nobody is bypassed`)
  }
  if ((PHOTOGRAPHIC_STYLE_PATHS as readonly unknown[]).includes(photographicStyles)) out.photographicStyles = photographicStyles as PhotographicStylePath
  else if (photographicStyles !== undefined && photographicStyles !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the photographic art-style path is not known: those runs are routed as Flex`)
  if (typeof styleRoutes === "object" && styleRoutes !== null && !Array.isArray(styleRoutes)) {
    const entries = Object.entries(styleRoutes as Record<string, unknown>)
    const valid = entries.filter((e): e is [string, StyleRoute] => STYLE_ROUTE_ID_PATTERN.test(e[0]) && (STYLE_ROUTES as readonly unknown[]).includes(e[1]))
    if (valid.length < entries.length) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] ${entries.length - valid.length} per-style routes are not a style id to a known route: those styles are routed as Flex`)
    out.styleRoutes = Object.fromEntries(valid)
  } else if (styleRoutes !== undefined && styleRoutes !== null) {
    warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the per-style routes are not a map: every style is routed as Flex`)
  }
  if (routedDepthBlur !== undefined && routedDepthBlur !== null) {
    const blur = routedDepthBlurSchema.safeParse(routedDepthBlur)
    if (blur.success) out.routedDepthBlur = blur.data
    else warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the routed depth blur is not a whole number from ${CAST_SWAP_DEPTH_BLUR_BOUNDS.min} to ${CAST_SWAP_DEPTH_BLUR_BOUNDS.max}: routed runs take no blur`)
  }
  if (typeof describeColours === "boolean") out.describeColours = describeColours
  else if (describeColours !== undefined && describeColours !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the colour switch is not a boolean: it reads as on`)
  if (typeof faceMesh === "boolean") out.faceMesh = faceMesh
  else if (faceMesh !== undefined && faceMesh !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the face mesh switch is not a boolean: it reads as off`)
  if ((VIDEO_FACE_MESH_PARTS as readonly unknown[]).includes(faceMeshParts)) out.faceMeshParts = faceMeshParts as VideoFaceMeshParts
  else if (faceMeshParts !== undefined && faceMeshParts !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the face mesh parts are not known: the Flex masking's are drawn`)
  if (faceMeshLayers !== undefined && faceMeshLayers !== null) {
    // Each known layer read on its own (an unknown one ignored); a set that draws nothing reads as none.
    const known = typeof faceMeshLayers === "object" && !Array.isArray(faceMeshLayers) ? videoFaceMeshLayersOn(faceMeshLayers as VideoFaceMeshLayers) : {}
    if (videoFaceMeshLayersDrawLines(known)) out.faceMeshLayers = known
    else warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the face mesh layers draw nothing: the parts decide`)
  }
  if ((FACE_MESH_WORDINGS as readonly unknown[]).includes(faceMeshWording)) out.faceMeshWording = faceMeshWording as FaceMeshWording
  else if (faceMeshWording !== undefined && faceMeshWording !== null) warn(`[${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}] the face mesh wording is not known: it reads as Motion`)
  return withoutDefaultPreciseStyleRoute(out)
}

/** Whether a (loaded or recorded) Cast Swap engine runs such a run as Flex (`castSwap.preciseStyleRoute`). An engine without it never reads the row. */
export function engineRoutesPreciseStyle(cs: { readonly preciseStyleRoute?: boolean } | undefined): boolean {
  return cs?.preciseStyleRoute === true
}
