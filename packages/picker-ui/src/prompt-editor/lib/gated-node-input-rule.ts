import { InputRule, nodeInputRule } from "@tiptap/core"
import type { ExtendedRegExpMatchArray, InputRuleFinder } from "@tiptap/core"
import type { NodeType } from "@tiptap/pm/model"

interface GatedNodeInputRuleConfig<A extends object> {
  find: InputRuleFinder
  type: NodeType
  /** `false` = decline this rule and leave the match to the next one. */
  getAttributes: (match: ExtendedRegExpMatchArray) => A | false
}

/**
 * `nodeInputRule` with the `false` gate that `nodePasteRule` already honors.
 *
 * All three mention grammars (`characterRef`, `locationRef`, `imageMention`)
 * match the SAME `@<slug>:N…` surface and separate themselves by returning
 * `false` from `getAttributes` for a slug that isn't theirs. `nodePasteRule`
 * implements that contract (`if (attributes === false || attributes === null)
 * return null`), but `nodeInputRule` does NOT: it does
 * `callOrReturn(getAttributes, …) || {}`, so `false` is coerced to `{}` and the
 * node is created with its DEFAULT attrs — an empty-slug pill whose
 * `renderText` emits `@:1`, destroying the typed token. Worse, that handler
 * still adds steps, and `run()` only advances to the next rule when a handler
 * returns `null` — so the declining rule also STOPS the sibling rule that
 * should have owned the token.
 *
 * This wrapper restores the documented contract: decline → `null` → the input
 * rule loop moves on to the next extension's rule, and a token no grammar
 * claims stays literal text (exactly the downstream resolver's fallback).
 *
 * `getAttributes` runs twice (once here, once inside the wrapped rule) — all
 * three call sites are pure derivations over the match plus editor storage, so
 * that is free. Everything else — the `match[1]` slice math, the preserved
 * boundary character, `scrollIntoView` — stays `nodeInputRule`'s.
 */
export function gatedNodeInputRule<A extends object>(
  config: GatedNodeInputRuleConfig<A>,
): InputRule {
  const inner = nodeInputRule({
    find: config.find,
    type: config.type,
    // Cast only to satisfy `nodeInputRule`'s `Record<string, any>` attrs type —
    // the `false` branch is intercepted below and never reaches this rule.
    getAttributes: (match) => config.getAttributes(match) as Record<string, unknown>,
  })
  return new InputRule({
    find: config.find,
    handler: (props) => {
      if (config.getAttributes(props.match) === false) return null
      return inner.handler(props)
    },
  })
}
