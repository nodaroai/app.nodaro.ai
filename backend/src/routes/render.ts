import type { FastifyInstance } from "fastify"

export async function renderRoutes(app: FastifyInstance) {
  app.post("/v1/render", async () => {
    return { data: null }
  })
}
