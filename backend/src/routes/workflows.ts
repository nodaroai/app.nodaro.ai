import type { FastifyInstance } from "fastify"

export async function workflowRoutes(app: FastifyInstance) {
  app.get("/v1/projects/:projectId/workflows", async () => {
    return { data: [] }
  })

  app.post("/v1/projects/:projectId/workflows", async () => {
    return { data: null }
  })

  app.get("/v1/workflows/:id", async () => {
    return { data: null }
  })

  app.patch("/v1/workflows/:id", async () => {
    return { data: null }
  })

  app.delete("/v1/workflows/:id", async (_req, reply) => {
    return reply.status(204).send()
  })

  app.post("/v1/workflows/:id/run", async () => {
    return { data: null }
  })
}
