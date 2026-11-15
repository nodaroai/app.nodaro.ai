/**
 * The line at the top of Edit with AI: whether anything is happening, what,
 * and how far along. It is always there, so the person never has to guess
 * whether the agents are still at work (`statusOf`).
 */
import { AlertTriangle, Ban, Check, Circle, Eye, Loader2, Square, Undo2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { StatusIcon, StatusKind, StatusModel } from "@/ee/lib/freecut-ai/panel-model"

const ICONS: Record<StatusIcon, typeof Check> = {
  dot: Circle,
  spin: Loader2,
  check: Check,
  alert: AlertTriangle,
  ban: Ban,
  square: Square,
  undo: Undo2,
  eye: Eye,
}

const TONE: Record<StatusKind, string> = {
  ready: "text-white/70",
  busy: "text-sky-300",
  ok: "text-emerald-300",
  warn: "text-amber-200",
  original: "text-violet-200",
}

export function StatusBlock({ model, subText }: { readonly model: StatusModel; readonly subText?: string }) {
  const t = useT()
  const Icon = ICONS[model.icon]
  const sub = subText ?? (model.sub ? t(model.sub, model.subVars) : "")
  return (
    <div className="border-b border-[#2D2D2D] px-4 py-3" data-status={model.kind}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", TONE[model.kind], model.icon === "spin" && "animate-spin", model.icon === "dot" && "h-2.5 w-2.5 fill-current")} aria-hidden />
        <p className={cn("text-sm font-semibold", TONE[model.kind])} aria-live="polite">
          {t(model.title, model.titleVars)}
        </p>
      </div>
      {sub ? <p className="mt-1 text-xs leading-snug text-white/65" dir="auto">{sub}</p> : null}
      {model.bar !== undefined ? (
        <div className="mt-2 h-1 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.bar * 100)}>
          <span className="block h-full bg-sky-300 transition-[width] duration-300" style={{ width: `${Math.round(model.bar * 100)}%` }} />
        </div>
      ) : null}
    </div>
  )
}
