"use client"

/**
 * The EDL validity badge, split by surface (decided 2026-10-04):
 *  - on the Edit Plan node's plan, "Well-formed EDL" / "N EDL issues": it
 *    promises structure only;
 *  - with `renders` (the Apply EDL config panel; later the review inspector and
 *    Render final), "Ready to render" / "N EDL issues": it judges every render
 *    the node's Run would make now, each with its own EDL and Sources, with
 *    Apply EDL's own render rule, which also refuses what the renderer cannot
 *    draw. When the run makes several renders (a list wired into EDL or into
 *    Sources fans it out), the one pill sums them up ("Issues in 2 of 5
 *    renders") and the popover lists each failing render by its number, with
 *    its reasons (decided 2026-10-05).
 * The verdict is `edlValidityOf` / `applyEdlRendersValidity`, computed once per
 * input; the details are the validators' own messages, shown left-to-right in
 * every locale (they quote field names).
 */
import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  applyEdlRendersValidity,
  edlValidityOf,
  type ApplyEdlRenderInput,
  type ApplyEdlRenderSettings,
  type EdlRenderVerdict,
  type EdlValidity,
} from "@/lib/edl-validity"
import { INSPECTOR_POPPER } from "./inspector-shell"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

function MessageList({ title, messages }: { readonly title: string; readonly messages: readonly string[] }) {
  if (messages.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-[11px] font-medium text-muted-foreground">{title}</div>
      <ul dir="ltr" className="flex flex-col gap-0.5 max-h-48 overflow-auto">
        {messages.map((m, i) => (
          <li key={i} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-snug break-words">{m}</li>
        ))}
      </ul>
    </div>
  )
}

/** The failing renders of a run that makes several, each under its number
 *  (its row, from 1), with its reasons in the render rule's words. */
function RenderIssueList({ failing }: { readonly failing: readonly EdlRenderVerdict[] }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 max-h-64 overflow-auto">
      {failing.map((r) => (
        <div key={r.row} data-testid="edl-render-issues" data-row={r.row} className="flex flex-col gap-1">
          <div className="px-1 text-[11px] font-medium text-muted-foreground">{t("node.edlRenderN", { n: r.row + 1 })}</div>
          <ul dir="ltr" className="flex flex-col gap-0.5">
            {r.issues.map((m, i) => (
              <li key={i} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-snug break-words">{m}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function label(v: EdlValidity, rendered: boolean, t: ReturnType<typeof useT>): string {
  if (v.unparseable) return t("node.edlNotJson")
  if (!v.ok && v.renders) return t("node.edlRendersFailing", { n: v.renders.failing.length, total: v.renders.total })
  if (!v.ok) return v.issues.length === 1 ? t("node.edlIssuesOne") : t("node.edlIssuesMany", { n: v.issues.length })
  return rendered ? t("node.edlReadyToRender") : t("node.edlWellFormed")
}

export function EdlValidityBadge({ value, renders, settings, className }: {
  /** Structure mode: the EDL value to check (the Edit Plan badge). */
  readonly value?: unknown
  /** Render mode: every render the node's Run would make (see
   *  `resolveApplyEdlRenders`), judged with Apply EDL's render rule and
   *  `settings`. Takes the place of `value`. */
  readonly renders?: readonly ApplyEdlRenderInput[]
  readonly settings?: ApplyEdlRenderSettings
  readonly className?: string
}) {
  const t = useT()
  const rendered = renders !== undefined && settings !== undefined
  // Keyed on the settings' fields, not their object: a caller may build it inline.
  const output = settings?.output
  const crossfadeMs = settings?.crossfadeMs
  const validity = useMemo(
    () =>
      renders !== undefined && output !== undefined && crossfadeMs !== undefined
        ? applyEdlRendersValidity(renders, { output, crossfadeMs })
        : edlValidityOf(value),
    [value, renders, output, crossfadeMs],
  )
  const [open, setOpen] = useState(false)
  if (!validity) return null
  const mode = rendered ? "render" : "structure"

  const warningCount = validity.warnings.length
  const hasDetails = validity.issues.length > 0 || warningCount > 0
  const tone = !validity.ok
    ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
    : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  const Icon = validity.ok ? CheckCircle2 : XCircle

  const pill = (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label(validity, rendered, t)}</span>
      {validity.ok && warningCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          {warningCount === 1 ? t("node.edlWarningsOne") : t("node.edlWarningsMany", { n: warningCount })}
        </span>
      )}
    </span>
  )
  const pillClass = cn(
    "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums",
    tone,
    className,
  )

  if (!hasDetails) {
    return <span data-testid="edl-validity-badge" data-ok={validity.ok} data-mode={mode} className={pillClass}>{pill}</span>
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="edl-validity-badge"
          data-ok={validity.ok}
          data-mode={mode}
          // A trigger inside a canvas node must not start a drag or a pan, and
          // React Flow must not read its keys (Backspace would delete the node).
          className={cn(pillClass, "nodrag nopan nokey cursor-pointer hover:opacity-90")}
          onClick={(e) => e.stopPropagation()}
        >
          {pill}
        </button>
      </PopoverTrigger>
      {/* Portaled to <body>, on the canvas and inside an inspector alike: keys stay
          away from React Flow and the list scrolls under the inspector's scroll
          lock (INSPECTOR_POPPER); z-[10000] sits above the inspector's z-[9999]. */}
      <PopoverContent
        align="start"
        side="bottom"
        onWheel={INSPECTOR_POPPER.onWheel}
        className={cn(INSPECTOR_POPPER.className, "nowheel z-[10000] w-80 p-2 flex flex-col gap-2")}
      >
        {validity.renders ? (
          <RenderIssueList failing={validity.renders.failing} />
        ) : (
          <MessageList title={t("node.edlIssuesTitle")} messages={validity.issues} />
        )}
        <MessageList title={t("node.edlWarningsTitle")} messages={validity.warnings} />
      </PopoverContent>
    </Popover>
  )
}
