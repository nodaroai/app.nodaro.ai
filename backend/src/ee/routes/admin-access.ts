import type { FastifyInstance } from "fastify"
import { config } from "../../lib/config.js"
import { networkKey } from "../../lib/ip-address.js"
import { networkHash, networkHashScheme, resolveClientAddress } from "../../lib/client-address.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { keyToken } from "../lib/signup-signal-clusters.js"

/**
 * Admin access tools.
 *
 * `GET /v1/admin/access/whoami` — how the server sees the CALLER: the address
 * the shared derivation (`lib/client-address.ts`) decided, the hop it came
 * through, and the network token that admin pages show for it. It reads no
 * database and returns nothing about anyone else, so it answers on every
 * deployment and is how a deployment's address derivation is checked after a
 * change: call it through every way in (the app domain, the MCP domain, with
 * forged forwarding headers) and the address must be the caller's own each
 * time. Also allowed on the `mcp.*` host (`middleware/mcp-host-filter.ts`),
 * because that host reaches the backend without the bundled Caddy.
 */

/** Same keying as the free-grant cluster tokens, so the two pages agree. */
const TOKEN_SECRET = config.SUPABASE_SERVICE_ROLE_KEY

export async function adminAccessRoutes(app: FastifyInstance) {
  app.get("/v1/admin/access/whoami", { preHandler: requireAdmin }, async (req) => {
    const detail = resolveClientAddress(req)
    const key = detail.address ? networkKey(detail.address) : null
    const { scheme } = networkHashScheme()
    return {
      data: {
        address: detail.address,
        source: detail.source,
        hop: detail.hop,
        header: detail.header,
        network: key,
        networkToken: key ? keyToken(networkHash(key), TOKEN_SECRET) : null,
        hashScheme: scheme,
      },
    }
  })
}
