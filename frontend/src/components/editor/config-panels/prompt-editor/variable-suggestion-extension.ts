import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"

/**
 * Tiptap extension that wires a `{` typeahead trigger for upstream variable
 * references. Items + render are configured at runtime via the `suggestion`
 * option (see `prompt-editor/index.tsx`).
 *
 * Unlike `ImageRefExtension` (which stores tokens as atomic Mention nodes),
 * variable refs are inserted as plain text in the form `{Node Label}`. The
 * runtime `resolveTextRefs` helper expands them at execution time.
 */
export const VariableSuggestionExtension = Extension.create({
  name: "variableSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "{",
        // Default no-op — overridden via configure() in PromptEditor.
        items: () => [],
        command: () => undefined,
        render: () => ({}),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
