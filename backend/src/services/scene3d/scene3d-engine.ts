import type { FastifyReply, FastifyRequest } from "fastify"
import { config, hasCredits } from "../../lib/config.js"
import { getPluginEngines } from "../../lib/private-plugins/engine-registry.js"
import { sendInternalError } from "../../lib/http-errors.js"

function unavailable(reply: FastifyReply) {
  return reply.status(503).send({ error: {
    code: "SCENE_CAPABILITY_UNAVAILABLE",
    message: "The selected 3D authoring engine is unavailable on this instance.",
  } })
}

/** A missing/unknown explicit engine must never become a paid Basic request. */
export function requestedScene3DEngine(body: unknown): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>).engine : undefined
}

export async function scene3DCapabilities() {
  const engine = hasCredits() && config.SCENE3D_ADVANCED_ENABLED ? getPluginEngines().scene3d : undefined
  const advanced = engine ? await engine.capabilities() : undefined
  return {
    basic: { available: true, sceneSchemaVersions: [1] },
    advanced: advanced ? {
      ...advanced,
      engines: advanced.engines.filter((value) => value !== "blender-local" || config.SCENE3D_LOCAL_ENABLED),
    } : null,
  }
}

/** Called before Basic's credit guard. The private engine owns its admission. */
export async function dispatchAdvancedScene3D(
  operation: "generate" | "edit",
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return
  }
  const selected = requestedScene3DEngine(request.body)
  if (selected !== "blender-cloud" && selected !== "blender-local") {
    reply.status(400).send({ error: { code: "validation_error", message: "Unknown 3D authoring engine" } })
    return
  }
  const engine = getPluginEngines().scene3d
  if (!hasCredits() || !config.SCENE3D_ADVANCED_ENABLED || !engine ||
      (selected === "blender-local" && !config.SCENE3D_LOCAL_ENABLED)) {
    unavailable(reply)
    return
  }
  try {
    const capabilities = await engine.capabilities()
    if (!capabilities.engines.includes(selected)) {
      unavailable(reply)
      return
    }
    const output = await engine[operation](request, reply)
    if (!reply.sent) reply.send(output)
  } catch (error) {
    if (!reply.sent) sendInternalError(reply, request, error, "Failed to start 3D scene authoring")
  }
}
