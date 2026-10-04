import type { FastifyInstance } from "fastify"
import { hasCredits } from "../lib/config.js"
import { CLOUD_ONLY_NODE_TYPES, NODARO_EXCLUSIVE_NODE_TYPES } from "../lib/cloud-only-nodes.js"
import { effectiveDeniedWebScrapeSources, isNodeDenied, USER_VIEWER } from "../lib/surface-deny.js"
import { scene3DProAvailable } from "../services/scene3d/scene3d-engine.js"
import { isNodaroConnected } from "../lib/nodaro-connect.js"
import { z } from "zod"
import { PRO3D_RENDER_NODE_TYPE } from "@nodaro/shared"
import { getEnrichedRegistry, findNode, chargedDescriptor, webScrapeDescription, type NodeDescriptor } from "../lib/node-registry.js"
import { loadChargedPrices } from "../lib/pricing/charged-prices.js"


import { openApiRegistry } from "../lib/openapi-registry.js"

const NodeDescriptorSchema = z.object({
  type: z.string(),
  label: z.string(),
  category: z.string(),
  description: z.string(),
  outputType: z.string(),
  creditCost: z.union([z.number(), z.string()]).optional(),
  inputSchema: z.object({ fields: z.array(z.object({
    key: z.string(), type: z.string(), required: z.boolean().optional(), options: z.array(z.string()).optional(),
  })) }).optional(),
  providers: z.array(z.string()).optional(),
}).openapi("NodeDescriptor")

openApiRegistry.registerPath({
  method: "get", path: "/v1/nodes",
  description: "List every runnable node type with its descriptor (label, category, credit cost, providers).",
  security: [],
  responses: { 200: { description: "Node descriptors", content: { "application/json": { schema: z.object({ data: z.array(NodeDescriptorSchema) }) } } } },
})
openApiRegistry.registerPath({
  method: "get", path: "/v1/nodes/{type}",
  description: "Descriptor for one node type — including its provider list for model pickers.",
  security: [],
  request: { params: z.object({ type: z.string() }) },
  responses: {
    200: { description: "Node descriptor", content: { "application/json": { schema: z.object({ data: NodeDescriptorSchema }) } } },
    404: { description: "Unknown node type" },
  },
})

const typeParams = z.object({ type: z.string().min(1) })

/**
 * A descriptor as a USER of this deployment sees it. Web Scrape's description
 * drops the sources withdrawn from users (the Instagram source follows the
 * Instagram node's availability), like the editor's source dropdown does.
 * Always the user view: these routes answer with `Cache-Control: public`.
 */
function describedForUsers(desc: NodeDescriptor): NodeDescriptor {
  if (desc.type !== "web-scrape") return desc
  const withdrawn = effectiveDeniedWebScrapeSources(USER_VIEWER)
  return withdrawn.length === 0 ? desc : { ...desc, description: webScrapeDescription(new Set(withdrawn)) }
}

export async function nodesRoutes(app: FastifyInstance) {
  app.get("/v1/nodes", async (_req, reply) => {
    // Editions without the Cloud plugin lane must not advertise nodes they
    // cannot execute — this is the discovery contract the SDK, CLI and MCP
    // agents build against. The Nodaro-EXCLUSIVE nodes (4b) are runnable on
    // a self-host through the nodaro.ai credential, so they list iff the
    // install is connected — a live read; note the 5-min Cache-Control means
    // a connect/disconnect lags discovery by up to that long.
    const connected = hasCredits() ? true : await isNodaroConnected().catch(() => false)
    const data = getEnrichedRegistry().filter((n) => {
      // Deployment surface deny (B1) applies on every edition the gate is open
      // for (business+), so it runs before the cloud/credits branch.
      // ALWAYS the user view: this route is public and answers with
      // `Cache-Control: public`, so it cannot vary by caller — a node an admin
      // has not released to users is not part of the public discovery contract.
      if (isNodeDenied(n.type, USER_VIEWER)) return false
      // Readiness, not edition: 3D Render Pro exists only while an installed
      // engine actually implements the operation. Discovery asks the same
      // predicate the route does, so an agent is never told about a node whose
      // only possible answer today is 503.
      if (n.type === PRO3D_RENDER_NODE_TYPE && !scene3DProAvailable(USER_VIEWER)) return false
      if (hasCredits()) return true
      if (CLOUD_ONLY_NODE_TYPES.has(n.type)) return false
      if (NODARO_EXCLUSIVE_NODE_TYPES.has(n.type)) return connected
      return true
    })
    // The prices a run is charged, not the registry's base figures.
    const prices = await loadChargedPrices()
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data: data.map((n) => describedForUsers(chargedDescriptor(n, prices))) })
  })

  app.get("/v1/nodes/:type", async (req, reply) => {
    const parsed = typeParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid type" } })
    }
    // Deployment surface deny (B1): a denied node is not describable either.
    if (isNodeDenied(parsed.data.type, USER_VIEWER)) {
      return reply.status(404).send({
        error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` },
      })
    }
    // Same reason as the list route: an engine-gated node that isn't ready is
    // not describable either.
    if (parsed.data.type === PRO3D_RENDER_NODE_TYPE && !scene3DProAvailable(USER_VIEWER)) {
      return reply.status(404).send({
        error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` },
      })
    }
    // Same reason as the list route: don't describe a node this edition can't run.
    if (!hasCredits() && CLOUD_ONLY_NODE_TYPES.has(parsed.data.type)) {
      return reply.status(404).send({
        error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` },
      })
    }
    if (!hasCredits() && NODARO_EXCLUSIVE_NODE_TYPES.has(parsed.data.type)) {
      const connected = await isNodaroConnected().catch(() => false)
      if (!connected) {
        return reply.status(404).send({
          error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` },
        })
      }
    }
    const node = findNode(parsed.data.type)
    if (!node) {
      return reply.status(404).send({ error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` } })
    }
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data: describedForUsers(chargedDescriptor(node, await loadChargedPrices())) })
  })
}
