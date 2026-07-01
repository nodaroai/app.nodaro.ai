import { Node, mergeAttributes } from "@tiptap/core"
import { nodeInputRule, nodePasteRule } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import {
  DEFAULT_LOCATION_USAGE_MODE,
  isLocationUsageMode,
  parseLocationMentionToken,
  type LocationUsageMode,
} from "@nodaro/shared"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"
import { LocationRefView } from "./location-ref-view"

export interface LocationRefAttrs {
  locationSlug: string
  imageIndex: number
  bucket: string | null
  variant: string | null
  usageMode: LocationUsageMode | null
  /** Bare-slug ROLE (Unified Reference Roles, Phase D) — a known location role
   *  (`background`, `empty-background`, `as-is`, …) in slug form, mutually
   *  exclusive with `bucket`/`variant`. null for canonical / bucket-variant /
   *  mode pills. Round-trips through `renderText` as the 3rd segment so the
   *  downstream shared parser sees the exact hand-typed token. */
  role: string | null
  /** Per-mention identity-lock (Unified Reference Roles, Task 4). When true the
   *  pill serializes a trailing `~lock` sentinel that the HYBRID location
   *  resolver turns into a per-reference lock line. HYBRID-only (legacy strips
   *  it on promotion). Optional so a lock-less parse stays byte-identical. */
  lock?: boolean
}

/**
 * Location `@-mention` token shape — captured as ONE group for the input/paste
 * rules because the location token grammar (`@<slug>:N(:bucket/variant|mode)?(:mode)?`)
 * doesn't fit cleanly into per-segment capture groups: the 3rd segment is
 * either a `bucket/variant` pair (slash-separated) or a bare mode keyword,
 * and disambiguation is done by `parseLocationMentionToken` from `@nodaro/shared`.
 *
 * Each segment after the index is either a plain slug (`[a-z][a-z0-9-]*`) or a
 * bucket/variant pair (`[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*`) — the two are
 * disjoint at the regex level (the slash is the discriminator).
 *
 * Match groups:
 *   1 = the FULL token (passed straight to `parseLocationMentionToken`)
 *
 * Mirrors the shape in `packages/shared/src/location-mention-slug.ts`
 * (`findLocationMentionTokens`) so the visual pill is a pure presentation
 * layer and downstream prompt-builder code sees the exact same text it would
 * have seen for a hand-typed slug.
 */
const LOCATION_REF_SEGMENT = "(?:[a-z][a-z0-9-]*\\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)"
// The optional trailing `(?:~lock)?` absorbs the additive Task-4 identity-lock
// sentinel INTO the single captured token (passed whole to
// `parseLocationMentionToken`, which strips it); optional, so a lock-less token
// matches byte-identically.
const LOCATION_REF_PATTERN_CORE =
  `(@[a-z][a-z0-9-]*:\\d+(?::${LOCATION_REF_SEGMENT})?(?::${LOCATION_REF_SEGMENT})?(?:~lock(?![a-z0-9-]))?)`

/**
 * Parse the captured token into a complete attribute set. Delegates to the
 * shared `parseLocationMentionToken` so the pills behave exactly like
 * text-based slugs at execution time. Returns null when the token doesn't
 * match any supported shape (caller leaves the typed text alone, mirroring
 * the resolver's literal-text fallback).
 */
function parseMatchAttrs(token: string): LocationRefAttrs | null {
  const parsed = parseLocationMentionToken(token)
  if (!parsed) return null
  return {
    locationSlug: parsed.locationSlug,
    imageIndex: parsed.imageIndex,
    bucket: parsed.bucket,
    variant: parsed.variant,
    usageMode: parsed.usageMode,
    role: parsed.role ?? null,
    // Additive `~lock` (Task 4): only present when true so a lock-less parse
    // stays byte-identical to the pre-Task-4 attr shape.
    ...(parsed.lock ? { lock: true } : {}),
  }
}

/**
 * Read the live location slug set from editor storage. Used by the
 * input/paste rules to only promote `@<slug>:N` to a pill when `<slug>` is a
 * known location wired into the consumer node. Without this storage check,
 * any `@kira:1`-shaped token would race the character extension's rule —
 * with this check, the character extension only matches known character
 * slugs and the location extension only matches known location slugs.
 */
function knownLocationSlugs(extension: { editor: unknown }): Set<string> {
  const ed = extension.editor as
    | { storage?: Record<string, { referenceImages?: ReadonlyArray<{ locationSlug?: string }> }> }
    | undefined
  const list = ed?.storage?.locationRef?.referenceImages ?? []
  const out = new Set<string>()
  for (const r of list) {
    if (r.locationSlug) out.add(r.locationSlug)
  }
  return out
}

/**
 * Resolve a TYPED / PASTED token into pill attrs, or `false` to leave it as
 * literal text. Single source of truth for the input + paste rules so they
 * never diverge. NOT used by `parseHTML` — existing saved pills always
 * round-trip regardless of format (the gate below is for new text→pill
 * promotion only).
 *
 * Gates:
 *   1. Parse — non-matching shapes stay text (parser returns null).
 *   2. Known-slug — only promote when `<slug>` is a location wired into the
 *      consumer node, so the character extension's rule owns character slugs
 *      and unknown slugs stay text.
 *   3. Legacy role gate (Unified Reference Roles, Phase D) — a bare-slug ROLE
 *      token (`@old-library:1:background`, `attrs.role` set) is a HYBRID-only
 *      construct. In LEGACY it must stay literal text exactly as pre-Phase-D
 *      (when the parser returned null for it), so we do NOT auto-promote it to
 *      a pill. HYBRID keeps the promotion. `usageMode`-bearing tokens
 *      (`:layout` / `:style`) carry no `role` → still promoted in both formats,
 *      unchanged.
 */
export function resolvePromotableAttrs(
  token: string,
  extension: { editor: unknown },
): LocationRefAttrs | false {
  const attrs = parseMatchAttrs(token)
  if (!attrs) return false
  if (!knownLocationSlugs(extension).has(attrs.locationSlug)) return false
  if (attrs.role && IMAGE_REFERENCE_FORMAT !== "hybrid") return false
  // `~lock` is a HYBRID-only construct (Task 4): in LEGACY strip it on promotion
  // so a stray sentinel from a prior hybrid session never sets a legacy pill's
  // (hidden, toggle-less) lock. HYBRID keeps it.
  if (attrs.lock && IMAGE_REFERENCE_FORMAT !== "hybrid") return { ...attrs, lock: false }
  return attrs
}

/**
 * Inline atomic node that represents a
 * `@location:N(:bucket/variant)(:mode)` mention as a single pill. The pill
 * is selectable as a unit (Backspace deletes the whole pill); the cursor
 * never enters it.
 *
 * Round-trip serialization is critical: `renderText` MUST emit the exact
 * literal slug so `editor.getText()` produces a string that the shared
 * `findLocationMentionTokens` / `parseLocationMentionToken` parser
 * recognizes verbatim. The pill is a pure visual layer — the canonical
 * representation downstream remains the text slug.
 *
 * Visual theme: CYAN to match the Location node card color (#22D3EE) used
 * elsewhere in the canvas (see `frontend/CLAUDE.md`).
 */
export const LocationRefExtension = Node.create({
  name: "locationRef",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      locationSlug: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-location-slug") ?? "",
        renderHTML: (attrs) => ({ "data-location-slug": String(attrs.locationSlug ?? "") }),
      },
      imageIndex: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute("data-image-index") ?? "1", 10),
        renderHTML: (attrs) => ({ "data-image-index": String(attrs.imageIndex ?? 1) }),
      },
      bucket: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-location-bucket") || null,
        renderHTML: (attrs) =>
          attrs.bucket ? { "data-location-bucket": String(attrs.bucket) } : {},
      },
      variant: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-location-variant") || null,
        renderHTML: (attrs) =>
          attrs.variant ? { "data-location-variant": String(attrs.variant) } : {},
      },
      usageMode: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-usage-mode")
          return v && isLocationUsageMode(v) ? v : null
        },
        renderHTML: (attrs) =>
          attrs.usageMode ? { "data-usage-mode": String(attrs.usageMode) } : {},
      },
      role: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-location-role") || null,
        renderHTML: (attrs) =>
          attrs.role ? { "data-location-role": String(attrs.role) } : {},
      },
      // Per-mention identity-lock (Task 4). Boolean; renders `data-lock` only
      // when on so lock-off pill HTML stays byte-identical.
      lock: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-lock") === "true",
        renderHTML: (attrs) => (attrs.lock ? { "data-lock": "true" } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-location-ref]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-location-ref": "" }),
    ]
  },

  /**
   * Plain-text serialization. Output here is what `editor.getText()` returns
   * for the pill, and what flows downstream into `findLocationMentionTokens`
   * / the worker prompt. It MUST be byte-exact with the user-typed slug
   * shape.
   *
   * Decision: ALWAYS emit the mode segment when `usageMode` is non-null on
   * the node — matches `character-ref-extension.ts` behavior so the user's
   * explicit choice survives the round-trip. Default-mode pills (mode ===
   * null) stay clean.
   *
   * Bucket/variant pair is emitted as `:bucket/variant` (slash-separated),
   * NOT two separate colon segments — this is the location-side
   * disambiguation against the character grammar.
   */
  renderText({ node }) {
    const a = node.attrs as LocationRefAttrs
    const parts: string[] = [`@${a.locationSlug}:${a.imageIndex}`]
    // 3rd segment is EITHER a `bucket/variant` pair OR a bare-slug role — they
    // are mutually exclusive (the shared parser never sets both). `usageMode`,
    // when present, trails as the next segment.
    if (a.bucket && a.variant) {
      parts.push(`${a.bucket}/${a.variant}`)
    } else if (a.role) {
      parts.push(a.role)
    }
    if (a.usageMode) {
      parts.push(a.usageMode)
    }
    // Additive `~lock` sentinel LAST so the shared parser reads it as the
    // trailing per-mention lock flag.
    return parts.join(":") + (a.lock ? "~lock" : "")
  },

  addNodeView() {
    return ReactNodeViewRenderer(LocationRefView)
  },

  /**
   * Auto-promote a typed slug to a pill once the user types a trailing
   * boundary character (space or newline). Anchoring on the boundary keeps
   * the user able to keep typing the slug without it being eagerly snatched
   * away mid-word.
   *
   * Conflict avoidance — the character extension's input rule matches any
   * `@<slug>:N` shape; without a discriminator, both rules would fire for
   * the same input. We gate the location rule's `getAttributes` on the
   * parent editor's location storage: only promote to a location pill when
   * `attrs.locationSlug` is a known location wired into the consumer node.
   * The character extension is gated by the analogous character-storage
   * check in `character-ref-extension.ts` (added in this same slice).
   */
  addInputRules() {
    const self = this
    return [
      nodeInputRule({
        find: new RegExp(`${LOCATION_REF_PATTERN_CORE}\\s$`),
        type: this.type,
        // Promotion is gated by `resolvePromotableAttrs`: known-slug only
        // (so the character extension owns character slugs + unknown slugs
        // stay text), and legacy role tokens stay literal (Phase D).
        getAttributes: (match) => resolvePromotableAttrs(match[1], self),
      }),
    ]
  },

  /**
   * Convert pasted text containing one or more slug literals into pills in
   * a single transaction. Pasting "see @oldlibrary:1:weather/rain in
   * @oldlibrary:1:layout" should land two pills with the surrounding text
   * intact. Same known-slug gating as `addInputRules`.
   */
  addPasteRules() {
    const self = this
    return [
      nodePasteRule({
        find: new RegExp(LOCATION_REF_PATTERN_CORE, "g"),
        type: this.type,
        // Same gating as the input rule (known-slug + legacy role guard) via
        // the shared `resolvePromotableAttrs` helper.
        getAttributes: (match) => resolvePromotableAttrs(match[1], self),
      }),
    ]
  },

  /**
   * Storage holds the live reference-image list so the React node view can
   * resolve `(locationSlug, bucket, variant)` → thumbnail URL without prop
   * drilling. Mirrors the `characterRef` and `imageRef` storage patterns.
   */
  addStorage() {
    return {
      referenceImages: [] as Array<{
        url: string
        locationSlug?: string
        locationVariantBucket?: string
        locationVariantSlug?: string
        locationVariantDisplayName?: string
        label?: string
      }>,
      revision: 0,
    }
  },
})

// Re-exported for the parent editor's `valueToDoc` slug → node scanner so it
// uses the exact same shape as the input/paste rules.
export const LOCATION_REF_PARSE_PATTERN_GLOBAL = new RegExp(
  `(?:^|[^a-zA-Z0-9])${LOCATION_REF_PATTERN_CORE}`,
  "g",
)

/**
 * Parse a captured location token (the single capture group from
 * `LOCATION_REF_PARSE_PATTERN_GLOBAL` or the extension's input/paste rule)
 * into a full `LocationRefAttrs`. Re-exported so the parent editor's
 * `valueToDoc` shares the same disambiguation rules.
 */
export function parseLocationRefMatch(token: string): LocationRefAttrs | null {
  return parseMatchAttrs(token)
}

// Re-export DEFAULT_LOCATION_USAGE_MODE / LocationUsageMode so consumers
// don't need to dual-import.
export { DEFAULT_LOCATION_USAGE_MODE }
export type { LocationUsageMode }
