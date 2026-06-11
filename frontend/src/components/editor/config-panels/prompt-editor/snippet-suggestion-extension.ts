import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"

/**
 * Tiptap extension wiring the `/` typeahead for prompt snippets. Items,
 * command, and render are configured at runtime in `prompt-editor/index.tsx`
 * (same pattern as `VariableSuggestionExtension`).
 *
 * `allowedPrefixes: [" "]` restricts the trigger to line start / after
 * whitespace, so `https://` never opens the menu.
 */
export const SnippetSuggestionExtension = Extension.create({
  name: "snippetSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        allowedPrefixes: [" "],
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
