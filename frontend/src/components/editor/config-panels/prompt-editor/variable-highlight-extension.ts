import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { Node as PMNode } from "@tiptap/pm/model"
import { NODE_REF_PATTERN, parseNodeRef } from "@nodaro/shared"
import { classifyPromptToken, type PromptTokenKind } from "@/lib/prompt-ref-scan"

/** A `{...}` span (brace-inclusive offsets, relative to the scanned text). */
export interface VariableRange {
  readonly from: number
  readonly to: number
  readonly kind: Exclude<PromptTokenKind, "skip">
}

/**
 * Scan a text fragment for `{...}` variable tokens and classify each against
 * the resolvable upstream label set. Pure — this is the only branching logic
 * the decoration plugin has; the plugin itself just maps ranges to
 * Decoration.inline. `String.matchAll` clones the regex, so sharing the
 * global NODE_REF_PATTERN object is safe (no lastIndex corruption).
 */
export function collectVariableRanges(
  text: string,
  resolvable: ReadonlySet<string> | null,
): VariableRange[] {
  const ranges: VariableRange[] = []
  for (const match of text.matchAll(NODE_REF_PATTERN)) {
    const { name } = parseNodeRef(match[1] ?? "")
    const kind = classifyPromptToken(name, resolvable)
    if (kind === "skip") continue
    const from = match.index ?? 0
    ranges.push({ from, to: from + match[0].length, kind })
  }
  return ranges
}

/** Transaction meta that forces a decoration rebuild (dispatched when the
 *  upstream label set changes — wire/unwire flips cyan↔amber live). */
export const VARIABLE_HIGHLIGHT_META = "var-refs-changed"

/** Both existing globals.css classes — reserved/unknown share the wired (cyan)
 *  look; only a confirmed missing upstream goes amber. */
const KIND_CLASS: Record<VariableRange["kind"], string> = {
  wired: "node-ref-highlight",
  reserved: "node-ref-highlight",
  unknown: "node-ref-highlight",
  missing: "ref-unresolved-highlight",
}

export interface VariableHighlightOptions {
  /** Ref-closure to the live label set; null = consumer passed no nodeRefs
   *  (amber suppressed). Read at decoration-build time, so the initial build
   *  during editor creation already sees labels assigned during render —
   *  no first-paint amber flash. */
  getResolvableLabels: () => ReadonlySet<string> | null
}

function buildDecorations(
  doc: PMNode,
  getLabels: () => ReadonlySet<string> | null,
): DecorationSet {
  const labels = getLabels()
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const r of collectVariableRanges(node.text, labels)) {
      decorations.push(
        Decoration.inline(pos + r.from, pos + r.to, { class: KIND_CLASS[r.kind] }),
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

const variableHighlightKey = new PluginKey<DecorationSet>("variableHighlight")

export const VariableHighlightExtension = Extension.create<VariableHighlightOptions>({
  name: "variableHighlight",

  addOptions() {
    return { getResolvableLabels: () => null }
  },

  addProseMirrorPlugins() {
    const getLabels = this.options.getResolvableLabels
    return [
      new Plugin<DecorationSet>({
        key: variableHighlightKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, getLabels),
          apply: (tr, old) => {
            // Full rebuild on content change or label-set change; prompts are
            // tiny so a rescan per keystroke is negligible. Otherwise remap.
            if (tr.docChanged || tr.getMeta(VARIABLE_HIGHLIGHT_META)) {
              return buildDecorations(tr.doc, getLabels)
            }
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return variableHighlightKey.getState(state) ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})
