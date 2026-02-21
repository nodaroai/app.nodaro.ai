import Fastify from "fastify"
import { registerAuthHook } from "../middleware/auth.js"

/**
 * Creates a minimal Fastify instance with the auth hook registered.
 * Supabase auth is expected to be mocked at the module level by the
 * calling test file (default: reject all tokens).
 */
export async function createTestApp() {
  const app = Fastify({ logger: false })
  registerAuthHook(app)
  return app
}
