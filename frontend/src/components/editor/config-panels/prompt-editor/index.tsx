"use client"

import { useEffect, useRef, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { createRoot, type Root } from "react-dom/client"
import { ImageRefExtension } from "./image-ref-extension"
import { CharacterRefExtension, parseCharacterRefMatch } from "./character-ref-extension"
import { SuggestionList, type SuggestionListHandle, type SuggestionCommandPayload } from "./suggestion-list"
import { VariableSuggestionExtension } from "./variable-suggestion-extension"
import { VariableSuggestionList, type VariableSuggestionListHandle } from "./variable-suggestion-list"
import { DEFAULT_USAGE_MODE } from "@nodaro/shared"
import type { RefImageItem } from "../tag-textarea"
import type { NodeRefItem } from "@/lib/node-refs"

const IMAGE_TOKEN_RE = /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

/**
 * Slug shape — must mirror the input/paste-rule regex in
 * `character-ref-extension.ts` (and the shared
 * `findCharacterMentionTokens`). The capture-group layout is:
 *   1=boundary char (or empty when at line start, dropped before reinjection)
 *   2=character w/ leading "@"
 *   3=imageIndex
 *   4=third (variant OR mode)
 *   5=fourth (mode)
 */
const CHARACTER_TOKEN_RE_GLOBAL = /(^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*):(\d+)(?::([a-z][a-z0-9-]*))?(?::([a-z][a-z0-9-]*))?/g

interface PromptEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly className?: string
  readonly referenceImages?: readonly RefImageItem[]
  /** Upstream node references for the `{` typeahead. */
  readonly nodeRefs?: readonly NodeRefItem[]
}

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

interface TokenMatch {
  start: number
  end: number
  node: JsonNode
}

/**
 * Scan a single line for both `{image:N:label}` and `@<slug>:N(:variant)(:mode)`
 * tokens, returning the resolved JSON nodes ordered by their start offset.
 *
 * Character matches that fail `parseCharacterRefMatch` (e.g. a 3-part token
 * whose third segment is neither a usage mode nor a valid variant slug, or a
 * 4-part token with an unknown mode) are dropped from the token list and
 * left as text by the caller — same fallback the input/paste rules use.
 *
 * Returns matches in document order; the caller stitches in plain-text
 * fragments between them.
 */
function collectTokens(line: string): TokenMatch[] {
  const tokens: TokenMatch[] = []

  for (const match of line.matchAll(IMAGE_TOKEN_RE)) {
    const start = match.index ?? 0
    tokens.push({
      start,
      end: start + match[0].length,
      node: {
        type: "imageRef",
        attrs: {
          imageIndex: parseInt(match[1], 10),
          label: match[2] ?? "",
        },
      },
    })
  }

  for (const match of line.matchAll(CHARACTER_TOKEN_RE_GLOBAL)) {
    const matchStart = match.index ?? 0
    const boundary = match[1] ?? ""
    // Slug starts after the boundary character (when present). The boundary
    // is left in-place as plain text — it belongs to the surrounding sentence.
    const slugStart = matchStart + boundary.length
    const slugEnd = matchStart + match[0].length
    const characterWithAt = match[2]
    const indexStr = match[3]
    const third = match[4]
    const fourth = match[5]
    const attrs = parseCharacterRefMatch(characterWithAt, indexStr, third, fourth)
    if (!attrs) continue
    tokens.push({
      start: slugStart,
      end: slugEnd,
      node: {
        type: "characterRef",
        attrs: {
          characterSlug: attrs.characterSlug,
          imageIndex: attrs.imageIndex,
          variantSlug: attrs.variantSlug,
          usageMode: attrs.usageMode,
        },
      },
    })
  }

  // Sort by start offset. Token regions can't legitimately overlap since
  // `{image:…}` lives between braces and `@…` starts with `@`, but in the
  // event of weird user input (e.g. a literal `@kira:1` inside an image
  // token's label like `{image:1:@kira}`) we drop later overlapping tokens
  // to keep the doc well-formed.
  tokens.sort((a, b) => a.start - b.start)
  const deduped: TokenMatch[] = []
  let cursor = 0
  for (const t of tokens) {
    if (t.start < cursor) continue
    deduped.push(t)
    cursor = t.end
  }
  return deduped
}

/**
 * Convert the canonical value string into a ProseMirror JSON doc. Splits on
 * "\n" for paragraphs and replaces every `{image:N:label}` and every
 * `@<slug>:N(:variant)(:mode)` match with the appropriate atomic node.
 * Empty paragraphs are preserved so blank lines round-trip cleanly.
 */
function valueToDoc(value: string): JsonNode {
  const lines = value.split("\n")
  const paragraphs: JsonNode[] = lines.map((line) => {
    const tokens = collectTokens(line)
    if (tokens.length === 0) {
      return {
        type: "paragraph",
        content: line.length > 0 ? [{ type: "text", text: line }] : undefined,
      }
    }
    const content: JsonNode[] = []
    let lastIndex = 0
    for (const tok of tokens) {
      if (tok.start > lastIndex) {
        content.push({ type: "text", text: line.slice(lastIndex, tok.start) })
      }
      content.push(tok.node)
      lastIndex = tok.end
    }
    if (lastIndex < line.length) {
      content.push({ type: "text", text: line.slice(lastIndex) })
    }
    return { type: "paragraph", content: content.length > 0 ? content : undefined }
  })
  return { type: "doc", content: paragraphs }
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows,
  className,
  referenceImages,
  nodeRefs,
}: PromptEditorProps) {
  // Hold the latest reference list in a ref so the suggestion plugin's items()
  // closure (created once at editor mount) always sees fresh data.
  const refsRef = useRef<readonly RefImageItem[]>(referenceImages ?? [])
  refsRef.current = referenceImages ?? []
  const nodeRefsRef = useRef<readonly NodeRefItem[]>(nodeRefs ?? [])
  nodeRefsRef.current = nodeRefs ?? []

  // Hold the latest onChange so we can call it without recreating the editor.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Track whether a programmatic content sync is in progress, so the editor's
  // onUpdate doesn't bounce that change back to the parent.
  const applyingExternalRef = useRef(false)

  const editor = useEditor({
    extensions: useMemo(() => [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      CharacterRefExtension,
      ImageRefExtension.configure({
        suggestion: {
          char: "@",
          // Return the FULL unfiltered set — the SuggestionList applies both
          // its hierarchical (drill-in) grouping AND the query-based filter
          // itself. Returning early-filtered items here would hide the right
          // character's variants when the user types something that matches
          // only the root character label.
          items: () => Array.from(refsRef.current),
          command: ({ editor: ed, range, props }) => {
            const item = props as unknown as SuggestionCommandPayload
            // Character refs: insert as an atomic `characterRef` TipTap node
            // (rendered as a violet pill with thumbnail). The pill's
            // `renderText` serializes back to the literal
            // `@<slug>:N(:<variant>)(:<mode>)` format that
            // `findCharacterMentionTokens` (shared) recognizes — so the visual
            // pill is a pure presentation layer and the downstream
            // prompt-builder sees the exact same text it would have seen for
            // a hand-typed slug.
            //
            // The numeric index N is computed at insertion time by scanning the
            // editor's current text (which includes round-tripped pills) for
            // existing `@<char>:<N>` patterns and using max-N + 1. This keeps
            // the user-typed slug and the final identity-directive block
            // (`Image N (Name) — match exactly…`) in lock-step.
            //
            // Non-character refs continue to use the existing TipTap `imageRef`
            // atomic node so the visual pill + `{image:N:label}` round-trip
            // behavior is preserved.
            if (item.source === "character" && item.characterSlug) {
              // Scan editor's plain-text content for existing
              // `@<char>:<N>(:<variant|mode>)?(:<mode>)?` tokens (2–4 part form).
              // Use max + 1 as the next index. Mirrors `computeNextMentionIndex`
              // in `tag-textarea.tsx` and the regex shape in `character-mention-slug.ts`.
              //
              // `editor.getText` invokes our extension's `renderText` for every
              // characterRef pill, so existing pills round-trip back to their
              // literal slug here and are counted alongside any raw-text
              // mentions the user may have pasted.
              const currentText = ed.getText({ blockSeparator: "\n" })
              const regex = /(?:^|[^a-zA-Z0-9])@[a-z][a-z0-9-]*:(\d+)(?::[a-z][a-z0-9-]*)?(?::[a-z][a-z0-9-]*)?/g
              let maxIdx = 0
              for (const match of currentText.matchAll(regex)) {
                const n = parseInt(match[1], 10)
                if (Number.isInteger(n) && n > maxIdx) maxIdx = n
              }
              const nextIdx = maxIdx + 1
              // Mode resolution priority:
              //   1. `item.usageMode` — set by the 3rd-level mode-picker drill;
              //      ALWAYS emitted as the 4th slug segment (even when equal to
              //      the default) so the user's explicit choice round-trips.
              //   2. character node's `defaultUsageMode` — emitted only when
              //      non-default. Keeps the common case (`identical`) clean as
              //      the legacy 2/3-part form. Casual users never see the
              //      4-part syntax unless they intentionally pick a mode or
              //      configured a non-default default on the source node.
              //
              // The resolved `modeForNode` is what we stash on the
              // characterRef node's `usageMode` attribute. The extension's
              // `renderText` only emits a 4th segment when `usageMode` is
              // non-null, so passing `null` here keeps the pill clean and
              // defers mode resolution to the character node at runtime.
              const explicitMode = item.usageMode
              const defaultMode = item.defaultUsageMode
              const includeMode = explicitMode != null
                ? true
                : defaultMode != null && defaultMode !== DEFAULT_USAGE_MODE
              const modeForNode = includeMode ? (explicitMode ?? defaultMode ?? null) : null
              ed
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  {
                    type: "characterRef",
                    attrs: {
                      characterSlug: item.characterSlug,
                      imageIndex: nextIdx,
                      variantSlug: item.variantSlug ?? null,
                      usageMode: modeForNode,
                    },
                  },
                  // Trailing space — matches the legacy plain-text insertion
                  // so the cursor lands ready for the user to keep typing.
                  { type: "text", text: " " },
                ])
                .run()
              return
            }
            // Non-character ref: keep the existing atomic `imageRef` node.
            ed
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: "imageRef",
                  attrs: { imageIndex: item.index, label: item.defaultLabel },
                },
                { type: "text", text: " " },
              ])
              .run()
          },
          render: () => {
            let mount: HTMLDivElement | null = null
            let root: Root | null = null
            let listRef: SuggestionListHandle | null = null

            const positionMount = (rect: DOMRect | null | undefined) => {
              if (!mount || !rect) return
              const MARGIN = 4
              const vh = window.innerHeight
              const vw = window.innerWidth
              // Should track the SuggestionList's `max-h` clamp (300px) so
              // the flip-above decision uses the actual rendered height.
              const ESTIMATED_H = 300
              const ESTIMATED_W = 280
              const spaceBelow = vh - rect.bottom - MARGIN
              const placeBelow = spaceBelow >= 160 || spaceBelow >= rect.top
              const top = placeBelow
                ? rect.bottom + MARGIN
                : Math.max(MARGIN, rect.top - ESTIMATED_H - MARGIN)
              const left = Math.min(
                Math.max(MARGIN, rect.left),
                vw - ESTIMATED_W - MARGIN,
              )
              mount.style.top = `${top}px`
              mount.style.left = `${left}px`
            }

            const renderList = (props: {
              items: readonly RefImageItem[]
              query: string
              // TipTap's mention extension passes whatever object the list
              // returns straight through to the configured `command`. The
              // 3rd-level drill (mode picker) attaches an optional `usageMode`
              // sidecar before firing — see `SuggestionCommandPayload`.
              command: (item: SuggestionCommandPayload) => void
              clientRect?: (() => DOMRect | null) | null
              editor: ReturnType<typeof useEditor>
              range: { from: number; to: number }
            }) => {
              if (!root) return
              positionMount(props.clientRect?.() ?? null)
              // Clear the typed filter text between the `@` and the cursor.
              // Used when the list pushes/pops the drill so the new view starts
              // with an empty filter (mirrors `TagTextarea`'s drill UX).
              const clearFilter = () => {
                const ed = props.editor
                if (!ed) return
                // Keep the `@` (range.from points at it) — delete from
                // range.from + 1 to range.to.
                const start = props.range.from + 1
                const end = props.range.to
                if (end <= start) return
                ed.chain().focus().deleteRange({ from: start, to: end }).run()
              }
              root.render(
                <SuggestionList
                  ref={(r) => { listRef = r }}
                  items={props.items}
                  query={props.query}
                  command={props.command}
                  onDrillChange={clearFilter}
                />,
              )
            }

            return {
              onStart: (props) => {
                mount = document.createElement("div")
                mount.style.position = "fixed"
                mount.style.zIndex = "9999"
                document.body.appendChild(mount)
                root = createRoot(mount)
                renderList(props as never)
              },
              onUpdate: (props) => renderList(props as never),
              onKeyDown: (props) => listRef?.onKeyDown(props.event) ?? false,
              onExit: () => {
                if (root) {
                  // Defer to avoid React's "unmount during render" warning.
                  const r = root
                  root = null
                  setTimeout(() => r.unmount(), 0)
                }
                if (mount) {
                  const m = mount
                  mount = null
                  setTimeout(() => m.remove(), 0)
                }
                listRef = null
              },
            }
          },
        },
      }),
      VariableSuggestionExtension.configure({
        suggestion: {
          char: "{",
          items: ({ query }: { query: string }) => {
            const all = nodeRefsRef.current
            if (!query) return all.slice(0, 30)
            const q = query.toLowerCase()
            return all
              .filter((r) => r.label.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
              .slice(0, 30)
          },
          command: ({ editor: ed, range, props }: { editor: typeof editor; range: { from: number; to: number }; props: NodeRefItem }) => {
            // Insert literal text `{Label}` followed by a space — variables stay
            // as plain text in the editor; the runtime resolves them.
            ed
              ?.chain()
              .focus()
              .insertContentAt(range, `{${props.label}} `)
              .run()
          },
          render: () => {
            let mount: HTMLDivElement | null = null
            let root: Root | null = null
            let listRef: VariableSuggestionListHandle | null = null

            const positionMount = (rect: DOMRect | null | undefined) => {
              if (!mount || !rect) return
              const MARGIN = 4
              const vh = window.innerHeight
              const vw = window.innerWidth
              // Should track the SuggestionList's `max-h` clamp (300px) so
              // the flip-above decision uses the actual rendered height.
              const ESTIMATED_H = 300
              const ESTIMATED_W = 280
              const spaceBelow = vh - rect.bottom - MARGIN
              const placeBelow = spaceBelow >= 160 || spaceBelow >= rect.top
              const top = placeBelow
                ? rect.bottom + MARGIN
                : Math.max(MARGIN, rect.top - ESTIMATED_H - MARGIN)
              const left = Math.min(
                Math.max(MARGIN, rect.left),
                vw - ESTIMATED_W - MARGIN,
              )
              mount.style.top = `${top}px`
              mount.style.left = `${left}px`
            }

            const renderList = (props: {
              items: readonly NodeRefItem[]
              command: (item: NodeRefItem) => void
              clientRect?: (() => DOMRect | null) | null
            }) => {
              if (!root) return
              positionMount(props.clientRect?.() ?? null)
              root.render(
                <VariableSuggestionList
                  ref={(r) => { listRef = r }}
                  items={props.items}
                  command={props.command}
                />,
              )
            }

            return {
              onStart: (props: never) => {
                mount = document.createElement("div")
                mount.style.position = "fixed"
                mount.style.zIndex = "9999"
                document.body.appendChild(mount)
                root = createRoot(mount)
                renderList(props as never)
              },
              onUpdate: (props: never) => renderList(props as never),
              onKeyDown: (props: { event: KeyboardEvent }) => listRef?.onKeyDown(props.event) ?? false,
              onExit: () => {
                if (root) {
                  const r = root
                  root = null
                  setTimeout(() => r.unmount(), 0)
                }
                if (mount) {
                  const m = mount
                  mount = null
                  setTimeout(() => m.remove(), 0)
                }
                listRef = null
              },
            }
          },
        },
      }),
    ], []), // intentionally created once — dynamic data flows via storage + refs
    content: valueToDoc(value),
    onUpdate: ({ editor: ed }) => {
      if (applyingExternalRef.current) return
      const text = ed.getText({ blockSeparator: "\n" })
      onChangeRef.current(text)
    },
  })

  // Push the latest reference list into editor storage so the React node
  // views can resolve their attribute keys → URL without prop drilling.
  //
  // The `imageRef` storage indexes by `imageIndex` (1-based slot the user
  // typed in the `@image:N` token), the `characterRef` storage indexes by
  // `characterSlug + variantSlug` (so a pill can find its thumbnail even
  // when the slot order shifts on edge insertion / removal).
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage as unknown as Record<string, {
      referenceImages?: readonly RefImageItem[]
      revision?: number
    }>
    storage.imageRef = storage.imageRef ?? {}
    storage.imageRef.referenceImages = referenceImages ?? []
    // Mirror the same list under the characterRef extension's storage so
    // CharacterRefView can resolve `(characterSlug, variantSlug)` without
    // round-tripping through the index — character pills survive slot
    // re-ordering that way (image-ref pills can't, since they're indexed
    // positionally by definition).
    storage.characterRef = storage.characterRef ?? {}
    storage.characterRef.referenceImages = referenceImages ?? []
    storage.characterRef.revision = (storage.characterRef.revision ?? 0) + 1
    // Force node views to re-read storage by dispatching a no-op transaction.
    editor.view.dispatch(editor.state.tr.setMeta("refs-changed", true))
  }, [editor, referenceImages])

  // Sync external value → editor when the prop changes from somewhere other
  // than this editor. Compare against the editor's serialized text to avoid
  // clobbering the cursor on every keystroke.
  useEffect(() => {
    if (!editor) return
    const current = editor.getText({ blockSeparator: "\n" })
    if (current === value) return
    applyingExternalRef.current = true
    try {
      editor.commands.setContent(valueToDoc(value), { emitUpdate: false })
    } finally {
      applyingExternalRef.current = false
    }
  }, [editor, value])

  const minHeight = rows ? `${rows * 1.5}rem` : undefined

  return (
    <div
      className={`prompt-editor rounded-md border border-input bg-transparent text-sm shadow-xs transition-colors ${className ?? ""}`}
      onClick={() => editor?.chain().focus().run()}
    >
      <EditorContent
        editor={editor}
        className="prompt-editor__content"
        style={{ minHeight }}
      />
    </div>
  )
}
