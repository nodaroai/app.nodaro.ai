---
"@nodaro/shared": minor
---

Runtime config: how a deployment's own lists withhold what it offers, for a client to apply before the platform's per-viewer answer (`GET /v1/surface/availability`) has arrived or after it could not be read. `listsWithhold` and `listsSet` read an `allow` / `deny` pair (`surface.nodes`, `surface.models`); `nodeListsWithhold` is the node lists' rule (a whitelist never withholds a node in `ALLOW_LIST_EXEMPT_NODE_TYPES` by leaving it out, and a deny of the Voice Clone node withholds a one-off clone too); `worldOffered` says whether a world is offered by the profile's `worlds.allow` and the node types it runs. The platform applies the same rule.
