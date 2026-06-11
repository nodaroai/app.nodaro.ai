"use client"

import { useMemo, useState } from "react"
import { Check, Copy, Eye, Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PromptSegmentOrigin } from "@nodaro/shared"

/**
 * Display-only provenance origin. Extends the shared {@link PromptSegmentOrigin}
 * with a frontend-local "snippet" tag (snippets are matched here, in a post-pass
 * over user-origin spans, not by the shared prompt builder).
 *
 * Lives here (the view layer) and is re-exported to the assembly hook and the
 * legacy `FinalPromptPreview` block (until that block is deleted) so the origin
 * vocabulary has a single home.
 */
export type DisplayOrigin = PromptSegmentOrigin | "snippet"

export interface DisplaySegment {
  readonly text: string
  readonly origin: DisplayOrigin
}

/** Tailwind classes per provenance origin (preview-only; never affects the
 *  string sent to the model). `user` text is unstyled. */
export const ORIGIN_CLASS: Record<DisplayOrigin, string> = {
  user: "",
  variable: "bg-sky-500/15 text-sky-800 dark:text-sky-200 rounded-sm",
  picker: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 rounded-sm",
  snippet: "bg-amber-500/15 text-amber-800 dark:text-amber-200 rounded-sm",
  mention: "bg-violet-500/10 text-violet-800 dark:text-violet-300 rounded-sm",
  style: "bg-muted text-muted-foreground rounded-sm",
  negative: "bg-rose-500/10 text-rose-800 dark:text-rose-300 rounded-sm",
}

/** Legend dot color + label per origin. `mention` reads as "References" to the
 *  user (it's the identity/reference directive block). Display order is fixed. */
export const LEGEND_META: ReadonlyArray<{ origin: Exclude<DisplayOrigin, "user">; label: string; dot: string }> = [
  { origin: "variable", label: "Variable", dot: "bg-sky-500" },
  { origin: "picker", label: "Picker", dot: "bg-indigo-500" },
  { origin: "snippet", label: "Snippet", dot: "bg-amber-500" },
  { origin: "mention", label: "References", dot: "bg-violet-500" },
  { origin: "style", label: "Style", dot: "bg-muted-foreground" },
  { origin: "negative", label: "Negative", dot: "bg-rose-500" },
]

interface PromptFieldFinalViewProps {
  /** Origin-tagged segments to render as colored spans. INVARIANT (upstream):
   *  `segments.map(s => s.text).join("")` equals `plainText` when non-empty. */
  readonly segments: readonly DisplaySegment[]
  /** The plain assembled text — copied verbatim to the clipboard. When empty,
   *  the muted placeholder renders instead of the segments. */
  readonly plainText: string
  /** The editor's placeholder, shown muted when the field is empty. */
  readonly placeholder?: string
  /** Optional one-line caption under the card (negative-field routing note:
   *  "Sent natively …" vs "Appended to the prompt as \"Avoid: …\""). */
  readonly routingCaption?: string
  /** Min-height of the card body, in rem — callers pass the editor's
   *  `rows * 1.5` (the {@link PromptEditor}/`TagTextarea` minHeight formula) so a
   *  tall field doesn't visibly shrink when toggled to final view. Falls back to
   *  the default `4.5rem` (= a 3-row prompt) when absent. */
  readonly minHeightRem?: number
  readonly className?: string
}

/**
 * Read-only rendering of a field's assembled final prompt, shown in place of
 * the editor when the field is toggled to "final" mode. Visually matched to
 * {@link PromptEditor}'s wrapper (same `rounded-md border border-input
 * bg-transparent text-sm shadow-xs` frame + `px-3 py-2` content padding the
 * `.prompt-editor__content` CSS applies) so toggling Edit⇄Final doesn't shift
 * layout.
 *
 * Renders `segments` as origin-colored spans with a compact legend (only the
 * origins actually present), plus a Copy button that writes PLAIN text — the
 * tints are a display layer only and never reach the clipboard or the model.
 */
export function PromptFieldFinalView({
  segments,
  plainText,
  placeholder,
  routingCaption,
  minHeightRem,
  className,
}: PromptFieldFinalViewProps) {
  const hasContent = plainText.length > 0

  // Legend shows only when ≥1 non-user origin is present.
  const presentOrigins = useMemo(() => {
    const set = new Set<DisplayOrigin>()
    for (const s of segments) set.add(s.origin)
    return set
  }, [segments])
  const legendItems = LEGEND_META.filter((l) => presentOrigins.has(l.origin))

  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!hasContent) return
    void navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className={cn(
          "relative rounded-md border border-input bg-transparent text-sm shadow-xs",
          "px-3 py-2",
          // Default min-height (= a 3-row prompt); overridden by the inline
          // style below when the caller passes the editor's exact rows*1.5.
          minHeightRem == null && "min-h-[4.5rem]",
        )}
        style={minHeightRem != null ? { minHeight: `${minHeightRem}rem` } : undefined}
      >
        <button
          type="button"
          onClick={handleCopy}
          disabled={!hasContent}
          aria-label="Copy final prompt"
          title={hasContent ? "Copy to clipboard" : "Nothing to copy"}
          className={cn(
            "absolute right-1.5 top-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 transition-colors",
            hasContent
              ? "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#2D2D2D] cursor-pointer"
              : "text-muted-foreground/40 cursor-not-allowed",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        {hasContent ? (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words pr-12 text-foreground">
            {segments.map((s, i) => (
              <span key={i} className={ORIGIN_CLASS[s.origin]}>{s.text}</span>
            ))}
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted-foreground pr-12">
            {placeholder ?? ""}
          </p>
        )}
      </div>
      {legendItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 pt-0.5" aria-label="Prompt provenance legend">
          {legendItems.map((l) => (
            <span key={l.origin} className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span className={cn("inline-block size-2 rounded-full", l.dot)} aria-hidden="true" />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {routingCaption && (
        <p className="px-0.5 text-[10px] text-muted-foreground">{routingCaption}</p>
      )}
    </div>
  )
}

interface PromptFieldModeToggleProps {
  /** Current field mode. */
  readonly mode: "edit" | "final"
  /** Fires on click to swap modes (caller owns the state). */
  readonly onToggle: () => void
  readonly className?: string
}

/**
 * Label-row icon button that swaps a field between Edit and Final views.
 * Styled to match {@link SnippetMenuButton}'s trigger (small ghost icon button)
 * so the label row reads as one cohesive control cluster. In edit mode it
 * offers an Eye ("Show final prompt"); in final mode a Pencil ("Edit prompt").
 */
export function PromptFieldModeToggle({ mode, onToggle, className }: PromptFieldModeToggleProps) {
  const label = mode === "edit" ? "Show final prompt" : "Edit prompt"
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
        className,
      )}
    >
      {mode === "edit" ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
    </button>
  )
}
