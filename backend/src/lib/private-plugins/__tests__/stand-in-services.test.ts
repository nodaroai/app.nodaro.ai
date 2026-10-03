/**
 * `publishStandInPluginServices` publishes services that must never be
 * called — it exists for the MCP docs generator, which only enumerates the
 * tools a cloud install registers. Nothing that runs a request may reach it:
 * a stand-in `orgs` or `billing` behind a real session would fail every call
 * that touches it. The generator lives in backend/scripts, so no shipped file
 * under backend/src may name it except its own definition.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SCAN_TIMEOUT_MS, SRC, relPath, sourceFiles } from "../../__tests__/source-scan.js"

describe("publishStandInPluginServices", () => {
  it(
    "is defined in load.ts and called by no shipped code",
    () => {
      const mentions = sourceFiles()
        .filter((file) => readFileSync(file, "utf8").includes("publishStandInPluginServices"))
        .map(relPath)
      expect(mentions).toEqual(["lib/private-plugins/load.ts"])
    },
    SCAN_TIMEOUT_MS,
  )

  it("is what the docs generator's cloud capture calls (so the guard above is not vacuous)", () => {
    const capture = readFileSync(join(SRC, "..", "scripts", "lib", "gen-skills", "capture-tool-surface.ts"), "utf8")
    expect(capture).toContain("publishStandInPluginServices(")
  })
})
