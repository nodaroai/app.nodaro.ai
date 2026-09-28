/**
 * Every Generate Music run reserves on the music id, whatever the model (the
 * route's guard and the orchestrator's payload). The estimate priced the node
 * by its model id instead — "minimax", which is the MiniMax VIDEO model's row.
 */
import { describe, it, expect } from "vitest"
import { MUSIC_CREDIT_ID } from "@nodaro/shared"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode } from "@/types/nodes"

describe("Generate Music price identifier", () => {
  it.each(["minimax", "suno", undefined])("is the music id for a node on %s", (provider) => {
    const node = { id: "m", type: "generate-music", position: { x: 0, y: 0 }, data: { label: "Music", provider } } as unknown as WorkflowNode
    expect(getModelIdentifier(node)).toBe(MUSIC_CREDIT_ID)
  })
})
