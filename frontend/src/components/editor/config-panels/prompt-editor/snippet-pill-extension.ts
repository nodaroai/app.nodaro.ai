import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { SnippetPillView } from "./snippet-pill-view"

export interface SnippetPillAttrs {
  /** Pool id ("identity-lock" or a user uuid). Used to look up live category/
   *  siblings in editor storage; may go stale (snippet deleted) — the pill
   *  still renders from `name`/`text`, swap just disables. */
  snippetId: string
  name: string
  /** The EXACT fragment this pill represents. renderText() emits this
   *  verbatim — the stored prompt string is always the plain text. */
  text: string
}

/**
 * Inline atomic display-pill over a snippet's plain text. Pure presentation:
 * `renderText` MUST emit `attrs.text` byte-exactly so `editor.getText()`
 * round-trips to the same prompt string the user would have typed by hand.
 * Promotion back from plain text happens in valueToDoc via matchSnippetRanges.
 */
export const SnippetPillExtension = Node.create({
  name: "snippetPill",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      snippetId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-snippet-id") ?? "",
        renderHTML: (attrs) => ({ "data-snippet-id": String(attrs.snippetId ?? "") }),
      },
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-snippet-name") ?? "",
        renderHTML: (attrs) => ({ "data-snippet-name": String(attrs.name ?? "") }),
      },
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-snippet-text") ?? "",
        renderHTML: (attrs) => ({ "data-snippet-text": String(attrs.text ?? "") }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-snippet-pill]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-snippet-pill": "" })]
  },

  renderText({ node }) {
    return String((node.attrs as SnippetPillAttrs).text ?? "")
  },

  addNodeView() {
    return ReactNodeViewRenderer(SnippetPillView)
  },

  /** Live snippet pool (SnippetPoolItem[]) for the swap menu; mirrored from
   *  PromptEditor props the same way characterRef mirrors referenceImages. */
  addStorage() {
    return {
      snippets: [] as Array<{
        id: string
        name: string
        text: string
        category: string
        source: "factory" | "user"
      }>,
      revision: 0,
    }
  },
})
