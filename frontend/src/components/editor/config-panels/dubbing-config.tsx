"use client"

// Extracted from audio-configs.tsx (2,700+ lines, over the 800-line cap) when
// dubbing grew the full ElevenLabs surface — video mode, source links, dub
// windows, per-minute pricing.
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ALL_LANGUAGES } from "@/lib/audio-tags"
import { useT } from "@/lib/i18n"
import type { DubbingData } from "@/types/nodes"
import type { ConfigProps } from "./types"

export function DubbingConfig({ data, onUpdate }: ConfigProps<DubbingData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("field.targetLanguage")}</Label>
        <Select
          value={data.targetLanguage || "es"}
          onValueChange={(v) => onUpdate({ targetLanguage: v })}
        >
          <SelectTrigger aria-label={t("field.targetLanguage")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("field.sourceLanguageOptional")}</Label>
        <Select
          value={data.sourceLanguage || "auto"}
          onValueChange={(v) => onUpdate({ sourceLanguage: v === "auto" ? undefined : v })}
        >
          <SelectTrigger aria-label={t("field.sourceLanguageOptional")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAutoDetect")}</SelectItem>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="dub-source-url">{t("audiocfg.dubSourceUrl")}</Label>
        <Input
          id="dub-source-url"
          type="url"
          value={data.sourceUrl ?? ""}
          onChange={(e) => onUpdate({ sourceUrl: e.target.value || undefined })}
          placeholder="https://youtube.com/watch?v=..."
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("audiocfg.hintDubSourceUrl")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="dub-start">{t("audiocfg.dubStartTime")}</Label>
          <Input
            id="dub-start"
            type="number"
            min={0}
            value={data.startTime ?? ""}
            onChange={(e) => onUpdate({ startTime: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor="dub-end">{t("audiocfg.dubEndTime")}</Label>
          <Input
            id="dub-end"
            type="number"
            min={0}
            value={data.endTime ?? ""}
            onChange={(e) => onUpdate({ endTime: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder={t("audiocfg.phDubEnd")}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">{t("audiocfg.hintDubWindow")}</p>

      <div>
        <Label>{t("audiocfg.numSpeakersOptional")}</Label>
        <Input
          type="number"
          min={0}
          max={20}
          value={data.numSpeakers ?? ""}
          onChange={(e) => onUpdate({ numSpeakers: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder={t("audiocfg.phAutoDetect")}
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("audiocfg.hintNumSpeakersAuto")}</p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-native-voice" checked={data.disableVoiceCloning ?? false} onCheckedChange={(v) => onUpdate({ disableVoiceCloning: !!v })} />
        <Label htmlFor="dubbing-native-voice" className="text-xs">{t("audiocfg.nativeVoice")}</Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        {t("audiocfg.hintDubCloneDesc")}
      </p>
      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-drop-bg" checked={data.dropBackgroundAudio ?? false} onCheckedChange={(v) => onUpdate({ dropBackgroundAudio: !!v })} />
        <Label htmlFor="dubbing-drop-bg" className="text-xs">{t("audiocfg.dropBackgroundAudio")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-highest-res" checked={data.highestResolution ?? false} onCheckedChange={(v) => onUpdate({ highestResolution: !!v })} />
        <Label htmlFor="dubbing-highest-res" className="text-xs">{t("audiocfg.dubHighestResolution")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-profanity" checked={data.useProfanityFilter ?? false} onCheckedChange={(v) => onUpdate({ useProfanityFilter: !!v })} />
        <Label htmlFor="dubbing-profanity" className="text-xs">{t("audiocfg.dubProfanityFilter")}</Label>
      </div>

      <div>
        <Label htmlFor="dub-accent">{t("audiocfg.dubTargetAccent")}</Label>
        <Input
          id="dub-accent"
          value={data.targetAccent ?? ""}
          onChange={(e) => onUpdate({ targetAccent: e.target.value || undefined })}
          placeholder={t("audiocfg.phDubAccent")}
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("audiocfg.hintDubAccent")}</p>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("audiocfg.hintDubTranslate")}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {t("audiocfg.hintDubPricing")}
      </p>
    </div>
  )
}
