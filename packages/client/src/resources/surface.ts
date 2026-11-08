import type { NodaroClientCore } from "../core.js"

/**
 * What this deployment offers the caller — the shape of `GET
 * /v1/surface/availability` (`backend/src/routes/surface-availability.ts`, the
 * source of truth: keep these in sync if it changes). The answer depends on who
 * asks: an admin is still offered a node the admin switch withholds from users.
 */

/** One world (a tab of the shared site header) and whether the caller is offered it. */
export interface SurfaceAvailabilityWorld {
  /** A world id: `explore`, `image`, `video`, `music`, `trends`, `motion`, `voice`, `app` or `studio`. A newer server may add one, so handle an id you do not know. */
  id: string
  /** `true` when the deployment's profile lets the world through and every node type it runs is available to the caller. */
  enabled: boolean
}

export interface SurfaceAvailability {
  /** Node types the caller is not offered; for an admin, `hiddenFromUsers` names those the admin switch withholds from users only. */
  nodes: { denied: string[]; hiddenFromUsers: string[] }
  /** Model ids nobody on this deployment is offered. */
  models: { denied: string[] }
  /** Web Scrape sources withdrawn with the node that governs them (Instagram follows the Instagram node). */
  webScrapeSources: { denied: string[]; hiddenFromUsers: string[] }
  /** Every world, in the deployment's display order. */
  worlds: SurfaceAvailabilityWorld[]
}

export class SurfaceResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/surface/availability` → the node types, models, Web Scrape
   * sources and worlds this deployment offers the caller. Signed out, the
   * answer is a user's. Never cached by a shared cache (`private, no-store`).
   */
  async availability(): Promise<SurfaceAvailability> {
    return this.client.request<SurfaceAvailability>("GET", "/v1/surface/availability")
  }
}
