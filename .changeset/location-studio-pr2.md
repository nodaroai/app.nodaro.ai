---
"@nodaro/client": minor
"@nodaro/cli": minor
---

Added atmosphere motion clip support to Location Studio.

New SDK method: `client.locations.generateMotion()`.

New CLI subcommand: `nodaro locations generate-motion`.

Other changes shipping in this release:
- Location Studio modal now has all 7 tabs (Appearance + Time of Day + Weather + Seasons + Angles + Lighting + Motion)
- Archive gallery at `/library/locations` with restore + permanent-delete (typed-name confirmation)
- 11 locale catalogs for the 46 preset variant labels (English placeholders pending translator pass)
- Full `docs/location-platform.md` and rewritten `docs/nodes/assets/location.md`
- New MCP tool `generate_location_motion` (scope: `workflows:execute`)
- 6th badge on canvas location node (atmosphere motions, amber tint to distinguish video from image badges)
