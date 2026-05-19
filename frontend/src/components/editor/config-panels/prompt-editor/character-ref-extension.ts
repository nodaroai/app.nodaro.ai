import { Node, mergeAttributes } from "@tiptap/core"
import { nodeInputRule, nodePasteRule } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { DEFAULT_USAGE_MODE, isUsageMode, type UsageMode } from "@nodaro/shared"
import { CharacterRefView } from "./character-ref-view"

export interface CharacterRefAttrs {
  characterSlug: string
  imageIndex: number
  variantSlug: string | null
  usageMode: UsageMode | null
}

/**
 * Slug shape (lower-case starts the character/variant; 2–4 colon-separated
 * segments). Mirrors the shape in `packages/shared/src/character-mention-slug.ts`
 * (`parseCharacterMentionToken` / `findCharacterMentionTokens`).
 *
 * Capture groups: 1=character, 2=imageIndex, 3=third (variant OR mode), 4=fourth (mode).
 *
 * NOTE: The pattern is anchored to a word-like boundary at the START
 * (`(?:^|[^a-zA-Z0-9])`) in the input/paste rules so emails / hashtag-ish
 * `foo@bar` are not promoted to pills. The capturing group still starts at
 * the `@`.
 */
const CHAR_REF_PATTERN_CORE = "(@[a-z][a-z0-9-]*):(\\d+)(?::([a-z][a-z0-9-]*))?(?::([a-z][a-z0-9-]*))?"

/**
 * Read the live character slug set from editor storage. Used by the
 * input/paste rules to only promote `@<slug>:N` to a pill when `<slug>` is
 * a known character wired into the consumer node. Without this storage
 * check, any `@kira:1`-shaped token would race the location extension's
 * rule (which uses the same shape for its 2-part canonical form) — with
 * this check, the character extension only matches known character slugs
 * and the location extension only matches known location slugs.
 *
 * The check is also the reason `@unknown:1` no longer eagerly promotes to
 * a broken character pill — slugs we don't recognize stay as literal text,
 * which is the correct fallback for the downstream resolver.
 */
function knownCharacterSlugs(extension: { editor: unknown }): Set<string> {
  const ed = extension.editor as
    | { storage?: Record<string, { referenceImages?: ReadonlyArray<{ characterSlug?: string }> }> }
    | undefined
  const list = ed?.storage?.characterRef?.referenceImages ?? []
  const out = new Set<string>()
  for (const r of list) {
    if (r.characterSlug) out.add(r.characterSlug)
  }
  return out
}

/**
 * Parse the four pattern groups (character with leading "@", indexStr, third, fourth)
 * into a complete attribute set. Disambiguates the 3rd/4th segment in the
 * 4-part form: third can be variant OR mode, fourth is always mode. Mirrors
 * `parseCharacterMentionToken` so the pills behave exactly like text-based
 * slugs at execution time.
 *
 * Returns null when the segments don't form a valid mention (e.g. a 3-part
 * token whose third segment isn't a usage mode and isn't a valid variant
 * slug, or a 4-part token whose final segment isn't a usage mode).
 */
function parseMatchAttrs(
  characterWithAt: string,
  indexStr: string,
  third: string | undefined,
  fourth: string | undefined,
): CharacterRefAttrs | null {
  const characterSlug = characterWithAt.slice(1) // drop leading "@"
  const imageIndex = parseInt(indexStr, 10)
  if (!Number.isInteger(imageIndex) || imageIndex < 1) return null

  // 2-part: @kira:1
  if (third === undefined && fourth === undefined) {
    return { characterSlug, imageIndex, variantSlug: null, usageMode: null }
  }
  // 3-part: @kira:1:X — X is mode OR variant.
  if (fourth === undefined && third !== undefined) {
    if (isUsageMode(third)) {
      return { characterSlug, imageIndex, variantSlug: null, usageMode: third }
    }
    // Plain variant slug (alpha-prefix already enforced by the regex).
    return { characterSlug, imageIndex, variantSlug: third, usageMode: null }
  }
  // 4-part: @kira:1:smile:mode — both must be set; final segment must be a
  // valid usage mode (matching parseCharacterMentionToken behavior).
  if (third !== undefined && fourth !== undefined) {
    if (!isUsageMode(fourth)) return null
    return { characterSlug, imageIndex, variantSlug: third, usageMode: fourth }
  }
  return null
}

/**
 * Inline atomic node that represents a `@character:N(:variant)(:mode)`
 * mention as a single pill. The pill is selectable as a unit (Backspace
 * deletes the whole pill); the cursor never enters it.
 *
 * Round-trip serialization is critical: `renderText` MUST emit the exact
 * literal slug so `editor.getText()` produces a string that the shared
 * `findCharacterMentionTokens` / `parseCharacterMentionToken` parser
 * recognizes verbatim. The pill is a pure visual layer — the canonical
 * representation downstream remains the text slug.
 */
export const CharacterRefExtension = Node.create({
  name: "characterRef",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      characterSlug: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-character-slug") ?? "",
        renderHTML: (attrs) => ({ "data-character-slug": String(attrs.characterSlug ?? "") }),
      },
      imageIndex: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute("data-image-index") ?? "1", 10),
        renderHTML: (attrs) => ({ "data-image-index": String(attrs.imageIndex ?? 1) }),
      },
      variantSlug: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-variant-slug") || null,
        renderHTML: (attrs) =>
          attrs.variantSlug
            ? { "data-variant-slug": String(attrs.variantSlug) }
            : {},
      },
      usageMode: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-usage-mode")
          return v && isUsageMode(v) ? v : null
        },
        renderHTML: (attrs) =>
          attrs.usageMode
            ? { "data-usage-mode": String(attrs.usageMode) }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-character-ref]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-character-ref": "" }),
    ]
  },

  /**
   * Plain-text serialization. The output here is what `editor.getText()`
   * returns for the pill, and it's what flows downstream into
   * `findCharacterMentionTokens` / the worker prompt. It MUST be byte-exact
   * with the user-typed slug shape.
   *
   * Mode emission rule mirrors index.tsx's insertion logic: the explicit
   * mode (4th segment) is included when it deviates from `DEFAULT_USAGE_MODE`
   * so the legacy 2/3-part form stays the default UX, but a pill that was
   * explicitly given `:identical` round-trips to `:identical` too — the user
   * picked it on purpose, we don't drop their choice silently.
   *
   * Decision: we ALWAYS emit the mode segment when `usageMode` is non-null
   * on the node. That matches the autocomplete's "explicit mode wins"
   * contract in index.tsx (line 147-152). Default-mode pills (mode === null)
   * stay clean.
   */
  renderText({ node }) {
    const a = node.attrs as CharacterRefAttrs
    const parts: string[] = [`@${a.characterSlug}:${a.imageIndex}`]
    if (a.variantSlug) parts.push(a.variantSlug)
    if (a.usageMode) parts.push(a.usageMode)
    return parts.join(":")
  },

  addNodeView() {
    return ReactNodeViewRenderer(CharacterRefView)
  },

  /**
   * Auto-promote a typed slug to a pill once the user types a trailing
   * boundary character (space or newline). Anchoring on the boundary keeps
   * the user able to keep typing the slug without it being eagerly snatched
   * away mid-word.
   *
   * The match's first regex group anchors the boundary (`(?:^|\s|[^a-zA-Z0-9])`),
   * and `nodeInputRule` uses `match[1]` to compute the actual slice that
   * becomes the node — so the boundary char is preserved.
   *
   * Conflict avoidance — the location extension's input rule (introduced
   * in slice 3 of Location Studio Phase 2 #2) matches the same 2-part
   * `@<slug>:N` shape. We gate this rule on the editor's known-character
   * slug set so character pills only auto-create for slugs that are
   * actually wired into the consumer node. The location rule applies the
   * mirrored gate against its own storage. Unknown slugs fall through to
   * literal text, matching the downstream resolver's literal-text
   * fallback.
   */
  addInputRules() {
    const self = this
    return [
      nodeInputRule({
        // Lowercase-only — uppercase slugs would not round-trip through the
        // shared `parseCharacterMentionToken` (which rejects any non-lowercase
        // character in the slug). Drop the `i` flag so we never promote a
        // typo like `@Kira:1` to a pill that the prompt-builder will then
        // silently ignore.
        find: new RegExp(`(${CHAR_REF_PATTERN_CORE})\\s$`),
        type: this.type,
        getAttributes: (match) => {
          // Capture indices: 0 full, 1 the slug (no trailing space),
          // 2 character w/ @, 3 indexStr, 4 third, 5 fourth.
          const characterWithAt = match[2]
          const indexStr = match[3]
          const third = match[4]
          const fourth = match[5]
          const attrs = parseMatchAttrs(characterWithAt, indexStr, third, fourth)
          // Returning false tells `nodeInputRule` to skip the rule — leaves
          // the typed text alone (e.g. a 3-part token whose 3rd segment is
          // neither a known usage mode nor a valid variant slug shape).
          if (!attrs) return false
          // Only auto-promote when the slug is known to the editor's
          // character storage. This is the surgical fix that lets the
          // location extension coexist on the same `@<slug>:N` shape.
          const known = knownCharacterSlugs(self)
          if (!known.has(attrs.characterSlug)) return false
          return attrs
        },
      }),
    ]
  },

  /**
   * Convert pasted text containing one or more slug literals into pills in
   * a single transaction. Pasting "see @kira:1:smile in pose @kira:2" should
   * land two pills with the surrounding text intact. Same known-slug gating
   * as `addInputRules` — see the comment there for why.
   */
  addPasteRules() {
    const self = this
    return [
      nodePasteRule({
        // See addInputRules — lowercase-only to keep the pill ↔ shared parser
        // round-trip lossless.
        find: new RegExp(CHAR_REF_PATTERN_CORE, "g"),
        type: this.type,
        getAttributes: (match) => {
          const characterWithAt = match[1]
          const indexStr = match[2]
          const third = match[3]
          const fourth = match[4]
          const attrs = parseMatchAttrs(characterWithAt, indexStr, third, fourth)
          if (!attrs) return false
          const known = knownCharacterSlugs(self)
          if (!known.has(attrs.characterSlug)) return false
          return attrs
        },
      }),
    ]
  },

  /** Storage holds the live reference-image list so the React node view can
   *  resolve `characterSlug + variantSlug` → thumbnail URL without prop
   *  drilling. Mirrors the `imageRef` storage pattern. */
  addStorage() {
    return {
      referenceImages: [] as Array<{
        url: string
        characterSlug?: string
        variantSlug?: string
        variantDisplayName?: string
        label?: string
      }>,
      // Bumped on every parent-driven storage update so node views can use it
      // as a `useMemo` / `useEffect` dependency to refresh thumbnails when the
      // upstream character list changes (new variants, swapped character).
      revision: 0,
    }
  },
})

// Re-exported for the parent editor's `valueToDoc` slug → node scanner so it
// uses the exact same shape as the input/paste rules. Lowercase-only — see
// addInputRules.
export const CHARACTER_REF_PARSE_PATTERN_GLOBAL = new RegExp(
  `(?:^|[^a-zA-Z0-9])${CHAR_REF_PATTERN_CORE}`,
  "g",
)

// Sole consumer of the parse helper outside the extension. Re-exported so
// the parent editor's `valueToDoc` shares the same disambiguation rules.
export function parseCharacterRefMatch(
  characterWithAt: string,
  indexStr: string,
  third: string | undefined,
  fourth: string | undefined,
): CharacterRefAttrs | null {
  return parseMatchAttrs(characterWithAt, indexStr, third, fourth)
}

// Re-export DEFAULT_USAGE_MODE / UsageMode so consumers don't need to dual-import.
export { DEFAULT_USAGE_MODE }
export type { UsageMode }
