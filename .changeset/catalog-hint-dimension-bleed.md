---
"@nodaro/prompts": patch
---

fix(catalogs): stop four prompt hints from injecting content outside their own dimension (same class as the earlier cowboy-shot holster).

- `framing/composition/magazine-spread`: drop the fabricated typography ("bold display typography… headline and pull quotes integrated with the photograph") — a composition picker arranges the frame, it shouldn't invent headlines and quotes in a language the user never chose. The two-page layout + gutter remain.
- `framing/composition/cutaway-cross-section`: reworded from a building-specific hint ("the building's near wall peeled away… the subject inhabiting one of the rooms") to a generic cross-section, so it no longer conjures a building for portrait/desert/space shots.
- `lens/macro` vs `framing/shot-size/macro` were the same instruction twice. `lens/macro` now describes the OPTICS only (close focus, life-size magnification, shallow DOF); `framing/macro` keeps the magnification/framing. Picking both no longer duplicates.
- `lens/anamorphic`: dropped the "cinematic widescreen feel" format claim (overlaps `camera-film/anamorphic-scope`'s 2.39:1); the lens hint now describes optics only (oval bokeh, horizontal flares).
