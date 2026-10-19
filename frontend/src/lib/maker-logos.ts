/**
 * The marks of the companies that make the models, as this instance publishes
 * them: `GET /v1/model-makers` lists every maker with its `logoUrl` (null for a
 * maker the instance has no mark for — backend `lib/maker-logos.ts`), folded
 * here into a maker id -> address map.
 */
export interface ModelMakersBody {
  makers?: ReadonlyArray<{ id: string; name: string; logoUrl?: string | null }>
}

/** Maker id -> its published mark. A maker with no mark is left out. */
export function makerLogoMap(body: ModelMakersBody): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const maker of body.makers ?? []) {
    if (maker.logoUrl) map.set(maker.id, maker.logoUrl)
  }
  return map
}
