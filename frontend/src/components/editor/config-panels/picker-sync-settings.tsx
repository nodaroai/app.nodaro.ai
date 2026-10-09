import { useT } from "@/lib/i18n"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PickerConsumerData } from "@/types/nodes"

/** How a picker takes the JSON a wired Describe to Picker node injects: the
 *  apply mode, and whether it syncs on its own when the upstream changes.
 *  Shared by every picker-json consumer, so each one offers the same levers.
 *  Auto-sync is on unless the node turned it off (`usePickerJsonConsumer`). */
export function PickerSyncSettings({
  idPrefix,
  data,
  onUpdate,
}: {
  readonly idPrefix: string
  readonly data: PickerConsumerData
  readonly onUpdate: (patch: Partial<PickerConsumerData>) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
      <Label htmlFor={`${idPrefix}-apply-mode`} className="text-xs text-muted-foreground">
        {t("paramcfg.whenImageJsonIsInjected")}
      </Label>
      <Select
        value={data.applyMode ?? "override"}
        onValueChange={(v) => onUpdate({ applyMode: v as PickerConsumerData["applyMode"] })}
      >
        <SelectTrigger id={`${idPrefix}-apply-mode`} aria-label={t("paramcfg.applyMode")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="override">{t("paramcfg.fullOverrideClearUndetected")}</SelectItem>
          <SelectItem value="overwrite-detected">{t("paramcfg.overwriteDetectedKeepRest")}</SelectItem>
          <SelectItem value="fill-empty">{t("paramcfg.fillEmptyOnly")}</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-auto-apply`} className="text-xs text-muted-foreground">
          {t("paramcfg.autoApplyOnChange")}
        </Label>
        <Switch
          id={`${idPrefix}-auto-apply`}
          checked={data.autoApplyInjected !== false}
          onCheckedChange={(c) => onUpdate({ autoApplyInjected: c })}
        />
      </div>
    </div>
  )
}
