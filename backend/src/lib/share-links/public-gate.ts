/**
 * The gate every public read of a share link passes (the JSON reads and the
 * card): the per-network limit, and the live link a token names. Each route
 * also asks the deployment's public-work switch itself
 * (`surfaceAllowsPublicOutputs`, lib/__tests__/public-outputs-reads-totality.test.ts).
 */
import type { FastifyRequest } from "fastify"
import { rateLimitAddressKey } from "../client-address.js"
import { isUserBlocked } from "../access-blocks.js"
import { findLiveShareByToken } from "./store.js"
import type { ShareLinkRow } from "./types.js"

/**
 * This many a minute, per network for a guest and per account when signed in,
 * keyed after the auth hook on who it resolved (a made-up bearer is a guest
 * here, so a header key would give each one its own bucket).
 */
export function publicReadLimit(max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: "1 minute",
      hook: "preHandler" as const,
      keyGenerator: (req: FastifyRequest) => (req.userId ? `share-read:user:${req.userId}` : `share-read:${rateLimitAddressKey(req)}`),
    },
  }
}

/** The live link a token names, or null: unknown, malformed, turned off, or its owner's account blocked or suspended. */
export async function findShownShare(token: string): Promise<ShareLinkRow | null> {
  const share = await findLiveShareByToken(token)
  if (!share || (await isUserBlocked(share.owner_id))) return null
  return share
}
