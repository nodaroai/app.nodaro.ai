---
"@nodaro/cli": minor
---

Add `nodaro media overlay` — place layers on a base image, pixel-exactly. Positional URLs are image layers sharing `--anchor` / `--x` / `--y` / `--width` / `--opacity` (the watermark case); `--layers-file` takes the full JSON array for the text, QR and shape kinds. Platform renders (`--platform`, repeatable), the QR link (`--qr-text`), the mask controls and an output `--canvas` are all wired.

Add `nodaro media overlay-placement` — asks a vision model where one layer should go and prints the answer in those same percent units, with the `media overlay` command to apply it.
