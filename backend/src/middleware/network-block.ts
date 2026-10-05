import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { hasAdmin } from "../lib/config.js"
import { clientAddress } from "../lib/client-address.js"
import { ACCESS_BLOCKED_BODY, isAddressBlocked } from "../lib/access-blocks.js"
import { roleIsAdmin } from "../lib/admin-check.js"

/**
 * Network blocks (admin → Blocks): a browser session from a blocked network is
 * refused, whoever it belongs to.
 *
 * BROWSER SESSIONS ONLY (`authKind === "jwt"`), on purpose. Connector servers
 * (Claude.ai, ChatGPT), CI jobs running the CLI and every inbound webhook reach
 * us from addresses SHARED by thousands of accounts; one click on such a
 * network would cut all of them off. An account that misbehaves through a token
 * is blocked as an account. A new account made on a blocked network cannot use
 * the app — or claim free credits, which is a request like any other.
 *
 * ADMINS ARE NEVER REFUSED HERE, so an admin can always reach the page that
 * lifts a block, from any network. Their role is already on the request (the
 * session resolution loads it), so this costs no read.
 *
 * Registered right after the auth hook, only on an edition with an admin panel.
 * An address that cannot be known is never refused — that includes one the
 * edge reports as a Cloudflare server (a Cloudflare Worker, or Cloudflare's own
 * VPN, WARP), which thousands of people share. That is the same way around a
 * network block as any VPN, which this tool never claimed to stop: the account
 * block is the tool for an account.
 */
export function registerNetworkBlockHook(app: FastifyInstance): void {
  if (!hasAdmin()) return
  app.addHook("preHandler", refuseBlockedNetwork)
}

export async function refuseBlockedNetwork(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.authKind !== "jwt" || !req.userId) return
  if (roleIsAdmin(req.userRole)) return
  if (!(await isAddressBlocked(clientAddress(req)))) return
  reply.status(403).send(ACCESS_BLOCKED_BODY)
}
