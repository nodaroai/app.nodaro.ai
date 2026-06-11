"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { SnippetPoolItem } from "@/lib/snippet-pool"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityMeta,
} from "@nodaro/shared"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { ORIGIN_CLASS, LEGEND_META, type DisplayOrigin } from "./prompt-field-final-view"

interface FinalPromptPreviewProps {
  /** User's prompt text (from `data.prompt` or equivalent). */
  readonly userPrompt: string | undefined
  /** Style text appended to the prompt (e.g. "cinematic, film grain"). */
  readonly style?: string
  /** Negative prompt — shown as a separate labeled section. */
  readonly negativePrompt?: string
  /** The consumer node's id; used to walk incoming cinematography edges. */
  readonly consumerNodeId: string | undefined
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /**
   * Provider key. When provided, the preview is computed by calling
   * `buildImagePromptSegments` so the rendered text is byte-identical to what
   * the runtime sends to the model (style translation, negative-prompt routing,
   * fidelity blocks, {image:N} expansion, 2000-char truncation) AND carries
   * origin tags for the colored provenance rendering.
   */
  readonly provider?: string
  /**
   * Connected references in display order. When provided alongside `provider`,
   * per-identity directives appear in the final string, `{image:N:label}` tokens
   * expand to "the {label} from image N", and URLs are sent in this order.
   */
  readonly connectedReferences?: ReadonlyArray<ConnectedReference>
  readonly identityMeta?: ReadonlyArray<IdentityMeta>
  /**
   * Legacy character definitions (only used when `connectedReferences` is
   * NOT provided). Lets the preview emit the same character-template
   * intro that the legacy path of `buildImagePrompt` produces.
   */
  readonly characterDefs?: ReadonlyArray<CharacterDef>
  /**
   * Prompt-field snippet pool for this node's modality+target. When provided,
   * snippet fragments inside the user-typed prose are highlighted (amber). The
   * pool is the same object the SnippetMenuButton / PromptEditor consume.
   */
  readonly snippets?: readonly SnippetPoolItem[]
  /** Negative-field snippet pool (highlights snippets in the negative card). */
  readonly negativeSnippets?: readonly SnippetPoolItem[]
  readonly className?: string
}

/**
 * Live preview of the final prompt that will be sent to the provider for an
 * AI gen node. Composes user prompt + cinematography hints + style the same
 * way `buildImagePrompt` does (". " between base parts, "\nStyle: …" appended
 * for style). Negative prompt is shown in its own card because providers
 * route it differently (native field for some, "Avoid: …" appended for
 * others) — separate display sidesteps that routing ambiguity.
 *
 * When `provider` is set, the prompt is rendered as origin-colored spans
 * (your text, {variables}, picker fragments, snippets, reference directives,
 * style, negative) with a legend. The string sent to the model is unchanged —
 * this is a display layer only, and the Copy button copies plain text.
 *
 * The per-hint bullet list exposes the raw fragment each connected source
 * contributes, so a missing hint points at a broken connection rather than
 * a composition bug.
 *
 * Assembly is delegated to {@link useFinalPromptSegments} (the single source
 * of assembly truth). This block is slated for removal once every prompt field
 * uses the inline final-view; until then it renders the hook's output.
 */
export function FinalPromptPreview({
  userPrompt,
  style,
  negativePrompt,
  consumerNodeId,
  nodes,
  edges,
  provider,
  connectedReferences,
  identityMeta,
  characterDefs,
  snippets,
  negativeSnippets,
  className,
}: FinalPromptPreviewProps) {
  const { promptText, cineHints, refBlock, negativeText, copyText, promptSegments, negativeSegments } =
    useFinalPromptSegments({
      userPrompt,
      style,
      negativePrompt,
      consumerNodeId,
      nodes,
      edges,
      provider,
      connectedReferences,
      identityMeta,
      characterDefs,
      snippets,
      negativeSnippets,
    })

  const hasPrompt = promptText.length > 0
  const hasNegative = negativeText.length > 0
  const hasContent = hasPrompt || hasNegative

  // Legend shows only when ≥1 non-user origin is present across both cards.
  const presentOrigins = useMemo(() => {
    const set = new Set<DisplayOrigin>()
    for (const s of promptSegments) set.add(s.origin)
    for (const s of negativeSegments) set.add(s.origin)
    return set
  }, [promptSegments, negativeSegments])
  const legendItems = LEGEND_META.filter((l) => presentOrigins.has(l.origin))

  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!hasContent) return
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          Final prompt
        </p>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!hasContent}
          aria-label="Copy final prompt"
          title={hasContent ? "Copy to clipboard" : "Nothing to copy"}
          className={cn(
            "flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 transition-colors",
            hasContent
              ? "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#2D2D2D] cursor-pointer"
              : "text-muted-foreground/40 cursor-not-allowed",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2">
        {hasPrompt ? (
          promptSegments.length > 0 ? (
            <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
              {promptSegments.map((s, i) => (
                <span key={i} className={ORIGIN_CLASS[s.origin]}>{s.text}</span>
              ))}
            </p>
          ) : (
            <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
              {promptText}
            </p>
          )
        ) : (
          <p className="text-[11px] italic text-muted-foreground">
            (empty — type a prompt and/or connect cinematography nodes)
          </p>
        )}
        {refBlock && (
          <div className="pt-1 border-t border-gray-200 dark:border-[#2D2D2D]">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
              References ({connectedReferences?.length ?? 0})
            </p>
            <p className="text-[10px] font-mono text-muted-foreground leading-snug whitespace-pre-wrap break-words">
              {refBlock}
            </p>
          </div>
        )}
        {cineHints.length > 0 && (
          <div className="pt-1 border-t border-gray-200 dark:border-[#2D2D2D]">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
              Cinematography ({cineHints.length})
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-[10px] font-mono text-muted-foreground leading-snug">
              {cineHints.map((hint, i) => (
                <li key={i} className="whitespace-pre-wrap break-words">{hint}</li>
              ))}
            </ul>
          </div>
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
      {hasNegative && (
        <div className="rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2 mt-1">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Negative prompt
          </p>
          {negativeSegments.length > 0 ? (
            <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
              {negativeSegments.map((s, i) => (
                <span key={i} className={ORIGIN_CLASS[s.origin]}>{s.text}</span>
              ))}
            </p>
          ) : (
            <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
              {negativeText}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
