import { isV2Model } from "@/lib/audio-tags"
import { useT } from "@/lib/i18n"

interface Props {
  readonly provider: string | undefined
  readonly fieldValues: readonly (string | undefined)[]
}

const BRACKET_RE = /\[[^\]]+\]/

export function ProviderAudioTagWarning({ provider, fieldValues }: Props) {
  const t = useT()
  if (provider === undefined || !isV2Model(provider)) return null
  const anyHasBrackets = fieldValues.some((v) => v !== undefined && BRACKET_RE.test(v))
  if (!anyHasBrackets) return null
  return (
    <p className="text-[10px] text-amber-500 mt-1">
      {t("cfgext.provWarnAudioTags")}
    </p>
  )
}
