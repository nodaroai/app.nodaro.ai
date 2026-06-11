import { Extension } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
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
        // Distinct key is mandatory: @tiptap/suggestion's default SuggestionPluginKey
        // is module-level shared, so two bare Suggestion() plugins in one editor
        // collide and throw `RangeError: Adding different instances of a keyed
        // plugin` at construction. Passed first so a configure()-level override wins.
        pluginKey: new PluginKey("snippetSuggestion"),
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
