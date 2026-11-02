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

export class ContentRightsResource {
  constructor(private client: NodaroClientCore) {}

  /** `GET /v1/content-rights/declaration` → the current text and its version. Public: needs no credential. */
  async declaration(): Promise<ContentRightsDeclaration> {
    const res = await this.client.request<{ data: ContentRightsDeclaration }>("GET", "/v1/content-rights/declaration")
    return res.data
  }

  /**
   * `POST /v1/content-rights/confirm` → the confirmation for one link, under
   * the declaration version the person saw. `409 rights_confirmation_stale`
   * when the declaration changed since: read it again and ask again.
   */
  async confirm(input: { url: string; declarationVersion: number }): Promise<ContentRightsConfirmation> {
    const res = await this.client.request<{ data: ContentRightsConfirmation }>("POST", "/v1/content-rights/confirm", { body: input })
    return res.data
  }
}
