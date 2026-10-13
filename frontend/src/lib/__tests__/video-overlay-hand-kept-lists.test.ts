/**
 * Video Overlay emits a video, but these hand-kept lists are not derived from
 * `VIDEO_PRODUCER_TYPES` — each names its video sources by hand. A new
 * video-producing node that misses one is invisible there: no Connected Media
 * row, no Manual Edit source, no Lip Sync source, no LLM video reference, no
 * display name. (The legacy-edge classifier list used to be one of them; it
 * now reads VIDEO_PRODUCER_TYPES itself — @nodaro/shared handle-aliases.ts.) This pins
 * `video-overlay` and `ugc-clip` (UGC Clip, one rendered clip) into every one of
 * them, and pins that each anchor still finds the list that names `fade-video`
 * (so a rename fails loudly here instead of passing on the wrong text).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

const SITES: ReadonlyArray<readonly [file: string, anchor: string]> = [
  ["components/editor/config-panels/connected-media-list.tsx", "const VIDEO_TYPES = new Set(["],
  ["components/editor/execution-utils.ts", "export const JOB_TYPE_LABELS"],
  ["lib/template-utils.ts", "const NODE_TYPE_LABELS"],
  ["components/editor/workflow-editor/workflow-editor-main.tsx", "const VIDEO_TYPES = new Set(["],
  ["components/nodes/manual-edit-node.tsx", "const VIDEO_TYPES = new Set(["],
  ["components/nodes/lip-sync-node.tsx", "const VIDEO_OUTPUT_TYPES = ["],
  ["components/editor/workflow-editor/node-input-resolver.ts", "const LLM_REF_VIDEO_NODE_TYPES"],
]

/** The literal that starts at `anchor`, up to its first closing `]` / `}` line. */
function listBlock(src: string, anchor: string): string {
  const start = src.indexOf(anchor)
  if (start < 0) throw new Error(`anchor not found: ${anchor}`)
  const close = /\n\s*[\]}]/g
  close.lastIndex = start
  const m = close.exec(src)
  return src.slice(start, m ? m.index : src.length)
}

/** Video nodes added after these lists were written; each must be named in every one. */
const LATER_VIDEO_NODES = ["video-overlay", "ugc-clip"] as const

describe("hand-kept video-type lists name every later video node", () => {
  for (const [file, anchor] of SITES) {
    it(`${file} — ${anchor}`, () => {
      const block = listBlock(readFileSync(join(SRC, file), "utf8"), anchor)
      expect(block).toContain('"fade-video"')
      for (const type of LATER_VIDEO_NODES) expect(block, type).toContain(`"${type}"`)
    })
  }
})
