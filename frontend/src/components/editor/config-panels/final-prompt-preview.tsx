"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { collectCinematographyHints, hasConnectedStyleNode } from "@/lib/cinematography-hints"
import { getStylePromptHint } from "@nodaro-shared/style"

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
 * The per-hint bullet list exposes the raw fragment each connected source
 * contributes, so a missing hint points at a broken connection rather than
 * a composition bug.
 */
export function FinalPromptPreview({
  userPrompt,
  style,
  negativePrompt,
  consumerNodeId,
  nodes,
  edges,
  className,
}: FinalPromptPreviewProps) {
  const { composed, cineHints, trimmedNegative, copyText } = useMemo(() => {
    const trimmedUser = (userPrompt ?? "").trim()
    // Bypass inline style entirely when a Style node is wired — mirrors the
    // runtime bypass in execute-node.ts and payload-builder.ts so the preview
    // matches what the provider actually receives.
    const styleBypass = hasConnectedStyleNode(consumerNodeId, nodes, edges)
    const rawStyle = (style ?? "").trim()
    const trimmedStyle = styleBypass ? "" : rawStyle
    // Upgrade the inline style from its bare id to the catalog's richer
    // promptHint when the id is a known preset; fall back to the raw text for
    // custom free-text styles. Matches buildImagePrompt.
    const styleText = trimmedStyle
      ? (getStylePromptHint(trimmedStyle) || trimmedStyle)
      : ""
    const neg = (negativePrompt ?? "").trim()
    const hints = consumerNodeId
      ? collectCinematographyHints(consumerNodeId, nodes, edges)
      : []

    const baseParts: string[] = []
    if (trimmedUser) baseParts.push(trimmedUser)
    if (hints.length > 0) baseParts.push(hints.join(", "))
    let promptText = baseParts.join(". ")
    if (styleText) promptText += (promptText ? "\n" : "") + `Style: ${styleText}`

    const copyLines: string[] = []
    if (promptText) copyLines.push(promptText)
    if (neg) copyLines.push(`Negative prompt: ${neg}`)

    return {
      composed: promptText,
      cineHints: hints,
      trimmedNegative: neg,
      copyText: copyLines.join("\n\n"),
    }
  }, [userPrompt, style, negativePrompt, consumerNodeId, nodes, edges])

  const hasPrompt = composed.length > 0
  const hasNegative = trimmedNegative.length > 0
  const hasContent = hasPrompt || hasNegative

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
          <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
            {composed}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">
            (empty — type a prompt and/or connect cinematography nodes)
          </p>
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
      {hasNegative && (
        <div className="rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2 mt-1">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Negative prompt
          </p>
          <p className="text-[11px] font-mono text-gray-700 dark:text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">
            {trimmedNegative}
          </p>
        </div>
      )}
    </div>
  )
}
