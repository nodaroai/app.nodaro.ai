/**
 * Every Generate Music run reserves on the music id (the route's guard and the
 * orchestrator's payload). The estimate priced the node by its model id —
 * "minimax", the MiniMax VIDEO model's row — so it quoted a different price
 * than the run reserved.
 */
import { describe, it, expect } from "vitest"
import { MUSIC_CREDIT_ID } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

describe("workflow estimate — Generate Music", () => {
  it.each(["minimax", "suno", undefined])("prices a node on %s at the music price", (provider) => {
    const quoted = CreditsService.estimateWorkflowBaseCredits([{ id: "m", type: "generate-music", data: { provider } }], [])
    expect(quoted).toBe(STATIC_CREDIT_COSTS[MUSIC_CREDIT_ID])
  })

  it("is not the MiniMax video price", () => {
    expect(STATIC_CREDIT_COSTS[MUSIC_CREDIT_ID]).not.toBe(STATIC_CREDIT_COSTS["minimax"])
  })
})
