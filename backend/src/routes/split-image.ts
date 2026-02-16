import type { FastifyInstance } from "fastify"
import { z } from "zod"
import sharp from "sharp"
import { uploadBufferToR2 } from "../lib/storage.js"
import { randomUUID } from "node:crypto"

const splitImageBody = z.object({
  imageUrl: z.string().url(),
  gridCols: z.number().int().min(1).max(6),
  gridRows: z.number().int().min(1).max(6),
  names: z.array(z.string().min(1)).min(1).max(36),
})

export async function splitImageRoutes(app: FastifyInstance) {
  app.post("/v1/split-image", async (req, reply) => {
    const parsed = splitImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, gridCols, gridRows, names } = parsed.data
    const expectedCount = gridCols * gridRows
    if (names.length !== expectedCount) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: `Expected ${expectedCount} names for ${gridCols}x${gridRows} grid, got ${names.length}`,
        },
      })
    }

    try {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`)
      }
      const imageBuffer = Buffer.from(await response.arrayBuffer())
      const metadata = await sharp(imageBuffer).metadata()

      if (!metadata.width || !metadata.height) {
        throw new Error("Could not read image dimensions")
      }

      const cellWidth = Math.floor(metadata.width / gridCols)
      const cellHeight = Math.floor(metadata.height / gridRows)
      const batchId = randomUUID()

      const results: { name: string; url: string }[] = []

      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const index = row * gridCols + col
          const name = names[index]
          const left = col * cellWidth
          const top = row * cellHeight

          const croppedBuffer = await sharp(imageBuffer)
            .extract({ left, top, width: cellWidth, height: cellHeight })
            .png()
            .toBuffer()

          const key = `characters/${batchId}/${name.toLowerCase().replace(/\s+/g, "-")}.png`
          const url = await uploadBufferToR2(croppedBuffer, key, "image/png")
          results.push({ name, url })
        }
      }

      return { images: results }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      return reply.status(500).send({
        error: { code: "internal_error", message },
      })
    }
  })
}
