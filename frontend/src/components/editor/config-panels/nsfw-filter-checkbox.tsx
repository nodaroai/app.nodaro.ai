import { useT } from "@/lib/i18n"
import { useFilterForcedOn } from "@/hooks/queries/use-provider-safety-locks"

/**
 * The node's "NSFW Content Filter" checkbox. When an admin has forced the
 * filter on for this model it shows on and cannot be changed; otherwise the
 * node decides, as it always has.
 */
export function NsfwFilterCheckbox({
  id,
  provider,
  checked,
  onChange,
}: {
  id: string
  provider: string | undefined
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const t = useT()
  const forced = useFilterForcedOn(provider)
  return (
    <div className="flex items-center gap-2 px-1">
      <input
        type="checkbox"
        id={id}
        checked={forced || checked}
        disabled={forced}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-muted-foreground/40"
      />
      <label htmlFor={id} className="text-xs">{t("vidcfg.nsfwFilter")}</label>
      {forced && <span className="text-xs text-muted-foreground">{t("vidcfg.nsfwFilterForced")}</span>}
    </div>
  )
}
