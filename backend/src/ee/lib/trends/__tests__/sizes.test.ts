/**
 * A trend run's sizes (sizes.ts): read by the size the engine makes unless the loaded engine declares BOTH
 * `castSwap.deliveredResolution` and `castSwap.trendDeliveredResolution`; then exactly the sizes `style-choice`
 * answers for the trend's engine choice.
 */
import { afterEach, describe, expect, it } from "vitest"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import { deliveredResolutionsOffered, engineDeliversTrendResolution, loadedEngineDeliversTrendResolution } from "../../../../lib/video-remake-delivered-resolution.js"
import { readTrendSizesHere, trendRunSizes, trendSizeLabel, trendSizesFrom, trendSizesKeepKey } from "../sizes.js"
import { trendResolutions } from "../schemas.js"
import type { TrendVersionData } from "../types.js"

const BASE = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p", "720p", "1080p"], trendRun: true } as const
const DECLARED = {
  "nodaro-prism": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-pulse": [{ size: "720p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-prism-flash": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p" }],
  "nodaro-pulse-flash": [{ size: "720p", native: true }, { size: "1080p", from: "720p" }],
}
const DELIVERS = { ...BASE, deliveredResolution: true, deliveredResolutions: DECLARED, preciseUpscale: true, trendDeliveredResolution: true }
/** Every Precise upscale row on (its defaults), as the engine is handed them. */
const ALL_ON = { "480p": "1080p", "720p": "1080p", "1080p": "4k", flash: { "480p": "1080p", "720p": "1080p" } }

const TRENDS: Record<string, Pick<TrendVersionData, "engine" | "flash">> = {
  prism: {},
  pulse: { engine: "kling-4" },
  "prism-flash": { flash: true },
  "pulse-flash": { engine: "kling-4", flash: true },
}

afterEach(() => _resetPluginSupportsForTests())

describe("which engine reads trend runs by the size delivered", () => {
  it("only one that declares both flags", () => {
    expect(engineDeliversTrendResolution(undefined)).toBe(false)
    expect(engineDeliversTrendResolution(BASE as never)).toBe(false)
    expect(engineDeliversTrendResolution({ ...BASE, deliveredResolution: true } as never)).toBe(false)
    expect(engineDeliversTrendResolution({ ...BASE, trendDeliveredResolution: true } as never)).toBe(false)
    expect(engineDeliversTrendResolution(DELIVERS as never)).toBe(true)
    setPluginSupports({ castSwap: DELIVERS as never })
    expect(loadedEngineDeliversTrendResolution()).toBe(true)
  })
})

describe("trendRunSizes", () => {
  it("read by the size the engine makes: the trend's engine choice's own sizes, exactly as before", () => {
    for (const [kind, data] of Object.entries(TRENDS)) {
      for (const cs of [undefined, BASE, { ...BASE, deliveredResolution: true, deliveredResolutions: DECLARED }, { ...BASE, trendDeliveredResolution: true }]) {
        const here = trendSizesFrom(cs as never, ALL_ON)
        expect(here, kind).toEqual({ delivered: false })
        expect(trendRunSizes(data, here)).toEqual({ delivered: false, sizes: [...trendResolutions(data)] })
      }
    }
  })

  it("read by the size delivered: exactly what style-choice answers for the trend's engine choice", () => {
    const here = trendSizesFrom(DELIVERS as never, ALL_ON)
    const answered = deliveredResolutionsOffered(DELIVERS as never, ALL_ON)
    const choice: Record<string, keyof typeof answered> = { prism: "nodaro-prism", pulse: "nodaro-pulse", "prism-flash": "nodaro-prism-flash", "pulse-flash": "nodaro-pulse-flash" }
    for (const [kind, data] of Object.entries(TRENDS)) {
      expect(trendRunSizes(data, here), kind).toEqual({ delivered: true, sizes: answered[choice[kind]!] })
    }
    expect(trendRunSizes(TRENDS.prism!, here).sizes).toEqual(["720p", "1080p", "4k"])
    expect(trendRunSizes(TRENDS["pulse-flash"]!, here).sizes).toEqual(["720p", "1080p"])
  })

  it("no Prism-family step offered (the settings unread): Nodaro Prism's own sizes, Nodaro Pulse's as declared", () => {
    const here = trendSizesFrom(DELIVERS as never, null, false)
    expect(trendRunSizes(TRENDS.prism!, here).sizes).toEqual(["480p", "720p", "1080p"])
    expect(trendRunSizes(TRENDS["prism-flash"]!, here).sizes).toEqual(["480p", "720p"])
    expect(trendRunSizes(TRENDS.pulse!, here).sizes).toEqual(["720p", "1080p", "4k"])
  })

  it("an engine choice the engine declares nothing for: the sizes its engine makes", () => {
    const here = { delivered: true as const, resolutions: {}, settingsRead: true }
    expect(trendRunSizes(TRENDS.pulse!, here)).toEqual({ delivered: true, sizes: ["720p", "1080p"] })
  })
})

describe("readTrendSizesHere", () => {
  it("reads no setting for an engine that does not read trend runs by the size delivered", async () => {
    setPluginSupports({ castSwap: { ...BASE, deliveredResolution: true, deliveredResolutions: DECLARED, preciseUpscale: true } as never })
    expect(await readTrendSizesHere()).toEqual({ delivered: false })
  })
})

describe("the guest answer's keep key", () => {
  it("is unchanged read by the size the engine makes, the sizes read the delivered way, and nothing kept unread", () => {
    expect(trendSizesKeepKey({ delivered: false })).toEqual({ keep: true, key: null })
    const here = trendSizesFrom(DELIVERS as never, ALL_ON)
    expect(trendSizesKeepKey(here)).toEqual({ keep: true, key: JSON.stringify(deliveredResolutionsOffered(DELIVERS as never, ALL_ON)) })
    const off = trendSizesFrom(DELIVERS as never, { ...ALL_ON, "1080p": "off" })
    expect(trendSizesKeepKey(off)).not.toEqual(trendSizesKeepKey(here))
    expect(trendSizesKeepKey(trendSizesFrom(DELIVERS as never, null, false))).toEqual({ keep: false })
  })

  it("names 4K in words", () => {
    expect(["480p", "720p", "1080p", "4k"].map((s) => trendSizeLabel(s as never))).toEqual(["480p", "720p", "1080p", "4K"])
  })
})
