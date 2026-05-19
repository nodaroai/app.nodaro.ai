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
import { LocationRefExtension, parseLocationRefMatch } from "./location-ref-extension"
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

/**
 * Location token shape — wider than character because the 3rd/4th segment
 * can be either a bare slug (mode keyword) or a `bucket/variant` pair
 * (slash-separated). Captured as ONE group (after the boundary) so
 * `parseLocationRefMatch` can do disambiguation in one pass.
 *
 * Capture groups:
 *   1 = boundary char (or empty when at line start, dropped before reinjection)
 *   2 = the FULL token starting with `@` (passed to `parseLocationRefMatch`)
 *
 * Mirrors the shape in `packages/shared/src/location-mention-slug.ts`
 * (`findLocationMentionTokens`) so the visual pill is a pure presentation
 * layer and downstream prompt-builder code sees the exact same text it
 * would have seen for a hand-typed slug.
 */
const LOCATION_TOKEN_SEGMENT = "(?:[a-z][a-z0-9-]*\\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)"
const LOCATION_TOKEN_RE_GLOBAL = new RegExp(
  `(^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\\d+(?::${LOCATION_TOKEN_SEGMENT})?(?::${LOCATION_TOKEN_SEGMENT})?)`,
  "g",
)

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

export interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

export interface TokenMatch {
  start: number
  end: number
  node: JsonNode
}

export interface KnownSlugSets {
  /** Character slugs known to this editor (from upstream wired characters). */
  characters: ReadonlySet<string>
  /** Location slugs known to this editor (from upstream wired locations). */
  locations: ReadonlySet<string>
}

/**
 * Scan a single line for `{image:N:label}`, `@<charSlug>:N(:variant)(:mode)`,
 * and `@<locSlug>:N(:bucket/variant)(:mode)` tokens, returning the resolved
 * JSON nodes ordered by their start offset.
 *
 * Dispatch is gated by `known.characters` / `known.locations`. A typed slug
 * is promoted to a pill only when it matches a slug wired into the consumer
 * node — otherwise it stays as plain text. This is the same gating the
 * input/paste rules apply (via editor storage), kept in lockstep here so the
 * `valueToDoc → setContent` path doesn't auto-promote a stale or unknown
 * slug that the rule would have left alone.
 *
 * Both regexes can match the same 2-part `@slug:N` shape. Disambiguation:
 * the LOCATION regex is checked first against `known.locations`; if found,
 * a `locationRef` node is emitted. Otherwise, the CHARACTER regex is
 * checked against `known.characters`; if found, a `characterRef` node is
 * emitted. Tokens that match neither known set fall through to text. The
 * dedup-by-offset step at the end guarantees we never emit two nodes for
 * the same span.
 *
 * Returns matches in document order; the caller stitches in plain-text
 * fragments between them.
 */
export function collectTokens(line: string, known: KnownSlugSets): TokenMatch[] {
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

  // Location matches first — the location regex is a strict superset of the
  // character regex shape (it permits the `bucket/variant` slash form). We
  // gate on `known.locations` so a typed `@kira:1` doesn't accidentally
  // promote to a location pill when "kira" is a character.
  for (const match of line.matchAll(LOCATION_TOKEN_RE_GLOBAL)) {
    const matchStart = match.index ?? 0
    const boundary = match[1] ?? ""
    const slugStart = matchStart + boundary.length
    const slugEnd = matchStart + match[0].length
    const token = match[2]
    const attrs = parseLocationRefMatch(token)
    if (!attrs) continue
    if (!known.locations.has(attrs.locationSlug)) continue
    tokens.push({
      start: slugStart,
      end: slugEnd,
      node: {
        type: "locationRef",
        attrs: {
          locationSlug: attrs.locationSlug,
          imageIndex: attrs.imageIndex,
          bucket: attrs.bucket,
          variant: attrs.variant,
          usageMode: attrs.usageMode,
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
    if (!known.characters.has(attrs.characterSlug)) continue
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

  // Sort by start offset, then drop overlapping tokens (location regex and
  // character regex can match the same 2-part `@slug:N` shape; the dedup
  // here keeps whichever appeared first in the token list, which by
  // matchAll-ordering above is the location match).
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
 * `@<slug>:N(...)` match with the appropriate atomic node. Empty paragraphs
 * are preserved so blank lines round-trip cleanly.
 *
 * `known` controls which slugs get promoted to pills. Slugs not present in
 * either set stay as literal text — same fallback as the live input/paste
 * rules so the value-sync path doesn't auto-promote slugs the user hasn't
 * wired in.
 */
function valueToDoc(value: string, known: KnownSlugSets): JsonNode {
  const lines = value.split("\n")
  const paragraphs: JsonNode[] = lines.map((line) => {
    const tokens = collectTokens(line, known)
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

/**
 * Build the live known-slug sets from the current reference list. Used by
 * `valueToDoc` (initial content + external sync) and the character/location
 * extensions (via storage) to decide which typed slugs get promoted to
 * pills.
 */
function buildKnownSlugSets(refs: readonly RefImageItem[]): KnownSlugSets {
  const characters = new Set<string>()
  const locations = new Set<string>()
  for (const r of refs) {
    if (r.source === "character" && r.characterSlug) characters.add(r.characterSlug)
    else if (r.source === "location" && r.locationSlug) locations.add(r.locationSlug)
  }
  return { characters, locations }
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
  // Known-slug sets derived from the current reference list. Recomputed when
  // the list changes; the suggestion-plugin's `items()` closure stays stable.
  const knownSlugsRef = useRef<KnownSlugSets>(buildKnownSlugSets(referenceImages ?? []))
  knownSlugsRef.current = useMemo(
    () => buildKnownSlugSets(referenceImages ?? []),
    [referenceImages],
  )

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
      LocationRefExtension,
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
            // Compute the next mention index by scanning the editor's
            // current plain-text content for ANY existing `@<slug>:N` token —
            // characters AND locations share a unified positional counter
            // so `@kira:1` and `@oldlibrary:2` coexist in one prompt without
            // collision. `editor.getText` round-trips every existing pill
            // back through its `renderText` so raw-text and pill mentions
            // are counted together.
            //
            // The shape on the right matches the LOCATION grammar (a strict
            // superset of the CHARACTER grammar — each optional segment can
            // be either a plain slug OR a `bucket/variant` pair).
            const computeNextMentionIndex = (): number => {
              const currentText = ed.getText({ blockSeparator: "\n" })
              const seg = "(?:[a-z][a-z0-9-]*\\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)"
              const regex = new RegExp(
                `(?:^|[^a-zA-Z0-9])@[a-z][a-z0-9-]*:(\\d+)(?::${seg})?(?::${seg})?`,
                "g",
              )
              let maxIdx = 0
              for (const match of currentText.matchAll(regex)) {
                const n = parseInt(match[1], 10)
                if (Number.isInteger(n) && n > maxIdx) maxIdx = n
              }
              return maxIdx + 1
            }

            // Location refs: insert as an atomic `locationRef` TipTap node
            // (rendered as a cyan pill with thumbnail). The pill's
            // `renderText` serializes back to the literal
            // `@<slug>:N(:<bucket>/<variant>)?(:<mode>)?` format that
            // `findLocationMentionTokens` (shared) recognizes — so the
            // visual pill is a pure presentation layer and the downstream
            // prompt-builder sees the exact same text it would have seen
            // for a hand-typed slug.
            if (item.source === "location" && item.locationSlug) {
              const nextIdx = computeNextMentionIndex()
              const bucket = item.locationVariantBucket ?? null
              const variant = item.locationVariantSlug ?? null
              // Slice 3 MVP: no mode-picker drill yet (slice 4 work), so we
              // always insert without a usage mode override. The runtime
              // path falls back to the location node's default mode (or the
              // global "identical") when resolving the slug.
              ed
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  {
                    type: "locationRef",
                    attrs: {
                      locationSlug: item.locationSlug,
                      imageIndex: nextIdx,
                      bucket,
                      variant,
                      usageMode: null,
                    },
                  },
                  // Trailing space — matches the character path so the
                  // cursor lands ready for the user to keep typing.
                  { type: "text", text: " " },
                ])
                .run()
              return
            }
            // Character refs: insert as an atomic `characterRef` TipTap node
            // (rendered as a violet pill with thumbnail). The pill's
            // `renderText` serializes back to the literal
            // `@<slug>:N(:<variant>)(:<mode>)` format that
            // `findCharacterMentionTokens` (shared) recognizes — so the visual
            // pill is a pure presentation layer and the downstream
            // prompt-builder sees the exact same text it would have seen for
            // a hand-typed slug.
            //
            // Non-character refs continue to use the existing TipTap `imageRef`
            // atomic node so the visual pill + `{image:N:label}` round-trip
            // behavior is preserved.
            if (item.source === "character" && item.characterSlug) {
              const nextIdx = computeNextMentionIndex()
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
            // Non-character/non-location ref: keep the existing atomic
            // `imageRef` node.
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
    content: valueToDoc(value, knownSlugsRef.current),
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
  // typed in the `@image:N` token); the `characterRef` storage indexes by
  // `characterSlug + variantSlug`; the `locationRef` storage indexes by
  // `locationSlug + locationVariantBucket + locationVariantSlug`. Each
  // extension reads its own storage and filters to its own ref kind — the
  // single source list flows into all three.
  //
  // Storage is also what the character/location extensions' input-rule
  // `getAttributes` calls read to decide which `@<slug>:N` shapes should
  // auto-promote to pills. Without this, any typed `@<slug>:N` would race
  // both rules; with this, character-only slugs auto-promote to violet
  // pills and location-only slugs auto-promote to cyan pills.
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
    // Same mirror for the locationRef extension. LocationRefView filters
    // the shared list to entries with `source === "location"` when
    // resolving thumbnails; the extension's `getAttributes` filters to
    // known location slugs when deciding whether to auto-promote.
    storage.locationRef = storage.locationRef ?? {}
    storage.locationRef.referenceImages = referenceImages ?? []
    storage.locationRef.revision = (storage.locationRef.revision ?? 0) + 1
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
      editor.commands.setContent(valueToDoc(value, knownSlugsRef.current), { emitUpdate: false })
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
