"use client"

import { useMemo, useState } from "react"
import { useT } from "@/lib/i18n"
import { Check, Copy } from "lucide-react"
import { getParameterPromptHint } from "@nodaro/prompts"
import { cn } from "@/lib/utils"
import { isParameterPickerNode } from "@/lib/parameter-picker-types"
import { HintModeToggle, readHintMode, useHintModeSetter } from "@/components/nodes/hint-mode-toggle"
import { useParameterPreviewContext } from "./parameter-preview-context"

/**
 * A single hint, an array of hints (which itself may contain falsy entries),
 * or a top-level falsy placeholder. The array shape exists so callers don't
 * need to spread (`...buildXxxHints()`) — spreading a string accidentally
 * explodes it into per-character entries, which used to render as
 * `"l, o, c, k, e, d, …"` in the preview (the CameraMotionConfig regression
 * that motivated this signature).
 *
 * Inner array tolerates `null | undefined | false` so callers using
 * `.map(x => x?.hint)` (partial data) or `cond && hint` (conditional
 * fragments) don't need to `filter(Boolean) as string[]` first — the
 * component handles the drop. Mirrors `flatten()`'s runtime behavior so
 * the type doesn't lie about what's accepted.
 */
export type Hint =
  | string
  | ReadonlyArray<string | null | undefined | false>
  | null
  | undefined
  | false

interface PromptInjectionPreviewProps {
  /**
   * FALLBACK hint text(s), used only when this preview renders OUTSIDE the
   * config panel's `ParameterPreviewContext` (or for a node type that is not a
   * registered parameter picker). Inside the panel the text is composed from
   * the node itself — see the component doc. Empty/falsy entries are dropped.
   */
  readonly hints: ReadonlyArray<Hint> | string
  readonly className?: string
}

/**
 * Read-only preview block showing the prompt-hint text(s) a parameter node
 * will contribute to a downstream consumer's prompt. Multiple hints render
 * as a comma-joined list in monospace; an empty input renders "(nothing
 * selected)" italic muted text. A copy button copies the joined text to
 * the clipboard.
 *
 * Why the prop accepts BOTH `string` AND `ReadonlyArray<Hint>` (where a Hint
 * is itself a string OR an array of strings): the parent-side spread pattern
 * (`...buildHints()`) is a footgun — spreading a `string` returns characters,
 * which `Array.isArray`/`typeof` checks can't catch at the type level. By
 * accepting arrays-of-arrays here and flattening internally, we make it
 * impossible to write the buggy form: callers pass either `compose*()` (a
 * string) or `build*Hints()` (a string[]) directly into the array literal,
 * no spread needed.
 *
 * SINGLE SOURCE OF TRUTH — for a registered parameter picker inside the config
 * panel (`ParameterPreviewContext`), the `hints` prop is IGNORED and the text
 * is composed by `getParameterPromptHint(node, { nodes, edges })`: the exact
 * function the frontend DAG executor and the backend orchestrator call. That
 * closes the gap the per-type `hints` callers had — they compose from a bare
 * catalog id, so they were blind to the node's `data.hintMode` (previewing the
 * long hint while the compact `term` was what actually got injected) and to
 * the startState / endState edges that camera-motion, transition and
 * character-fx compose from. The Full / Compact lever is rendered right beside
 * the text for the same reason, and is the SAME component the canvas node card
 * uses, so neither surface can drift from the other.
 *
 * Outside that context — and for a non-picker node type — the component stays
 * exactly what it was: a presentational block over the `hints` prop, with no
 * lever (there is no node to write the mode to).
 */
export function PromptInjectionPreview({ hints, className }: PromptInjectionPreviewProps) {
  const t = useT()
  const ctx = useParameterPreviewContext()
  const setHintMode = useHintModeSetter()
  // Only a registered picker composes through the injection path: free-text
  // and pure-runtime parameter nodes have no catalog fragment (and no `term`),
  // so they keep the caller-supplied hints and get no lever.
  const picker = ctx && isParameterPickerNode(ctx.node.type) ? ctx : null
  const injected = useMemo(
    () => (picker ? getParameterPromptHint(picker.node, { nodes: picker.nodes, edges: picker.edges }) : null),
    [picker],
  )
  // A composed fragment is ONE string (already comma-joined by the injection
  // path); an empty one means "nothing selected", same as an empty hint list.
  const list =
    injected === null ? flatten(hints) : injected.trim() ? [injected] : []
  const joined = list.join(", ")
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!joined) return
    // Dev-loud, prod-quiet: expected permission-denied paths (Firefox-not-
    // focused, sandboxed iframes, browser denial) are the dominant rejection
    // case so we keep the prod console clean. But silent-swallow in dev
    // makes real regressions (TypeError from a future signature change,
    // programmer errors) undebuggable — surfacing them in dev preserves
    // the diagnostic signal we'd otherwise lose by catching at all.
    navigator.clipboard
      .writeText(joined)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[PromptInjectionPreview] clipboard.writeText rejected:", err)
        }
      })
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
            {t("cfgext.pipWillInject")}
          </p>
          {picker && (
            <HintModeToggle
              mode={readHintMode(picker.node.data as Record<string, unknown>)}
              onChange={(mode) => setHintMode(picker.node.id, mode)}
            />
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!joined}
          aria-label={t("cfgext.pipCopyAria")}
          title={joined ? t("cfgshared.copyToClipboard") : t("cfgshared.nothingToCopy")}
          className={cn(
            "flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 transition-colors",
            joined
              ? "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#2D2D2D] cursor-pointer"
              : "text-muted-foreground/40 cursor-not-allowed",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? t("apiTok.copied") : t("apiTok.copy")}</span>
        </button>
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2">
        {list.length > 0 ? (
          <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
            {joined}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">
            {t("cfgext.pipNothingSelected")}
          </p>
        )}
      </div>
    </div>
  )
}

function flatten(hints: ReadonlyArray<Hint> | string): string[] {
  if (typeof hints === "string") return hints ? [hints] : []
  // .flat(1) intentionally matches Hint's one-level nesting depth. Deeper
  // nesting would be a TS error at the callsite — keeping the runtime
  // depth in sync with the type keeps the contract honest (deeper nesting
  // is a bug to fix at the source, not silently flattened here).
  return hints
    .flat(1)
    .filter((x): x is string => typeof x === "string" && x.length > 0)
}
