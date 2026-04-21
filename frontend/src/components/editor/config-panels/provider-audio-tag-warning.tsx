import { isV2Model } from "@/lib/audio-tags"

interface Props {
  readonly provider: string | undefined
  readonly fieldValues: readonly (string | undefined)[]
}

const BRACKET_RE = /\[[^\]]+\]/

export function ProviderAudioTagWarning({ provider, fieldValues }: Props) {
  if (provider === undefined || !isV2Model(provider)) return null
  const anyHasBrackets = fieldValues.some((v) => v !== undefined && BRACKET_RE.test(v))
  if (!anyHasBrackets) return null
  return (
    <p className="text-[10px] text-amber-500 mt-1">
      Audio tags require ElevenLabs v3 — stripped on this model.
    </p>
  )
}
