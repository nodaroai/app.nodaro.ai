---
"@nodaro/shared": minor
---

`OAUTH_SCOPES` and the `OAuthScope` type: every OAuth scope a Nodaro token can carry, the list the server validates against. The server and `@nodaro/sdk` both read it, so the SDK's scope type can no longer fall behind the server (it was missing `presets:read`, `workspaces:read` and `workspaces:write`).

`RECAST_SEGMENT_PACKS` and the `RecastSegmentPack` type: the values the recast routes take for `segmentSec` (`"max"`, `"scenes-max"`, `"scenes"`), a name rather than seconds.
