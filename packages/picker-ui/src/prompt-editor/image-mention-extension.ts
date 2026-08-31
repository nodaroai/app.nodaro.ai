import { Node, mergeAttributes } from "@tiptap/core"
import { nodeInputRule, nodePasteRule } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { parseImageMentionToken } from "@nodaro/shared"
import { IMAGE_REFERENCE_FORMAT } from "./lib/image-reference-format"
import { knownImageMentionSlugs } from "./lib/image-mention-refs"
import type { RefImageItem } from "./editor-types"
import { ImageMentionView } from "./image-mention-view"

/**
 * Attributes of the NAME-addressed media mention pill — the sibling of the
 * POSITIONAL `imageRef` pill (`{image:N}`), not its replacement. Both can sit in
 * one prompt: `{image:2}` addresses the second wired reference by slot, while
 * `@town:3` addresses the reference NAMED "Town" wherever it ends up.
 *
 * The grammar is the shared `@<name-slug>:<index>[:<role>]` (see
 * `packages/shared/src/image-mention-slug.ts`) — 2 or 3 segments, no bucket,
 * no variant, no usage-mode enum. Every valid 3rd segment is a ROLE.
 */
export interface ImageMentionAttrs {
  /** Slug of the reference's NAME, derived by the shared `imageMentionSlug`. */
  imageSlug: string
  /**
   * 1-based CORRELATION index from the unified `nextMentionIndex` counter
   * (shared with characters + locations). The hybrid resolver binds by its own
   * numbering walk, so this is never echoed into the built prompt.
   */
  imageIndex: number
  /** 3rd-segment role (`@town:3:background`), curated or custom. null = none. */
  role: string | null
  /** Tri-state `~lock` / `~nolock` sentinel; undefined = inherit (no sentinel). */
  lock?: boolean
}

/**
 * Token shape — 2 or 3 colon segments plus the optional additive lock sentinel.
 * The token is captured as ONE group and handed to the SHARED
 * `parseImageMentionToken`, so the pill can never drift from the grammar the
 * resolver reads (the same delegation the location pill does).
 *
 * The trailing `(?![:a-z0-9-])` is the shared finder's 4-part guard verbatim: a
 * 4-part CHARACTER token (`@kira:1:smile:face`) must NEVER be captured here as
 * its 3-part prefix, which would leave `:face` dangling.
 */
const IMAGE_MENTION_PATTERN_CORE =
  "(@[a-z][a-z0-9-]*:\\d+(?::[a-z][a-z0-9-]*)?(?:~(?:no)?lock(?![a-z0-9-]))?)(?![:a-z0-9-])"

/**
 * The SLASH GUARD, applied post-match exactly as the shared finder applies it.
 * `/` is the LOCATION grammar's bucket/variant separator, so a token
 * immediately followed by `/<segment>` is a sibling-grammar token, never an
 * image mention. It cannot be a lookahead: the engine would just backtrack to a
 * shorter prefix and promote THAT, which is the corruption being prevented.
 *
 * `/` alone is not the signal — `@town:1/@barn:2` (two mentions separated by a
 * slash) must still promote, and a location segment always starts `[a-z]`.
 */
function slashGuardTripped(input: string | undefined, tokenEnd: number): boolean {
  if (input === undefined) return false
  return /^\/[a-z]/.test(input.slice(tokenEnd))
}

/**
 * HYBRID is the only format with an image-mention RESOLVER — under legacy an
 * `@name:N` token stays literal text and the reference auto-attaches as it
 * always did. So legacy must not promote one to a pill either: a pill that
 * looks bound but resolves to nothing is worse than plain text.
 *
 * Gates PROMOTION only (input rule, paste rule, `valueToDoc`). Parsing and
 * `renderText` are ungated so an existing pill always round-trips.
 */
function promotionEnabled(): boolean {
  return IMAGE_REFERENCE_FORMAT === "hybrid"
}

/**
 * Live known-image-slug set from editor storage — the mirror of the character
 * extension's `knownCharacterSlugs`. All three mention grammars match the same
 * `@slug:N…` surface; only the known-slug sets separate them, and this one is
 * derived from the SAME predicate the autocomplete rows use
 * (`knownImageMentionSlugs`), so a typed token and a picked row agree.
 */
function knownSlugsFromStorage(extension: { editor: unknown }): Set<string> {
  const ed = extension.editor as
    | { storage?: Record<string, { referenceImages?: readonly RefImageItem[] }> }
    | undefined
  return knownImageMentionSlugs(ed?.storage?.imageMention?.referenceImages ?? [])
}

/**
 * Decide whether a matched token may become a pill, and with which attrs.
 * The EXACT decision function both the input rule and the paste rule call, so
 * the gate can be unit-tested without driving TipTap end-to-end (mirrors the
 * location extension's `resolvePromotableAttrs`).
 *
 * Returns `false` — nodeInputRule/nodePasteRule's "skip this rule" — whenever
 * the token isn't a promotable image mention, leaving the text literal, which
 * is exactly the downstream resolver's fallback.
 */
export function resolvePromotableAttrs(
  token: string,
  known: ReadonlySet<string>,
  opts?: { input?: string; tokenEnd?: number },
): ImageMentionAttrs | false {
  if (!promotionEnabled()) return false
  if (opts && slashGuardTripped(opts.input, opts.tokenEnd ?? 0)) return false
  const parsed = parseImageMentionToken(token)
  if (!parsed) return false
  if (!known.has(parsed.imageSlug)) return false
  // Spread the optional fields so a role-less / lock-less token gains NO extra
  // key beyond the node defaults (byte-identical round-trip).
  return {
    imageSlug: parsed.imageSlug,
    imageIndex: parsed.imageIndex,
    role: parsed.role ?? null,
    ...(parsed.lock === undefined ? {} : { lock: parsed.lock }),
  }
}

/**
 * Inline atomic node for a NAME-addressed media mention. The pill is a pure
 * visual layer: `renderText` MUST emit the exact `@<slug>:<N>[:<role>][~lock]`
 * token so `editor.getText()` produces a string the shared
 * `findImageMentionTokens` / `parseImageMentionToken` recognize verbatim.
 */
export const ImageMentionExtension = Node.create({
  name: "imageMention",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      imageSlug: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-image-slug") ?? "",
        renderHTML: (attrs) => ({ "data-image-slug": String(attrs.imageSlug ?? "") }),
      },
      imageIndex: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute("data-image-index") ?? "1", 10),
        renderHTML: (attrs) => ({ "data-image-index": String(attrs.imageIndex ?? 1) }),
      },
      role: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-role") || null,
        renderHTML: (attrs) => (attrs.role ? { "data-role": String(attrs.role) } : {}),
      },
      lock: {
        default: undefined,
        parseHTML: (el) => {
          const v = el.getAttribute("data-lock")
          return v === "true" ? true : v === "false" ? false : undefined
        },
        renderHTML: (attrs) =>
          attrs.lock === true
            ? { "data-lock": "true" }
            : attrs.lock === false
              ? { "data-lock": "false" }
              : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-image-mention]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-image-mention": "" })]
  },

  /**
   * Plain-text serialization — what `editor.getText()` emits for the pill and
   * therefore what reaches the prompt-builder. Byte-exact with the hand-typed
   * token: role (when set) as the 3rd segment, then the additive lock sentinel
   * LAST, after every colon segment.
   */
  renderText({ node }) {
    const a = node.attrs as ImageMentionAttrs
    const parts: string[] = [`@${a.imageSlug}:${a.imageIndex}`]
    if (a.role) parts.push(a.role)
    const lockSuffix = a.lock === true ? "~lock" : a.lock === false ? "~nolock" : ""
    return parts.join(":") + lockSuffix
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageMentionView)
  },

  /**
   * Auto-promote a typed token to a pill once the user types a trailing
   * boundary (space / newline), so the slug can be typed out without being
   * snatched mid-word. `match[1]` is the token without that boundary, which is
   * what `nodeInputRule` uses to compute the replaced slice — so the boundary
   * character survives as plain text.
   */
  addInputRules() {
    const self = this
    return [
      nodeInputRule({
        find: new RegExp(`${IMAGE_MENTION_PATTERN_CORE}\\s$`),
        type: this.type,
        getAttributes: (match) =>
          resolvePromotableAttrs(match[1], knownSlugsFromStorage(self)),
      }),
    ]
  },

  /**
   * Pasted text containing one or more tokens becomes pills in one
   * transaction. `nodePasteRule` replaces the WHOLE `match[0]` span, so the
   * pattern carries no boundary group; the slash guard runs post-match against
   * the pasted input instead.
   */
  addPasteRules() {
    const self = this
    return [
      nodePasteRule({
        find: new RegExp(IMAGE_MENTION_PATTERN_CORE, "g"),
        type: this.type,
        getAttributes: (match) =>
          resolvePromotableAttrs(match[1], knownSlugsFromStorage(self), {
            input: match.input,
            tokenEnd: (match.index ?? 0) + match[0].length,
          }),
      }),
    ]
  },

  /** Storage holds the live reference list so the node view can resolve
   *  `imageSlug` → thumbnail + display name without prop drilling, and so the
   *  input/paste rules can read the known-slug set. Mirrors `characterRef`. */
  addStorage() {
    return {
      referenceImages: [] as RefImageItem[],
      /** Bumped on every parent-driven storage update so node views can use it
       *  as a memo dependency when the upstream reference list changes. */
      revision: 0,
    }
  },
})
