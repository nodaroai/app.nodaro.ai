import type { FastifyInstance } from "fastify"

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN

interface ReplicatePrediction {
  id: string
  model: string
  version: string
  input: Record<string, unknown>
  output: unknown
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  error: string | null
  logs: string | null
  metrics: {
    predict_time?: number
    total_time?: number
  }
  created_at: string
  started_at: string | null
  completed_at: string | null
  urls: {
    get: string
    cancel: string
  }
  source: string
}

interface ReplicatePredictionsResponse {
  results: ReplicatePrediction[]
  next: string | null
  previous: string | null
}

export async function predictionsRoutes(app: FastifyInstance) {
  // List all predictions from Replicate
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/v1/predictions",
    async (req, reply) => {
      if (!REPLICATE_API_TOKEN) {
        return reply.status(500).send({
          error: { code: "config_error", message: "Replicate API token not configured" },
        })
      }

      const { cursor, limit = "50" } = req.query
      const url = new URL("https://api.replicate.com/v1/predictions")
      if (cursor) url.searchParams.set("cursor", cursor)

      try {
        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          return reply.status(response.status).send({
            error: { code: "replicate_error", message: errorText },
          })
        }

        const data = (await response.json()) as ReplicatePredictionsResponse

        // Limit results if needed (Replicate returns all by default)
        const limitNum = parseInt(limit, 10)
        const predictions = data.results.slice(0, Math.min(limitNum, data.results.length))

        return {
          data: predictions,
          next: data.next,
          previous: data.previous,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch predictions"
        return reply.status(500).send({
          error: { code: "fetch_error", message },
        })
      }
    }
  )

  // Get a single prediction by ID
  app.get<{ Params: { id: string } }>(
    "/v1/predictions/:id",
    async (req, reply) => {
      if (!REPLICATE_API_TOKEN) {
        return reply.status(500).send({
          error: { code: "config_error", message: "Replicate API token not configured" },
        })
      }

      const { id } = req.params

      try {
        const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          return reply.status(response.status).send({
            error: { code: "replicate_error", message: errorText },
          })
        }

        const prediction = (await response.json()) as ReplicatePrediction

        return { data: prediction }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch prediction"
        return reply.status(500).send({
          error: { code: "fetch_error", message },
        })
      }
    }
  )

  // Cancel a prediction
  app.post<{ Params: { id: string } }>(
    "/v1/predictions/:id/cancel",
    async (req, reply) => {
      if (!REPLICATE_API_TOKEN) {
        return reply.status(500).send({
          error: { code: "config_error", message: "Replicate API token not configured" },
        })
      }

      const { id } = req.params

      try {
        const response = await fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          return reply.status(response.status).send({
            error: { code: "replicate_error", message: errorText },
          })
        }

        const prediction = (await response.json()) as ReplicatePrediction

        return { data: prediction }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to cancel prediction"
        return reply.status(500).send({
          error: { code: "fetch_error", message },
        })
      }
    }
  )
}
