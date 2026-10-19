/**
 * The SDK's typed image-route params (`@nodaro/sdk`'s `ImageToImageParams`,
 * `EditImageParams`, `SplitImageParams`, `GenerateMaskParams`, and the inpaint
 * fields of `GenerateImageParams`) are hand-written interfaces over these
 * routes' Zod bodies. Nothing else ties the two: a field added to a route would
 * reach SDK callers only through the untyped index signature, and a field
 * renamed or removed would keep compiling in every app while the route
 * silently ignores it.
 *
 * So, read from the SDK SOURCE with the TypeScript compiler (interfaces walked
 * through their local `extends`; a union read branch by branch):
 *  - each Params type declares exactly its route's body keys — the only extras
 *    allowed are the session fields every job-creating request takes
 *    (`GenerationSessionParams`: `sessionId`, `origin`), which the job funnel
 *    reads off the raw body, not a route schema;
 *  - a key is optional in the SDK exactly when the route accepts it missing
 *    (`.optional()` or `.default()`); in a union a key is optional when some
 *    branch may leave it out, required only when every branch requires it;
 *  - every lever enum the route validates is the shared tuple the SDK type is
 *    derived from, and the SDK property names that derived type.
 */
// @test-watches packages/client/src/resources/nodes-image-params.ts packages/client/src/resources/nodes.ts packages/shared/src/generate-mask.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import type { z } from "zod"
import {
  IMAGE_ASPECT_RATIO_VALUES,
  IMAGE_EDIT_PROVIDERS,
  IMAGE_EDIT_TARGET_RESOLUTION_VALUES,
  IMAGE_QUALITY_VALUES,
  IMAGE_RENDERING_SPEED_VALUES,
  IMAGE_RESOLUTION_VALUES,
  MODIFY_IMAGE_PROVIDERS,
} from "@nodaro/shared/models"
import { TOPAZ_UPSCALE_FACTORS } from "@nodaro/shared/credits"
import { IMAGE_TO_IMAGE_ATTACH_COLUMNS } from "@nodaro/shared/entities"
import { GENERATE_MASK_LIMITS } from "@nodaro/shared/media"
import { imageToImageBody } from "../image-to-image.js"
import { editImageBody } from "../edit-image.js"
import { splitImageBody } from "../split-image.js"
import { generateMaskBody } from "../generate-mask.js"
import { generateImageBody } from "../generate-image-body.js"

const SDK_RESOURCES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "packages", "client", "src", "resources")
const REPO = join(SDK_RESOURCES, "..", "..", "..", "..")
// The SDK params files, plus the shared wire contract GenerateMaskParams extends.
const SDK_FILES = [
  ...["nodes-image-params.ts", "nodes.ts"].map((f) => join(SDK_RESOURCES, f)),
  join(REPO, "packages", "shared", "src", "generate-mask.ts"),
]

/** The session fields the job funnel stamps from the raw body on every route. */
const SESSION_FIELDS = ["sessionId", "origin"]

type Declaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration
/** One declared property: whether it carries `?`, and its type as written. */
type Prop = { optional: boolean; type: string }
/** The properties of one branch of a type (an interface has one; a union one per member). */
type Branch = Map<string, Prop>

/** Every interface and type alias the SDK files declare, by name. */
function declarations(): Map<string, Declaration> {
  const byName = new Map<string, Declaration>()
  for (const file of SDK_FILES) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) byName.set(node.name.text, node)
    })
  }
  return byName
}

const DECLS = declarations()

function members(list: ts.NodeArray<ts.TypeElement>): Branch {
  const branch: Branch = new Map()
  for (const m of list) {
    if (ts.isPropertySignature(m) && m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) {
      branch.set(m.name.text, { optional: m.questionToken !== undefined, type: m.type?.getText() ?? "" })
    }
  }
  return branch
}

/** The branches of a type: its own members over its local bases' (a base the files read here do not declare is not walked). */
function branchesOf(typeName: string): Branch[] {
  const decl = DECLS.get(typeName)
  if (!decl) throw new Error(`the SDK declares no ${typeName}`)
  const fromType = (node: ts.TypeNode): Branch[] => {
    if (ts.isUnionTypeNode(node)) return node.types.flatMap(fromType)
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return branchesOf(node.typeName.text)
    if (ts.isTypeLiteralNode(node)) return [members(node.members)]
    return []
  }
  if (ts.isTypeAliasDeclaration(decl)) return fromType(decl.type)
  const bases = (decl.heritageClauses ?? [])
    .flatMap((clause) => clause.types)
    .filter((base) => ts.isIdentifier(base.expression) && DECLS.has(base.expression.text))
    .map((base) => branchesOf((base.expression as ts.Identifier).text))
  // Interfaces here only extend interfaces, so each base is a single branch.
  const merged: Branch = new Map(bases.flatMap((b) => [...b[0]!]))
  for (const [k, p] of members(decl.members)) merged.set(k, p)
  return [merged]
}

function propertyNames(typeName: string): Set<string> {
  return new Set(branchesOf(typeName).flatMap((b) => [...b.keys()]))
}

/** Optional when some branch may leave the key out (absent there, or `?`); required only when every branch requires it. */
function isOptionalInSdk(typeName: string, key: string): boolean {
  return branchesOf(typeName).some((b) => !b.has(key) || b.get(key)!.optional)
}

/** The type text(s) the SDK writes for a key, across the branches that declare it. */
function sdkTypes(typeName: string, key: string): string[] {
  return [...new Set(branchesOf(typeName).flatMap((b) => (b.has(key) ? [b.get(key)!.type] : [])))].sort()
}

/** Whether the route accepts the key missing — `.optional()` and `.default()` both do. */
function isOptionalInZod(shape: Record<string, z.ZodType>, key: string): boolean {
  return shape[key]!.safeParse(undefined).success
}

/** The values of a body's enum field, through its `.optional()` wrapper. */
function enumOptions(shape: Record<string, z.ZodType>, key: string): string[] {
  let field = shape[key] as unknown as { options?: readonly string[]; unwrap?: () => unknown }
  while (!field.options && field.unwrap) field = field.unwrap() as typeof field
  if (!field.options) throw new Error(`${key} is not an enum field`)
  return [...field.options]
}

const sorted = (values: Iterable<string>) => [...values].sort()

const BODIES: Array<[string, string, Record<string, z.ZodType>]> = [
  ["ImageToImageParams", "imageToImageBody", imageToImageBody.shape],
  ["EditImageParams", "editImageBody", editImageBody.shape],
  ["SplitImageParams", "splitImageBody", splitImageBody.shape],
  ["GenerateMaskParams", "generateMaskBody", generateMaskBody.shape],
]

describe.each(BODIES)("%s declares exactly %s's keys", (typeName, _body, shape) => {
  const zodKeys = Object.keys(shape)
  const declared = propertyNames(typeName)

  it("declares every key the route reads", () => {
    expect(zodKeys.length).toBeGreaterThan(0)
    expect(sorted(zodKeys.filter((k) => !declared.has(k)))).toEqual([])
  })

  it("declares no key the route does not read (the session fields aside)", () => {
    expect(sorted([...declared].filter((k) => !zodKeys.includes(k) && !SESSION_FIELDS.includes(k)))).toEqual([])
  })

  it("marks a key optional exactly when the route accepts it missing", () => {
    const mismatched = zodKeys
      .filter((k) => isOptionalInSdk(typeName, k) !== isOptionalInZod(shape, k))
      .map((k) => `${k}: SDK ${isOptionalInSdk(typeName, k) ? "optional" : "required"}, route ${isOptionalInZod(shape, k) ? "optional" : "required"}`)
    expect(mismatched).toEqual([])
  })
})

describe("edit-image's union matches the route's refine", () => {
  it("each source is required in its own branch and forbidden in the other", () => {
    const [byUrl, byTask] = branchesOf("EditImageParams")
    expect(byUrl!.get("imageUrl")).toEqual({ optional: false, type: "string" })
    expect(byUrl!.get("taskId")).toEqual({ optional: true, type: "never" })
    expect(byTask!.get("taskId")).toEqual({ optional: false, type: "string" })
    expect(byTask!.get("imageUrl")).toEqual({ optional: true, type: "never" })
  })
})

/** [Params type, key, body, the shared tuple the route's enum must be, the SDK type(s) derived from it]. */
const LEVERS: Array<[string, string, Record<string, z.ZodType>, readonly string[], string[]]> = [
  ["ImageToImageParams", "provider", imageToImageBody.shape, MODIFY_IMAGE_PROVIDERS, ["ModifyImageProvider"]],
  ["ImageToImageParams", "resolution", imageToImageBody.shape, IMAGE_RESOLUTION_VALUES, ["ImageResolution"]],
  ["ImageToImageParams", "quality", imageToImageBody.shape, IMAGE_QUALITY_VALUES, ["ImageQuality"]],
  ["ImageToImageParams", "renderingSpeed", imageToImageBody.shape, IMAGE_RENDERING_SPEED_VALUES, ["ImageRenderingSpeed"]],
  ["ImageToImageParams", "aspectRatio", imageToImageBody.shape, IMAGE_ASPECT_RATIO_VALUES, ["ImageAspectRatio"]],
  ["ImageToImageParams", "attachToColumn", imageToImageBody.shape, IMAGE_TO_IMAGE_ATTACH_COLUMNS, ["ImageToImageAttachColumn"]],
  ["EditImageParams", "provider", editImageBody.shape, IMAGE_EDIT_PROVIDERS, ["Exclude<ImageEditProvider, TaskChainedEditProvider>", "TaskChainedEditProvider"]],
  ["EditImageParams", "upscaleFactor", editImageBody.shape, TOPAZ_UPSCALE_FACTORS, ["TopazUpscaleFactor"]],
  ["EditImageParams", "targetResolution", editImageBody.shape, IMAGE_EDIT_TARGET_RESOLUTION_VALUES, ["ImageEditTargetResolution"]],
  ["EditImageParams", "aspectRatio", editImageBody.shape, IMAGE_ASPECT_RATIO_VALUES, ["ImageAspectRatio"]],
]

describe.each(LEVERS)("%s.%s: the route's enum is the shared tuple, and the SDK names its type", (typeName, key, shape, tuple, sdkType) => {
  it("route enum values", () => {
    // Deduped as Zod's enum is: IMAGE_I2I_PROVIDERS (inside MODIFY_IMAGE_PROVIDERS) lists flux-fill twice.
    expect(enumOptions(shape, key)).toEqual([...new Set(tuple)])
  })

  it("SDK type", () => {
    expect(sdkTypes(typeName, key)).toEqual([...sdkType].sort())
  })
})

describe("the job-creating params carry the session fields; split-image (no job) does not", () => {
  it.each(["ImageToImageParams", "EditImageParams", "GenerateMaskParams"])("%s", (typeName) => {
    expect(sorted(SESSION_FIELDS.filter((k) => propertyNames(typeName).has(k)))).toEqual(sorted(SESSION_FIELDS))
  })

  it("SplitImageParams", () => {
    expect(SESSION_FIELDS.filter((k) => propertyNames("SplitImageParams").has(k))).toEqual([])
  })
})

describe("GenerateImageParams' inpaint fields are optional generate-image body keys", () => {
  it.each(["baseImageUrl", "maskUrl", "strength", "guidanceScale"])("%s", (key) => {
    expect(propertyNames("GenerateImageParams").has(key)).toBe(true)
    expect(Object.keys(generateImageBody.shape)).toContain(key)
    expect(isOptionalInSdk("GenerateImageParams", key)).toBe(true)
    expect(isOptionalInZod(generateImageBody.shape, key)).toBe(true)
  })
})

describe("the walker itself", () => {
  it("reads the session fields through GenerationSessionParams and both edit-image branches", () => {
    const edit = propertyNames("EditImageParams")
    expect(edit.has("imageUrl") && edit.has("taskId") && edit.has("maskIndexes") && edit.has("sessionId")).toBe(true)
  })

  it("reads a `.default()` field as optional on the route", () => {
    expect(isOptionalInZod(imageToImageBody.shape, "injectCharacterContext")).toBe(true)
    expect(isOptionalInZod(generateMaskBody.shape, "threshold")).toBe(true)
    expect(isOptionalInZod(generateMaskBody.shape, "prompt")).toBe(false)
  })
})

describe("generate-mask has one wire contract (@nodaro/shared's generate-mask.ts)", () => {
  it("GenerateMaskParams declares no field of its own: its fields are GenerateMaskRequest's", () => {
    const own = DECLS.get("GenerateMaskParams") as ts.InterfaceDeclaration
    expect([...members(own.members).keys()]).toEqual([])
    const request = propertyNames("GenerateMaskRequest")
    expect(sorted(request)).toEqual(sorted(Object.keys(generateMaskBody.shape)))
    expect([...request].every((k) => propertyNames("GenerateMaskParams").has(k))).toBe(true)
  })

  it("the route's bounds are GENERATE_MASK_LIMITS", () => {
    const base = { imageUrl: "https://example.com/a.png" }
    const { PROMPT_MAX_LENGTH, THRESHOLD_MIN, THRESHOLD_MAX, THRESHOLD_DEFAULT } = GENERATE_MASK_LIMITS
    expect(generateMaskBody.safeParse({ ...base, prompt: "x".repeat(PROMPT_MAX_LENGTH) }).success).toBe(true)
    expect(generateMaskBody.safeParse({ ...base, prompt: "x".repeat(PROMPT_MAX_LENGTH + 1) }).success).toBe(false)
    expect(generateMaskBody.safeParse({ ...base, prompt: "p", threshold: THRESHOLD_MAX + 0.01 }).success).toBe(false)
    expect(generateMaskBody.safeParse({ ...base, prompt: "p", threshold: THRESHOLD_MIN - 0.01 }).success).toBe(false)
    expect(generateMaskBody.parse({ ...base, prompt: "p" }).threshold).toBe(THRESHOLD_DEFAULT)
  })
})
