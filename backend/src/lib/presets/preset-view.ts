import { factoryPresetPreviewUrl, presetMinReferences } from "@nodaro/prompts/presets"
import { appBaseUrl } from "../deployment-urls.js"

/**
 * The metadata every preset carries over the API (REST, SDK, CLI, MCP), on
 * factory and user presets alike:
 *   - `minReferences` — how many connected reference images the preset works
 *     from (0 = none), and `needsImage` = `minReferences > 0`. One function
 *     (`presetMinReferences`) for both: a user preset counts its `{image:N}`
 *     tokens; a factory preset also counts its own declaration.
 *   - `previewUrl` — an example picture: for a factory preset, its committed
 *     file on this installation's public origin (null until one is committed);
 *     for a user preset, the image the user stored with it (null when unset).
 */
export interface PresetReferenceFields {
  readonly minReferences: number
  readonly needsImage: boolean
}

export function referenceFields(
  nodeType: string,
  data: Readonly<Record<string, unknown>>,
  declared?: number,
): PresetReferenceFields {
  const minReferences = presetMinReferences(nodeType, data, declared)
  return { minReferences, needsImage: minReferences > 0 }
}

/** A factory catalog entry as `presetCatalog` lists it (node presets and app namespaces alike). */
export interface CatalogEntry {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly group?: string
  /** "folder" / "section" for node presets; an app namespace may name its own. */
  readonly groupKind?: string
  /** A sub-heading inside the group (a YouTube topic, "Instagram feed"); see `FactoryPreset`. */
  readonly section?: string
  /** Where the result is meant to be posted, most fitting first; see `FactoryPreset`. */
  readonly platforms?: readonly string[]
  readonly data: Readonly<Record<string, unknown>>
  readonly minReferences?: number
}

/** A factory preset as the API serves it (`GET /v1/node-presets/factory`). */
export function factoryPresetView(nodeType: string, preset: CatalogEntry) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    group: preset.group,
    groupKind: preset.groupKind,
    ...(preset.section ? { section: preset.section } : {}),
    ...(preset.platforms && preset.platforms.length > 0 ? { platforms: preset.platforms } : {}),
    data: preset.data,
    ...referenceFields(nodeType, preset.data, preset.minReferences),
    previewUrl: factoryPresetPreviewUrl(preset.id, appBaseUrl()),
  }
}
