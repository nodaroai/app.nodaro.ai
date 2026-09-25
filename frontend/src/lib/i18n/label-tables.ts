/**
 * One locale's string-keyed label tables.
 *
 * Every table is keyed by the English string a render site already holds, so
 * a string with no entry — a user's rename, a model added upstream tomorrow —
 * passes through in English instead of rendering blank. `labels.ts` registers
 * one set per locale (`LABEL_TABLES`), and the coverage guards iterate that
 * registry.
 */
export interface LocaleLabelTables {
  /** Node header labels, by the node definition's default English label. */
  readonly node: Readonly<Record<string, string>>
  /** Handle pip labels ("Look", "Elements", picker pips like "Camera format"). */
  readonly handle: Readonly<Record<string, string>>
  /**
   * Factory-preset GROUP names — the folder/section headers in the node preset
   * dropdown — by the English catalog string in `@nodaro/prompts` factory-presets.
   */
  readonly presetGroup: Readonly<Record<string, string>>
  /**
   * Node-picker family / section headers ("Camera", "Light & Look"), by the
   * `label` field of `NODE_FAMILIES` and `COMMON_SECTIONS` in `@/lib/node-families`.
   */
  readonly nodeGroup: Readonly<Record<string, string>>
  /**
   * Model DESCRIPTIONS — the one-line copy under a model's name in every
   * provider dropdown and in the hint below it ("Higher detail, production
   * images"). They ship as `desc:` strings in config-panels/model-options.ts and
   * in @nodaro/shared's LLM / voice-changer tables. Model NAMES stay Latin.
   */
  readonly modelDescription: Readonly<Record<string, string>>
  /**
   * Dropdown OPTION labels — data, not chrome: aspect ratios ("16:9
   * (Landscape)"), resolutions ("2K (Standard)"), sources ("From image").
   * `option` holds whole labels.
   */
  readonly option: Readonly<Record<string, string>>
  /** The parenthetical alone, so "16:9 (Landscape)" keeps its token and translates the word. */
  readonly optionQualifier: Readonly<Record<string, string>>
}
