/**
 * A tutorial's listed figure holding a metered LLM call's estimate (`estimatedCreditsIsEstimate`,
 * Task 12) keeps its `≈` when the card hands the tutorial to the template preview modal.
 */
import { describe, it, expect } from "vitest"
import { flowToTemplateBrowseCard } from "../tutorials-tab"
import type { FlowTutorialItem } from "@/lib/api"

const flow = (patch: Partial<FlowTutorialItem> = {}): FlowTutorialItem => ({
  id: "t1", type: "flow", templateId: "tpl-1", slug: "s", title: "T", description: null, markdownDescription: null,
  previewMediaUrl: null, previewMediaType: null, complexity: "simple", estimatedCredits: 6,
  nodeTypesUsed: [], providersUsed: [], creatorDisplayName: null, nodeCount: 2, categoryId: "c",
  tutorialSortOrder: 0, workflowId: "wf", createdAt: "2026-10-20T00:00:00Z", ...patch,
})

describe("flowToTemplateBrowseCard — the estimate flag", () => {
  it("carries estimatedCreditsIsEstimate to the preview modal's card", () => {
    expect(flowToTemplateBrowseCard(flow({ estimatedCreditsIsEstimate: true }))).toMatchObject({ estimatedCredits: 6, estimatedCreditsIsEstimate: true })
  })
  it("a fixed figure has no such key", () => {
    expect(flowToTemplateBrowseCard(flow())).not.toHaveProperty("estimatedCreditsIsEstimate")
  })
})
