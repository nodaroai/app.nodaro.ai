/**
 * What Edit with AI can do, as quiet rows in their groups (Tidy up, Add, Look,
 * Format; or Make from this video): an icon, the name, a few words. A row is
 * ticked when the request asks for it; tapping it writes its words into the
 * request, or takes them out. After a run, a row says what was done; one done
 * for good on this video cannot be asked for again. Prices are not on the
 * rows: the footer says what the whole request costs.
 */
import {
  AlertTriangle,
  Captions,
  Check,
  Clapperboard,
  Eraser,
  Film,
  ImagePlus,
  LayoutGrid,
  ListOrdered,
  Music,
  Palette,
  Repeat,
  Scissors,
  Smartphone,
  Video,
  Wand2,
  ZoomIn,
  Type,
} from "lucide-react"
import type { ReactNode } from "react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ABILITIES, ABILITY_GROUPS, ABILITY_HINT, ABILITY_NAME, ABILITY_OF, GROUP_TITLE, type AbilityGroup } from "@/ee/lib/freecut-ai/abilities"
import type { EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import type { StepOutcome, StepOutcomes } from "@/ee/lib/freecut-ai/panel-model"

export const ABILITY_ICON: Record<EditStep, typeof Scissors> = {
  pauses: Scissors,
  fillers: Eraser,
  mistakes: Repeat,
  captions: Captions,
  music: Music,
  broll: ImagePlus,
  titles: Type,
  picture: Wand2,
  color: Palette,
  zoom: ZoomIn,
  phone: Smartphone,
  layout: LayoutGrid,
  cameras: Video,
  clips: Clapperboard,
  trailer: Film,
  chapters: ListOrdered,
}

export interface AbilityRowsProps {
  /** The groups shown (the panel's tab). */
  readonly groups?: readonly AbilityGroup[]
  /** The steps the request asks for now. */
  readonly asked: readonly EditStep[]
  readonly outcomes: StepOutcomes
  readonly locked: boolean
  /** Steps not offered here (this editor cannot do them yet, or there is one camera). */
  readonly hidden: readonly EditStep[]
  readonly onToggle: (step: EditStep) => void
  /** The speaker layout's frame, shown under its row while it is asked for: the wide one, or the phone. */
  readonly layoutWide?: boolean
  readonly onLayoutWide?: (wide: boolean) => void
  /** Shown under the picture row while it is asked for: which seconds it changes. */
  readonly pictureNote?: ReactNode
  /** Shown under the pictures-on-the-words row while it is asked for: how many pictures. */
  readonly brollNote?: ReactNode
  /** Shown under the titles row while it is asked for: the look, and how many texts. */
  readonly titlesNote?: ReactNode
}

/** The frame of the speaker layout: the phone, or the wide one with the speakers side by side. */
function LayoutFrame({ wide, locked, onChange }: { readonly wide: boolean; readonly locked: boolean; readonly onChange: (wide: boolean) => void }) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t("freecutAi.format.label")} className="ms-9 flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
      {([false, true] as const).map((option) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={wide === option}
          disabled={locked}
          onClick={() => onChange(option)}
          className={cn("min-h-9 flex-1 rounded-md px-2 text-[11px] font-medium transition-colors disabled:cursor-default", wide === option ? "bg-white/[0.14] text-white" : "text-white/60 hover:text-white")}
        >
          {t(option ? "freecutAi.format.wide" : "freecutAi.format.phone")}
        </button>
      ))}
    </div>
  )
}

export function AbilityRows({ groups = ABILITY_GROUPS, asked, outcomes, locked, hidden, onToggle, layoutWide = false, onLayoutWide, pictureNote, brollNote, titlesNote }: AbilityRowsProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const rows = ABILITIES.filter((a) => a.group === group && !hidden.includes(a.key))
        if (rows.length === 0) return null
        return (
          <section key={group} aria-label={t(GROUP_TITLE[group])}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">{t(GROUP_TITLE[group])}</p>
            <div className="flex flex-col gap-1">
              {rows.flatMap((a) => [
                <AbilityRow key={a.key} step={a.key} checked={asked.includes(a.key)} outcome={outcomes[a.key]} locked={locked} onToggle={onToggle} />,
                ...(a.key === "layout" && asked.includes("layout") && onLayoutWide ? [<LayoutFrame key="layout-frame" wide={layoutWide} locked={locked} onChange={onLayoutWide} />] : []),
                ...(a.key === "picture" && asked.includes("picture") && pictureNote ? [<div key="picture-note">{pictureNote}</div>] : []),
                ...(a.key === "broll" && asked.includes("broll") && brollNote ? [<div key="broll-note">{brollNote}</div>] : []),
                ...(a.key === "titles" && asked.includes("titles") && titlesNote ? [<div key="titles-note">{titlesNote}</div>] : []),
              ])}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function AbilityRow({ step, checked, outcome, locked, onToggle }: { readonly step: EditStep; readonly checked: boolean; readonly outcome?: StepOutcome; readonly locked: boolean; readonly onToggle: (step: EditStep) => void }) {
  const t = useT()
  const Icon = ABILITY_ICON[step]
  const done = outcome?.state === "done"
  const finished = done && !ABILITY_OF[step].again
  const failed = outcome?.state === "failed"
  // Still at work after its run (a render the panel follows on): it says so, and is not asked for again meanwhile.
  const late = outcome?.state === "waiting" && outcome.key !== "freecutAi.waiting"
  const sub = outcome && (done || failed || late) ? t(outcome.key, outcome.vars) : t(ABILITY_HINT[step])
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={locked || finished || late}
      onClick={() => onToggle(step)}
      title={outcome?.detail}
      className={cn(
        "group flex min-h-[44px] items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-start transition-colors disabled:cursor-default",
        checked && !finished ? "border-[#ff0073]/60 bg-[#ff0073]/10" : "border-transparent bg-white/[0.035]",
        !locked && !finished && "hover:bg-white/[0.07]",
      )}
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", checked && !finished ? "bg-[#ff0073]/20 text-[#ff7ab8]" : "bg-white/[0.06] text-white/75")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-medium leading-tight text-white">{t(ABILITY_NAME[step])}</span>
        <span className={cn("truncate text-[11px] leading-snug", failed ? "text-amber-200" : done ? "text-emerald-300/90" : "text-white/50")} dir="auto">
          {sub}
        </span>
      </span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden /> : null}
      {failed ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden /> : null}
    </button>
  )
}
