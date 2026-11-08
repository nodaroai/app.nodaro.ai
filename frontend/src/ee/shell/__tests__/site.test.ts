// @vitest-environment node
import { describe, expect, it } from "vitest"

import { headerHomeUrl, readSiteEnv, siteWorldsFile, worldHrefsFor } from "../site"

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
  it("Explore and the simple worlds on the tools origin, Studio on its origin, the App on this page's own /projects", () => {
    expect(worldHrefsFor(HERE, { tools: "https://tools.example", studio: "https://studio.example" })).toEqual({
      explore: "https://tools.example/explore",
      image: "https://tools.example/image",
      video: "https://tools.example/video",
      music: "https://tools.example/music",
      trends: "https://tools.example/trends",
      motion: "https://tools.example/video/cast-swap",
      voice: "https://tools.example/voice-changer",
      studio: "https://studio.example/",
      app: "https://next.nodaro.ai/projects",
    })
  })

  it("unset: only the App is overridden (the header keeps its canonical links for the rest)", () => {
    expect(worldHrefsFor(HERE, {})).toEqual({ app: "https://next.nodaro.ai/projects" })
  })
})

describe("siteWorldsFile", () => {
  const read = (source: string) => JSON.parse(source) as { worldsRow: boolean; worldHrefs: Record<string, string> }
  const BUILDS = [{}, { tools: "https://tools.example", studio: "https://studio.example" }, { tools: "https://tools.example" }, { home: "https://home.example" }]

  it("says the row is shown and its links, the App's as a path on the site itself", () => {
    expect(read(siteWorldsFile({}, true))).toEqual({ worldsRow: true, worldHrefs: { app: "/projects" } })
    expect(read(siteWorldsFile({ studio: "https://studio.example" }, true))).toEqual({ worldsRow: true, worldHrefs: { studio: "https://studio.example/", app: "/projects" } })
  })

  it("a site without the header has no row and no links", () => {
    expect(read(siteWorldsFile({ tools: "https://tools.example" }, false))).toEqual({ worldsRow: false, worldHrefs: {} })
  })

  // That these are the links the mounted header gets is held in app-header.test.tsx.
  it("every link is an https address or a path on the site: what the admin page reads", () => {
    for (const site of BUILDS) {
      for (const href of Object.values(read(siteWorldsFile(site, true)).worldHrefs)) expect(href).toMatch(/^(https:\/\/|\/(?!\/))/)
    }
  })
})

describe("headerHomeUrl", () => {
  it("the configured home, or undefined for the header's own default", () => {
    expect(headerHomeUrl({ home: "https://home.example" })).toBe("https://home.example")
    expect(headerHomeUrl({})).toBeUndefined()
  })
})
