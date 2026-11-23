/** OpenAPI entries for `/v1/favorites*` (routes in `favorites.ts`) and `GET /v1/library` (`library.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { FAVORITE_KINDS } from "../lib/favorites-cursor.js"
import { JOB_SOURCES } from "../lib/job-source.js"

const CatalogFavorite = z
  .object({
    catalog: z.string().describe("The catalog's id: a picker catalog's `catalogId` (`GET /v1/picker-catalogs`), `shot-shapes` or `style-presets`."),
    optionId: z.string().describe("The option's id; a per-field option of a multi-field catalog is `<field>:<id>` (`genre:jazz`)."),
    label: z.string().nullable().describe("The option's label now; null when its catalog no longer has it."),
    createdAt: z.string(),
  })
  .openapi("CatalogFavorite")

const FavoriteItem = z
  .object({
    kind: z.enum(FAVORITE_KINDS),
    id: z.string().describe("What the favorite points at: the job id, the asset id, the voice id, the preset id, or `<catalog>/<optionId>`."),
    favoritedAt: z.string().describe("When it was starred."),
    job: z
      .object({
        id: z.string().uuid(),
        type: z.string().nullable(),
        status: z.string().nullable(),
        mediaType: z.enum(["image", "video", "audio"]).nullable(),
        url: z.string().nullable(),
        thumbnailUrl: z.string().nullable(),
        createdAt: z.string().nullable(),
      })
      .optional()
      .describe("kind `job`: the generation."),
    asset: z
      .object({
        id: z.string().uuid(),
        type: z.string(),
        filename: z.string().nullable(),
        url: z.string(),
        thumbnailUrl: z.string().nullable(),
        createdAt: z.string(),
      })
      .optional()
      .describe("kind `asset`: an uploaded file, or a library file whose job was in the Trash when it was starred."),
    voice: z
      .object({ voiceId: z.string(), voiceType: z.string(), name: z.string(), previewUrl: z.string().nullable() })
      .optional()
      .describe("kind `voice`: the voice as it was starred."),
    preset: z.object({ nodeType: z.string(), presetId: z.string() }).optional().describe("kind `preset`: the node preset."),
    catalog: z
      .object({ catalog: z.string(), optionId: z.string(), label: z.string().nullable() })
      .optional()
      .describe("kind `catalog`: the picker option."),
  })
  .openapi("FavoriteItem")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/favorites",
  description:
    "Every favorite you keep, in one list, newest first: generations (`job`), uploads (`asset` — a library file whose job was in the " +
    "Trash when starred too; any other file a job made lists as its `job`), voices (`voice`), node presets (`preset`) and picker " +
    "options (`catalog`). Each item carries enough to render it. `kinds` narrows the list (comma-separated); `cursor` is the previous " +
    "page's `nextCursor`. A page can hold fewer items than `limit`, even none, while `nextCursor` is set (a favorite you can no longer " +
    "see is left out): page until it is null. The list is not counted. OAuth apps read the kinds their grant reads through each " +
    "kind's own route: `assets:read` (all but presets; jobs also with `jobs:read`), `presets:read` (presets). Without `kinds` an app " +
    "gets the kinds it may read; naming one it may not is a 403. 120 requests a minute.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      kinds: z.string().optional().describe(`Comma-separated: ${FAVORITE_KINDS.join(", ")}. Default: every kind.`),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Page size, 1–100 (default 50)."),
      cursor: z.string().optional().describe("The previous page's `nextCursor`."),
    }),
  },
  responses: {
    200: {
      description: "A page of favorites",
      content: { "application/json": { schema: z.object({ data: z.array(FavoriteItem), nextCursor: z.string().nullable() }) } },
    },
    400: { description: "An unknown kind, or a cursor this API did not write" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token that may not read a kind it named" },
    429: { description: "Too many requests" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/favorites/catalog",
  description:
    "Your favorite picker options, newest first — styles, looks, moods, camera moves, Person settings, music genres and moods, " +
    "instruments, voices, deliveries, shot shapes, Style Gallery looks. `catalog` narrows it to one catalog. OAuth apps need `assets:read`.",
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ catalog: z.string().optional().describe("One catalog's id (a node type is accepted too).") }) },
  responses: {
    200: { description: "Your favorite options", content: { "application/json": { schema: z.object({ data: z.array(CatalogFavorite) }) } } },
    400: { description: "An unknown catalog" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:read" },
  },
})

const catalogPathParams = z.object({
  catalog: z.string().describe("The catalog's id: a picker catalog's `catalogId` (its node type is accepted too), `shot-shapes` or `style-presets`."),
  optionId: z.string().describe("The option's id; `<field>:<id>` for a per-field option (a bare id that names one option is accepted)."),
})

openApiRegistry.registerPath({
  method: "put",
  path: "/v1/favorites/catalog/{catalog}/{optionId}",
  description:
    "Star a picker option. Both ids are checked against the catalogs this server serves; the answer gives the stored spelling. " +
    "Idempotent. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: { params: catalogPathParams },
  responses: {
    200: {
      description: "The option is a favorite",
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({ catalog: z.string(), optionId: z.string(), label: z.string(), favorited: z.literal(true), createdAt: z.string().nullable() }),
          }),
        },
      },
    },
    400: { description: "An unknown catalog or option, or a bare id that names options of several fields" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    409: { description: "The most favorite options a person can keep" },
    429: { description: "Too many writes; wait a minute" },
    503: { description: "Favorite options are not available on this server yet" },
  },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/favorites/catalog/{catalog}/{optionId}",
  description: "Unstar a picker option. Idempotent: removing one that is not starred succeeds. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: { params: catalogPathParams },
  responses: {
    200: {
      description: "The option is not a favorite",
      content: { "application/json": { schema: z.object({ data: z.object({ catalog: z.string(), optionId: z.string(), favorited: z.literal(false) }) }) } },
    },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    429: { description: "Too many writes; wait a minute" },
    503: { description: "Favorite options are not available on this server yet" },
  },
})

const LibraryAsset = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["image", "video", "audio"]),
    filename: z.string().nullable(),
    mimeType: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    url: z.string(),
    thumbnailUrl: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    isLibraryItem: z.boolean(),
    uploadSource: z.string(),
    source: z.string().nullable(),
    sourceDetail: z.string().nullable(),
    jobId: z.string().uuid().nullable().describe("The job that made the file; null for an upload."),
    title: z.string().nullable().describe("The name the owner gave that job."),
    favorited: z
      .boolean()
      .optional()
      .describe(
        "Whether you favorited the file: a file a job made by its job's favorite while that job is out of the Trash, an upload " +
          "(or a file whose job is in the Trash) by its own star. Absent when it could not be read.",
      ),
    createdAt: z.string(),
  })
  .openapi("LibraryAsset")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/library",
  description:
    "Your media library, newest first: the files you saved to it and the shared items (`owned=true`: every file you own). " +
    "Filter by `type`, `source`, a filename search (`q`) and `favorited` — all together, with the cursor.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      type: z.enum(["all", "image", "video", "audio"]).optional(),
      q: z.string().optional().describe("Words that must all occur in the filename or a song's title."),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Page size, 1–100 (default 40)."),
      cursor: z.string().uuid().optional().describe("The previous page's `nextCursor`."),
      owned: z.enum(["true", "false"]).optional(),
      source: z.enum(JOB_SOURCES).optional(),
      favorited: z
        .enum(["true", "false"])
        .optional()
        .describe("Only the files you favorited (`true`), or did not (`false`), by the rule of `favorited` on each file; any number of favorites."),
    }),
  },
  responses: {
    200: {
      description: "A page of the library",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(LibraryAsset),
            nextCursor: z.string().nullable(),
            totalCount: z.number().int().optional().describe("The exact total; on the first page only."),
          }),
        },
      },
    },
    400: { description: "An invalid filter" },
    401: { description: "Unauthorized" },
    503: { description: "`favorited` on a server whose database does not have upload favorites yet" },
  },
})
