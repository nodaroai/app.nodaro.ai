// One part of the Cast Swap engine's prompt, as an admin edits it: the
// engine's default (greyed, read-only), the override (empty = the default,
// "-" removes the part), Reset, the placeholders it may use, and what the
// engine found wrong with it. Shared by a trend's engine prompt
// (EnginePromptParts.tsx) and Admin → Nodaro Motion's (PromptPartsTabs.tsx).
//
// "Default changed" (a trend's only: it stores the hash of the default each
// override replaced) says the engine's default moved since the override was
// written, so the admin re-reads it.

import { useId } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { CastSwapPromptPartId, PromptPart, PromptPartProblem } from "@/lib/api"

/** The most an override may hold (the engine refuses a longer one). */
export const PROMPT_PART_MAX = 2000

/** What each part is, in the admin's words. */
export const PROMPT_PART_LABELS: Readonly<Record<CastSwapPromptPartId, string>> = {
  opener: "Opening line",
  original: "The original video",
  scene: "The scene, described",
  quality: "Quality",
  keep: "Keep motion and timing",
  audio: "Sound and lip sync",
  face: "Identity",
  depthGuard: "Depth guard",
  person: "Each person",
  pet: "Each pet",
  product: "Each product",
  location: "Each location",
  avoid: "Avoid list",
  postHeader: "Header before the post prompt",
}

/** A problem as a sentence: the engine's own, except for the codes the screen words itself. */
export function problemText(p: PromptPartProblem): string {
  if (p.code === "part_required") return "This part is required in this mode."
  return p.message
}

interface Props {
  readonly part: PromptPart
  /** The override as edited ("" = the default). */
  readonly value: string
  readonly onChange: (next: string) => void
  readonly problems?: readonly PromptPartProblem[]
  /** The stored override was written against another default. */
  readonly defaultChanged?: boolean
  readonly disabled?: boolean
}

export function PromptPartRow({ part, value, onChange, problems = [], defaultChanged = false, disabled = false }: Props) {
  const id = useId()
  const label = PROMPT_PART_LABELS[part.id] ?? part.id
  const over = value.length > PROMPT_PART_MAX
  return (
    <div role="group" aria-labelledby={`${id}-label`} data-part={part.id} className="flex flex-col gap-1.5 rounded-md border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        {!part.applies && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Not used in this mode</span>}
        {defaultChanged && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Default changed</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto min-h-8"
          disabled={disabled || value === ""}
          aria-label={`Reset ${label} to the default`}
          onClick={() => onChange("")}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
      </div>
      <p aria-label={`${label}: the default`} className="whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs text-muted-foreground">
        {part.default || "(empty)"}
      </p>
      <Textarea
        aria-label={`${label}: your text`}
        aria-describedby={`${id}-help`}
        aria-invalid={over || problems.length > 0}
        rows={2}
        value={value}
        disabled={disabled}
        placeholder='Empty: the default. "-" removes the part.'
        onChange={(e) => onChange(e.target.value)}
      />
      <div id={`${id}-help`} className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {part.placeholders.length > 0 ? `Placeholders: ${part.placeholders.join(" ")}` : "No placeholders."}
          {part.required.length > 0 ? ` Must keep: ${part.required.join(" ")}.` : ""}
        </span>
        <span className={cn("tabular-nums", over && "text-destructive")}>
          {value.length} / {PROMPT_PART_MAX}
        </span>
      </div>
      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
          {problems.map((p, i) => (
            <li key={i}>{problemText(p)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The assembled prompt with its length against the engine's limit, and the problems that name no part. */
export function AssembledPrompt({
  assembled,
  length,
  max,
  problems = [],
}: {
  readonly assembled: string
  readonly length: number
  readonly max: number
  readonly problems?: readonly PromptPartProblem[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">The prompt the engine sends</span>
        <span data-testid="assembled-length" className={cn("tabular-nums", length > max ? "text-destructive" : "text-muted-foreground")}>
          {length} / {max}
        </span>
      </div>
      <pre aria-label="The assembled prompt" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">
        {assembled}
      </pre>
      {problems.length > 0 && (
        <ul aria-label="Prompt problems" className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
          {problems.map((p, i) => (
            <li key={i}>{problemText(p)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The rows to show: every part the mode uses, and any other with text (a stored override the mode no longer uses must stay resettable). */
export function partsShown(parts: readonly PromptPart[], texts: Partial<Record<CastSwapPromptPartId, string>>): PromptPart[] {
  return parts.filter((p) => p.applies || (texts[p.id] ?? "") !== "")
}

/** The texts without the empty ones (empty = the default). */
export function nonEmpty(texts: Partial<Record<CastSwapPromptPartId, string>>): Partial<Record<CastSwapPromptPartId, string>> {
  return Object.fromEntries(Object.entries(texts).filter(([, v]) => typeof v === "string" && v.trim() !== "")) as Partial<Record<CastSwapPromptPartId, string>>
}
