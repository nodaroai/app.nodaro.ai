import { NodaroClientCore } from "@nodaro/sdk/core"
import { TrendRadarResource } from "@nodaro/sdk/trend-radar"
import { NODARO_CLIENT_OPTIONS } from "@/lib/nodaro-client"

/**
 * The Trend Radar pages talk to the server through the SDK's own resource
 * (`client.trendRadar`), the same one tools and any first-party app use, so
 * the screen and the SDK cannot drift. Built on the SDK core with this ONE
 * resource, from the app's client options (auth from the Supabase session),
 * and only here: the app's shared `nodaroClient` keeps its own short list.
 */
class TrendRadarClient extends NodaroClientCore {
  readonly trendRadar = new TrendRadarResource(this)
}

export const radarClient = new TrendRadarClient(NODARO_CLIENT_OPTIONS)
