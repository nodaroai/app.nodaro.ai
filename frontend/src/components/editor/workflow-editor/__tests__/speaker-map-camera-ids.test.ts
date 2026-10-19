// @test-watches packages/shared/src/__tests__/fixtures/speaker-map-camera-ids.json
/**
 * Speaker Map's camera ids are Edit Plan's EDL ids for the same recordings,
 * a Teleport pair included (the editor's half; the server's is
 * backend/src/services/workflow-engine/__tests__/speaker-map-camera-ids.test.ts).
 * The editor's resolver bypasses teleports itself; Camera Switch's panel is
 * handed the bypassed edges, as config-panel.tsx hands them.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ characterDefinitions: [], nodes: [], edges: [] }) },
}))

import { bypassTeleports } from "@nodaro/render-rules"
import { resolveNodeInputs } from "../node-input-resolver"
import { cameraChoices } from "@/components/editor/config-panels/camera-switch-config"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const F = JSON.parse(readFileSync(join(__dirname, "../../../../../../packages/shared/src/__tests__/fixtures/speaker-map-camera-ids.json"), "utf8"))
const nodes = (F.nodes as Array<Record<string, unknown>>).map((n) => ({ position: { x: 0, y: 0 }, ...n })) as unknown as WorkflowNode[]
const edges = F.edges as WorkflowEdge[]
const node = (id: string) => nodes.find((n) => n.id === id)!

describe("Speaker Map's camera ids are the Edit Plan EDL's (editor engine, through a Teleport pair)", () => {
  it("Edit Plan's wired sources and Speaker Map's Cameras rows name the same nodes", () => {
    expect(resolveNodeInputs(node("plan"), nodes, edges).editPlanSources?.map((s) => s.nodeId)).toEqual(F.expectedIds)
    expect((resolveNodeInputs(node("map"), nodes, edges).unitInputs?.sources as unknown as Array<{ id: string }>).map((r) => r.id)).toEqual(F.expectedIds)
  })

  it("Camera Switch's panel offers the same camera ids for the Edit Plan wired into its edit", () => {
    expect(cameraChoices("cs", nodes, bypassTeleports(nodes, edges)).map((c) => c.id)).toEqual(F.expectedIds)
  })
})
