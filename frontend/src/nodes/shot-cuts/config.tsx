import { useT } from "@/lib/i18n"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import { formatShotTime, shotCutsResultOf, type ShotCutsData } from "./types"

/**
 * Shot Cuts' one setting: whether a run also saves every shot's first and last
 * frame (same price). Nothing depends on a provider, so nothing snaps (root
 * CLAUDE.md Provider Enum Sync 12b does not apply). Below it, the last run's
 * shots.
 */
export function ConfigPanel({ data: raw, onUpdate }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as ShotCutsData
  const t = useT()
  const result = shotCutsResultOf(data.generatedJson)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("proccfg.shotCutsHint")}</p>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="shot-cuts-frames">{t("proccfg.shotCutsFrames")}</Label>
        <Switch id="shot-cuts-frames" checked={data.frames === true} onCheckedChange={(v) => onUpdate({ frames: v })} />
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">{t("proccfg.shotCutsFramesHint")}</p>
      {result && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t("node.shotCutsCount", { count: result.shotCount })}</span>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto text-xs">
            {result.shots.map((s) => (
              <div key={s.index} className="flex items-center gap-2">
                {s.firstFrameUrl && <a href={s.firstFrameUrl} target="_blank" rel="noreferrer"><img src={s.firstFrameUrl} alt="" className="h-8 w-14 rounded object-cover" loading="lazy" /></a>}
                {s.lastFrameUrl && <a href={s.lastFrameUrl} target="_blank" rel="noreferrer"><img src={s.lastFrameUrl} alt="" className="h-8 w-14 rounded object-cover" loading="lazy" /></a>}
                <span className="tabular-nums">{t("node.shotCutsLine", { n: s.index + 1, start: formatShotTime(s.startSec), end: formatShotTime(s.endSec) })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
