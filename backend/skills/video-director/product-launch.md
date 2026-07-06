# Genre addendum — Product launch

A delta on `doctrine.md`. The shared method, motion doctrine, and machine contract live there; this file only tunes the **arc** and the **reveal palette** for a product launch. Read `doctrine.md` first.

## When to use

Use when there is a **product or brand** with a problem→product→features→CTA story to tell. Output is **kinetic typography + shapes** — a name lockup, feature lines, value phrases, a CTA — plus the `device-surface-showcase` / `cursor-ui-demo` blueprints when the caller has already supplied real product screenshots (a device mockup + screen images, or a cursor-driven screen tour). **Honest Phase-1 limit:** the SVG-ring / push-through blueprints and real website capture are **not** available here (they are Phase 2). Author from the text brief; if you're handed a URL, you still describe the product in words (or reference screenshots the caller already uploaded) — there is no automatic screenshot capture. Don't imply a live-site capture you can't perform.

## Arc

Problem → product → features → CTA (a PAS / Feature-Benefit spine):

`hook → pain_point → product_intro (name lockup) → feature_showcase ×2–3 → benefit_highlight → (social_proof) → cta / branding`

- Open with ONE hook that creates tension or desire (a sharp claim, a rhetorical jab) — never a generic company description.
- `product_intro` is where the brand name lands — a good candidate for the single **frame-0 poster** (a small wordmark held from t=0) or a mid-video name reveal.
- Each `feature_showcase` is one capability translated into viewer value, revealed on its own cue — not a stacked feature list dumped at once.
- Land the `cta` near the end so it holds into the resolver's tail (the held read). 5–8 cues for a 20–60s launch.

## Vertical layout for product launch

A full PAS/Feature-Benefit arc (hook + 2–3 pain lines + product name + 2–3 features + CTA) has 8–10 co-visible reveals by the end. **One column of a 1080-tall canvas cannot hold more than ~6 average-sized text reveals without colliding** — plan your y-stack before picking values.

**Worked single-column layout (≤ 6 reveals, 1920 × 1080, left margin x: 140):**

| Beat | y | fontSize | Band (≈ 1.3×) | Ends at |
|------|---|----------|--------------|---------|
| poster wordmark | 110 | 44 | ~57 px | ~167 |
| hook line | 240 | 100 | ~130 px | ~370 |
| pain beat 1 | 410 | 56 | ~73 px | ~483 |
| pain beat 2 | 520 | 56 | ~73 px | ~593 |
| product name | 640 | 80 | ~104 px | ~744 |
| CTA | 790 | 52 | ~68 px | ~858 |

All six fit with ≥ 24 px gaps; the last element ends well below the caption keep-out boundary (~896 px = 83% of 1080). A large display title (`fontSize: 100+`) consuming ~130 px+ needs its own gap — budget accordingly.

**When you have more than ~6 beats** (common for product launches), split into two columns:
- **Left column** (`x: 140`): hook → pain beats → product name
- **Right column** (`x: 980`): feature showcases → benefit → CTA — each with its own y-stack starting from ~y: 160

Never cram more reveals into one column than the vertical budget allows.

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
