/**
 * Whether THIS build routes video per model (docs/design/alternate-routes.md,
 * "Routing per model"): admission decides and holds from the route's quote,
 * the run obeys the decision, and settlement charges what the route billed.
 * Everything the setting reaches — a routed listing price, saving a model on
 * the alternate route, the `alternateRouteV2` capability a plugin reads —
 * follows this one switch, so a build that lists or saves a routed price
 * always runs and charges it too. False until the lanes are wired.
 */
export const HOST_ROUTES_PER_MODEL: boolean = false
