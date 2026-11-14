import { describe, it, expect } from "vitest"
import { wiredCharacterNamesOf } from "@nodaro/shared/entities"
import { buildExtraRefCharacterContextLookup } from "../extra-ref-character-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The editor's extra-ref character context reads the wired characters only,
 * as the workflow run's does (decided 2026-11-13): a Character node wired by
 * its plain image pip never supplies a character's settings, even when its
 * edge comes first.
 */
const character = (id: string, characterName: string, canonicalDescription: string): WorkflowNode =>
  ({ id, type: "character", position: { x: 0, y: 0 }, data: { label: "Character Asset", characterName, canonicalDescription, defaultUsageMode: id === "pip" ? "face" : "identical" } }) as unknown as WorkflowNode
const wire = (source: string, sourceHandle: string): WorkflowEdge =>
  ({ id: `${source}->gv`, source, target: "gv", sourceHandle, targetHandle: "assets" }) as WorkflowEdge
const consumer = { id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: {} } as unknown as WorkflowNode

describe("buildExtraRefCharacterContextLookup — the wired characters only", () => {
  for (const name of ["マヤ", "Maya"]) {
    it(`an image-pip "${name}" wired first never supplies the wired "${name}"'s settings`, () => {
      const nodes = [consumer, character("pip", name, "the image-pip look"), character("wired", name, "the wired look")]
      const edges = [wire("pip", "image"), wire("wired", "characterRef")]
      const slug = wiredCharacterNamesOf("gv", nodes, edges).get("wired")!.slug
      const context = buildExtraRefCharacterContextLookup("gv", nodes, edges)(slug)
      expect(context).toMatchObject({ canonicalDescription: "the wired look", displayName: name, defaultUsageMode: "identical" })
    })
  }

  it("a character wired only by its image pip gives no context", () => {
    const nodes = [consumer, character("pip", "Maya", "the image-pip look")]
    expect(buildExtraRefCharacterContextLookup("gv", nodes, [wire("pip", "image")])("maya")).toBeUndefined()
  })
})
