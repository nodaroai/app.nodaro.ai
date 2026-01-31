import type { FastifyInstance } from "fastify"

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    }
  })
}
