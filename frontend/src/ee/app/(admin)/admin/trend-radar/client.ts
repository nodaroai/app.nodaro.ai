import { NodaroClientCore } from "@nodaro/sdk/core"
import { TrendRadarResource } from "@nodaro/sdk/trend-radar"
import { ContentRightsResource } from "@nodaro/sdk/content-rights"
import { NODARO_CLIENT_OPTIONS } from "@/lib/nodaro-client"

/**
 * The Trend Radar pages talk to the server through the SDK's own resources
 * (`client.trendRadar`, and `client.contentRights` for the declaration an
 * admin confirms before a candidate's top post is downloaded), the same ones
 * tools and any first-party app use, so the screen and the SDK cannot drift.
 * Built on the SDK core with these TWO resources, from the app's client
 * options (auth from the Supabase session), and only here: the app's shared
 * `nodaroClient` keeps its own short list.
 */
class TrendRadarClient extends NodaroClientCore {
  readonly trendRadar = new TrendRadarResource(this)
  readonly contentRights = new ContentRightsResource(this)
}

export const radarClient = new TrendRadarClient(NODARO_CLIENT_OPTIONS)
