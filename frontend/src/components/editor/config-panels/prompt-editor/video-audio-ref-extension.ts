import Mention, { type MentionOptions } from "@tiptap/extension-mention"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { nodeInputRule, nodePasteRule } from "@tiptap/core"
import { VideoAudioRefView } from "./video-audio-ref-view"

/**
 * Atomic VIDEO / AUDIO reference nodes — the `{video:N:label}` and
 * `{audio:N:label}` siblings of the `{image:N:label}` atomic node in
 * `image-ref-extension.ts`. Each token becomes a single inline widget the
 * cursor can never enter, built on Tiptap's Mention extension so the `@`
 * typeahead plumbing comes for free (wired in by Tasks 5.2/5.3).
 *
 * Behavior is byte-parallel to image by design — do NOT diverge the grammar or
 * serialization. The token shape is the SAME as image (digit index + optional
 * `[a-zA-Z0-9_-]` label) so `{video:N}` / `{audio:N}` round-trip through the
 * editor exactly like `{image:N}`, and the shared backend resolver
 * (`packages/shared/src/video-reference-resolver.ts`, `REFERENCE_TOKEN_RE`)
 * sees the identical literal text the user would have typed by hand.
 */

export type RefKind = "video" | "audio"

export interface VideoAudioRefAttrs {
  refIndex: number
  label: string
}

export interface ParsedRefToken {
  kind: RefKind
  /** 1-based positional slot N. */
  index: number
  /** Optional role label; "" when the token is label-less. */
  label: string
}

/**
 * Label sub-pattern — IDENTICAL to image's input/paste rule
 * (`image-ref-extension.ts`): alphanumerics, underscore, hyphen; NO space (the
 * FE sanitizes spaces to hyphens, see `video-audio-ref-view.sanitizeLabel`).
 * The shared backend `REFERENCE_TOKEN_RE` permits spaces too, so it is a strict
 * superset — any token this grammar emits is resolvable downstream.
 */
const LABEL_PATTERN = "[a-zA-Z0-9_-]+"

/** Whole-token grammar, kind captured. Case-insensitive + kind lowercased on
 *  parse so a `{Video:1}` paste still resolves (mirrors the image scanner's
 *  `gi` flag), while the live input rule below stays lowercase like image's. */
const REF_TOKEN_RE = new RegExp(`^\\{(video|audio):(\\d+)(?::(${LABEL_PATTERN}))?\\}$`, "i")

/**
 * Serialize a video/audio reference to its literal token — the single source of
 * truth for the form emitted by every node's `renderText` (what
 * `editor.getText()` returns and what persists to `node.data.prompt`). Mirrors
 * image exactly: labelled → `{kind:N:label}`, label-less → `{kind:N}`.
 */
export function serializeRefToken(kind: RefKind, index: number, label: string): string {
  return label ? `{${kind}:${index}:${label}}` : `{${kind}:${index}}`
}

/**
 * Parse a single literal `{video:N(:label)}` / `{audio:N(:label)}` token into
 * its attributes, or `null` when the string isn't a well-formed video/audio
 * token (wrong kind, zero/negative index, illegal label char, stray text).
 *
 * This is the parse-side single source of truth: the extension's input/paste
 * rules and the editor's value→doc scanner (Tasks 5.2/5.3) all funnel through
 * it so the pill ↔ raw-text round trip can never drift from `serializeRefToken`.
 */
export function parseRefToken(token: string): ParsedRefToken | null {
  const m = REF_TOKEN_RE.exec(token)
  if (!m) return null
  const index = parseInt(m[2], 10)
  if (!Number.isInteger(index) || index < 1) return null
  return { kind: m[1].toLowerCase() as RefKind, index, label: m[3] ?? "" }
}

/**
 * Build one atomic inline node for a modality. The two exported extensions
 * (`VideoRefExtension` / `AudioRefExtension`) are independent `Mention.extend`
 * instances produced by this factory so the video/audio grammar can never
 * diverge — both derive from `LABEL_PATTERN` and `serializeRefToken`.
 */
function createRefExtension(kind: RefKind) {
  const nodeName = kind === "video" ? "videoRef" : "audioRef"
  return Mention.extend({
    name: nodeName,

    // Atomic + selectable: backspace deletes the whole node, arrow keys skip
    // it, clicks select it as a unit — exactly image's behavior.
    atom: true,
    inline: true,
    selectable: true,

    addOptions(): MentionOptions {
      const parent = this.parent?.() ?? ({} as MentionOptions)
      return {
        ...parent,
        HTMLAttributes: parent.HTMLAttributes ?? {},
        // Plain-text serialization — what `editor.getText()` returns. Mention
        // reads `this.options.renderText`, so it MUST live here (mirrors image).
        renderText({ node }) {
          return serializeRefToken(
            kind,
            node.attrs.refIndex as number,
            node.attrs.label as string,
          )
        },
        // The atomic node already deletes cleanly with a single backspace.
        deleteTriggerWithBackspace: false,
      } as MentionOptions
    },

    addAttributes() {
      return {
        refIndex: {
          default: 1,
          parseHTML: (el) => parseInt(el.getAttribute(`data-${kind}-index`) || "1", 10),
          renderHTML: (attrs) => ({ [`data-${kind}-index`]: String(attrs.refIndex) }),
        },
        label: {
          default: "",
          parseHTML: (el) => el.getAttribute(`data-${kind}-label`) || "",
          renderHTML: (attrs) => ({ [`data-${kind}-label`]: attrs.label }),
        },
      }
    },

    parseHTML() {
      return [{ tag: `span[data-${kind}-ref]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return ["span", { ...HTMLAttributes, [`data-${kind}-ref`]: "" }]
    },

    addNodeView() {
      return ReactNodeViewRenderer(VideoAudioRefView)
    },

    /**
     * Suppress the `@` typeahead Mention would otherwise add. The editor's
     * SINGLE unified `@` suggestion lives on `ImageRefExtension` (index.tsx) and
     * inserts video/audio pills via its `command` branches (Task 5.2). Inheriting
     * Mention's default Suggestion plugin here would register a THIRD `@` plugin
     * (alongside image's) fighting over the same trigger — duplicate popups,
     * broken char/location/image typeahead. We only need the atomic node
     * (renderText round-trip + input/paste rules), so drop the inherited
     * ProseMirror plugins entirely. Input/paste rules are registered separately
     * (addInputRules/addPasteRules) and are unaffected.
     */
    addProseMirrorPlugins() {
      return []
    },

    /**
     * Convert literally-typed `{video:N}` / `{video:N:label}` (resp. audio)
     * text into the atomic node as soon as the user types the closing `}`.
     * Mirrors image's `addInputRules` — lowercase kind, image-identical grammar.
     */
    addInputRules() {
      return [
        nodeInputRule({
          find: new RegExp(`\\{${kind}:(\\d+)(?::(${LABEL_PATTERN}))?\\}$`),
          type: this.type,
          getAttributes: (match) => ({
            refIndex: parseInt(match[1], 10),
            label: match[2] ?? "",
          }),
        }),
      ]
    },

    /**
     * Convert pasted text containing one or more literal tokens into pills in a
     * single transaction (image has no paste rule today, but the character /
     * location pills do — adding it here keeps a paste of `{video:1} {video:2}`
     * from landing as raw text).
     */
    addPasteRules() {
      return [
        nodePasteRule({
          find: new RegExp(`\\{${kind}:(\\d+)(?::(${LABEL_PATTERN}))?\\}`, "g"),
          type: this.type,
          getAttributes: (match) => ({
            refIndex: parseInt(match[1], 10),
            label: match[2] ?? "",
          }),
        }),
      ]
    },

    /**
     * Storage holds the live reference list (populated by Tasks 5.2/5.3) so the
     * node view can resolve `refIndex` → media metadata without prop drilling —
     * mirrors the `imageRef` storage pattern.
     */
    addStorage() {
      return {
        referenceItems: [] as Array<{ url?: string; defaultName?: string }>,
      }
    },
  })
}

/** `{video:N:label}` atomic inline node. */
export const VideoRefExtension = createRefExtension("video")
/** `{audio:N:label}` atomic inline node. */
export const AudioRefExtension = createRefExtension("audio")
