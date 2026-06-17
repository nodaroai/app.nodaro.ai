// frontend/src/lib/inline-prompt-pref.ts
/**
 * Device-local toggle for "inline prompt mode" — when ON, AI nodes render their
 * prompt editor inline on the canvas. Mirrors the snap/alignment canvas toggles'
 * persistence (localStorage), and is mirrored into the workflow store so node
 * components re-render on change (see use-workflow-store.ts).
 *
 * Defaults OFF: the feature ships dark so production behaves exactly as before
 * until a user opts in via the canvas "Inline Prompts" toggle. When off,
 * generate-image/video nodes render identically to pre-feature (media fills the
 * node, prompt via the quick-edit modal, hover-pill run strip) and
 * onlyRenderVisibleElements stays off (render-all, as before).
 */
import { makeBoolPref } from "./bool-pref"

export const INLINE_PROMPT_MODE_KEY = "nodaro:inlinePromptMode"
const inlinePromptPref = makeBoolPref(INLINE_PROMPT_MODE_KEY, false)
export const getInlinePromptMode = inlinePromptPref.get
export const setInlinePromptMode = inlinePromptPref.set
