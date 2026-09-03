"use client"

// The voice strip at the top of the configured card's right column: the
// picked voice (name + "Language · Gender"), a small level meter that comes
// alive while the preview plays, and the play button. Clicking the voice opens
// the full voice picker (search, language / gender filters, previews) in a
// popover anchored to the row, so the voice can be changed without leaving the
// card. Renders from the stored voiceName first — the catalog only ENRICHES
// (language, gender, preview clip), so a workflow authored elsewhere still
// shows its voice on a keyless install.

import { useT } from "@/lib/i18n"
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react"
import { ChevronDown, Music, Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { HeygenVoice } from "@/lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useHeygenVoices } from "@/components/heygen/heygen-catalog"
import { useVoicePreview } from "@/components/heygen/use-voice-preview"
import { VoicePicker } from "@/components/heygen/voice-picker"
import { describeVoice } from "./catalog-helpers"
import { PANEL_EDGE } from "./styles"

/** Idle meter heights (px) — a plausible, deterministic envelope. */
const BAR_HEIGHTS = [7, 12, 5, 15, 9, 17, 6, 13, 8, 16, 5, 11, 14, 7] as const

interface VoiceRowProps {
  readonly voiceId?: string
  readonly voiceName?: string
  /** A voice was picked in the popover — write it to the node. */
  readonly onSelectVoice: (voice: HeygenVoice) => void
}

function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation()
}

export function VoiceRow({ voiceId, voiceName, onSelectVoice }: VoiceRowProps) {
  const t = useT()
  const { data: voices } = useHeygenVoices()
  const voice = useMemo(
    () => (voiceId ? voices.find((v) => v.voiceId === voiceId) : undefined),
    [voices, voiceId],
  )
  const described = voice ? describeVoice(voice) : undefined
  const name = described?.name || voiceName?.trim() || (voiceId ? "Voice" : "")
  const meta = described?.meta ?? ""
  const { isPlaying, canPlay, toggle } = useVoicePreview(voice?.previewAudio)
  const [open, setOpen] = useState(false)

  const handlePlay = (e: MouseEvent) => { stop(e); toggle() }

  return (
    <div
      className={cn("shrink-0 flex items-center gap-2.5 px-3 py-2 border-b", PANEL_EDGE)}
      data-testid="ai-avatar-voice-row"
      data-playing={isPlaying ? "" : undefined}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nodrag nopan group/voice flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            onClick={stop}
            title={t("node.changeVoice")}
            aria-label={voiceId ? `Voice: ${name}. Change voice` : "Choose a voice"}
            aria-expanded={open}
          >
            <span className="grid place-items-center w-7 h-7 rounded-md border border-border/60 bg-muted/40 text-muted-foreground shrink-0">
              <Music className="size-3" />
            </span>
            <span className="flex flex-col min-w-0">
              {voiceId ? (
                <>
                  <span className="text-[12px] text-foreground truncate leading-tight">{name}</span>
                  {meta && <span className="text-[10.5px] text-muted-foreground truncate leading-tight">{meta}</span>}
                </>
              ) : (
                <>
                  <span className="text-[12px] text-[#ff0073] leading-tight">{t("node.chooseAVoice")}</span>
                  <span className="text-[10.5px] text-muted-foreground leading-tight">{t("node.neededForTextTts")}</span>
                </>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-muted-foreground/60 transition-transform ml-0.5",
                open ? "rotate-180 opacity-100" : "opacity-0 group-hover/voice:opacity-100",
              )}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="node-menu-surface w-[400px] p-2"
          onClick={stop}
          onKeyDown={stop}
          data-testid="ai-avatar-voice-popover"
        >
          <VoicePicker
            value={voiceId}
            onSelect={(v) => { onSelectVoice(v); setOpen(false) }}
          />
        </PopoverContent>
      </Popover>

      {/* Level meter — static envelope; the bars breathe while the preview plays. */}
      <span className="flex items-center gap-[3px] h-[18px] shrink-0" aria-hidden>
        {BAR_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className={cn("w-[2px] rounded-sm transition-colors", isPlaying ? "bg-[#ff0073]" : "bg-muted-foreground/35")}
            style={
              isPlaying
                ? { height: "100%", animation: `waveform-bar ${0.55 + (i % 5) * 0.11}s ease-in-out infinite`, animationDelay: `${(i * 37) % 200}ms` }
                : { height: h }
            }
          />
        ))}
      </span>

      <button
        type="button"
        aria-label={isPlaying ? t("cfgext.voicePausePreview") : t("cfgext.voicePlayPreview")}
        title={canPlay ? (isPlaying ? t("node.pausePreview") : t("node.playPreview")) : "No preview available"}
        disabled={!canPlay}
        className={cn(
          "nodrag nopan grid place-items-center w-6 h-6 rounded-full border transition-colors shrink-0",
          isPlaying
            ? "border-[#ff0073] text-[#ff0073] bg-[#ff0073]/10"
            : "border-border/70 text-foreground/70 bg-background/60 hover:border-[#ff0073] hover:text-[#ff0073]",
          !canPlay && "opacity-30 cursor-not-allowed hover:border-border/70 hover:text-foreground/70",
        )}
        onClick={handlePlay}
      >
        {isPlaying ? <Pause className="size-2.5 fill-current" /> : <Play className="size-2.5 fill-current" />}
      </button>
    </div>
  )
}
