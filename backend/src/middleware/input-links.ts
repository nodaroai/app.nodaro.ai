import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { judgeInputLinks } from "../lib/input-links.js"
import { inputLinkReadingForRoute } from "../lib/input-link-lanes.js"
import { surfaceInputLinksMode } from "../lib/surface-profile.js"

/**
 * THE REST LANE of the media-input funnel (`lib/input-links.ts`, decided
 * 2026-11-16): every request with a body, to any route, has its media inputs
 * judged here — in front of every route's own preHandlers (its credit guard,
 * its length probes, its holds), so a refused request has created, reserved,
 * fetched and sent nothing. Registered on the root instance before any route,
 * so a route added later is covered without a word: what it takes is read by
 * its field names, and what a name cannot say is declared in
 * `lib/input-link-lanes.ts` (held to the routes by `input-links-census.test.ts`).
 *
 * Not judged here:
 *  - a deployment that has not set the lever (`"allow"`): one env read;
 *  - an internal call (`authKind: "internal"`): the workflow engine's call of
 *    a node's route, whose inputs the engine judged; an MCP verb's, whose
 *    arguments the MCP lane judged; a plugin's own step, whose run was judged
 *    at its request;
 *  - the MCP transport itself (`config.mcpTransport`), which judges each tool
 *    call's arguments itself (`lib/mcp/tool-addresses.ts`);
 *  - a route the lanes table exempts, with why.
 */
const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"])

export async function judgeRequestInputLinks(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (surfaceInputLinksMode() === "allow") return
  if (!BODY_METHODS.has(req.method) || req.body === undefined || req.body === null) return
  if (req.authKind === "internal") return
  const options = req.routeOptions
  if ((options?.config as { mcpTransport?: unknown } | undefined)?.mcpTransport === true) return
  const pattern = options?.url
  if (!pattern) return
  const route = `${req.method} ${pattern}`
  const reading = inputLinkReadingForRoute(route)
  if (reading === null) return
  const verdict = judgeInputLinks({ kind: "route", name: route }, req.body, { reading, ...(req.userId ? { userId: req.userId } : {}) })
  if (verdict.refusal) return void reply.code(403).send({ error: verdict.refusal })
}

/** Registers the judge on the root instance: before every route plugin, after the auth hook (the user it logs). */
export function registerInputLinkJudge(app: FastifyInstance): void {
  app.addHook("preHandler", judgeRequestInputLinks)
}
