// frontend/src/lib/inline-prompt-pref.ts
/**
 * Device-local toggle for "inline prompt mode" — when ON, AI nodes render their
 * prompt editor inline on the canvas. Mirrors the snap/alignment canvas toggles'
 * persistence (localStorage), and is mirrored into the workflow store so node
 * components re-render on change (see use-workflow-store.ts).
 *
 * Defaults ON (graduated 2026-08-17 from the dark-ship default): a fresh
 * device — i.e. every newcomer — gets inline prompts out of the box. The
 * default only applies when the key is UNSET, so anyone who explicitly turned
 * the toggle off (stored "0") keeps their choice. When off,
 * generate-image/video nodes render identically to pre-feature (media fills
 * the node, prompt via the quick-edit modal, hover-pill run strip) and
 * onlyRenderVisibleElements stays off (render-all, as before).
 */
import { makeBoolPref } from "./bool-pref"

export const INLINE_PROMPT_MODE_KEY = "nodaro:inlinePromptMode"
const inlinePromptPref = makeBoolPref(INLINE_PROMPT_MODE_KEY, true)
export const getInlinePromptMode = inlinePromptPref.get
export const setInlinePromptMode = inlinePromptPref.set
