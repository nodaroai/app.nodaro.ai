import { useT } from "@/lib/i18n"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import type { GifToVideoData } from "./types"

// Gif to Video's settings: loop a short GIF to a target length, the motion
// smoothing, and the colour a transparent GIF is flattened onto.
export function ConfigPanel({ data: raw, onUpdate }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as GifToVideoData
  const t = useT()
  const loopToMinimum = data.loopToMinimum ?? true
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="gif-loop-to-minimum"
          checked={loopToMinimum}
          onChange={(e) => onUpdate({ loopToMinimum: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor="gif-loop-to-minimum" className="text-xs">{t("proccfg.extendShortGifsToATarget")}</label>
      </div>
      <p className="text-[11px] text-muted-foreground px-1 leading-snug">
        {t("proccfg.mostGifsAreShorterThanThe")}
      </p>

      {loopToMinimum && (
        <div>
          <Label htmlFor="gif-target-duration">{t("proccfg.targetDurationS", { n: data.targetDuration ?? 3 })}</Label>
          <input
            id="gif-target-duration"
            type="range"
            min={2}
            max={8}
            step={1}
            value={data.targetDuration ?? 3}
            onChange={(e) => onUpdate({ targetDuration: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
            <span>{t("proccfg.s2", { n: 2 })}</span>
            <span>{t("proccfg.s2", { n: 5 })}</span>
            <span>{t("proccfg.s2", { n: 8 })}</span>
          </div>
        </div>
      )}

      <div>
        <Label>{t("proccfg.motionSmoothing")}</Label>
        <Select value={(data.interpolate ?? true) ? "smooth" : "stepped"} onValueChange={(v) => onUpdate({ interpolate: v === "smooth" })}>
          <SelectTrigger aria-label={t("proccfg.motionSmoothing")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="smooth">{t("proccfg.smoothInterpolateTo24fps")}</SelectItem>
            <SelectItem value="stepped">{t("proccfg.preserveOriginalTiming")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          {t("proccfg.smoothSynthesisesInBetweenFramesFor")}
        </p>
      </div>

      <div>
        <Label>{t("proccfg.transparentBackground")}</Label>
        <Select value={data.alphaBackground ?? "white"} onValueChange={(v) => onUpdate({ alphaBackground: v as GifToVideoData["alphaBackground"] })}>
          <SelectTrigger aria-label={t("proccfg.transparentBackground")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="white">{t("proccfg.white")}</SelectItem>
            <SelectItem value="black">{t("proccfg.black")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          {t("proccfg.mp4CanTCarryTransparencyA")}
        </p>
      </div>
    </div>
  )
}
