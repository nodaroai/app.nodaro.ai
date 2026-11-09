/** A Seedance 2.5 draft's finalize keeps the filter its node chose. */
import { describe, expect, it } from "vitest"
import { buildSeedanceDraftFinalizeInput } from "../seedance-draft.js"

describe("buildSeedanceDraftFinalizeInput", () => {
  it("adds nothing unless the draft asked for the filter", () => {
    expect(buildSeedanceDraftFinalizeInput("task-1")).toEqual(buildSeedanceDraftFinalizeInput("task-1", { nsfwChecker: false }))
    expect(buildSeedanceDraftFinalizeInput("task-1")).not.toHaveProperty("nsfw_checker")
  })

  it("carries the draft's filter choice to the finalize", () => {
    expect(buildSeedanceDraftFinalizeInput("task-1", { nsfwChecker: true })).toMatchObject({ draft_task_id: "task-1", nsfw_checker: true })
  })
})
