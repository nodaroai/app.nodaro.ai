// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import { DYNAMIC_ROUTE_FILES, isAppManagementPath, isAppRunPath, routesInSource } from "./helpers/route-source-scan.js"

describe("the route source scan behind the OAuth-scope totality tests", () => {
  it("the two scope tests cover disjoint paths", () => {
    const both = routesInSource((path) => isAppRunPath(path) && isAppManagementPath(path)).routes
    expect(both).toEqual([])
    expect(isAppRunPath("/v1/apps/mine")).toBe(false)
    expect(isAppManagementPath("/v1/app/some-app/run")).toBe(false)
  })

  it("each scope test's paths are found in the source", () => {
    expect(routesInSource(isAppRunPath).routes.length).toBeGreaterThan(0)
    expect(routesInSource(isAppManagementPath).routes.length).toBeGreaterThan(0)
  })

  it("every file registering a route on a computed path is listed with why it registers no covered route", () => {
    expect(routesInSource(() => false).dynamic.sort()).toEqual(Object.keys(DYNAMIC_ROUTE_FILES).sort())
  })
})
