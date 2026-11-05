/**
 * Nodaro Motion's Precise art-style route: whether a DIRECT run on Nodaro
 * Motion Prism that resolves to Precise and carries an art style
 * (`direction.style`) runs as Flex, its estimate alike. A whole-world art style
 * holds only when the video model gets a full-frame depth map, which is the
 * Flex path. Set by an admin for the whole deployment, never by the person
 * running it.
 *
 * The `app_settings` row `nodaro_motion_precise_style_route`:
 * `{ routing?: "on" | "off"; bypassEmails?: string[] }`.
 *
 * - `routing`: "on" (the default; absent means it) runs such a run as Flex;
 *   "off" leaves it the Precise run of `nodaro-motion-precise-art-style.ts`.
 * - `bypassEmails`: the accounts that skip the route and run real Precise with
 *   a style, for testing. Stored trimmed, lowercased and without repeats; the
 *   engine compares them against the account's email as the server reads it.
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

export const NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY = "nodaro_motion_precise_style_route"

/** The switch's two values; "on" when never saved. */
export const PRECISE_STYLE_ROUTINGS = ["on", "off"] as const
export type PreciseStyleRouting = (typeof PRECISE_STYLE_ROUTINGS)[number]

/** How many accounts the bypass list holds: it is a test list, not an audience. */
export const PRECISE_STYLE_ROUTE_MAX_EMAILS = 200

/** The saved setting. Absent `routing` means "on"; absent `bypassEmails` means nobody. */
export interface NodaroMotionPreciseStyleRoute {
  routing?: PreciseStyleRouting
  bypassEmails?: string[]
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()
const withoutRepeats = (emails: readonly string[]): string[] => [...new Set(emails)]
const emailSchema = z.string().transform(normalizeEmail).pipe(z.email().max(254))

/** What an admin saves: strict (an unknown key, a third value or something that is not an email is refused), the emails normalized. */
export const nodaroMotionPreciseStyleRouteSchema = z.strictObject({
  routing: z.enum(PRECISE_STYLE_ROUTINGS).optional(),
  bypassEmails: z.array(emailSchema).max(PRECISE_STYLE_ROUTE_MAX_EMAILS).transform(withoutRepeats).optional(),
})

/** The setting as stored and sent: `routing` only when "off", the list only when it is not empty. New objects. */
export function withoutDefaultPreciseStyleRoute(setting: NodaroMotionPreciseStyleRoute | null | undefined): NodaroMotionPreciseStyleRoute {
  const out: NodaroMotionPreciseStyleRoute = {}
  if (setting?.routing === "off") out.routing = "off"
  if (setting?.bypassEmails && setting.bypassEmails.length > 0) out.bypassEmails = [...setting.bypassEmails]
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
 * naming no email), the defaults left out. Not an object reads as never saved
 * (null).
 */
export function parseNodaroMotionPreciseStyleRoute(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionPreciseStyleRoute | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const { routing, bypassEmails } = value as { routing?: unknown; bypassEmails?: unknown }
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
  return withoutDefaultPreciseStyleRoute(out)
}

/** Whether a (loaded or recorded) Cast Swap engine runs such a run as Flex (`castSwap.preciseStyleRoute`). An engine without it never reads the row. */
export function engineRoutesPreciseStyle(cs: { readonly preciseStyleRoute?: boolean } | undefined): boolean {
  return cs?.preciseStyleRoute === true
}
