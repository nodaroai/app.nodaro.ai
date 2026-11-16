/**
 * Under the titles row, before the run: the look every text takes (one look
 * for the whole video) and how many texts (the video's length sets it: two
 * for half a minute, four for a minute).
 */
import { formatNumber, useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { TITLE_MAX, TITLE_MIN } from "@/ee/lib/freecut-ai/run/titles"
import { TITLE_LOOKS, type TitleLook } from "@/ee/lib/freecut-ai/title-style"
import { CountStepper } from "./picture-count"

export const LOOK_NAME: Record<TitleLook, MessageKey> = {
  outline: "freecutAi.titles.look.outline",
  clean: "freecutAi.titles.look.clean",
  sticker: "freecutAi.titles.look.sticker",
}

/** Two letters drawn the way the look draws a text: white with a black line, white with a soft shadow, or dark on yellow. */
const SAMPLE: Record<TitleLook, string> = {
  outline: "text-white [-webkit-text-stroke:1.5px_#000] [paint-order:stroke_fill]",
  clean: "text-white [text-shadow:0_1px_3px_#000]",
  sticker: "rounded-[3px] bg-[#FFD60A] px-1 text-[#0B0B0C]",
}

/** Two letters, not words: the same in every language. */
const SAMPLE_LETTERS = "Aa"

export interface TitleOptionsProps {
  readonly look: TitleLook
  readonly count: number
  readonly locked: boolean
  readonly onLook: (look: TitleLook) => void
  readonly onCount: (count: number) => void
}

export function TitleOptions({ look, count, locked, onLook, onCount }: TitleOptionsProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={t("freecutAi.titles.look")} className="ms-9 flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
        {TITLE_LOOKS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={look === option}
            disabled={locked}
            onClick={() => onLook(option)}
            className={cn("flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium transition-colors disabled:cursor-default", look === option ? "bg-white/[0.14] text-white" : "text-white/60 hover:text-white")}
          >
            <span aria-hidden className={cn("text-[13px] font-black leading-none", SAMPLE[option])}>
              {SAMPLE_LETTERS}
            </span>
            {t(LOOK_NAME[option])}
          </button>
        ))}
      </div>
      <CountStepper
        count={count}
        min={TITLE_MIN}
        max={TITLE_MAX}
        label={count === 1 ? t("freecutAi.titles.countOne") : t("freecutAi.titles.count", { n: formatNumber(count) })}
        fewer={t("freecutAi.titles.fewer")}
        more={t("freecutAi.titles.more")}
        locked={locked}
        onCount={onCount}
      />
    </div>
  )
}
