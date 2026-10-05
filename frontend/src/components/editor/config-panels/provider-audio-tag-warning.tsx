import { ttsSupportsAudioTags } from "@nodaro/shared"
import { useT } from "@/lib/i18n"

interface Props {
  readonly provider: string | undefined
  readonly fieldValues: readonly (string | undefined)[]
}

const BRACKET_RE = /\[[^\]]+\]/

export function ProviderAudioTagWarning({ provider, fieldValues }: Props) {
  const t = useT()
  // Only a model that does NOT perform [audio tags] warns — it would read them aloud.
  if (provider === undefined || ttsSupportsAudioTags(provider)) return null
  const anyHasBrackets = fieldValues.some((v) => v !== undefined && BRACKET_RE.test(v))
  if (!anyHasBrackets) return null
  return (
    <p className="text-[10px] text-amber-500 mt-1">
      {t("cfgext.provWarnAudioTags")}
    </p>
  )
}
