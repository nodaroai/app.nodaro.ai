/**
 * Which DB columns of a saved entity land on its canvas node, per kind.
 *
 * Four surfaces copy an entity row onto a node: the browser's load-time
 * hydrator, the browser's library picker, the backend's run-time hydration, and
 * (indirectly) anything that reads a node expecting those fields to be there.
 * They used to be four hand-written lists, and they drifted exactly as you would
 * expect — the load-time hydrator covers `character` and nothing else, so an
 * object node bound by an agent stays media-less until someone rebinds it by
 * hand.
 *
 * This is the field NAMES only — the structural vocabulary. Merge behaviour
 * (defaults, `prev` fallbacks, type narrowing) stays with each caller, because
 * a browser node and a server row disagree about nulls and it is not worth
 * pretending otherwise.
 */

/**
 * Every entity kind, in the order surfaces present them.
 *
 * The list is the invariant: `Record<EntityNodeKind, …>` makes the compiler
 * find every table below, every per-kind UI row in the `@` picker, and the
 * picker’s kind→query map. What the compiler cannot see — that the MCP read
 * tools for a kind exist and are reachable — is pinned by a test instead.
 *
 * Tool names are derivable from it too: `list_<kind>s` / `get_<kind>`.
 */
export const ENTITY_NODE_KINDS = ["character", "object", "creature", "location"] as const

export type EntityNodeKind = (typeof ENTITY_NODE_KINDS)[number]

/** The `data.*DbId` field that binds each entity node to its row. */
export const ENTITY_DB_ID_FIELD: Record<EntityNodeKind, string> = {
  character: "characterDbId",
  object: "objectDbId",
  creature: "creatureDbId",
  location: "locationDbId",
}

/** The `data.*Name` field each kind stores its display name under. */
export const ENTITY_NAME_FIELD: Record<EntityNodeKind, string> = {
  character: "characterName",
  object: "objectName",
  creature: "creatureName",
  location: "locationName",
}

/** Postgres table per kind. */
export const ENTITY_TABLE: Record<EntityNodeKind, string> = {
  character: "characters",
  object: "objects",
  creature: "creatures",
  location: "locations",
}

/**
 * `{name,url}[]` buckets per kind, as `[db_column, nodeField]`.
 *
 * These are what a generation actually consumes — the variant a prompt
 * `@mentions`, the extra references a user attaches. A node missing them is not
 * visibly broken; it just quietly generates the wrong picture.
 */
export const ENTITY_BUCKET_FIELDS: Record<EntityNodeKind, ReadonlyArray<readonly [string, string]>> = {
  character: [
    ["expressions", "expressions"],
    ["poses", "poses"],
    ["motions", "motions"],
    ["angles", "angles"],
    ["body_angles", "bodyAngles"],
    ["lighting_variations", "lightingVariations"],
    ["outfit_variations", "outfitVariations"],
    ["detail_closeups", "detailCloseups"],
    ["sheets", "sheets"],
  ],
  object: [
    ["angles", "angles"],
    ["materials", "materials"],
    ["variations", "variations"],
    ["motion_clips", "motionClips"],
    ["detail_closeups", "detailCloseups"],
    ["sheets", "sheets"],
  ],
  creature: [
    ["angles", "angles"],
    ["poses", "poses"],
    ["variations", "variations"],
    ["motion_clips", "motionClips"],
    ["detail_closeups", "detailCloseups"],
    ["sheets", "sheets"],
  ],
  location: [
    ["time_of_day", "timeOfDay"],
    ["weather", "weather"],
    ["angles", "angles"],
    ["lighting", "lighting"],
    ["seasons", "seasons"],
    ["atmosphere_motions", "atmosphereMotions"],
    ["detail_closeups", "detailCloseups"],
    ["sheets", "sheets"],
  ],
}

/**
 * Scalars every kind shares, as `[db_column, nodeField]`.
 *
 * `source_image_url` is the load-bearing one: the run engine reads
 * `defaultAssetUrl || sourceImageUrl` and SKIPS the reference entirely when
 * both are empty — no error, no warning, just a generation of the wrong
 * person. A node with an id but no image is the shape an agent produces.
 */
export const ENTITY_SCALAR_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["name", "__name"], // routed to the kind's own name field by the caller
  ["description", "description"],
  ["canonical_description", "canonicalDescription"],
  ["source_image_url", "sourceImageUrl"],
]

/**
 * Scalars only SOME kinds have.
 *
 * `style_lock` looks shared and is not: characters never grew the column,
 * because a character's likeness is the lock. Selecting it from `characters`
 * anyway is a PostgREST error, which the run-time hydrator swallows by design
 * — so the whole kind would quietly stop hydrating and every test that mocks
 * the database would still pass. That is why the column lists are checked
 * against the migrations by `entity-hydration-columns.test.ts`.
 */
export const ENTITY_KIND_SCALAR_FIELDS: Record<EntityNodeKind, ReadonlyArray<readonly [string, string]>> = {
  character: [],
  object: [["style_lock", "styleLock"]],
  creature: [["style_lock", "styleLock"]],
  location: [["style_lock", "styleLock"]],
}

/** Every DB column a full hydration of `kind` reads. */
export function entityHydrationColumns(kind: EntityNodeKind): string[] {
  return [
    "id",
    ...entityScalarFields(kind).map(([column]) => column),
    ...ENTITY_BUCKET_FIELDS[kind].map(([column]) => column),
  ]
}

/** Every scalar `kind` actually has, shared plus its own. */
export function entityScalarFields(kind: EntityNodeKind): ReadonlyArray<readonly [string, string]> {
  return [...ENTITY_SCALAR_FIELDS, ...ENTITY_KIND_SCALAR_FIELDS[kind]]
}
