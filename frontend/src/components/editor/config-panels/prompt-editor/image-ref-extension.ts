import Mention, { type MentionOptions } from "@tiptap/extension-mention"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { nodeInputRule } from "@tiptap/core"
import { ImageRefView } from "./image-ref-view"

/**
 * Atomic image reference node — `{image:N:label}` becomes a single inline
 * widget that the cursor can never enter. Built on top of Tiptap's Mention
 * extension so the `@` typeahead plumbing comes for free.
 */
export const ImageRefExtension = Mention.extend({
  name: "imageRef",

  // Atomic + selectable: backspace deletes the whole node, arrow keys skip it,
  // clicks select it as a unit. This is exactly the behaviour we want.
  atom: true,
  inline: true,
  selectable: true,

  addOptions(): MentionOptions {
    const parent = this.parent?.() ?? ({} as MentionOptions)
    return {
      ...parent,
      HTMLAttributes: parent.HTMLAttributes ?? {},
      // Plain-text serialization — what `editor.getText()` returns for this node.
      renderText({ node }) {
        const idx = node.attrs.imageIndex as number
        const label = node.attrs.label as string
        return label ? `{image:${idx}:${label}}` : `{image:${idx}}`
      },
      // Disable Mention's default backspace-trigger behaviour; our atomic node
      // already deletes cleanly with a single backspace via the `atom` flag.
      deleteTriggerWithBackspace: false,
    } as MentionOptions
  },

  addAttributes() {
    return {
      imageIndex: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute("data-image-index") || "1", 10),
        renderHTML: (attrs) => ({ "data-image-index": String(attrs.imageIndex) }),
      },
      label: {
        default: "object",
        parseHTML: (el) => el.getAttribute("data-image-label") || "object",
        renderHTML: (attrs) => ({ "data-image-label": attrs.label }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-image-ref]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      { ...HTMLAttributes, "data-image-ref": "" },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageRefView)
  },

  /**
   * Convert literally-typed `{image:N}` or `{image:N:label}` text into the
   * atomic node as soon as the user types the closing `}`. Without this,
   * users who type the token directly (instead of using `@`) get plain text.
   */
  addInputRules() {
    return [
      nodeInputRule({
        find: /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}$/,
        type: this.type,
        getAttributes: (match) => ({
          imageIndex: parseInt(match[1], 10),
          label: match[2] ?? "",
        }),
      }),
    ]
  },

  /** Storage holds the live reference-image list so the React node view can
   *  resolve `imageIndex` → URL without prop drilling. */
  addStorage() {
    return {
      referenceImages: [] as Array<{ url: string; defaultName?: string }>,
    }
  },
})
