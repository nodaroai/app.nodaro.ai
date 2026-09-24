"use client"

// Right column of the Avatar Picker modal: the selected look large, its
// name / meta, the person's LOOKS as chips (pick one), the DETAILS rows, and
// the CTA row (Preview voice · Use this avatar).

import { Pause, Play, Sparkles } from "lucide-react"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { avatarStatus, avatarStatusLabel, avatarSupportsV, genderLabel } from "@/components/heygen/heygen-catalog"
import { useVoicePreview } from "@/components/heygen/use-voice-preview"
import { describeVoice } from "@/components/nodes/ai-avatar/catalog-helpers"
import { engineLabels, lookLabel, type Person } from "./model"
import { CHIP, CHIP_ON, KICKER, V_TAG } from "./styles"
import { useRovingRadiogroup } from "./use-roving-radiogroup"
import { useT, type TFunction } from "@/lib/i18n"

interface LookDetailProps {
  readonly person: Person
  readonly look: HeygenAvatar
  readonly onPickLook: (look: HeygenAvatar) => void
  readonly onUse: (look: HeygenAvatar) => void
  /** The look's default voice, when the voice catalog knows it. */
  readonly voice?: HeygenVoice
  /** e.g. "from 150 CR" — the node's run cost, when the caller knows it. */
  readonly costLabel?: string
}

function orientationLabel(look: HeygenAvatar, t: TFunction): string {
  if (look.preferredOrientation === "portrait") return t("heygen.portraitRatio")
  if (look.preferredOrientation === "landscape") return t("heygen.landscapeRatio")
  return "—"
}

function LookChips({ person, look, onPickLook }: Pick<LookDetailProps, "person" | "look" | "onPickLook">) {
  const t = useT()
  const looks = person.looks
  const roving = useRovingRadiogroup(looks.length, looks.findIndex((l) => l.avatarId === look.avatarId), (i) => onPickLook(looks[i]))
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("heygen.looks")}>
      <span className={KICKER}>{t("heygen.looksCountKicker", { n: looks.length })}</span>
      <div className="flex flex-wrap gap-1.5">
        {looks.map((l, i) => {
          const on = l.avatarId === look.avatarId
          const label = lookLabel(l, person)
          const status = avatarStatusLabel(l, t)
          return (
            <button
              key={l.avatarId}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={status ? `${label} — ${status}` : label}
              title={label}
              className={cn(CHIP, on && CHIP_ON, status && "opacity-50")}
              onClick={() => onPickLook(l)}
              {...roving(i)}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SpecRows({ person, look, voice, costLabel }: Pick<LookDetailProps, "person" | "look" | "voice" | "costLabel">) {
  const t = useT()
  // [stable test-id slug, localized label, value]
  const specs: Array<[string, string, string]> = [
    ["engine", t("cfgext.compEngine"), engineLabels(look).join(" · ")],
    ["orientation", t("heygen.orientation"), orientationLabel(look, t)],
    ["default-voice", t("heygen.defaultVoice"), voice ? describeVoice(voice).name : look.defaultVoiceId ? t("heygen.setByHeygen") : "—"],
    ["looks", t("heygen.looks"), String(person.looks.length)],
    ...(costLabel ? ([["cost", t("editorTab.cost"), costLabel]] as Array<[string, string, string]>) : []),
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <span className={KICKER}>{t("common.details")}</span>
      {specs.map(([id, k, v]) => (
        <div key={id} className="flex items-center justify-between gap-3 border-b border-border/50 py-[7px] text-[12px]" data-testid={`avatar-picker-spec-${id}`}>
          <span className="whitespace-nowrap text-muted-foreground">{k}</span>
          <span className="truncate text-foreground/85">{v}</span>
        </div>
      ))}
    </div>
  )
}

export function LookDetail({ person, look, onPickLook, onUse, voice, costLabel }: LookDetailProps) {
  const t = useT()
  const preview = useVoicePreview(voice?.previewAudio)
  const statusKind = avatarStatus(look)
  const status = avatarStatusLabel(look, t)
  const usable = statusKind === null
  const label = lookLabel(look, person)
  const n = person.looks.length

  return (
    <div className="flex min-h-0 flex-col border-s border-border/60 bg-muted/20" data-testid="avatar-picker-detail">
      <div className="relative h-[300px] shrink-0 overflow-hidden border-b border-border/60 bg-muted/40">
        <CachedImage key={look.avatarId} src={look.previewImageUrl} alt={look.name} className="h-full w-full object-cover object-top" />
        {avatarSupportsV(look) && (
          <span className={cn(V_TAG, "absolute start-3 top-3 flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[9.5px] tracking-[0.08em]")}>
            <Sparkles className="size-2.5" aria-hidden />
            AVATAR V
          </span>
        )}
        {status && (
          <span className={cn("absolute end-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold text-white", statusKind === "failed" ? "bg-red-600/90" : "bg-amber-500/90")}>
            {status}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-[15px]">
        <div className="flex flex-col">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-foreground" data-testid="avatar-picker-detail-name">
            {person.name}
            {label && label !== person.name ? ` — ${label}` : ""}
          </div>
          <div className="mt-1 text-[12.5px] text-muted-foreground">
            {genderLabel(person.gender, t) || "—"} · {n === 1 ? t("heygen.looksAvailableOne", { n }) : t("heygen.looksAvailable", { n })}
          </div>
        </div>

        <LookChips person={person} look={look} onPickLook={onPickLook} />
        <SpecRows person={person} look={look} voice={voice} costLabel={costLabel} />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-[13px]">
        <button
          type="button"
          onClick={preview.toggle}
          disabled={!preview.canPlay}
          aria-label={preview.isPlaying ? t("heygen.pauseVoicePreview") : t("heygen.previewVoice")}
          title={preview.canPlay ? undefined : t("heygen.noVoiceSample")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3.5 py-2.5 text-[12.5px] text-foreground/80 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
        >
          {preview.isPlaying ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {t("heygen.previewVoice")}
        </button>
        <button
          type="button"
          onClick={() => onUse(look)}
          disabled={!usable}
          title={usable ? undefined : t("heygen.lookNotFinished")}
          className="flex-1 rounded-lg bg-[#ff0073] py-2.5 text-center text-[13px] font-medium text-white hover:bg-[#e6006a] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
        >
          {t("heygen.useThisAvatar")}
        </button>
      </div>
    </div>
  )
}
