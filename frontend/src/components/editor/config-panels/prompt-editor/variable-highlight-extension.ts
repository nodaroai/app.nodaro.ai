import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { Node as PMNode } from "@tiptap/pm/model"
import { NODE_REF_PATTERN, parseNodeRef } from "@nodaro/shared"
import { classifyPromptToken, type PromptTokenKind } from "@/lib/prompt-ref-scan"

/** A `{...}` span (brace-inclusive offsets, relative to the scanned text).
 *  `sep`/`fallback` are present only for non-reserved tokens with a non-empty
 *  default AND when value data was provided (valueLabels !== null). */
export interface VariableRange {
  readonly from: number
  readonly to: number
  readonly kind: Exclude<PromptTokenKind, "skip">
  /** The first `||` separator inside the token. */
  readonly sep?: { readonly from: number; readonly to: number }
  /** The trimmed default text; `active` = it will be injected at run time. */
  readonly fallback?: { readonly from: number; readonly to: number; readonly active: boolean }
}

/**
 * Scan a text fragment for `{...}` variable tokens and classify each against
 * the resolvable upstream label set. Pure — this is the only branching logic
 * the decoration plugin has; the plugin itself just maps ranges to
 * Decoration.inline. `String.matchAll` clones the regex, so sharing the
 * global NODE_REF_PATTERN object is safe (no lastIndex corruption).
 *
 * `valueLabels` (labels whose upstream currently produces a NON-EMPTY value —
 * refMap keys) drives the `{Label || default}` sub-ranges; `null` suppresses
 * them entirely ("no data" must not masquerade as a state).
 */
export function collectVariableRanges(
  text: string,
  resolvable: ReadonlySet<string> | null,
  valueLabels: ReadonlySet<string> | null = null,
): VariableRange[] {
  const ranges: VariableRange[] = []
  for (const match of text.matchAll(NODE_REF_PATTERN)) {
    const inner = match[1] ?? ""
    const { name, fallback } = parseNodeRef(inner)
    const kind = classifyPromptToken(name, resolvable)
    if (kind === "skip") continue
    const from = match.index ?? 0
    ranges.push({
      from,
      to: from + match[0].length,
      kind,
      ...fallbackSubRanges(inner, from, name, fallback, kind, valueLabels),
    })
  }
  return ranges
}

/**
 * `sep`/`fallback` sub-ranges for a token, or undefined when it has no
 * applicable default: value data absent (suppression), reserved token (the
 * resolver never applies its fallback), no `||`, or an empty default.
 * The span content comes FROM parseNodeRef's `fallback` string — only the
 * offset anchor is derived locally — so the highlighted span and the
 * runtime-injected text can never drift.
 */
function fallbackSubRanges(
  inner: string,
  from: number,
  name: string,
  fallback: string | null,
  kind: Exclude<PromptTokenKind, "skip">,
  valueLabels: ReadonlySet<string> | null,
): Pick<VariableRange, "sep" | "fallback"> | undefined {
  if (valueLabels === null || kind === "reserved" || !fallback) return undefined
  // parseNodeRef found a "||" (fallback !== null), splitting on the first one.
  const sepFrom = from + 1 + inner.indexOf("||")
  const rawFallback = inner.slice(inner.indexOf("||") + 2)
  // fallback === rawFallback.trim(), so indexOf is the leading-whitespace width.
  const fbFrom = sepFrom + 2 + rawFallback.indexOf(fallback)
  return {
    sep: { from: sepFrom, to: sepFrom + 2 },
    fallback: { from: fbFrom, to: fbFrom + fallback.length, active: !valueLabels.has(name) },
  }
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
  /** Ref-closure to the labels whose upstream currently produces a NON-EMPTY
   *  value (refMap keys); null = consumer passed no refMap → fallback
   *  sub-styling suppressed entirely. */
  getValueLabels: () => ReadonlySet<string> | null
}

function buildDecorations(
  doc: PMNode,
  getLabels: () => ReadonlySet<string> | null,
  getValueLabels: () => ReadonlySet<string> | null,
): DecorationSet {
  const labels = getLabels()
  const valueLabels = getValueLabels()
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const r of collectVariableRanges(node.text, labels, valueLabels)) {
      decorations.push(
        Decoration.inline(pos + r.from, pos + r.to, { class: KIND_CLASS[r.kind] }),
      )
      if (r.sep) {
        decorations.push(
          Decoration.inline(pos + r.sep.from, pos + r.sep.to, { class: "ref-fallback-sep" }),
        )
      }
      if (r.fallback) {
        decorations.push(
          Decoration.inline(pos + r.fallback.from, pos + r.fallback.to, {
            class: r.fallback.active ? "ref-fallback-active" : "ref-fallback-dormant",
          }),
        )
      }
    }
  })
  return DecorationSet.create(doc, decorations)
}

const variableHighlightKey = new PluginKey<DecorationSet>("variableHighlight")

export const VariableHighlightExtension = Extension.create<VariableHighlightOptions>({
  name: "variableHighlight",

  addOptions() {
    return { getResolvableLabels: () => null, getValueLabels: () => null }
  },

  addProseMirrorPlugins() {
    const getLabels = this.options.getResolvableLabels
    const getValueLabels = this.options.getValueLabels
    return [
      new Plugin<DecorationSet>({
        key: variableHighlightKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, getLabels, getValueLabels),
          apply: (tr, old) => {
            // Full rebuild on content change or label-set change; prompts are
            // tiny so a rescan per keystroke is negligible. Otherwise remap.
            if (tr.docChanged || tr.getMeta(VARIABLE_HIGHLIGHT_META)) {
              return buildDecorations(tr.doc, getLabels, getValueLabels)
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
