/**
 * Video Remake's upscale choice (decided 2026-11-24): whether the finished
 * video is upscaled straight to the next size and delivered at it
 * (480p → 720p, 720p → 1080p).
 *
 *   request (run and estimate)  upscale?: "off" | "next"
 *   estimate answer             resolution (the engine's size), outputResolution
 *                               (the size delivered), upscale (the choice made),
 *                               upscaleOffered, breakdown.upscale ("next" only)
 *   completed job output        outputResolution, and on a "next" run
 *                               upscale: "applied" | "skipped"
 *
 * The engine is its authority: it decides where the choice is offered (never
 * on a 1080p run, a draft or a trend run, nor where the deployment has not
 * turned it on) and answers a "next" asked where it is not offered as "off".
 * The platform only says whether the loaded engine takes the field at all
 * (`castSwap.upscaleChoice`, read at load), and reads the estimate's answer
 * field by field.
 */
import type { PluginSupports } from "./private-plugins/types.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

/** The request's choice, and the estimate's effective one. */
export const VIDEO_REMAKE_UPSCALE_CHOICES = ["off", "next"] as const
export type VideoRemakeUpscaleChoice = (typeof VIDEO_REMAKE_UPSCALE_CHOICES)[number]

/** A completed "next" run's outcome: the upscale was delivered, or it failed and the engine's size was. */
export type VideoRemakeUpscaleOutcome = "applied" | "skipped"

/** The sizes a run is made and delivered at. */
export type VideoRemakeResolution = "480p" | "720p" | "1080p"

/** Whether an engine's supports take the upscale choice (`castSwap.upscaleChoice`). */
export function engineTakesUpscaleChoice(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.upscaleChoice === true
}

/** Whether this process's Cast Swap engine takes the upscale choice. An engine without it is never sent the field. */
export function loadedEngineTakesUpscaleChoice(): boolean {
  return engineTakesUpscaleChoice(getPluginSupports().castSwap)
}

/** The estimate's upscale fields, each kept only when it is a value of the contract. */
export interface VideoRemakeUpscaleQuote {
  resolution?: VideoRemakeResolution
  outputResolution?: VideoRemakeResolution
  upscale?: VideoRemakeUpscaleChoice
  upscaleOffered?: boolean
}

const isResolution = (v: unknown): v is VideoRemakeResolution => v === "480p" || v === "720p" || v === "1080p"
const isChoice = (v: unknown): v is VideoRemakeUpscaleChoice => v === "off" || v === "next"

/** The upscale fields of an estimate's answer (an older engine answers none: an empty object). A new object. */
export function upscaleQuoteOf(quote: unknown): VideoRemakeUpscaleQuote {
  if (typeof quote !== "object" || quote === null) return {}
  const q = quote as Record<string, unknown>
  return {
    ...(isResolution(q.resolution) ? { resolution: q.resolution } : {}),
    ...(isResolution(q.outputResolution) ? { outputResolution: q.outputResolution } : {}),
    ...(isChoice(q.upscale) ? { upscale: q.upscale } : {}),
    ...(typeof q.upscaleOffered === "boolean" ? { upscaleOffered: q.upscaleOffered } : {}),
  }
}
