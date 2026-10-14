// @test-watches frontend/src/components/editor/config-panels/connected-media-list.tsx frontend/src/components/editor/workflow-editor/{workflow-editor-main.tsx,node-input-resolver.ts}
// @test-watches frontend/src/components/nodes/{manual-edit-node,lip-sync-node}.tsx
/**
 * Every frontend site that asks "is this source a video?" reads the shared
 * `VIDEO_PRODUCER_TYPES` (@nodaro/shared) — the set the canvas validators and
 * the server type outputs by — instead of a list kept by hand. A hand-kept list
 * missed every video node added after it was written: no Connected Media row,
 * no Manual Edit or Lip Sync source, no LLM video reference, no display name
 * (Video Overlay and UGC Clip had to be pinned into each list one by one).
 *
 * Two halves:
 *  - each site's declaration is built from VIDEO_PRODUCER_TYPES (what a site
 *    adds on top is stated in code beside it);
 *  - the two label tables name every video producer, directly or through the
 *    node's own NODE_DEFINITIONS label — never the id title-cased.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { JOB_TYPE_LABELS, formatNodeType } from "@/components/editor/execution-utils"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { getNodeTypeLabel } from "@/lib/template-utils"

const SRC = join(__dirname, "..", "..")

/** file → the declaration that must read VIDEO_PRODUCER_TYPES. */
const DERIVED_SITES: ReadonlyArray<readonly [file: string, declaration: string]> = [
  ["components/editor/config-panels/connected-media-list.tsx", "const VIDEO_TYPES"],
  ["components/editor/workflow-editor/workflow-editor-main.tsx", "const VIDEO_TYPES"],
  ["components/nodes/manual-edit-node.tsx", "const VIDEO_TYPES"],
  ["components/nodes/lip-sync-node.tsx", "const VIDEO_OUTPUT_TYPES"],
  ["components/editor/workflow-editor/node-input-resolver.ts", "const LLM_REF_VIDEO_NODE_TYPES"],
]

/** The declaration statement starting at `anchor`, through its first `;` or line end that closes it. */
function declaration(src: string, anchor: string): string {
  const start = src.indexOf(anchor)
  if (start < 0) throw new Error(`declaration not found: ${anchor}`)
  const end = src.indexOf("\n\n", start)
  return src.slice(start, end < 0 ? src.length : end)
}

describe("video-source sites derive from VIDEO_PRODUCER_TYPES", () => {
  for (const [file, anchor] of DERIVED_SITES) {
    it(`${file} — ${anchor}`, () => {
      const decl = declaration(readFileSync(join(SRC, file), "utf8"), anchor)
      expect(decl).toContain("VIDEO_PRODUCER_TYPES")
      // A hand-kept copy would name an ordinary producer again; none may.
      expect(decl).not.toContain('"trim-video"')
    })
  }
})

describe("every video producer has a display name", () => {
  const definitionLabel = new Map<string, string>(NODE_DEFINITIONS.map((d) => [d.type, d.label]))

  for (const type of VIDEO_PRODUCER_TYPES) {
    it(type, () => {
      // Both tables fall back to the node's own definition label, so a producer
      // with a definition is named on every surface without a table edit.
      const label = JOB_TYPE_LABELS[type] ?? definitionLabel.get(type)
      expect(label, `${type} has neither a job label nor a NODE_DEFINITIONS entry`).toBeTruthy()
      expect(formatNodeType(type)).toBe(label)
      expect(getNodeTypeLabel(type).length).toBeGreaterThan(0)
    })
  }

  it("a producer no table names reads by its definition label on both surfaces", () => {
    expect(JOB_TYPE_LABELS["ai-avatar"]).toBeUndefined()
    expect(formatNodeType("ai-avatar")).toBe(definitionLabel.get("ai-avatar"))
    expect(getNodeTypeLabel("ai-avatar")).toBe(definitionLabel.get("ai-avatar"))
  })
})
