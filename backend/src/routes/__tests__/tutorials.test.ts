import { describe, it, expect } from "vitest"
import { toFlowResponse } from "../tutorials.js"

describe("toFlowResponse", () => {
  const row = {
    id: "t1", slug: "s", name: "N", description: null, markdown_description: null,
    preview_media_url: null, preview_media_type: null, complexity: "simple",
    estimated_credits: 5, node_types_used: ["text"], providers_used: [], node_count: 1,
    creator_display_name: "Acme Team",
    tutorial_category_id: "c1", tutorial_sort_order: 0, workflow_id: "w1", created_at: "2026-01-01",
  }

  it("maps creator_display_name → creatorDisplayName (null-safe)", () => {
    expect(toFlowResponse(row as never).creatorDisplayName).toBe("Acme Team")
    expect(toFlowResponse({ ...row, creator_display_name: null } as never).creatorDisplayName).toBeNull()
  })
})
