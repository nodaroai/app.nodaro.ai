/** OpenAPI entries for `/v1/palettes` and `/v1/moodboards` (routes in `palettes.ts` / `moodboards.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import {
  createMoodboardBody,
  createPaletteBody,
  idParams,
  listQuery,
  updateMoodboardBody,
  updatePaletteBody,
} from "../lib/palettes-moodboards.js"

const Palette = z.object({
  id: z.string().uuid(),
  name: z.string(),
  colors: z.array(z.string()).describe("2..12 colours, `#RRGGBB`, upper case."),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const Moodboard = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().describe("The words a run puts into the prompt as the moodboard's look."),
  images: z
    .array(z.object({ url: z.string(), caption: z.string().optional() }))
    .describe("1..12 links, stored as given (never copied). A run sends them as style references."),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const page = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), nextCursor: z.string().nullable() })

const security = [{ bearerAuth: [] }]
const notFound = { description: "Not found (or not yours)" }
const unauthorized = { description: "Unauthorized" }
const notAvailable = { description: "This server's database does not have the table yet" }

for (const family of [
  {
    path: "/v1/palettes",
    noun: "palette",
    item: Palette,
    create: createPaletteBody,
    update: updatePaletteBody,
    use: "Use one on generate-image as `direction.colorLook: \"palette:<id>\"`: every colour, named and with its hex, goes into the prompt.",
  },
  {
    path: "/v1/moodboards",
    noun: "moodboard",
    item: Moodboard,
    create: createMoodboardBody,
    update: updateMoodboardBody,
    use: "Use one on generate-image as `direction.style: \"moodboard:<id>\"`: its description goes into the prompt and its images go along as style references, after your own references and up to the model's limit.",
  },
] as const) {
  const json = { "application/json": { schema: family.item } }

  openApiRegistry.registerPath({
    method: "get",
    path: family.path,
    description: `List your ${family.noun}s, newest first. ${family.use}`,
    security,
    request: { query: listQuery },
    responses: {
      200: { description: `A page of ${family.noun}s`, content: { "application/json": { schema: page(family.item) } } },
      401: unauthorized,
    },
  })

  openApiRegistry.registerPath({
    method: "post",
    path: family.path,
    description: `Create a ${family.noun}. ${family.use}`,
    security,
    request: { body: { content: { "application/json": { schema: family.create } } } },
    responses: { 201: { description: "Created", content: json }, 401: unauthorized, 503: notAvailable },
  })

  openApiRegistry.registerPath({
    method: "get",
    path: `${family.path}/{id}`,
    description: `Get one of your ${family.noun}s.`,
    security,
    request: { params: idParams },
    responses: { 200: { description: `The ${family.noun}`, content: json }, 401: unauthorized, 404: notFound },
  })

  openApiRegistry.registerPath({
    method: "patch",
    path: `${family.path}/{id}`,
    description: `Change a ${family.noun}: only the fields you send are written; a description of null clears it.`,
    security,
    request: { params: idParams, body: { content: { "application/json": { schema: family.update } } } },
    responses: { 200: { description: `The ${family.noun}`, content: json }, 401: unauthorized, 404: notFound, 503: notAvailable },
  })

  openApiRegistry.registerPath({
    method: "delete",
    path: `${family.path}/{id}`,
    description: `Delete a ${family.noun}. A run that still names it answers 404 \`direction_not_found\`.`,
    security,
    request: { params: idParams },
    responses: { 200: { description: "Deleted" }, 401: unauthorized, 404: notFound, 503: notAvailable },
  })
}
