import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"

const sendSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.unknown()),
})

export async function webhookOutputRoutes(app: FastifyInstance) {
  app.post("/v1/webhook-output/send", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }

    const { url, payload } = parsed.data

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => "")
        return reply.status(502).send({
          error: `Webhook POST failed (${response.status})`,
          details: body.slice(0, 500),
        })
      }

      return reply.send({ success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      return reply.status(502).send({ error: `Webhook POST failed: ${message}` })
    }
  })
}
