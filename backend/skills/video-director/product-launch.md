# Genre addendum — Product launch

A delta on `doctrine.md`. The shared method, motion doctrine, and machine contract live there; this file only tunes the **arc** and the **reveal palette** for a product launch. Read `doctrine.md` first.

## When to use

Use when there is a **product or brand** with a problem→product→features→CTA story to tell. Output is **kinetic typography + shapes only** — a name lockup, feature lines, value phrases, a CTA — NOT a real-UI showcase. **Honest Phase-1 limit:** the device-showcase / SVG-ring / push-through / cursor-demo blueprints and real website capture are **not** available here (they are Phase 2). Author from the text brief; if you're handed a URL, you still describe the product in words — there is no screenshot capture. Don't imply a UI demo you can't render.

## Arc

Problem → product → features → CTA (a PAS / Feature-Benefit spine):

`hook → pain_point → product_intro (name lockup) → feature_showcase ×2–3 → benefit_highlight → (social_proof) → cta / branding`

- Open with ONE hook that creates tension or desire (a sharp claim, a rhetorical jab) — never a generic company description.
- `product_intro` is where the brand name lands — a good candidate for the single **frame-0 poster** (a small wordmark held from t=0) or a mid-video name reveal.
- Each `feature_showcase` is one capability translated into viewer value, revealed on its own cue — not a stacked feature list dumped at once.
- Land the `cta` near the end so it holds into the resolver's tail (the held read). 5–8 cues for a 20–60s launch.

## Reveal palette

Per beat, the element + motion (all `easeOut`, 8–16 frame entrances — see doctrine motion enum):

| Beat | Reveal |
|------|--------|
| poster | brand wordmark `text` (heavy display font, accent color), small `fontSize`, top-left, `revealAt frame:0`, `fade` — the only frame-0 element. |
| hook | the hook line as large `text`, `slide-up`; the dominant element of its moment. |
| pain_point | 1–3 short pain `text` lines landing solo, `fade` each on its cue — no product yet. |
| product_intro | the product name big and central-feel, `wipe-in`; optional `shape` accent bar `wipe-in` beneath it. |
| feature_showcase | one `text` value line per feature stacked down the canvas, each `slide-up` on its cue; a `shape` bullet/underline beside it. Vary entrance direction sparingly; keep weight on the words. |
| benefit_highlight | a tighter `text` value phrase (or a large `text` metric with `scale-up`, used once) as the payoff. |
| cta | the closing line `text`, `slide-up` or `wipe-in`, landing on the action/name and holding into the tail. |

Use a consistent left margin (the keystone's `x: 140`), one accent hue, and shapes for structure (an accent bar under the name, an underline on the CTA). Smooth and back-weighted: `fade`/`slide-up`/`wipe-in` first, `scale-up` as a rare accent, never `spring`.
