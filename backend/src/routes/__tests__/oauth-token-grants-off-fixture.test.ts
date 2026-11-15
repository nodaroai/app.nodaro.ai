import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * `POST /v1/oauth/token` on a deployment that has not turned the
 * server-to-server assertion exchange on (decided 2026-11-11) answers exactly
 * as it did before the exchange existed.
 *
 * The inline snapshots below were RECORDED by running this file on the code as
 * it was before the exchange was added (dev at 19594ac450), then kept
 * unchanged while it was built: the authorization-code grant in each of its
 * shapes (PKCE, a client secret, JSON, and every refusal), the grants the
 * endpoint does not know, the jwt-bearer grant as an application would send
 * it, and the grants the authorization-server metadata names. Once with no
 * MCP client list, once with one (MCP_ALLOWED_CLIENT_IDS naming both clients):
 * the exchange is on only where a deployment turns it on, and neither of
 * these does.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  delete process.env.MCP_ALLOWED_CLIENT_IDS
  delete process.env.NODARO_SURFACE_PROFILE
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { buildApp } from "../../app.js"
import { config } from "../../lib/config.js"
import { hashSecret } from "../developer-apps.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { OWN_CLIENT_ID, seedLane } from "./helpers/mcp-lane-transcript.js"
import { SECRET_CLIENT_ID, TOKEN_WALK_SECRET, seedSecretClient, tokenTranscript } from "./helpers/oauth-token-transcript.js"

const MCP_RESOURCE = "https://mcp.example.com/mcp"

describe("POST /v1/oauth/token with the assertion exchange not turned on — unchanged", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    const db = fake.db as OAuthMemoryDb
    seedLane(db)
    seedSecretClient(db, await hashSecret(TOKEN_WALK_SECRET))
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("no MCP client list: every grant, every shape", async () => {
    expect(config.MCP_ALLOWED_CLIENT_IDS).toBe("")
    expect(await tokenTranscript(app, { resource: MCP_RESOURCE })).toMatchInlineSnapshot(`
      {
        "clientCredentials": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codeMissingSecret": {
          "body": {
            "error": "invalid_client",
            "error_description": "client_secret required for non-PKCE flow",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 401,
        },
        "codeMissingVerifier": {
          "body": {
            "error": "invalid_request",
            "error_description": "code_verifier required for PKCE",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codeNoCode": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected string, received undefined",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codeOtherClient": {
          "body": {
            "error": "invalid_grant",
            "error_description": "Code does not belong to this client_id",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codePkce": {
          "body": {
            "access_token": "<random>",
            "expires_in": 7776000,
            "scope": "jobs:read",
            "token_type": "Bearer",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "codeReused": {
          "body": {
            "error": "invalid_grant",
            "error_description": "Code expired, used, or redirect_uri mismatch",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codeSecret": {
          "body": {
            "access_token": "<random>",
            "expires_in": 7776000,
            "scope": "jobs:read",
            "token_type": "Bearer",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "codeSecretJson": {
          "body": {
            "access_token": "<random>",
            "expires_in": 7776000,
            "scope": "jobs:read",
            "token_type": "Bearer",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "codeUnknownClient": {
          "body": {
            "error": "invalid_client",
            "error_description": "Unknown client",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 401,
        },
        "codeUnknownCode": {
          "body": {
            "error": "invalid_grant",
            "error_description": "Code expired, used, or redirect_uri mismatch",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "codeWrongSecret": {
          "body": {
            "error": "invalid_client",
            "error_description": "Bad client_secret",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 401,
        },
        "codeWrongVerifier": {
          "body": {
            "error": "invalid_grant",
            "error_description": "code_verifier does not match code_challenge",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "emptyBody": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "grantTypesSupported": [
          "authorization_code",
        ],
        "jwtBearer": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerJson": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerNoAssertion": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerNoClient": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerNoResource": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerPublicClient": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "jwtBearerUnknownClient": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "noGrantType": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "password": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "refreshToken": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
      }
    `)
  })

  it("an MCP client list naming both clients: every grant, every shape", async () => {
    const before = config.MCP_ALLOWED_CLIENT_IDS
    config.MCP_ALLOWED_CLIENT_IDS = `${OWN_CLIENT_ID},${SECRET_CLIENT_ID}`
    try {
      expect(await tokenTranscript(app, { resource: MCP_RESOURCE })).toMatchInlineSnapshot(`
        {
          "clientCredentials": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codeMissingSecret": {
            "body": {
              "error": "invalid_client",
              "error_description": "client_secret required for non-PKCE flow",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 401,
          },
          "codeMissingVerifier": {
            "body": {
              "error": "invalid_request",
              "error_description": "code_verifier required for PKCE",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codeNoCode": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected string, received undefined",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codeOtherClient": {
            "body": {
              "error": "invalid_grant",
              "error_description": "Code does not belong to this client_id",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codePkce": {
            "body": {
              "access_token": "<random>",
              "expires_in": 7776000,
              "scope": "jobs:read",
              "token_type": "Bearer",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 200,
          },
          "codeReused": {
            "body": {
              "error": "invalid_grant",
              "error_description": "Code expired, used, or redirect_uri mismatch",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codeSecret": {
            "body": {
              "access_token": "<random>",
              "expires_in": 7776000,
              "scope": "jobs:read",
              "token_type": "Bearer",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 200,
          },
          "codeSecretJson": {
            "body": {
              "access_token": "<random>",
              "expires_in": 7776000,
              "scope": "jobs:read",
              "token_type": "Bearer",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 200,
          },
          "codeUnknownClient": {
            "body": {
              "error": "invalid_client",
              "error_description": "Unknown client",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 401,
          },
          "codeUnknownCode": {
            "body": {
              "error": "invalid_grant",
              "error_description": "Code expired, used, or redirect_uri mismatch",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "codeWrongSecret": {
            "body": {
              "error": "invalid_client",
              "error_description": "Bad client_secret",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 401,
          },
          "codeWrongVerifier": {
            "body": {
              "error": "invalid_grant",
              "error_description": "code_verifier does not match code_challenge",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "emptyBody": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "grantTypesSupported": [
            "authorization_code",
          ],
          "jwtBearer": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerJson": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerNoAssertion": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerNoClient": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerNoResource": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerPublicClient": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "jwtBearerUnknownClient": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "noGrantType": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "password": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
          "refreshToken": {
            "body": {
              "error": "invalid_request",
              "error_description": "Invalid input: expected "authorization_code"",
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
            },
            "status": 400,
          },
        }
      `)
    } finally {
      config.MCP_ALLOWED_CLIENT_IDS = before
    }
  })
})
