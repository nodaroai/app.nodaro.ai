"use client"

/**
 * The EDL validity badge, split by surface (decided 2026-10-04):
 *  - on the Edit Plan node's plan, "Well-formed EDL" / "N EDL issues": it
 *    promises structure only;
 *  - with `render` (the Apply EDL config panel; later the review inspector and
 *    Render final), "Ready to render" / "N EDL issues": it judges the EDL the
 *    node would render now with Apply EDL's own render rule, which also refuses
 *    what the renderer cannot draw.
 * The verdict is `edlValidityOf`, computed once per value; the details are the
 * validators' own messages, shown left-to-right in every locale (they quote
 * field names).
 */
import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { edlValidityOf, type ApplyEdlRenderContext, type EdlValidity } from "@/lib/edl-validity"
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

function label(v: EdlValidity, rendered: boolean, t: ReturnType<typeof useT>): string {
  if (v.unparseable) return t("node.edlNotJson")
  if (!v.ok) return v.issues.length === 1 ? t("node.edlIssuesOne") : t("node.edlIssuesMany", { n: v.issues.length })
  return rendered ? t("node.edlReadyToRender") : t("node.edlWellFormed")
}

export function EdlValidityBadge({ value, render, className }: {
  readonly value: unknown
  /** Judge `value` as what an Apply EDL node renders, with its render rule
   *  (see `ApplyEdlRenderContext`). Absent: structure only. */
  readonly render?: ApplyEdlRenderContext
  readonly className?: string
}) {
  const t = useT()
  // Keyed on the context's fields, not its object: a caller may build it inline.
  const clipList = render?.clipList
  const output = render?.output
  const crossfadeMs = render?.crossfadeMs
  const sources = render?.sources
  const validity = useMemo(
    () =>
      edlValidityOf(
        value,
        clipList === undefined || output === undefined || crossfadeMs === undefined || sources === undefined
          ? {}
          : { render: { clipList, output, crossfadeMs, sources } },
      ),
    [value, clipList, output, crossfadeMs, sources],
  )
  const [open, setOpen] = useState(false)
  if (!validity) return null
  const mode = render ? "render" : "structure"

  const warningCount = validity.warnings.length
  const hasDetails = validity.issues.length > 0 || warningCount > 0
  const tone = !validity.ok
    ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
    : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  const Icon = validity.ok ? CheckCircle2 : XCircle

  const pill = (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label(validity, render !== undefined, t)}</span>
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
        <MessageList title={t("node.edlIssuesTitle")} messages={validity.issues} />
        <MessageList title={t("node.edlWarningsTitle")} messages={validity.warnings} />
      </PopoverContent>
    </Popover>
  )
}
