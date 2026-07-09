"use client"

import { useEffect, useRef, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { createFloatingSuggestionRenderer } from "./floating-suggestion-renderer"
import { ImageRefExtension } from "./image-ref-extension"
import { VideoRefExtension, AudioRefExtension } from "./video-audio-ref-extension"
import { CharacterRefExtension, parseCharacterRefMatch } from "./character-ref-extension"
import { LocationRefExtension, parseLocationRefMatch } from "./location-ref-extension"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"
import { SuggestionList, type SuggestionCommandPayload } from "./suggestion-list"
import { buildRefPillNodes, nextMentionIndex } from "./build-ref-pill-nodes"
import { VariableSuggestionExtension } from "./variable-suggestion-extension"
import { VariableSuggestionList } from "./variable-suggestion-list"
import { VariableHighlightExtension, VARIABLE_HIGHLIGHT_META } from "./variable-highlight-extension"
import { SnippetSuggestionExtension } from "./snippet-suggestion-extension"
import { SnippetSuggestionList } from "./snippet-suggestion-list"
import { SnippetPillExtension } from "./snippet-pill-extension"
import { filterSnippets, computeSnippetInsertPrefix, type SnippetPoolItem } from "@/lib/snippet-pool"
import { matchSnippetRanges, type MatchableSnippet } from "@/lib/snippet-matching"
import { canonicalVarName } from "@nodaro/shared"
import type { RefImageItem } from "../tag-textarea"
import type { NodeRefItem } from "@/lib/node-refs"

const IMAGE_TOKEN_RE = /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

/**
 * `{video:N(:label)?}` / `{audio:N(:label)?}` scanners — byte-parallel to
 * `IMAGE_TOKEN_RE` (digit index + optional `[a-zA-Z0-9_-]` label, case-insensitive)
 * so the literal grammar matches the Task 5.1 `videoRef` / `audioRef` extension's
 * input/paste rules + `parseRefToken`. Used by `collectTokens` to promote
 * stored/typed tokens into pills on the `valueToDoc → setContent` path.
 */
const VIDEO_TOKEN_RE = /\{video:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi
const AUDIO_TOKEN_RE = /\{audio:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

/**
 * Slug shape — must mirror the input/paste-rule regex in
 * `character-ref-extension.ts` (and the shared
 * `findCharacterMentionTokens`). The capture-group layout is:
 *   1=boundary char (or empty when at line start, dropped before reinjection)
 *   2=character w/ leading "@"
 *   3=imageIndex
 *   4=third (variant OR mode)
 *   5=fourth (mode)
 *
 * The optional trailing `(?:~(?:no)?lock)?` absorbs the additive Task-4/F4
 * identity-lock sentinel (`~lock` force-on OR `~nolock` force-off) into the
 * match (the tri-state is read via `/~nolock$/` then `/~lock$/` on match[0]);
 * optional + non-capturing, so groups 1–5 and a lock-less token stay
 * byte-identical.
 */
const CHARACTER_TOKEN_RE_GLOBAL = /(^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*):(\d+)(?::([a-z][a-z0-9-]*))?(?::([a-z][a-z0-9-]*))?(?:~(?:no)?lock(?![a-z0-9-]))?/g

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
// The optional trailing `(?:~(?:no)?lock)?` is captured INSIDE group 2 (the
// token passed to `parseLocationRefMatch`, which strips it and surfaces the
// tri-state `lock`); optional, so a lock-less token stays byte-identical.
const LOCATION_TOKEN_RE_GLOBAL = new RegExp(
  `(^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\\d+(?::${LOCATION_TOKEN_SEGMENT})?(?::${LOCATION_TOKEN_SEGMENT})?(?:~(?:no)?lock(?![a-z0-9-]))?)`,
  "g",
)

interface PromptEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  /** Minimum visible height in lines (1 line = 1.5rem). With `maxRows`, the
   *  editor auto-grows from `rows` (min) and caps at `maxRows` (then scrolls). */
  readonly rows?: number
  /** Maximum visible height in lines. When set, the editor grows with content
   *  between `rows` and `maxRows`, then scrolls. Overrides `scrollable`'s
   *  fixed-height behavior. */
  readonly maxRows?: number
  readonly className?: string
  /** When true, clamps height to `rows * 1.5rem` and makes the content area
   *  scroll rather than grow. Use in fixed-height modal contexts. */
  readonly scrollable?: boolean
  readonly referenceImages?: readonly RefImageItem[]
  /** Upstream node references for the `{` typeahead. */
  readonly nodeRefs?: readonly NodeRefItem[]
  /** Label → current non-empty upstream output (buildNodeRefMap). Drives the
   *  {Label || default} active/dormant fallback styling; omit to suppress it. */
  readonly refMap?: ReadonlyMap<string, string>
  /** Merged snippet pool for THIS field (already target+media filtered).
   *  Omit/empty → the "/" menu renders nothing. See useSnippetPool(). */
  readonly snippets?: readonly SnippetPoolItem[]
  /** Fired when the editor gains focus (drives focus-gated nodrag inline). */
  readonly onFocus?: () => void
  /** Fired when the editor loses focus. */
  readonly onBlur?: () => void
  /** When true, drops the bordered/rounded/shadowed box chrome so the editor
   *  blends into its host surface (used by the inline canvas editor, where the
   *  node card already provides the panel). Default false = modal/panel box. */
  readonly bare?: boolean
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
  /** Snippets whose text gets promoted to display pills. */
  snippets: readonly MatchableSnippet[]
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

  // `{video:N(:label)?}` / `{audio:N(:label)?}` → atomic videoRef / audioRef
  // nodes. Byte-parallel to the imageRef block above; the attrs use the SAME
  // names the Task 5.1 extension declares (`refIndex` + `label`), so the
  // pill ↔ raw-text round trip stays lossless. These literal shapes can't
  // overlap an `{image:N}` or `@<slug>:N` span, so they never collide in the
  // dedup-by-offset pass below.
  for (const match of line.matchAll(VIDEO_TOKEN_RE)) {
    const start = match.index ?? 0
    tokens.push({
      start,
      end: start + match[0].length,
      node: {
        type: "videoRef",
        attrs: { refIndex: parseInt(match[1], 10), label: match[2] ?? "" },
      },
    })
  }
  for (const match of line.matchAll(AUDIO_TOKEN_RE)) {
    const start = match.index ?? 0
    tokens.push({
      start,
      end: start + match[0].length,
      node: {
        type: "audioRef",
        attrs: { refIndex: parseInt(match[1], 10), label: match[2] ?? "" },
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
    // Phase D legacy gate (mirrors the extension's input/paste rule): a
    // bare-slug ROLE token (`@old-library:1:background` or a custom
    // `@old-library:1:rooftop`, role set) is a HYBRID-only construct. In LEGACY
    // it stayed literal text pre-Phase-D, so the valueToDoc scanner must NOT
    // auto-promote it to a pill either — otherwise a saved legacy prompt would
    // flip text→pill on reload. HYBRID keeps promotion. NOT gated:
    // `parseLocationRefMatch` itself (existing pills still parse) — only this
    // promotion decision.
    if (attrs.role && IMAGE_REFERENCE_FORMAT !== "hybrid") continue
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
          // Carry the ROLE slug through (hybrid only reaches here): dropping it
          // would let `renderText` silently rewrite `@old-library:1:background`
          // → `@old-library:1` on the next edit. Matches the extension's
          // `parseMatchAttrs` / input-rule shape.
          role: attrs.role,
          // Per-mention tri-state lock (Task 4 + F4): HYBRID-only so a reloaded
          // legacy prompt never flips a pill's lock on/off. In legacy force
          // `undefined` (inert); in hybrid carry the parsed tri-state through
          // verbatim (undefined stays undefined — NOT coerced to false, which
          // would emit a spurious `~nolock`). Mirrors `resolvePromotableAttrs`.
          lock: IMAGE_REFERENCE_FORMAT === "hybrid" ? attrs.lock : undefined,
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
    // Per-mention tri-state lock (Task 4 + F4): read from the full match (which
    // now includes the sentinel) — `~nolock` → false, `~lock` → true, neither →
    // undefined. HYBRID-gated so a reloaded legacy prompt never flips a pill's
    // lock on/off. Mirrors the extension's input/paste `getAttributes`.
    const lock = IMAGE_REFERENCE_FORMAT === "hybrid"
      ? (/~nolock$/.test(match[0]) ? false : /~lock$/.test(match[0]) ? true : undefined)
      : undefined
    const attrs = parseCharacterRefMatch(characterWithAt, indexStr, third, fourth, lock)
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
          // Tri-state lock carried verbatim (undefined = inherit; NOT coerced to
          // false, which would emit a spurious `~nolock` on re-serialize).
          lock: attrs.lock,
        },
      },
    })
  }

  // Snippet display-pills: exact-text matches promote to snippetPill nodes.
  // Snippet texts can't contain `@`/`{`/`}` (guard-tested), so they can never
  // overlap a mention/image token span — `occupied` is belt-and-braces.
  const occupied = tokens.map((t) => ({ start: t.start, end: t.end }))
  for (const r of matchSnippetRanges(line, known.snippets, occupied)) {
    tokens.push({
      start: r.start,
      end: r.end,
      node: {
        type: "snippetPill",
        attrs: { snippetId: r.snippet.id, name: r.snippet.name, text: r.snippet.text },
      },
    })
  }

  // Sort by start offset (longest-first at equal starts so the longest
  // snippet/token wins the dedup below), then drop overlapping tokens
  // (location regex and character regex can match the same 2-part `@slug:N`
  // shape; the dedup here keeps whichever appeared first in the token list,
  // which by matchAll-ordering above is the location match).
  tokens.sort((a, b) => a.start - b.start || b.end - a.end)
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
function buildKnownSlugSets(
  refs: readonly RefImageItem[],
  snippets: readonly MatchableSnippet[],
): KnownSlugSets {
  const characters = new Set<string>()
  const locations = new Set<string>()
  for (const r of refs) {
    if (r.source === "character" && r.characterSlug) characters.add(r.characterSlug)
    else if (r.source === "location" && r.locationSlug) locations.add(r.locationSlug)
  }
  return { characters, locations, snippets }
}

/**
 * Shallow structural equality for two reference-image lists. `RefImageItem` is
 * a flat object of primitives, so a per-key shallow compare is exact. Used to
 * keep `referenceImages` content-stable inside PromptEditor — the parent often
 * hands us a freshly `.map()`-ed array on each keystroke even when nothing
 * changed, which would otherwise fire a redundant ProseMirror transaction (and
 * recompute the known-slug sets) on every key press.
 */
function refImagesEqual(
  a: readonly RefImageItem[],
  b: readonly RefImageItem[],
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as unknown as Record<string, unknown>
    const y = b[i] as unknown as Record<string, unknown>
    if (x === y) continue
    const xKeys = Object.keys(x)
    if (xKeys.length !== Object.keys(y).length) return false
    for (const k of xKeys) {
      if (x[k] !== y[k]) return false
    }
  }
  return true
}

/** Set equality for the resolvable-label sets (order-insensitive). null means
 *  "no nodeRefs prop" and only equals null. */
function labelSetsEqual(
  a: ReadonlySet<string> | null,
  b: ReadonlySet<string> | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.size !== b.size) return false
  for (const l of a) if (!b.has(l)) return false
  return true
}

/** Keep the previous reference while contents are equal. Render-phase ref
 *  mutation (not an effect) so the stabilized value is usable during the same
 *  render — the extension closures read `.current` at decoration-build time,
 *  including the very first build during editor creation. */
function useContentStable<T>(incoming: T, equal: (a: T, b: T) => boolean) {
  const ref = useRef(incoming)
  if (!equal(ref.current, incoming)) ref.current = incoming
  return ref
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows,
  maxRows,
  className,
  scrollable = false,
  referenceImages,
  nodeRefs,
  refMap,
  snippets,
  onFocus,
  onBlur,
  bare = false,
}: PromptEditorProps) {
  // Content-stabilize the incoming reference list. The parent config panels
  // build this via `.map()` inside a useMemo, so it can arrive as a fresh array
  // reference even when nothing changed (e.g. an unrelated keystroke). Reusing
  // the previous reference when the contents are structurally equal keeps the
  // refs-changed transaction below (and the known-slug memo) from firing every
  // keystroke.
  const stableRefsRef = useRef<readonly RefImageItem[]>(referenceImages ?? [])
  const incomingRefs = referenceImages ?? []
  if (!refImagesEqual(stableRefsRef.current, incomingRefs)) {
    stableRefsRef.current = incomingRefs
  }
  const stableReferenceImages = stableRefsRef.current

  // Content-stabilize the snippet pool the same way as the reference list: the
  // parent rebuilds it per render (useMemo over a query result), so it can be a
  // fresh array reference even when nothing meaningful changed. Compare on the
  // only fields the pill layer consumes (id/text/name) so the storage-mirror +
  // re-promotion effect below fires on pool load/CRUD, not every keystroke.
  const stableSnippetsRef = useRef<readonly SnippetPoolItem[]>(snippets ?? [])
  const incomingSnippets = snippets ?? []
  if (
    stableSnippetsRef.current.length !== incomingSnippets.length
    || stableSnippetsRef.current.some((s, i) =>
      s.id !== incomingSnippets[i].id || s.text !== incomingSnippets[i].text || s.name !== incomingSnippets[i].name)
  ) {
    stableSnippetsRef.current = incomingSnippets
  }
  const stableSnippets = stableSnippetsRef.current

  // Hold the latest reference list in a ref so the suggestion plugin's items()
  // closure (created once at editor mount) always sees fresh data.
  const refsRef = useRef<readonly RefImageItem[]>(stableReferenceImages)
  refsRef.current = stableReferenceImages
  const nodeRefsRef = useRef<readonly NodeRefItem[]>(nodeRefs ?? [])
  nodeRefsRef.current = nodeRefs ?? []
  // Latest snippet pool in a ref so the "/" Suggestion plugin's items()
  // closure (created once at editor mount) always sees fresh data — same
  // pattern as nodeRefsRef above.
  const snippetsRef = useRef<readonly SnippetPoolItem[]>(snippets ?? [])
  snippetsRef.current = snippets ?? []
  // Content-stable label sets for the variable-highlight plugin. Fresh Sets
  // are built per render (labels are few) but the previous reference is kept
  // while contents are equal, so the live-update effect below fires only on
  // real changes. null (prop absent) ≠ empty: it suppresses the corresponding
  // signal entirely — "no data" must never masquerade as a state.
  // resolvable = wired upstream labels (cyan/amber); value = labels whose
  // upstream currently produces a NON-EMPTY output (fallback active/dormant;
  // buildNodeRefMap only inserts non-empty outputs).
  const stableLabelsRef = useContentStable<ReadonlySet<string> | null>(
    nodeRefs ? new Set(nodeRefs.map((r) => canonicalVarName(r.label))) : null,
    labelSetsEqual,
  )
  const resolvableLabels = stableLabelsRef.current
  const stableValueLabelsRef = useContentStable<ReadonlySet<string> | null>(
    refMap ? new Set(refMap.keys()) : null,
    labelSetsEqual,
  )
  const valueLabels = stableValueLabelsRef.current
  // Known-slug sets derived from the current reference list. Recomputed when
  // the list changes; the suggestion-plugin's `items()` closure stays stable.
  const knownSlugsRef = useRef<KnownSlugSets>(buildKnownSlugSets(stableReferenceImages, stableSnippets))
  knownSlugsRef.current = useMemo(
    () => buildKnownSlugSets(stableReferenceImages, stableSnippets),
    [stableReferenceImages, stableSnippets],
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
      SnippetPillExtension,
      // Atomic `{video:N:label}` / `{audio:N:label}` pills (Task 5.1). Render +
      // round-trip only — their inherited Mention `@` suggestion plugin is
      // suppressed (addProseMirrorPlugins → []) so the single `@` typeahead
      // stays on ImageRefExtension below, which inserts these via its command
      // branches.
      VideoRefExtension,
      AudioRefExtension,
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
            const computeNextMentionIndex = (): number =>
              nextMentionIndex(ed.getText({ blockSeparator: "\n" }))

            // The per-source pill shape lives in the shared `buildRefPillNodes`
            // (single source of truth, also used by the thumbnail swap-picker),
            // so the `@`-insert and in-place swap can never drift. Character +
            // location mentions use the unified `@<slug>:N` counter; image /
            // video / audio use the item's positional `index` (handled inside
            // the builder). `insertContentAt(range, …)` replaces the `@query`
            // with the pill (+ trailing space) exactly as the prior per-branch
            // `deleteRange`/`insertContent` did.
            const needsMentionIndex =
              (item.source === "location" && !!item.locationSlug) ||
              (item.source === "character" && !!item.characterSlug)
            ed
              .chain()
              .focus()
              .insertContentAt(
                range,
                buildRefPillNodes(item, needsMentionIndex ? computeNextMentionIndex() : 0),
              )
              .run()
          },
          render: createFloatingSuggestionRenderer<{
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
          }>(280, (root, props, setKeyHandle) => {
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
                ref={(r) => setKeyHandle(r)}
                items={props.items}
                query={props.query}
                command={props.command}
                onDrillChange={clearFilter}
              />,
            )
          }) as never,
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
              .insertContentAt(range, `{${canonicalVarName(props.label)}} `)
              .run()
          },
          render: createFloatingSuggestionRenderer<{
            items: readonly NodeRefItem[]
            command: (item: NodeRefItem) => void
            clientRect?: (() => DOMRect | null) | null
          }>(280, (root, props, setKeyHandle) => {
            root.render(
              <VariableSuggestionList
                ref={(r) => setKeyHandle(r)}
                items={props.items}
                command={props.command}
              />,
            )
          }) as never,
        },
      }),
      SnippetSuggestionExtension.configure({
        suggestion: {
          char: "/",
          allowedPrefixes: [" "],
          items: ({ query }: { query: string }) =>
            filterSnippets(snippetsRef.current, query).slice(0, 50),
          command: ({ editor: ed, range, props }: { editor: typeof editor; range: { from: number; to: number }; props: SnippetPoolItem }) => {
            // Atomically replace "/query" with separator + snippetPill node + a
            // trailing space. The pill's renderText emits attrs.text verbatim, so
            // editor.getText() (the value persisted to node.data.prompt) is always
            // the plain fragment — the pill is a pure display layer.
            const prevChar = range.from > 1
              ? ed?.state.doc.textBetween(range.from - 1, range.from, "\n", "\n") ?? ""
              : ""
            const prefix = computeSnippetInsertPrefix(prevChar)
            ed
              ?.chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                ...(prefix ? [{ type: "text", text: prefix }] : []),
                { type: "snippetPill", attrs: { snippetId: props.id, name: props.name, text: props.text } },
                { type: "text", text: " " },
              ])
              .run()
          },
          render: createFloatingSuggestionRenderer<{
            items: readonly SnippetPoolItem[]
            command: (item: SnippetPoolItem) => void
            clientRect?: (() => DOMRect | null) | null
          }>(340, (root, props, setKeyHandle) => {
            root.render(
              <SnippetSuggestionList
                ref={(r) => setKeyHandle(r)}
                items={props.items}
                command={props.command}
              />,
            )
          }) as never,
        },
      }),
      VariableHighlightExtension.configure({
        getResolvableLabels: () => stableLabelsRef.current,
        getValueLabels: () => stableValueLabelsRef.current,
      }),
    ], []), // intentionally created once — dynamic data flows via storage + refs
    content: valueToDoc(value, knownSlugsRef.current),
    onUpdate: ({ editor: ed }) => {
      if (applyingExternalRef.current) return
      const text = ed.getText({ blockSeparator: "\n" })
      onChangeRef.current(text)
    },
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
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
    storage.imageRef.referenceImages = stableReferenceImages
    // Mirror the same list under the characterRef extension's storage so
    // CharacterRefView can resolve `(characterSlug, variantSlug)` without
    // round-tripping through the index — character pills survive slot
    // re-ordering that way (image-ref pills can't, since they're indexed
    // positionally by definition).
    storage.characterRef = storage.characterRef ?? {}
    storage.characterRef.referenceImages = stableReferenceImages
    storage.characterRef.revision = (storage.characterRef.revision ?? 0) + 1
    // Same mirror for the locationRef extension. LocationRefView filters
    // the shared list to entries with `source === "location"` when
    // resolving thumbnails; the extension's `getAttributes` filters to
    // known location slugs when deciding whether to auto-promote.
    storage.locationRef = storage.locationRef ?? {}
    storage.locationRef.referenceImages = stableReferenceImages
    storage.locationRef.revision = (storage.locationRef.revision ?? 0) + 1
    // Force node views to re-read storage by dispatching a no-op transaction.
    // Gated by `stableReferenceImages` so this only fires when the ref list
    // actually changes — not on every parent keystroke.
    editor.view.dispatch(editor.state.tr.setMeta("refs-changed", true))
  }, [editor, stableReferenceImages])

  // Push the live snippet pool into editor storage (the pill's swap menu reads
  // it) and re-promote plain text → pills when the pool changes (initial load,
  // CRUD). setContent resets the caret, so it only runs when a pool snippet's
  // text actually occurs in the current value — cheap includes() pre-check.
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage as unknown as Record<string, { snippets?: readonly SnippetPoolItem[]; revision?: number }>
    storage.snippetPill = storage.snippetPill ?? {}
    storage.snippetPill.snippets = stableSnippets
    storage.snippetPill.revision = (storage.snippetPill.revision ?? 0) + 1
    editor.view.dispatch(editor.state.tr.setMeta("refs-changed", true))

    const current = editor.getText({ blockSeparator: "\n" })
    if (current && stableSnippets.some((s) => s.text && current.includes(s.text))) {
      applyingExternalRef.current = true
      try {
        editor.commands.setContent(valueToDoc(current, knownSlugsRef.current), { emitUpdate: false })
      } finally {
        applyingExternalRef.current = false
      }
    }
  }, [editor, stableSnippets])

  // Rebuild variable decorations when the upstream label set OR the
  // non-empty-value set changes — wiring/unwiring flips cyan↔amber, and an
  // upstream value emptying/filling flips the fallback active↔dormant,
  // both without a remount.
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(VARIABLE_HIGHLIGHT_META, true))
  }, [editor, resolvableLabels, valueLabels])

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

  // Per-line height in rem. `bare` (inline canvas) renders at 18px with a 2rem
  // paragraph line-height (see globals.css), so its line unit is 2rem; the modal
  // /panel default is 1.5rem. Keeping these aligned makes rows/maxRows map to the
  // actual visible line count.
  const lineRem = bare ? 2 : 1.5
  const minHeight = rows ? `${rows * lineRem}rem` : undefined
  const maxHeight = maxRows ? `${maxRows * lineRem + 1.125}rem` : undefined
  // Auto-grow (maxRows) wins: content grows from `rows` (min, set on
  // EditorContent below) up to `maxRows` (the cap here), then scrolls. Else
  // `scrollable` pins a fixed `rows`-tall scroll area (modal). Else unbounded.
  const wrapperStyle = maxHeight
    ? { maxHeight, overflowY: "auto" as const }
    : scrollable && minHeight
      ? { maxHeight: `calc(${minHeight} + 1.125rem)`, overflowY: "auto" as const }
      : undefined

  const editorContent = (
    <EditorContent
      editor={editor}
      className="prompt-editor__content"
      style={{ minHeight }}
    />
  )

  // Inline canvas editor (bare + auto-grow): route scrolling through the SAME
  // Radix ScrollArea the text-prompt node uses, so the on-canvas prompt
  // scrollbar matches it EXACTLY in look AND behavior (hover-reveal, ~8px
  // rounded thumb, brighten on drag) regardless of the OS "show scroll bars"
  // setting. A native scrollbar can't match a DOM one — on macOS overlay mode
  // it's drawn by the OS and ignores most of our styling. The maxHeight goes on
  // the ScrollArea VIEWPORT (the scroller): the editor grows to it, then the
  // viewport scrolls. Boxed (config-panel/modal) usages keep the native overflow.
  const useScrollArea = bare && !!maxHeight

  return (
    <div
      className={`prompt-editor ${bare ? "prompt-editor--bare" : ""} bg-transparent text-sm transition-colors ${bare ? "" : "rounded-md border border-input shadow-xs"} ${className ?? ""}`}
      onClick={() => editor?.chain().focus().run()}
      // Scrollable (native path): cap the outer wrapper (border included). The inner
      // .prompt-editor__content has 1rem vertical padding; .ProseMirror
      // inherits `min-height` from its parent so it is always exactly
      // `rows*1.5rem` tall. Setting maxHeight here (border-box, no padding on
      // this element) to rows*1.5 + 1.125rem gives a content area of
      // rows*1.5 + 1rem — exactly ProseMirror's min-height + the 1rem padding,
      // leaving zero overflow and zero spurious scrollbar. The ScrollArea path
      // (inline) caps the viewport instead, so the wrapper stays unconstrained.
      style={useScrollArea ? undefined : wrapperStyle}
    >
      {useScrollArea ? (
        <ScrollArea className="w-full" viewportStyle={{ maxHeight }}>
          {editorContent}
        </ScrollArea>
      ) : (
        editorContent
      )}
    </div>
  )
}
