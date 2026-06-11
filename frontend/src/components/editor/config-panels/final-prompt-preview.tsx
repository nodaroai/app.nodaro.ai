"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { collectCinematographyHints, hasConnectedStyleNode } from "@/lib/cinematography-hints"
import { buildNodeRefMap, resolveTextRefs, resolveTextRefsSegments } from "@/lib/node-refs"
import { matchSnippetRanges } from "@/lib/snippet-matching"
import type { SnippetPoolItem } from "@/lib/snippet-pool"
import { getStylePromptHint } from "@nodaro/shared"
import { buildImagePromptSegments, buildIdentityDirectives } from "@nodaro/shared"
import { collectIdentityLockClause } from "@nodaro/shared"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityMeta,
  PromptSegment,
  PromptSegmentOrigin,
} from "@nodaro/shared"

/**
 * Display-only provenance origin. Extends the shared {@link PromptSegmentOrigin}
 * with a frontend-local "snippet" tag (snippets are matched here, in a post-pass
 * over user-origin spans, not by the shared prompt builder).
 */
type DisplayOrigin = PromptSegmentOrigin | "snippet"

interface DisplaySegment {
  readonly text: string
  readonly origin: DisplayOrigin
}

/** Tailwind classes per provenance origin (preview-only; never affects the
 *  string sent to the model). `user` text is unstyled. */
const ORIGIN_CLASS: Record<DisplayOrigin, string> = {
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
const LEGEND_META: ReadonlyArray<{ origin: Exclude<DisplayOrigin, "user">; label: string; dot: string }> = [
  { origin: "variable", label: "Variable", dot: "bg-sky-500" },
  { origin: "picker", label: "Picker", dot: "bg-indigo-500" },
  { origin: "snippet", label: "Snippet", dot: "bg-amber-500" },
  { origin: "mention", label: "References", dot: "bg-violet-500" },
  { origin: "style", label: "Style", dot: "bg-muted-foreground" },
  { origin: "negative", label: "Negative", dot: "bg-rose-500" },
]

/**
 * Split `user`-origin segments on snippet texts (exact substring match via
 * {@link matchSnippetRanges}), tagging matched spans `origin: "snippet"`.
 * Non-user segments pass through untouched (snippets only live in user-typed
 * prose). Each user segment is scanned independently, so `occupied` is `[]`.
 * Text is only partitioned, never altered → the join is preserved exactly.
 */
function splitUserSegmentsBySnippets(
  segments: readonly DisplaySegment[],
  snippets: readonly SnippetPoolItem[],
): DisplaySegment[] {
  if (snippets.length === 0) return [...segments]
  const out: DisplaySegment[] = []
  for (const seg of segments) {
    if (seg.origin !== "user" || !seg.text) {
      out.push(seg)
      continue
    }
    const ranges = matchSnippetRanges(seg.text, snippets, [])
    if (ranges.length === 0) {
      out.push(seg)
      continue
    }
    let cursor = 0
    for (const r of ranges) {
      if (r.start > cursor) out.push({ text: seg.text.slice(cursor, r.start), origin: "user" })
      out.push({ text: seg.text.slice(r.start, r.end), origin: "snippet" })
      cursor = r.end
    }
    if (cursor < seg.text.length) out.push({ text: seg.text.slice(cursor), origin: "user" })
  }
  return out
}

/**
 * Build origin-tagged display segments for a negative-prompt field. Resolves
 * {Label} variables, splits snippets, then GUARDS the join: if the tinted
 * segments don't reconstruct the displayed text (e.g. the provider rewrote the
 * native negative prompt), collapse to a single plain `user` segment so the
 * rendered text always equals the plain text byte-for-byte.
 */
function buildNegativeSegments(
  displayedNegative: string,
  rawNeg: string,
  refMap: ReadonlyMap<string, string>,
  snippets: readonly SnippetPoolItem[],
): DisplaySegment[] {
  if (!displayedNegative) return []
  const resolved = resolveTextRefsSegments(rawNeg, refMap) as DisplaySegment[]
  const split = splitUserSegmentsBySnippets(resolved, snippets)
  if (split.map((s) => s.text).join("") === displayedNegative) return split
  return [{ text: displayedNegative, origin: "user" }]
}

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
  // Stabilize the optional pools so an undefined prop doesn't churn a new []
  // identity every render and re-run the memo. (Callers already memoize the
  // pools via useSnippetPool, so the prop identity is stable when provided.)
  const promptSnippets = useMemo<readonly SnippetPoolItem[]>(() => snippets ?? [], [snippets])
  const negSnippets = useMemo<readonly SnippetPoolItem[]>(() => negativeSnippets ?? [], [negativeSnippets])

  const { composed, cineHints, refBlock, trimmedNegative, copyText, promptSegments, negativeSegments } = useMemo(() => {
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

    // Provider-aware path: invoke buildImagePromptSegments for byte-identical
    // preview AND origin-tagged spans.
    if (provider) {
      // Body segments mirroring the preBuildPrompt composition above EXACTLY
      // (same ". " / ", " / " " joiners), so their join matches preBuildPrompt
      // and buildImagePromptSegments keeps them instead of collapsing.
      const userSegs = resolveTextRefsSegments(rawUser, refMap)
      const bodySegs: PromptSegment[] = [...userSegs]
      if (hints.length > 0) {
        if (resolvedUser) bodySegs.push({ text: ". ", origin: "user" })
        hints.forEach((h, i) => {
          if (i > 0) bodySegs.push({ text: ", ", origin: "user" })
          bodySegs.push({ text: h, origin: "picker" })
        })
      }
      if (identityClause) {
        if (bodySegs.length > 0) bodySegs.push({ text: " ", origin: "user" })
        bodySegs.push({ text: identityClause, origin: "mention" })
      }
      // Dev-invariant: if our segment composition diverges from the string the
      // preview actually builds (e.g. a variable value introduced boundary
      // whitespace that .trim() removed), pass undefined so the builder
      // collapses the body to one user span rather than rendering a wrong split.
      const bodySegsValid = bodySegs.map((s) => s.text).join("") === preBuildPrompt

      const result = buildImagePromptSegments(
        {
          prompt: preBuildPrompt,
          provider,
          style: styleBypass ? undefined : style,
          negativePrompt: resolvedNeg || undefined,
          connectedReferences: refs.length > 0 ? [...refs] : undefined,
          identityMeta: meta.length > 0 ? [...meta] : undefined,
          characterDefs: characterDefs ? [...characterDefs] : undefined,
        },
        bodySegsValid ? bodySegs : undefined,
      )
      const promptText = result.prompt
      const negativeText = result.nativeNegativePrompt ?? ""
      const copyLines: string[] = []
      if (promptText) copyLines.push(promptText)
      if (negativeText) copyLines.push(`Negative prompt: ${negativeText}`)
      // Snippet post-pass over the user-origin spans (builder guarantees
      // join(segments) === promptText; splitting preserves it).
      const segs = splitUserSegmentsBySnippets(result.segments as DisplaySegment[], promptSnippets)
      return {
        composed: promptText,
        cineHints: hints,
        refBlock: refIntro,
        trimmedNegative: negativeText,
        copyText: copyLines.join("\n\n"),
        promptSegments: segs,
        negativeSegments: buildNegativeSegments(negativeText, rawNeg, refMap, negSnippets),
      }
    }

    // Provider-less fallback: legacy manual composition (kept for callers that
    // haven't wired up `provider`). Best-effort preview, not byte-identical, and
    // rendered as flat text (no provenance spans).
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
      promptSegments: [] as DisplaySegment[],
      negativeSegments: [] as DisplaySegment[],
    }
  }, [userPrompt, style, negativePrompt, consumerNodeId, nodes, edges, provider, connectedReferences, identityMeta, characterDefs, promptSnippets, negSnippets])

  const hasPrompt = composed.length > 0
  const hasNegative = trimmedNegative.length > 0
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
              {composed}
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
              {trimmedNegative}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
