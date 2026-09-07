import { getDurationsForModel } from "@nodaro/shared"

/**
 * A video model's allowed clip lengths, for the plan importer's repair pass.
 *
 * The importer takes this as a FUNCTION rather than reading the catalog itself,
 * so it stays a pure function of its inputs and the same code can be tested
 * against a made-up catalog. On the server the answer is simply the catalog's.
 */
export function durationsFor(model: string): ReadonlyArray<number> {
  return getDurationsForModel(model) ?? []
}
