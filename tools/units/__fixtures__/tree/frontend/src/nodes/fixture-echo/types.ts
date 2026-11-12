// Like every real unit's data type, it carries an index signature: UnitAppFieldsFit must judge its app
// fields on the keys it DECLARES, not on `keyof`, which the signature opens to any name.
export type FixtureEchoData = {
  [key: string]: unknown
  label: string
  videoUrl?: string
  generatedVideoUrl?: string
  /** An app field (unit.json appFields): a select of fixed values. */
  size?: "auto" | "1K" | "1.5K" | "2K"
  /** An app field (unit.json appFields): a whole number from 1 to 99. */
  maxLayers?: number
}
