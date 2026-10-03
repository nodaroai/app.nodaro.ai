/**
 * A Motion node wired into a video node's Settings input adds its clause to the
 * prompt through the editor's hint collector — the same `isSettingsHintEdge`
 * the orchestrator's collector asks (payload-builder-settings-motion.test.ts).
 */
import { describe, it, expect } from "vitest"
import { collectCinematographyHints, STILL_IMAGE_EXCLUDE_TYPES } from "../cinematography-hints"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const wire = (source: string, target: string, targetHandle = "settings") =>
  ({ id: `${source}->${target}`, source, target, targetHandle }) as unknown as WorkflowEdge

describe("editor hints: Motion in the Settings input", () => {
  const video = node("v", "generate-video", { prompt: "a lighthouse" })
  const dynamic = node("m1", "motion", { motion: "dynamic" })
  const subtle = node("m2", "motion", { motion: "subtle" })

  it("adds the Motion clause", () => {
    expect(collectCinematographyHints("v", [video, dynamic], [wire("m1", "v")]).join(" ")).toMatch(/dynamic, energetic motion/)
  })

  it("uses only the last Motion wired", () => {
    const hints = collectCinematographyHints("v", [video, dynamic, subtle], [wire("m1", "v"), wire("m2", "v")]).join(" ")
    expect(hints).toMatch(/subtle, gentle motion/)
    expect(hints).not.toMatch(/energetic/)
  })

  it("follows the Inject Look switch", () => {
    const off = node("v", "generate-video", { prompt: "a lighthouse", injectLook: false })
    expect(collectCinematographyHints("v", [off, dynamic], [wire("m1", "v")])).toEqual([])
  })

  it("is a video-only clause", () => {
    expect(STILL_IMAGE_EXCLUDE_TYPES.has("motion")).toBe(true)
  })
})
