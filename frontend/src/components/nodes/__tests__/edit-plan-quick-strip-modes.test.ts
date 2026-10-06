/**
 * Round 2 of Edit Plan's trailer mode (decided 2026-10-06): the quick strip
 * never offers a mode the server cannot plan — it removes it, where the config
 * panel greys it out with the reason. Edit Plan's strip has no mode control
 * today (the panel owns the mode), so this guards the day one is added: its
 * options must come from `isEditPlanModeSupported`, not a static list.
 */
import { describe, it, expect, afterEach } from "vitest"
import { getQuickConfigs } from "../node-quick-configs"
import { __setEditPlanModesForTests } from "@/lib/edit-plan-modes"

afterEach(() => __setEditPlanModesForTests(null))

const modeValues = (data: Record<string, unknown>) =>
  getQuickConfigs("edit-plan")
    .filter((c) => c.field === "mode")
    .flatMap((c) => (typeof c.options === "function" ? c.options(data) : c.options).map((o) => o.value))

describe("Edit Plan quick strip — modes", () => {
  it("never lists Trailer while the server cannot plan it", () => {
    for (const mode of ["tighten", "clips", "chapters", "trailer"]) {
      expect(modeValues({ mode })).not.toContain("trailer")
    }
  })
})
