import type { FastifyRequest } from "fastify"

/**
 * The per-minute limit on the node routes that are run lanes (#1890): the
 * editor's Run (a person's session) and the orchestrator (the internal
 * secret) call them once per item of a fan-out, so a cap there would fail a
 * long run halfway. A direct caller with an API token or an app token, the
 * credentials the public APIs limit, gets `max` calls a minute per
 * credential, so these routes are not a way around those APIs. The limiter
 * runs before auth, so it reads the credential's shape. A forged `ndr_` token
 * is limited and then refused, and any other forged header is refused by auth.
 */
const MACHINE_CREDENTIAL = /^Bearer ndr_/

export function machineCredentialLimit(max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: "1 minute",
      allowList: (req: FastifyRequest) => !MACHINE_CREDENTIAL.test(req.headers.authorization ?? ""),
    },
  }
}
