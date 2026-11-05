import type { NodaroClientCore } from "../core.js"

/**
 * Content rights — the declaration a person confirms before a link is
 * imported, and the confirmation a download then carries. Mirrors
 * `/v1/content-rights/*` (`backend/src/routes/content-rights.ts`).
 *
 * The flow: show {@link ContentRightsResource.declaration}'s text with a
 * checkbox, call {@link ContentRightsResource.confirm} with the link once it
 * is ticked, and pass the answered `id` as `confirmationId` to
 * `media.downloadVideo`. One confirmation is good for one download of that
 * link, by the same account, within an hour. Whether a download WITHOUT a
 * confirmation is refused is the deployment's setting
 * (`content_rights_required`); a client always sends one.
 *
 * An import through an API key or an AI agent has nobody to tick a box: the
 * person authorizes those imports ONCE, in their own session, with
 * {@link ContentRightsResource.authorize} (the standing authorization), and
 * every such import is then recorded as a confirmation derived from it.
 * {@link ContentRightsResource.authorization} reads the current one and
 * {@link ContentRightsResource.revokeAuthorization} ends it.
 */

export interface ContentRightsDeclaration {
  /** The declaration's version; a confirmation names the version it agreed to. */
  version: number
  /** The text the person confirms, verbatim. */
  text: string
}

export interface ContentRightsConfirmation {
  /** The id a download carries as `confirmationId`. */
  id: string
  declarationVersion: number
  /** After this the confirmation no longer opens a download (ISO 8601). */
  expiresAt: string
}

export interface ContentRightsAuthorization {
  id: string
  /** The declaration version the person authorized; a newer declaration asks for a new authorization. */
  declarationVersion: number
  /** When it was given (ISO 8601). */
  createdAt: string
}

export class ContentRightsResource {
  constructor(private client: NodaroClientCore) {}

  /** `GET /v1/content-rights/declaration` → the current text and its version. Public: needs no credential. */
  async declaration(): Promise<ContentRightsDeclaration> {
    const res = await this.client.request<{ data: ContentRightsDeclaration }>("GET", "/v1/content-rights/declaration")
    return res.data
  }

  /**
   * `POST /v1/content-rights/confirm` → the confirmation for one link, under
   * the declaration version the person saw. Any `http(s)` link an import takes
   * can be confirmed (a video's page, a file, a picture). `409
   * rights_confirmation_stale` when the declaration changed since: read it
   * again and ask again.
   */
  async confirm(input: { url: string; declarationVersion: number }): Promise<ContentRightsConfirmation> {
    const res = await this.client.request<{ data: ContentRightsConfirmation }>("POST", "/v1/content-rights/confirm", { body: input })
    return res.data
  }

  /**
   * `GET /v1/content-rights/authorization` → the account's standing
   * authorization for imports through its API keys and AI agents, or `null`
   * when there is none (never given, revoked, or given under an older
   * declaration than the current one).
   */
  async authorization(): Promise<ContentRightsAuthorization | null> {
    const res = await this.client.request<{ data: ContentRightsAuthorization | null }>("GET", "/v1/content-rights/authorization")
    return res.data
  }

  /**
   * `POST /v1/content-rights/authorization` → records that the person
   * authorized imports through their keys and agents under the declaration
   * version they saw. The person's own session only: a key or an agent
   * answers `403 forbidden`. `409 rights_confirmation_stale` when the
   * declaration changed since: read it again and ask again.
   */
  async authorize(input: { declarationVersion: number }): Promise<ContentRightsAuthorization> {
    const res = await this.client.request<{ data: ContentRightsAuthorization }>("POST", "/v1/content-rights/authorization", { body: input })
    return res.data
  }

  /** `DELETE /v1/content-rights/authorization` → revokes the standing authorization (the record stays). The person's own session only. */
  async revokeAuthorization(): Promise<{ revoked: boolean }> {
    const res = await this.client.request<{ data: { revoked: boolean } }>("DELETE", "/v1/content-rights/authorization")
    return res.data
  }
}
