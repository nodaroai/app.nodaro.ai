// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { UnitAppFieldsFit, UnitDefinition } from "@/nodes/kit"
import { definition } from "../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated"
import type { FixtureEchoData } from "../../../tools/units/__fixtures__/tree/frontend/src/nodes/fixture-echo/types"

/**
 * A unit's app fields (unit.json `appFields`) are held to its data type at TYPECHECK: the definitions
 * aggregate writes one `UnitAppFieldsFit<Data, typeof definition.appFields>` per unit that declares them
 * (tools/units/templates.mjs), and a field whose values its data type does not take fails the constraint
 * at that unit's line. The assertions below are type-level — `npm run typecheck` holds them, an unused
 * `@ts-expect-error` included — on the fixture unit's golden definition and its types.ts.
 */
const appFields = definition.appFields

// The fixture's own data type takes every value it declares.
export type FitsItsOwnData = UnitAppFieldsFit<FixtureEchoData, typeof appFields>

// A definition that carries appFields is a UnitDefinition: the shape gen:units projects fits the editor kit
// (the definitions aggregate types every member with it).
type IsDefinition<T extends UnitDefinition> = T
export type ProjectionFitsTheKit = IsDefinition<typeof definition>

// Each data type below carries `[key: string]: unknown`, as every real unit's does: the fit judges the
// keys a type DECLARES, so the signature cannot let a field through.
type Indexed<T> = { [key: string]: unknown } & T

// A value the data type does not take ("1.5K", "2K" and "auto" are not in this union).
// @ts-expect-error the select lists values `size` does not take
export type SelectValueNotTaken = UnitAppFieldsFit<Indexed<{ label: string; size?: "1K"; maxLayers?: number }>, typeof appFields>

// An integer field over a field that is not a number.
// @ts-expect-error `maxLayers` holds a string here
export type IntegerOverText = UnitAppFieldsFit<Indexed<{ label: string; size?: string; maxLayers?: string }>, typeof appFields>

// A field the data type does not declare, though its index signature admits any name.
// @ts-expect-error `maxLayers` is not a declared field of this data type
export type FieldNotDeclared = UnitAppFieldsFit<Indexed<{ label: string; size?: string }>, typeof appFields>

// The same, written as the real units write their data type (a type literal with the signature inside).
// @ts-expect-error `size` is not a declared field of this data type
export type FieldNotDeclaredLiteral = UnitAppFieldsFit<{ [key: string]: unknown; label: string; maxLayers?: number }, typeof appFields>

describe("UnitAppFieldsFit — a unit's app fields against its data type", () => {
  it("the golden definition carries the fields the type-level checks above read", () => {
    expect(appFields.map((f) => [f.field, f.kind])).toEqual([["size", "select"], ["maxLayers", "integer"]])
  })
})
