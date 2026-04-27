"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { collectCinematographyHints, hasConnectedStyleNode } from "@/lib/cinematography-hints"
import { buildNodeRefMap, resolveTextRefs } from "@/lib/node-refs"
import { getStylePromptHint } from "@nodaro-shared/style"
import { buildImagePrompt, buildIdentityDirectives } from "@nodaro-shared/prompt-builder"
import { collectIdentityLockClause } from "@nodaro-shared/identity-lock"
import type { CharacterDef, ConnectedReference, IdentityMeta } from "@nodaro-shared/types"

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
   * `buildImagePrompt` so the rendered text is byte-identical to what the
   * runtime sends to the model (style translation, negative-prompt routing,
   * fidelity blocks, {image:N} expansion, 2000-char truncation).
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
  provider,
  connectedReferences,
  identityMeta,
  characterDefs,
  className,
}: FinalPromptPreviewProps) {
  const { composed, cineHints, refBlock, trimmedNegative, copyText } = useMemo(() => {
    // Resolve {Node Label} variable refs first — this mirrors the runtime
    // step in execute-node.ts before the prompt enters buildImagePrompt.
    const refMap = consumerNodeId ? buildNodeRefMap(consumerNodeId, nodes, edges) : new Map<string, string>()
    const rawUser = (userPrompt ?? "").trim()
    const resolvedUser = (resolveTextRefs(rawUser, refMap) ?? rawUser).trim()
    const rawNeg = (negativePrompt ?? "").trim()
    const resolvedNeg = (resolveTextRefs(rawNeg, refMap) ?? rawNeg).trim()
    const styleBypass = hasConnectedStyleNode(consumerNodeId, nodes, edges)

    const hints = consumerNodeId
      ? collectCinematographyHints(consumerNodeId, nodes, edges)
      : []
    const identityClause = consumerNodeId
      ? collectIdentityLockClause(consumerNodeId, nodes, edges)
      : ""

    // Replicate the cinematography + identity-clause prefix that execute-node.ts
    // performs before invoking buildImagePrompt.
    let preBuildPrompt = resolvedUser
    if (hints.length > 0) {
      const joined = hints.join(", ")
      preBuildPrompt = preBuildPrompt ? `${preBuildPrompt}. ${joined}` : joined
    }
    if (identityClause) {
      preBuildPrompt = preBuildPrompt ? `${preBuildPrompt} ${identityClause}` : identityClause
    }

    const refs = connectedReferences ?? []
    const meta = identityMeta ?? []
    const refIntro = refs.length > 0 ? buildIdentityDirectives(preBuildPrompt, refs, meta) : ""

    // Provider-aware path: invoke buildImagePrompt for byte-identical preview.
    if (provider) {
      const result = buildImagePrompt({
        prompt: preBuildPrompt,
        provider,
        style: styleBypass ? undefined : style,
        negativePrompt: resolvedNeg || undefined,
        connectedReferences: refs.length > 0 ? [...refs] : undefined,
        identityMeta: meta.length > 0 ? [...meta] : undefined,
        characterDefs: characterDefs ? [...characterDefs] : undefined,
      })
      const promptText = result.prompt
      const negativeText = result.nativeNegativePrompt ?? ""
      const copyLines: string[] = []
      if (promptText) copyLines.push(promptText)
      if (negativeText) copyLines.push(`Negative prompt: ${negativeText}`)
      return {
        composed: promptText,
        cineHints: hints,
        refBlock: refIntro,
        trimmedNegative: negativeText,
        copyText: copyLines.join("\n\n"),
      }
    }

    // Provider-less fallback: legacy manual composition (kept for callers that
    // haven't wired up `provider`). Best-effort preview, not byte-identical.
    const trimmedStyle = styleBypass ? "" : (style ?? "").trim()
    const styleText = trimmedStyle
      ? (getStylePromptHint(trimmedStyle) || trimmedStyle)
      : ""
    const baseParts: string[] = []
    if (preBuildPrompt) baseParts.push(preBuildPrompt)
    let promptText = baseParts.join(". ")
    if (refIntro) {
      promptText = promptText ? `${refIntro}\n\n${promptText}` : refIntro
    }
    if (styleText) promptText += (promptText ? "\n" : "") + `Style: ${styleText}`

    const copyLines: string[] = []
    if (promptText) copyLines.push(promptText)
    if (resolvedNeg) copyLines.push(`Negative prompt: ${resolvedNeg}`)

    return {
      composed: promptText,
      cineHints: hints,
      refBlock: refIntro,
      trimmedNegative: resolvedNeg,
      copyText: copyLines.join("\n\n"),
    }
  }, [userPrompt, style, negativePrompt, consumerNodeId, nodes, edges, provider, connectedReferences, identityMeta, characterDefs])

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
