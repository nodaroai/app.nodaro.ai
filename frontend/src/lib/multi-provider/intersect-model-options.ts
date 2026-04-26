import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTION_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
} from "@/components/editor/config-panels/model-options"
import { MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "@nodaro-shared/model-constants"

type Option = { value: string; label: string }

export type IntersectedOptions = {
  /** Options common to ALL selected providers, preserving the first provider's order. */
  aspectRatios: readonly Option[]
  /** Empty when at least one selected provider has no resolution options (the
   *  setting doesn't apply for the cohort). */
  resolutions: readonly Option[]
  /** Empty when at least one selected provider has no quality options. */
  qualities: readonly Option[]
  /** True only when EVERY selected provider supports reference images. */
  supportsReferenceImage: boolean
}

function intersectTable(
  table: Record<string, readonly Option[]>,
  providers: readonly string[],
): readonly Option[] {
  if (providers.length === 0) return []
  const sets = providers.map((p) => table[p])
  // If any selected provider has no entry for this setting, the setting
  // doesn't apply to the cohort.
  if (sets.some((s) => !s)) return []
  const firstValues = sets[0]!.map((o) => o.value)
  const common = firstValues.filter((v) =>
    sets.every((s) => s!.some((o) => o.value === v)),
  )
  return sets[0]!.filter((o) => common.includes(o.value))
}

export function intersectModelOptions(
  providers: readonly string[],
): IntersectedOptions {
  return {
    aspectRatios: intersectTable(IMAGE_ASPECT_RATIOS, providers),
    resolutions: intersectTable(IMAGE_RESOLUTION_OPTIONS, providers),
    qualities: intersectTable(IMAGE_QUALITY_OPTIONS, providers),
    supportsReferenceImage:
      providers.length > 0 &&
      providers.every((p) => MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(p)),
  }
}
