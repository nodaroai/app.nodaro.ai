/**
 * `daemonListProblem` — the one shape check the loader and the host share.
 */
import { describe, it, expect } from "vitest"
import { daemonListProblem } from "../daemons.js"

const start = async () => undefined

describe("daemonListProblem", () => {
  it("accepts a well-formed list, including optional members that are functions", () => {
    expect(daemonListProblem([])).toBeNull()
    expect(
      daemonListProblem([
        { name: "alpha", start },
        { name: "beta-2", start, registerInternalRoutes: async () => undefined, health: () => ({ ok: true }) },
      ]),
    ).toBeNull()
  })

  it.each([
    ["a missing entry", [null], /name/],
    ["a name with capitals or spaces", [{ name: "Not Valid", start }], /name/],
    ["a name longer than 64", [{ name: "a".repeat(65), start }], /name/],
    ["a name that is not a string", [{ name: 7, start }], /name/],
    ["no start()", [{ name: "alpha" }], /start/],
    ["registerInternalRoutes that is not a function", [{ name: "alpha", start, registerInternalRoutes: "x" }], /registerInternalRoutes/],
    ["health that is not a function", [{ name: "alpha", start, health: { ok: true } }], /health/],
    ["the same name twice", [{ name: "alpha", start }, { name: "alpha", start }], /twice/],
    ["the reserved name health (its routes would sit on the open /health prefix)", [{ name: "health", start }], /reserved/],
  ] as const)("names %s", (_label, list, reason) => {
    expect(daemonListProblem(list as readonly unknown[])).toMatch(reason)
  })
})
