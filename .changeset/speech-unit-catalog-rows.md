---
"@nodaro/shared": minor
---

Each speech model's catalog `pricing` gains a second row, `<model>:per-100-chars`, with the per-started-100-characters credit price and the note `SPEECH_UNIT_PRICE_NOTE` (exported); the two notes that said `per 1K chars` for a flat per-request price are removed. Served by `GET /v1/models` and `list_models` only on an instance that prices speech by length — a client that sees the row quotes `speechCredits(characters, row)`, else the flat row.

A `field` presentation item, and a `node` item for a Text node exposed whole, may carry `maxLength` — for a text input, the most characters the app user may enter. It is enforced when the app runs (400 `input_too_long`), served by `get_app_inputs`, and caps the price a speech node fed by that input is advertised at.
