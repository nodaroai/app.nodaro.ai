import { Extension } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
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
        // Distinct key is mandatory: @tiptap/suggestion's default SuggestionPluginKey
        // is module-level shared, so two bare Suggestion() plugins in one editor
        // collide and throw `RangeError: Adding different instances of a keyed
        // plugin` at construction. Passed first so a configure()-level override wins.
        pluginKey: new PluginKey("variableSuggestion"),
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
