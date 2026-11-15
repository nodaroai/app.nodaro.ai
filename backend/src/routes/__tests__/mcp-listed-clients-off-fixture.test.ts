import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * A deployment that sets none of the listed-clients levers (decided
 * 2026-11-11: `MCP_ALLOWED_CLIENT_IDS`, the surface profile's
 * `developerApps.manage` and the `apps` navigation entry hiding the public app
 * listing) answers exactly as it did before they existed.
 *
 * The inline snapshots below were RECORDED by running this file on the code as
 * it was before the levers were added (dev at ba63f74ff1), then kept unchanged
 * while they were built: every door of the MCP lane — the endpoint with each
 * credential kind it accepts, the consent redirect (and that it reads nothing),
 * app-info, consent, the token exchange, a refresh grant, dynamic registration —
 * plus the developer-app writes as a person and the public app listing (the
 * marketplace browse and MCP `list_apps`). Status, the headers that matter
 * (`www-authenticate`, `location`, `content-type`) and the whole body, with
 * random values masked.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.MCP_DCR_ALLOWLIST = "Claude,Cursor"
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
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { seedAppToken, type OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { ADMIN, appListings, developerAppWrites, laneTranscript, seedLane, USER_JWT, type Seeded } from "./helpers/mcp-lane-transcript.js"

describe("MCP lane with no listed-clients lever set — unchanged", () => {
  let app: FastifyInstance
  let seeded: Seeded

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    seeded = seedLane(fake.db as OAuthMemoryDb)
    app = await buildApp()
    // The MCP transport calls `destroySoon()` on the request's socket after a
    // drained body; the injected stand-in socket lacks it (see mcp-by-path.test.ts).
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
  })

  it("every door of the MCP lane and its sign-in", async () => {
    const transcript = await laneTranscript(app, seeded, { mcpPath: "/mcp", resource: "https://mcp.example.com/mcp" })
    expect(transcript).toMatchInlineSnapshot(`
      {
        "appInfoDcr": {
          "body": {
            "description": null,
            "homepageUrl": null,
            "kind": "dynamic_mcp",
            "logoUrl": null,
            "name": "Claude",
            "redirectUriRegistered": true,
            "scopesRequested": [
              "jobs:read",
              "assets:read",
              "assets:write",
            ],
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "appInfoOwn": {
          "body": {
            "description": null,
            "homepageUrl": null,
            "kind": "user",
            "logoUrl": null,
            "name": "Own chat",
            "redirectUriRegistered": true,
            "scopesRequested": [
              "jobs:read",
              "assets:read",
              "assets:write",
            ],
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "authorizeRedirectDcr": {
          "body": "",
          "headers": {
            "location": "https://app.example.com/oauth/authorize?response_type=code&client_id=ndr_dcr_22222222222222222222222222222222&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&scope=jobs%3Aread&state=st8&code_challenge=w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.example.com%2Fmcp",
          },
          "status": 302,
        },
        "authorizeRedirectOwn": {
          "body": "",
          "headers": {
            "location": "https://app.example.com/oauth/authorize?response_type=code&client_id=app_11111111111111111111111111111111&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&scope=jobs%3Aread&state=st8&code_challenge=w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.example.com%2Fmcp",
          },
          "status": 302,
        },
        "authorizeRedirectReads": 0,
        "consentDcr": {
          "body": {
            "code": "<random>",
            "redirectUri": "https://client.example/cb",
            "state": "st8",
          },
          "headers": {},
          "status": 200,
        },
        "consentOwn": {
          "body": {
            "code": "<random>",
            "redirectUri": "https://client.example/cb",
            "state": "st8",
          },
          "headers": {},
          "status": 200,
        },
        "endpoint": {
          "billingKey": {
            "body": {
              "error": {
                "code": "unauthorized",
                "message": "MCP requires a Bearer token. See /.well-known/oauth-protected-resource.",
              },
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
              "www-authenticate": "Bearer realm="mcp.example.com", resource="https://mcp.example.com/mcp"",
            },
            "status": 401,
          },
          "internalSecret": {
            "body": {
              "id": 1,
              "jsonrpc": "2.0",
              "result": {
                "capabilities": {
                  "experimental": {},
                  "resources": {
                    "listChanged": true,
                    "subscribe": false,
                  },
                  "tasks": {
                    "cancel": {},
                    "list": {},
                  },
                  "tools": {
                    "listChanged": true,
                  },
                },
                "protocolVersion": "2025-06-18",
                "serverInfo": {
                  "name": "nodaro-mcp",
                  "version": "1.0.0",
                },
              },
            },
            "headers": {
              "content-type": "application/json",
            },
            "status": 200,
          },
          "none": {
            "body": {
              "error": {
                "code": "unauthorized",
                "message": "MCP requires a Bearer token. See /.well-known/oauth-protected-resource.",
              },
            },
            "headers": {
              "content-type": "application/json; charset=utf-8",
              "www-authenticate": "Bearer realm="mcp.example.com", resource="https://mcp.example.com/mcp"",
            },
            "status": 401,
          },
          "ownClientToken": {
            "body": {
              "id": 1,
              "jsonrpc": "2.0",
              "result": {
                "capabilities": {
                  "experimental": {},
                  "resources": {
                    "listChanged": true,
                    "subscribe": false,
                  },
                  "tasks": {
                    "cancel": {},
                    "list": {},
                  },
                  "tools": {
                    "listChanged": true,
                  },
                },
                "protocolVersion": "2025-06-18",
                "serverInfo": {
                  "name": "nodaro-mcp",
                  "version": "1.0.0",
                },
              },
            },
            "headers": {
              "content-type": "application/json",
            },
            "status": 200,
          },
          "ownClientToolsList": {
            "count": 1,
            "hasPing": true,
            "status": 200,
          },
          "personalApiToken": {
            "body": {
              "id": 1,
              "jsonrpc": "2.0",
              "result": {
                "capabilities": {
                  "experimental": {},
                  "resources": {
                    "listChanged": true,
                    "subscribe": false,
                  },
                  "tasks": {
                    "cancel": {},
                    "list": {},
                  },
                  "tools": {
                    "listChanged": true,
                  },
                },
                "protocolVersion": "2025-06-18",
                "serverInfo": {
                  "name": "nodaro-mcp",
                  "version": "1.0.0",
                },
              },
            },
            "headers": {
              "content-type": "application/json",
            },
            "status": 200,
          },
          "selfRegisteredClientToken": {
            "body": {
              "id": 1,
              "jsonrpc": "2.0",
              "result": {
                "capabilities": {
                  "experimental": {},
                  "resources": {
                    "listChanged": true,
                    "subscribe": false,
                  },
                  "tasks": {
                    "cancel": {},
                    "list": {},
                  },
                  "tools": {
                    "listChanged": true,
                  },
                },
                "protocolVersion": "2025-06-18",
                "serverInfo": {
                  "name": "nodaro-mcp",
                  "version": "1.0.0",
                },
              },
            },
            "headers": {
              "content-type": "application/json",
            },
            "status": 200,
          },
          "session": {
            "body": {
              "id": 1,
              "jsonrpc": "2.0",
              "result": {
                "capabilities": {
                  "experimental": {},
                  "resources": {
                    "listChanged": true,
                    "subscribe": false,
                  },
                  "tasks": {
                    "cancel": {},
                    "list": {},
                  },
                  "tools": {
                    "listChanged": true,
                  },
                },
                "protocolVersion": "2025-06-18",
                "serverInfo": {
                  "name": "nodaro-mcp",
                  "version": "1.0.0",
                },
              },
            },
            "headers": {
              "content-type": "application/json",
            },
            "status": 200,
          },
        },
        "refreshGrant": {
          "body": {
            "error": "invalid_request",
            "error_description": "Invalid input: expected "authorization_code"",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "register": {
          "body": {
            "client_id": "<random>",
            "client_id_issued_at": "<time>",
            "client_name": "Claude",
            "client_secret": "<random>",
            "client_secret_expires_at": "<time>",
            "grant_types": [
              "authorization_code",
            ],
            "redirect_uris": [
              "https://claude.ai/api/mcp/auth_callback",
            ],
            "response_types": [
              "code",
            ],
            "scope": "workflows:read workflows:write workflows:execute jobs:read assets:read assets:write credits:read apps:read pipelines:read pipelines:execute pipelines:approve presets:read workspaces:read workspaces:write",
            "token_endpoint_auth_method": "client_secret_post",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 201,
        },
        "tokenDcr": {
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
        "tokenOwn": {
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
      }
    `)
  })

  it("the developer-app writes as a person", async () => {
    expect(await developerAppWrites(app, USER_JWT)).toMatchInlineSnapshot(`
      {
        "changed": {
          "body": {
            "data": {
              "allowedOrigins": [],
              "clientId": "<random>",
              "createdAt": "<random>",
              "description": null,
              "homepageUrl": null,
              "id": "<random>",
              "kind": "user",
              "logoUrl": null,
              "name": "Renamed",
              "redirectUris": [
                "https://client.example/cb",
              ],
              "scopesRequested": [
                "jobs:read",
              ],
              "status": "active",
              "updatedAt": "<random>",
            },
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "created": {
          "body": {
            "data": {
              "allowedOrigins": [],
              "clientId": "<random>",
              "clientSecret": "<random>",
              "createdAt": "<random>",
              "description": null,
              "homepageUrl": null,
              "id": "<random>",
              "kind": "user",
              "logoUrl": null,
              "name": "My client",
              "redirectUris": [
                "https://client.example/cb",
              ],
              "scopesRequested": [
                "jobs:read",
              ],
              "status": "active",
              "updatedAt": "<random>",
            },
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 201,
        },
        "deleted": {
          "body": {
            "success": true,
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "listed": {
          "count": 2,
          "status": 200,
        },
        "rotated": {
          "body": {
            "clientSecret": "<random>",
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
      }
    `)
  })

  it("the public app listing", async () => {
    // A token of its own: the consent above re-granted the shared authorization with `jobs:read` only.
    const reader = seedAppToken(fake.db as OAuthMemoryDb, seeded.ownApp, ADMIN, ["apps:read"])
    expect(await appListings(app, "/mcp", reader)).toMatchInlineSnapshot(`
      {
        "browse": {
          "body": {
            "data": [
              {
                "category": "image",
                "componentMetadata": null,
                "createdAt": "<random>",
                "creatorDisplayName": "Admin",
                "creatorId": "00000000-0000-4000-8000-0000000000a2",
                "description": null,
                "estimatedCredits": 10,
                "favoriteCount": 1,
                "iconUrl": null,
                "id": "<random>",
                "monetizationEnabled": false,
                "name": "listed-app",
                "outputTypes": [
                  "image",
                ],
                "perItemCredits": 0,
                "perMinuteCredits": 0,
                "previewMediaType": null,
                "previewMediaUrl": null,
                "publishType": "app",
                "slug": "listed-app",
                "supportsRemix": false,
                "tags": [],
                "totalRunCount": 3,
              },
              {
                "category": "image",
                "componentMetadata": null,
                "createdAt": "<random>",
                "creatorDisplayName": "Admin",
                "creatorId": "00000000-0000-4000-8000-0000000000a2",
                "description": null,
                "estimatedCredits": 10,
                "favoriteCount": 1,
                "iconUrl": null,
                "id": "<random>",
                "monetizationEnabled": false,
                "name": "listed-component",
                "outputTypes": [
                  "image",
                ],
                "perItemCredits": 0,
                "perMinuteCredits": 0,
                "previewMediaType": null,
                "previewMediaUrl": null,
                "publishType": "component",
                "slug": "listed-component",
                "supportsRemix": false,
                "tags": [],
                "totalRunCount": 3,
              },
            ],
            "nextCursor": null,
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "browseApps": {
          "body": {
            "data": [
              {
                "category": "image",
                "componentMetadata": null,
                "createdAt": "<random>",
                "creatorDisplayName": "Admin",
                "creatorId": "00000000-0000-4000-8000-0000000000a2",
                "description": null,
                "estimatedCredits": 10,
                "favoriteCount": 1,
                "iconUrl": null,
                "id": "<random>",
                "monetizationEnabled": false,
                "name": "listed-app",
                "outputTypes": [
                  "image",
                ],
                "perItemCredits": 0,
                "perMinuteCredits": 0,
                "previewMediaType": null,
                "previewMediaUrl": null,
                "publishType": "app",
                "slug": "listed-app",
                "supportsRemix": false,
                "tags": [],
                "totalRunCount": 3,
              },
            ],
            "nextCursor": null,
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "browseComponents": {
          "body": {
            "data": [
              {
                "category": "image",
                "componentMetadata": null,
                "createdAt": "<random>",
                "creatorDisplayName": "Admin",
                "creatorId": "00000000-0000-4000-8000-0000000000a2",
                "description": null,
                "estimatedCredits": 10,
                "favoriteCount": 1,
                "iconUrl": null,
                "id": "<random>",
                "monetizationEnabled": false,
                "name": "listed-component",
                "outputTypes": [
                  "image",
                ],
                "perItemCredits": 0,
                "perMinuteCredits": 0,
                "previewMediaType": null,
                "previewMediaUrl": null,
                "publishType": "component",
                "slug": "listed-component",
                "supportsRemix": false,
                "tags": [],
                "totalRunCount": 3,
              },
            ],
            "nextCursor": null,
          },
          "headers": {
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
        "listApps": {
          "status": 200,
          "text": "{
        "data": [
          {
            "id": "00000000-0000-4000-8000-0000000000f1",
            "name": "listed-app",
            "description": null,
            "icon_url": null,
            "estimated_credits": 10,
            "category": "image",
            "output_types": [
              "image"
            ],
            "tags": [],
            "preview_media_url": null,
            "preview_media_type": null,
            "supports_remix": false,
            "creator_id": "00000000-0000-4000-8000-0000000000a2",
            "creator_display_name": "Admin",
            "total_run_count": 3,
            "favorite_count": 1,
            "created_at": "2026-11-10T00:00:00.000Z",
            "monetization_enabled": false,
            "component_metadata": null,
            "is_listed": true,
            "is_active": true,
            "deleted_at": null,
            "slug": "listed-app",
            "publish_type": "app"
          }
        ],
        "scope": "public",
        "next_cursor": null
      }",
        },
      }
    `)
  })
})
