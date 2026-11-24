/**
 * Video Remake's upscale choice (decided 2026-11-24): whether the finished
 * video is upscaled straight to the next size and delivered at it
 * (480p → 720p, 720p → 1080p, 1080p → 4K; the 4K size is spelled "4k").
 *
 *   request (run and estimate)  upscale?: "off" | "next"
 *   estimate answer             resolution (the engine's size), outputResolution
 *                               (the size delivered), upscale (the choice made),
 *                               upscaleOffered, breakdown.upscale ("next" only)
 *   completed job output        outputResolution, and on a "next" run
 *                               upscale: "applied" | "skipped"
 *
 * The engine is its authority: it decides where the choice is offered (never
 * on a draft or a trend run, nor where the deployment has not turned it on; a
 * 1080p run is offered it too, delivered at 4K) and answers a "next" asked
 * where it is not offered as "off". The platform only says whether the loaded engine takes the field at all
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

/** The sizes the engine makes a run at (`resolution`). */
export type VideoRemakeResolution = "480p" | "720p" | "1080p"

/** The sizes a run is delivered at (`outputResolution`): the engine's sizes, and 4K for an upscaled 1080p run. */
export const VIDEO_REMAKE_OUTPUT_RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const
export type VideoRemakeOutputResolution = (typeof VIDEO_REMAKE_OUTPUT_RESOLUTIONS)[number]

/** A delivered size in words: "4K" for "4k", the others as they are spelled. */
export function outputResolutionLabel(size: VideoRemakeOutputResolution): string {
  return size === "4k" ? "4K" : size
}

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
  outputResolution?: VideoRemakeOutputResolution
  upscale?: VideoRemakeUpscaleChoice
  upscaleOffered?: boolean
}

const isResolution = (v: unknown): v is VideoRemakeResolution => v === "480p" || v === "720p" || v === "1080p"
const isOutputResolution = (v: unknown): v is VideoRemakeOutputResolution =>
  typeof v === "string" && (VIDEO_REMAKE_OUTPUT_RESOLUTIONS as readonly string[]).includes(v)
const isChoice = (v: unknown): v is VideoRemakeUpscaleChoice => v === "off" || v === "next"

/** The upscale fields of an estimate's answer (an older engine answers none: an empty object). A new object. */
export function upscaleQuoteOf(quote: unknown): VideoRemakeUpscaleQuote {
  if (typeof quote !== "object" || quote === null) return {}
  const q = quote as Record<string, unknown>
  return {
    ...(isResolution(q.resolution) ? { resolution: q.resolution } : {}),
    ...(isOutputResolution(q.outputResolution) ? { outputResolution: q.outputResolution } : {}),
    ...(isChoice(q.upscale) ? { upscale: q.upscale } : {}),
    ...(typeof q.upscaleOffered === "boolean" ? { upscaleOffered: q.upscaleOffered } : {}),
  }
}
