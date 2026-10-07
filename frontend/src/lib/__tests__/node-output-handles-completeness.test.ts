import { describe, it, expect } from "vitest"
import { RENDERED_OUTPUT_HANDLES } from "@nodaro/shared"
import { NODE_DEF_MAP } from "@/types/nodes"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"

/**
 * Drift guard for the "stale NODE_DEFINITIONS.outputs" bug class — the
 * output-side twin of node-input-handles-completeness.test.ts.
 *
 * `NODE_DEFINITIONS.outputs` is what every MCP client learns a node's source
 * handle ids are: it generates `backend/src/lib/mcp/generated/node-handles.ts`,
 * the node skills and the public tool docs, and it feeds the editor's Connect
 * popover. The pip a node actually RENDERS is what React Flow needs to draw an
 * edge: an edge whose `sourceHandle` does not exist on the node is silently
 * not drawn (React Flow error 008). Telegram Channel Feed documented `text`
 * and rendered `out`, so every MCP-made feed edge was invisible (2026-10-05).
 *
 * Source of truth for the rendered side: `HANDLE_OUTPUT_TYPES` (keys = the
 * static source pips each component renders — pinned to the JSX by
 * handle-color-guard.test.ts).
 *
 * The nodes that still drift are listed ONCE, in `@nodaro/shared`
 * (`RENDERED_OUTPUT_HANDLES`, issue #1877): the server reads that table to
 * know which pips really draw, and this test pins it to the JSX. It is a
 * BURN-DOWN list, not a permission: each entry must drift exactly as recorded
 * (the rendered pips there, the declared ids below), and fixing a node fails
 * this test until its entry is removed from both — so the list only shrinks.
 */
// Burned down to empty (#1877): every definition now declares the pips its
// component renders. A drift found later is recorded here AND in the shared
// table, or this test fails.
const DECLARED_WHILE_DRIFTING: Readonly<Record<string, readonly string[]>> = {}

/**
 * Pips created at run time that the color registry cannot list: a `media`
 * pip whose kind (video / audio / image) is decided by the result.
 */
const DYNAMIC_EXTRA_OUTPUTS: Readonly<Record<string, readonly string[]>> = {
  "apply-edl": ["media"],
  "social-media-format": ["media"],
}

const sorted = (xs: readonly string[]) => [...xs].sort()

describe("NODE_DEFINITIONS.outputs equals each node's rendered source-handle set", () => {
  const types = Object.keys(HANDLE_OUTPUT_TYPES).filter((type) => NODE_DEF_MAP.has(type))

  it.each(types)("%s", (type) => {
    const def = NODE_DEF_MAP.get(type)!
    const rendered = sorted([...Object.keys(HANDLE_OUTPUT_TYPES[type]!), ...(DYNAMIC_EXTRA_OUTPUTS[type] ?? [])])
    const defined = sorted(def.outputs)
    const drifting = RENDERED_OUTPUT_HANDLES[type]
    if (drifting) {
      // Recorded drift must stay exactly as recorded — a fix removes the entry (shared table + the declared list above).
      expect({ rendered, defined }).toEqual({
        rendered: sorted(drifting),
        defined: sorted(DECLARED_WHILE_DRIFTING[type] ?? ["<not on the burn-down list>"]),
      })
      return
    }
    expect(defined).toEqual(rendered)
  })

  it("the shared burn-down table names exactly the nodes recorded here, and every one still exists", () => {
    expect(sorted(Object.keys(RENDERED_OUTPUT_HANDLES))).toEqual(sorted(Object.keys(DECLARED_WHILE_DRIFTING)))
    for (const type of Object.keys(RENDERED_OUTPUT_HANDLES)) {
      expect(NODE_DEF_MAP.has(type), `${type} is on the burn-down list but has no definition — remove it`).toBe(true)
      expect(HANDLE_OUTPUT_TYPES[type], `${type} is on the burn-down list but renders no static source pip`).toBeDefined()
    }
  })
})
