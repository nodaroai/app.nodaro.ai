---
"@nodaro/shared": minor
---

New in `@nodaro/shared/media`: `MASK_COMPOSITE_REMEASURE_SLACK_SEC` (0.5) — how much longer a Mask Composite's leading video (the foreground, or the background with a pixelate or blur fill) may measure when it is rendered than when the run was priced, before the render refuses it as changed and the charge is refunded. It is taken off the seconds, not the units, before the price's own 0.05 s grace past a whole second: a run priced for 10 s renders a leading video of up to about 10.55 s.
