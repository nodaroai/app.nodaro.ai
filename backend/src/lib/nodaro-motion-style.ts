/**
 * Nodaro Motion's Style choice, per engine — whether people choose a DIRECT
 * run's style (Precise or Flex) or every direct run of that engine is forced
 * to one. Set by an admin for the whole deployment, never by the person
 * running it. A trend run keeps its own trend's style.
 *
 * The `app_settings` row `nodaro_motion_style`:
 * `{ "motion-prism"?: Choice, "motion-pulse"?: Choice }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, `Choice = "user" | "precise" | "flex"`.
 *
 * - No row, an engine left out, or `"user"`: people choose (the request's
 *   `style`, left out = Precise), exactly as before the setting.
 * - `"flex"` ("Always Flex", the wire's `style: "motion"`): enforced for every
 *   direct run and quote of that engine, API and agents too, whatever the
 *   request's `style` says. The Cast Swap engine enforces it, and clients hide
 *   their Style control (`GET /v1/cast-swap/style-choice`).
 * - `"precise"` ("Precise in Nodaro Motion"): clients hide their Style control
 *   and run Precise; the engine (from plugin 0.456.0) makes a request that asks
 *   for Flex (`style: "motion"`) a Flex run, so an API or agent caller that
 *   asks for Flex gets it. An engine before it runs every direct run of that
 *   engine as Precise.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). What is stored: only the forced engines
 * (`"user"` is the same as left out, so it is dropped). Who reads it: the
 * Cast Swap engine, through `tk.settings.nodaroMotionStyle()` (advertised as
 * `tk.capabilities.nodaroMotionStyle`), which answers each forced entry under
 * both its current and its earlier key (`withEarlierEngineKeys`), or null when
 * nothing is forced; and the public route above. Written only by
 * `PUT /v1/admin/nodaro-motion/style` (ee/routes), through
 * `nodaro-motion-style-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_STYLE_KEY = "nodaro_motion_style"

/** Who decides a direct run's style: people (`"user"`), or Precise in Nodaro Motion (`"precise"`) / always Flex (`"flex"`). */
export const NODARO_MOTION_STYLE_CHOICES = ["user", "precise", "flex"] as const
export type NodaroMotionStyleChoice = (typeof NODARO_MOTION_STYLE_CHOICES)[number]

/** The saved setting: one choice per engine an admin set. */
export type NodaroMotionStyle = ByEngine<NodaroMotionStyleChoice>

/** What `tk.settings.nodaroMotionStyle()` answers: each forced entry under its current and its earlier key. */
export type NodaroMotionStyleForPlugin = ByEngineForPlugin<Exclude<NodaroMotionStyleChoice, "user">>

/** Every engine's choice, `"user"` where nothing is forced: what clients read. */
export type NodaroMotionStyleChoices = Record<NodaroMotionEngine, NodaroMotionStyleChoice>

const choiceSchema = z.enum(NODARO_MOTION_STYLE_CHOICES)

/** What an admin saves: strict (an unknown engine or value is refused). */
export const nodaroMotionStyleSchema: z.ZodType<NodaroMotionStyle> = z.strictObject({
  "motion-prism": choiceSchema.optional(),
  "motion-pulse": choiceSchema.optional(),
})

/** The setting with every `"user"` entry left out (the same as never set): what is stored. A new object. */
export function forcedStyles(style: NodaroMotionStyle | null | undefined): NodaroMotionStyle {
  const out: NodaroMotionStyle = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const choice = style?.[engine]
    if (choice && choice !== "user") out[engine] = choice
  }
  return out
}

/** Whether any engine's style is forced. */
export function anyStyleForced(style: NodaroMotionStyle | null | undefined): boolean {
  return Object.keys(forcedStyles(style)).length > 0
}

/** Every engine's choice, `"user"` where none is forced (a new object). */
export function styleChoices(style: NodaroMotionStyle | null | undefined): NodaroMotionStyleChoices {
  const out = {} as NodaroMotionStyleChoices
  for (const engine of NODARO_MOTION_ENGINES) out[engine] = forcedStyles(style)[engine] ?? "user"
  return out
}

/** TRANSITION SHIM (the 2026-10-26 rename): each forced entry also under its earlier key; null when nothing is forced. */
export function styleForPlugin(style: NodaroMotionStyle | null | undefined): NodaroMotionStyleForPlugin | null {
  const forced = forcedStyles(style)
  if (Object.keys(forced).length === 0) return null
  return withEarlierEngineKeys(forced) as NodaroMotionStyleForPlugin
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's choice validated on its own, an invalid
 * one dropped with a warning (that engine then lets people choose). Not an
 * object reads as never saved (null).
 */
export function parseNodaroMotionStyle(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionStyle | null {
  const parsed = parseByEngine(value, NODARO_MOTION_STYLE_KEY, choiceSchema, warn)
  return parsed ? forcedStyles(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine enforces this setting
 * (`castSwap.styleChoice`). An engine without it never reads the setting: its
 * direct runs take the request's `style`.
 */
export function engineTakesStyleChoice(cs: { readonly styleChoice?: boolean } | undefined): boolean {
  return cs?.styleChoice === true
}
