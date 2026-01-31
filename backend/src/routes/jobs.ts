import type { FastifyInstance } from "fastify"

export async function jobRoutes(app: FastifyInstance) {
  app.get("/v1/jobs", async () => {
    return { data: [] }
  })

  app.get("/v1/jobs/:id", async () => {
    return { data: null }
  })

  app.post("/v1/jobs/:id/cancel", async () => {
    return { data: null }
  })

  app.post("/v1/jobs/:id/retry", async () => {
    return { data: null }
  })
}
