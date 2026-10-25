// @vitest-environment node
import { describe, expect, it } from "vitest"

import { headerHomeUrl, readSiteEnv, worldHrefsFor } from "../site"

/**
 * Where the shared header's links go from THIS build. Unset variables leave the
 * header's own canonical targets in place (it ships them); a preview points
 * them at its matching preview hosts.
 */

const HERE = "https://next.nodaro.ai"

describe("readSiteEnv", () => {
  it("keeps only http(s) origins, trimmed, without a trailing slash", () => {
    expect(
      readSiteEnv({ VITE_HOME_URL: " https://home.example/ ", VITE_TOOLS_URL: "https://tools.example//", VITE_STUDIO_URL: "http://localhost:3005" }),
    ).toEqual({ home: "https://home.example", tools: "https://tools.example", studio: "http://localhost:3005" })
  })

  it("drops empty, relative or non-http values", () => {
    expect(readSiteEnv({ VITE_HOME_URL: "", VITE_TOOLS_URL: "/image", VITE_STUDIO_URL: "javascript:alert(1)" })).toEqual({})
    expect(readSiteEnv({})).toEqual({})
  })
})

describe("worldHrefsFor", () => {
  it("the five simple worlds on the tools origin, Studio on its origin, the App on this page's own /projects", () => {
    expect(worldHrefsFor(HERE, { tools: "https://tools.example", studio: "https://studio.example" })).toEqual({
      image: "https://tools.example/image",
      video: "https://tools.example/video",
      music: "https://tools.example/music",
      trends: "https://tools.example/trends",
      ads: "https://tools.example/ads",
      studio: "https://studio.example/",
      app: "https://next.nodaro.ai/projects",
    })
  })

  it("unset: only the App is overridden (the header keeps its canonical links for the rest)", () => {
    expect(worldHrefsFor(HERE, {})).toEqual({ app: "https://next.nodaro.ai/projects" })
  })
})

describe("headerHomeUrl", () => {
  it("the configured home, or undefined for the header's own default", () => {
    expect(headerHomeUrl({ home: "https://home.example" })).toBe("https://home.example")
    expect(headerHomeUrl({})).toBeUndefined()
  })
})
