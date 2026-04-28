import type { NodaroClient } from "../client.js"

/**
 * OAuth scopes that a developer app may request. Mirrors
 * `backend/src/lib/scopes.ts#ALL_SCOPES`.
 */
export type DeveloperAppScope =
  | "workflows:read"
  | "workflows:write"
  | "workflows:execute"
  | "jobs:read"
  | "assets:read"
  | "assets:write"
  | "credits:read"
  | "apps:read"

export type DeveloperAppStatus = "active" | "suspended" | "pending_review"

export interface DeveloperApp {
  id: string
  name: string
  description: string | null
  logoUrl: string | null
  homepageUrl: string | null
  redirectUris: string[]
  allowedOrigins: string[]
  scopesRequested: DeveloperAppScope[]
  clientId: string
  status: DeveloperAppStatus
  createdAt: string
  updatedAt: string
}

/**
 * One-shot create response — `clientSecret` is returned exactly ONCE here.
 * Store it securely; subsequent `get`/`list` calls will not include it.
 */
export interface CreateDeveloperAppResult extends DeveloperApp {
  clientSecret: string
}

export interface CreateDeveloperAppInput {
  name: string
  description?: string
  homepageUrl?: string
  logoUrl?: string
  /** At least 1, at most 10 redirect URIs. Each must be https or http://localhost. */
  redirectUris: string[]
  /** Up to 5 bare origins (no path/query/hash), e.g. "https://example.com". */
  allowedOrigins?: string[]
  /** At least 1 scope required. */
  scopesRequested: DeveloperAppScope[]
}

export interface UpdateDeveloperAppInput {
  name?: string
  description?: string
  homepageUrl?: string
  logoUrl?: string
  redirectUris?: string[]
  allowedOrigins?: string[]
  scopesRequested?: DeveloperAppScope[]
}

export interface RotateSecretResult {
  /** New client secret. Returned exactly once — old secret is invalidated. */
  clientSecret: string
}

export class DeveloperAppsResource {
  constructor(private client: NodaroClient) {}

  /** List the authenticated user's developer apps. */
  list(): Promise<{ data: DeveloperApp[] }> {
    return this.client.request("GET", "/v1/developer-apps")
  }

  /** Get a developer app by ID. */
  get(id: string): Promise<{ data: DeveloperApp }> {
    return this.client.request("GET", `/v1/developer-apps/${encodeURIComponent(id)}`)
  }

  /**
   * Create a new developer app. Returns the app PLUS a one-time `clientSecret`
   * — store it now, the secret hash is the only copy kept server-side.
   */
  create(input: CreateDeveloperAppInput): Promise<{ data: CreateDeveloperAppResult }> {
    return this.client.request("POST", "/v1/developer-apps", { body: input })
  }

  /** Update a developer app's metadata, redirect URIs, origins, or requested scopes. */
  update(id: string, input: UpdateDeveloperAppInput): Promise<{ data: DeveloperApp }> {
    return this.client.request(
      "PATCH",
      `/v1/developer-apps/${encodeURIComponent(id)}`,
      { body: input },
    )
  }

  /** Delete a developer app. Returns `{ success: true }`. */
  delete(id: string): Promise<{ success: true }> {
    return this.client.request(
      "DELETE",
      `/v1/developer-apps/${encodeURIComponent(id)}`,
    )
  }

  /**
   * Generate a new `clientSecret`. The previous secret is invalidated.
   * Server returns ONLY the new secret, not the full app record.
   */
  rotateSecret(id: string): Promise<RotateSecretResult> {
    return this.client.request(
      "POST",
      `/v1/developer-apps/${encodeURIComponent(id)}/rotate-secret`,
    )
  }
}
