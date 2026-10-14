// @vitest-environment node
import { describe, it, expect } from "vitest"
import { resolveHomeTab, EXPLORE_SECTION_KEYS, type HomeTabVisibility } from "../home-tabs"

const ALL: HomeTabVisibility = { exploreVisible: true, appsPageVisible: true, statisticsVisible: true }

describe("resolveHomeTab", () => {
  it("opens Continue when no tab is requested", () => {
    expect(resolveHomeTab(null, ALL)).toEqual({ tab: "continue" })
  })

  it("opens Continue for an unknown value and leaves the URL alone", () => {
    expect(resolveHomeTab("nonsense", ALL)).toEqual({ tab: "continue" })
  })

  it("opens Explore for ?tab=explore", () => {
    expect(resolveHomeTab("explore", ALL)).toEqual({ tab: "explore" })
  })

  it("drops a stale ?tab=explore when the profile hides every Explore section", () => {
    expect(resolveHomeTab("explore", { ...ALL, exploreVisible: false })).toEqual({
      tab: "continue",
      canonicalParam: null,
    })
  })

  it("canonicalizes ?tab=continue to the bare URL", () => {
    expect(resolveHomeTab("continue", ALL)).toEqual({ tab: "continue", canonicalParam: null })
  })

  it.each(["tutorials", "templates"])("maps the legacy ?tab=%s link onto Explore and rewrites it", (legacy) => {
    expect(resolveHomeTab(legacy, ALL)).toEqual({ tab: "explore", canonicalParam: "explore" })
  })

  it("maps a legacy Explore alias onto Continue when Explore is hidden", () => {
    expect(resolveHomeTab("tutorials", { ...ALL, exploreVisible: false })).toEqual({
      tab: "continue",
      canonicalParam: null,
    })
  })

  it("maps the legacy ?tab=apps link onto Continue, where the Nodaro apps band now lives", () => {
    expect(resolveHomeTab("apps", ALL)).toEqual({ tab: "continue", canonicalParam: null })
  })

  it("sends the legacy ?tab=miniapps link to the MiniApps page", () => {
    expect(resolveHomeTab("miniapps", ALL)).toEqual({ tab: "continue", redirectTo: "/apps" })
  })

  it("does not redirect ?tab=miniapps to a page the profile hides", () => {
    expect(resolveHomeTab("miniapps", { ...ALL, appsPageVisible: false })).toEqual({
      tab: "continue",
      canonicalParam: null,
    })
  })

  it("sends the legacy ?tab=statistics link to Executions, where the stats moved", () => {
    expect(resolveHomeTab("statistics", ALL)).toEqual({ tab: "continue", redirectTo: "/executions" })
  })

  it("does not redirect ?tab=statistics when the profile hides the statistics view", () => {
    expect(resolveHomeTab("statistics", { ...ALL, statisticsVisible: false })).toEqual({
      tab: "continue",
      canonicalParam: null,
    })
  })

  it.each(["workflows", "projects", "studio"])(
    "leaves the workspace value ?tab=%s in place for the Jump back in filter",
    (value) => {
      expect(resolveHomeTab(value, ALL)).toEqual({ tab: "continue" })
    },
  )
})

describe("EXPLORE_SECTION_KEYS", () => {
  it("gates Explore on the templates and tutorials profile keys", () => {
    expect([...EXPLORE_SECTION_KEYS]).toEqual(["templates", "tutorials"])
  })
})
