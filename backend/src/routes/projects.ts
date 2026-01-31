import type { FastifyInstance } from "fastify"

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/projects", async () => {
    return { data: [] }
  })

  app.post("/v1/projects", async () => {
    return { data: null }
  })

  app.get("/v1/projects/:id", async () => {
    return { data: null }
  })

  app.patch("/v1/projects/:id", async () => {
    return { data: null }
  })

  app.delete("/v1/projects/:id", async (_req, reply) => {
    return reply.status(204).send()
  })
}
