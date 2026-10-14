/**
 * The editor's preview refusals, in the reader's language, naming the remedy
 * for what holds the run (`previewHoldKind`, @nodaro/render-rules — the rule
 * the server's copy follows too, backend lib/preview-refusal-copy.ts): a
 * render at Preview is set to Final; a use-case node with review on has its
 * "Review before render" turned off. "any" names both, for a graph both kinds
 * actually hold. Not knowing what held a run (a bare code with no kind) reads
 * as a render: the wording render users have always seen.
 */
import type { PreviewHoldKind } from "@nodaro/render-rules"
import { tx, type MessageKey } from "@/lib/i18n"

/** Where the editor says a run cannot stop for a review. */
export type PreviewRefusalSituation = "headless" | "nested" | "trigger"

const KEYS: Readonly<Record<PreviewRefusalSituation, Readonly<Record<PreviewHoldKind, MessageKey>>>> = {
  headless: { any: "previewGate.headlessRefusal", render: "previewGate.headlessRefusalRender", review: "previewGate.headlessRefusalReview" },
  nested: { any: "previewGate.nestedRefusal", render: "previewGate.nestedRefusalRender", review: "previewGate.nestedRefusalReview" },
  trigger: { any: "previewGate.triggerWarning", render: "previewGate.triggerWarningRender", review: "previewGate.triggerWarningReview" },
}

/** The message key for `situation`, by what holds the run. */
export function previewRefusalKey(situation: PreviewRefusalSituation, kind: PreviewHoldKind = "render"): MessageKey {
  return KEYS[situation][kind]
}

/** The refusal's text for `situation`, by what holds the run. */
export function previewRefusalText(situation: PreviewRefusalSituation, kind: PreviewHoldKind = "render"): string {
  return tx(previewRefusalKey(situation, kind))
}
