import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { FAN_OUT_EACH_TYPES } from "@/components/editor/workflow-editor/types"
import { LIST_PRODUCER_TYPES, JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { DYNAMIC_PRODUCER_TYPES, PASSTHROUGH_TYPES } from "@nodaro/shared"

/**
 * Invariant guard for the loop→list node-type unification (Task 7).
 *
 * The legacy `loop` node type was folded into the canonical `list` node. It
 * now survives ONLY as a documented load-migration alias in four places:
 *   - the `nodeTypes` map (renders a migrated-but-not-yet-saved node)
 *   - `SceneNodeType` (marked @deprecated)
 *   - `frontend/src/lib/list-loop-migration.ts` (the load-time migrator)
 *   - backend `normalize-node-types.ts` (the execution-time migrator)
 *
 * It must NOT reappear in any data registry or "list-like" type-set, because
 * post-migration `loop` never reaches those code paths — keeping it there only
 * re-scatters the retired type through the codebase and defeats the cleanup.
 *
 * If you are adding a node whose output is a structured list, add `"list"`
 * (NOT `"loop"`) to the relevant set. These assertions pin the most important
 * shared/exported sets so the membership can't silently drift back.
 */
describe("loop node-type is retired (survives only as a documented alias)", () => {
  it("NODE_DEFINITIONS has no loop entry", () => {
    expect(NODE_DEFINITIONS.some((d) => d.type === "loop")).toBe(false)
  })

  it("exported list-like sets contain list but not loop", () => {
    const sets: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
      ["FAN_OUT_EACH_TYPES", FAN_OUT_EACH_TYPES],
      ["LIST_PRODUCER_TYPES", LIST_PRODUCER_TYPES],
      ["JSON_PRODUCER_TYPES", JSON_PRODUCER_TYPES],
      ["DYNAMIC_PRODUCER_TYPES", DYNAMIC_PRODUCER_TYPES],
      ["PASSTHROUGH_TYPES", PASSTHROUGH_TYPES],
    ]
    for (const [name, set] of sets) {
      expect(set.has("list"), `${name} should still contain "list"`).toBe(true)
      expect(set.has("loop"), `${name} should NOT contain "loop"`).toBe(false)
    }
  })
})
