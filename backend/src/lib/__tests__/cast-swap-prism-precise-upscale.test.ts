import { describe, expect, it, vi } from "vitest"
import {
  PRECISE_UPSCALE_CHOICES,
  PRECISE_UPSCALE_DEFAULTS,
  effectivePreciseUpscale,
  engineTakesPreciseUpscale,
  nodaroMotionPreciseUpscaleSchema,
  parseNodaroMotionPreciseUpscale,
} from "../cast-swap-prism-precise-upscale.js"

describe("Precise upscale setting", () => {
  it("defaults to Topaz 1080p for 480p and 720p, 4k for 1080p, each a choice its resolution takes", () => {
    expect(PRECISE_UPSCALE_DEFAULTS).toEqual({ "480p": "1080p", "720p": "1080p", "1080p": "4k" })
    for (const [r, d] of Object.entries(PRECISE_UPSCALE_DEFAULTS)) expect(PRECISE_UPSCALE_CHOICES[r as keyof typeof PRECISE_UPSCALE_CHOICES]).toContain(d)
    expect(PRECISE_UPSCALE_CHOICES["1080p"]).not.toContain("720p")
  })

  it("the save schema is strict per resolution", () => {
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ "480p": "off", "720p": "720p", "1080p": "4k" }).success).toBe(true)
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({}).success).toBe(true)
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ "1080p": "720p" }).success).toBe(false)
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ "540p": "1080p" }).success).toBe(false)
  })

  it("reads the row tolerantly: a bad resolution is dropped alone, not an object is never saved", () => {
    const warnings: string[] = []
    const warn = (m: string) => void warnings.push(m)
    expect(parseNodaroMotionPreciseUpscale({ "480p": "off", "720p": "8k", "1080p": "720p", extra: 1 }, warn)).toEqual({ "480p": "off" })
    expect(warnings).toHaveLength(2)
    expect(parseNodaroMotionPreciseUpscale("4k", warn)).toBeNull()
    expect(parseNodaroMotionPreciseUpscale(null, warn)).toBeNull()
    expect(parseNodaroMotionPreciseUpscale([], warn)).toBeNull()
  })

  it("the effective value fills each resolution left out (or never saved) with its default, Nodaro Prism Flash's rows too", () => {
    const FLASH = { "480p": "1080p", "720p": "1080p" }
    expect(effectivePreciseUpscale(null)).toEqual({ ...PRECISE_UPSCALE_DEFAULTS, flash: FLASH })
    expect(effectivePreciseUpscale({ "720p": "off" })).toEqual({ "480p": "1080p", "720p": "off", "1080p": "4k", flash: FLASH })
    expect(effectivePreciseUpscale({ "720p": undefined })).toEqual({ ...PRECISE_UPSCALE_DEFAULTS, flash: FLASH })
    expect(effectivePreciseUpscale(null)).not.toBe(PRECISE_UPSCALE_DEFAULTS)
    // Nodaro Prism Flash's rows are their own: Nodaro Prism's 720p off leaves Nodaro Prism Flash's 720p at its default.
    expect(effectivePreciseUpscale({ "720p": "off", flash: { "480p": "off" } }).flash).toEqual({ "480p": "off", "720p": "1080p" })
  })

  it("Nodaro Prism Flash's rows (decided 2026-11-22): saved strictly (no 1080p row), read tolerantly, and absent from a row stored before them", () => {
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ flash: { "480p": "off", "720p": "4k" } }).success).toBe(true)
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ flash: { "1080p": "4k" } }).success).toBe(false)
    expect(nodaroMotionPreciseUpscaleSchema.safeParse({ flash: { "480p": "2k" } }).success).toBe(false)
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseUpscale({ "480p": "off" }, warn)).toEqual({ "480p": "off" })
    expect(parseNodaroMotionPreciseUpscale({ flash: { "480p": "720p", "720p": "2k" } }, warn)).toEqual({ flash: { "480p": "720p" } })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("only an engine that declares castSwap.preciseUpscale runs the step", () => {
    expect(engineTakesPreciseUpscale(undefined)).toBe(false)
    expect(engineTakesPreciseUpscale({})).toBe(false)
    expect(engineTakesPreciseUpscale({ preciseUpscale: true })).toBe(true)
  })
})
