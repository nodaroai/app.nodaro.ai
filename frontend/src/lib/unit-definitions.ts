// frontend/src/lib/unit-definitions.ts — the editor's one door to the node
// units' definitions (§5.8 B, decided 2026-10-16; tools/units/README.md), a
// reviewed composer (tools/units/registry-composers.json). The registries
// derived from a unit's manifest — the handle tables, EXECUTABLE_TYPES and the
// price mirror, the ffmpeg connection rule, the config-panel names and sets,
// output extraction — read it here rather than importing the generated
// aggregate themselves, so a module a unit may import (ffmpeg-handles,
// target-handle-registry) is never a composer (G5 forbids a unit to import one).
// Each reader declares `@registry-enumerates` (it builds a table over every
// unit) or `@registry-lookup` (it asks only `unitDefinitionOf(type)`).
import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"
import type { UnitDefinition } from "@/nodes/kit"

/** Every node unit's definition (frontend/src/nodes/<type>/definition.generated.ts), sorted by type. */
export const UNIT_NODE_DEFINITIONS: ReadonlyArray<UnitDefinition> = UNIT_DEFINITIONS

const BY_TYPE: ReadonlyMap<string, UnitDefinition> = new Map(UNIT_DEFINITIONS.map((d) => [d.type, d]))

/** The unit definition of `type`, or undefined when it is a legacy node (or unknown). */
export function unitDefinitionOf(type: string | undefined): UnitDefinition | undefined {
  return type === undefined ? undefined : BY_TYPE.get(type)
}
