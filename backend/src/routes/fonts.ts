import type { FastifyInstance } from "fastify"
import { readFile } from "node:fs/promises"
import { overlayFontFilePath } from "../providers/image/overlay-text.js"
import { sendInternalError } from "../lib/http-errors.js"

/** The bundled faces never change while the process runs — read each once. */
const fontCache = new Map<string, Promise<Buffer>>()
function fontBytes(file: string, path: string): Promise<Buffer> {
  const hit = fontCache.get(file)
  if (hit) return hit
  const pending = readFile(path).catch((err) => {
    fontCache.delete(file)
    throw err
  })
  fontCache.set(file, pending)
  return pending
}

/**
 * Serves the bundled overlay fonts so the canvas preview renders text with
 * the exact face the worker rasterises. Public and immutable-cached: the
 * registry (OVERLAY_FONTS in @nodaro/shared) is the only allow-list — a
 * request for any other name is a 404, so no path ever comes from the URL.
 */
export async function fontRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>("/v1/fonts/:file", async (req, reply) => {
    const path = overlayFontFilePath(req.params.file)
    if (!path) {
      return reply.status(404).send({ error: { code: "not_found", message: "Unknown font" } })
    }
    let bytes: Buffer
    try {
      bytes = await fontBytes(req.params.file, path)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load font")
    }
    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Access-Control-Allow-Origin", "*")
      .type("font/ttf")
      .send(bytes)
  })
}
