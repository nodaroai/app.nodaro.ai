# Edge Modes

> How the lines between your nodes decide what flows through — and how much.

## What's an Edge?

When you drag a connection from one node to another, you're drawing an **edge**. Think of it as a little delivery route: whatever the first node produces, the edge carries to the next node.

Most of the time, nodes produce **one thing** — one image, one video clip, one block of text. In that case, the edge just passes it along and you never have to think about it.

But some nodes produce **many things at once**:

- A **Split Text** node can break an LLM's answer into 10 paragraphs
- A **List** or **Loop** node can produce dozens of items
- Running a **Generate Image** node 5 times in a row leaves 5 images sitting on that node

When there's more than one result to move, you need to decide: *which one?* *all of them together?* *one at a time?*

That's what **Edge Modes** are for.

---

## The Four Modes at a Glance

| Mode | What it does | When you want it |
|------|--------------|-------------------|
| **Selected** | Sends the currently selected result (the one you picked with the carousel arrows) | Most of the time — it's the default |
| **Each** | Runs the downstream node once per item (fan-out) | "Do this for every item in the list" |
| **All** | Sends the whole list as one bundle | Downstream needs everything together (e.g., combine videos) |
| **Item** | Picks one specific result by position | "Just give me the 2nd one" or "the last one" |

---

## How to Change the Mode

1. **Click the edge** (the line between two nodes) on the canvas
2. A small dropdown menu appears
3. Pick one of: **Selected · Each · All · Item**
4. The pill label on the edge updates to show what you chose

If you don't see anything special on the edge, it's in **Selected** mode — the default.

---

## Mode 1: Selected

**The default. Pass the result you've currently selected.**

```
┌─────────────┐                    ┌─────────────┐
│  Gen Image  │                    │  Img → Vid  │
│             │ ───── Selected ──► │             │
│ 3 results   │                    │  runs once  │
│ ◀ ● ▶       │                    │             │
└─────────────┘                    └─────────────┘
       │
       │  Result 1: image A
       │  Result 2: image B  ◄── you clicked this one, so this passes
       │  Result 3: image C
```

**What happens:** The edge passes whichever result is currently *active* on the source node — the one shown in the carousel. After each run the newest result is auto-selected, so by default this means "the most recent." But if you arrow back to an earlier result, *that* one flows through instead.

**Use it for:** Almost everything. Simple linear workflows where each node has one job and hands off one thing — including the "generate 4 variations, pick my favorite, keep going" pattern without needing any special mode.

> **Note:** The word *last* also appears inside range and list expressions like `1..last` or `last-1`. There, it means the final index in the array, not the selected result. Same word, different meaning.

---

## Mode 2: Each (Fan-out)

**Run the downstream node once per item in the list.**

```
┌─────────────┐                  ┌─────────────┐
│ Split Text  │                  │  Image Gen  │
│             │ ────── Each ───► │             │
│  3 items    │                  │  runs 3x!   │
└─────────────┘                  └─────────────┘
       │
       │  "a cat on a beach"   ──► generates cat image
       │  "a dog in the park"  ──► generates dog image
       │  "a bird in flight"   ──► generates bird image
```

**What happens:** The edge "fans out" — the downstream node executes **one time for every item**. You end up with one output per item.

**Use it for:**

- **Split text from an LLM before processing** — LLM gives you 5 scene descriptions, then you want to generate an image for each one
- **Batch generation** — turn a list of 10 prompts into 10 images, or a list of articles into 10 videos
- **Loop tables** — use a Loop node to define 5 variations (subject × style) and generate one result per row

> **Tip:** The credit estimate on the downstream node multiplies by the fan-out count. If Each produces 5 items and the node costs 4 credits, expect ~20 credits.

---

## Mode 3: All (Bundle)

**Send the whole list as one package.**

```
┌─────────────┐                  ┌─────────────────┐
│ Generate    │                  │ Combine Videos  │
│ Images      │ ────── All ────► │                 │
│ (3 images)  │                  │  runs once,     │
└─────────────┘                  │  gets all 3     │
       │                         └─────────────────┘
       │
       │  [img1, img2, img3]  ──► delivered as one bundle
```

**What happens:** The downstream node runs **once**, but it receives the full list as its input. The node itself then decides how to use the whole bundle.

**Use it for:**

- **Combine Videos** — stitch all upstream clips into one final video
- **Mix Audio** — layer multiple audio tracks into a single mix
- **After Effects / Motion Graphics** — feed a set of clips into a composite scene
- Any node whose input is "a list of things to process together"

> **Rule of thumb:** If the next node's icon suggests *merging* or *composing*, use **All**. If it suggests *transforming one thing*, use **Each**.

---

## Mode 4: Item (Cherry-pick)

**Pick one specific result from a multi-output node.**

```
┌─────────────┐                     ┌─────────────┐
│ Generate    │                     │ Image to    │
│ Images      │ ─── Item: 2 ──────► │ Video       │
│ (3 images)  │                     │             │
└─────────────┘                     └─────────────┘
       │
       │  img1
       │  img2  ◄── picked
       │  img3
```

**What happens:** You type an index (like `1`, `3`, or `last`) and the edge pulls just that one item through.

**Use it for:**

- **Cherry-pick a favorite** — generate 4 images, pick the one you like, send it to video
- **Reliable picks** — always grab the last result or the first result from a batch
- **Combining with other nodes** — use multiple Item edges from the same source to wire up different downstream paths

---

## Selecting a Range or List (Each / All)

When the edge is in **Each** or **All** mode, the dropdown menu adds a **Range** tab and a **List** tab. These let you narrow down which items actually pass through.

### Range Tab

Three fields: **From**, **To**, **Step**.

- `From: 2, To: last` → skip the first item
- `From: 1, To: 5` → only the first 5 items
- `From: 1, To: last, Step: 2` → every other item (1, 3, 5, …)

### List Tab

A single text box that accepts a friendly expression:

| You type | You get |
|----------|---------|
| `1` | Item 1 only |
| `1, 2, last` | Items 1, 2, and the last one |
| `1..5` | Items 1 through 5 |
| `1..last` | All items |
| `1..last-1` | All except the last |
| `1..10:2` | Items 1, 3, 5, 7, 9 |
| `last..1:-1` | All items in reverse order |
| `1, 3..5, last` | Item 1, items 3–5, and the last one |

> **Friendly syntax:** Use `..` for ranges, `,` to combine multiple picks, and `last` / `last-1` / `last-2` to count from the end. If you type something invalid, the box turns red but your workflow won't crash — it'll just treat the edge as "all items."

---

## Include Previous Runs

Normally, an edge only looks at the **latest batch** of results from the upstream node. But what if you ran a node 5 times manually over an afternoon, and now you want to use **all 5 runs** downstream?

That's what the **Include previous runs** checkbox does. Turn it on, and the edge remembers everything.

```
┌──────────────────┐
│ Generate Image   │
│                  │     ┌─────────────┐
│  Ran 5 times:    │     │  Combine    │
│  [img1]          │ ──► │  Videos     │
│  [img2]          │     │             │
│  [img3]          │     └─────────────┘
│  [img4]          │
│  [img5] ← latest │
└──────────────────┘
  Edge pill: "all runs"  (all 5 flow through)
```

### Picking specific runs

When the checkbox is on, a new text field appears — the **runs selector**. It uses the **exact same syntax** as the list selector, but it picks from *runs* instead of *items*.

| You type | Result |
|----------|--------|
| *(empty)* | All runs pass through |
| `1, 3, last` | Only runs 1, 3, and the last one |
| `1..5` | Runs 1 through 5 |
| `last-2..last` | Only the last three runs |

The runs selector and the items selector work **together**. Runs are filtered first, then items. The edge pill shows both, like `runs: 1,3 → items: 2..last`.

---

## Use Cases

### Split text from an LLM, then process each piece

You asked an LLM for "5 scene descriptions for a short film." The LLM returns one big block of text. You want to generate an image for each scene.

```
LLM ──► Split Text ──► [Each] ──► Generate Image
                                         │
                             (one image per scene)
```

Use **Split Text** to break the LLM output into a list, then set the next edge to **Each**.

### Generate many, pick the best, continue

You want to generate 4 image variations and then only animate your favorite.

```
Generate Image (run 4 times)
       │
  [Include previous runs: on]
       │
    [Item: 3]                    ◄── your pick
       │
       ▼
Image to Video
```

### Combine a batch into one final output

Generate 6 short video clips, then stitch them together.

```
Generate Video ──► [All] ──► Combine Videos
   (6 clips)                  (one final video)
```

### Run a scheduled trigger against historic data

Your schedule trigger has fired 30 times (one per day). You want to regenerate the last 7 days as a weekly recap.

```
Schedule Trigger ──► [Include previous runs: last-6..last] ──► Generate Summary
```

### Skip failed attempts

Your image gen failed twice in the middle of a 10-run session. You want to exclude those.

```
Generate Image (10 runs, #4 and #7 failed)
       │
  [Include previous runs: on]
  [runs: 1..3, 5, 6, 8..last]       ◄── skip the bad ones
       │
       ▼
Downstream processing
```

---

## Best Practices

### Start simple, then add modes as you need them

New workflows should start entirely in **Selected** mode. Only switch an edge to **Each / All / Item** once you actually have a list of things to deal with.

### One mode change at a time

When an edge isn't behaving how you expect, change *one* setting, click Run, and see what happens. Ranges, lists, and "include previous runs" can stack on top of each other — changing several at once makes it hard to tell which setting fixed or broke things.

### Match the mode to the downstream node's job

- Is the downstream node a **transformer** (one in, one out)? Use **Each** when the upstream has multiple items.
- Is it a **combiner** (many in, one out)? Use **All**.
- Do you want **just one** specific result? Use **Item**.

### Watch the edge pill

The pill label on the edge always tells you what's happening in shorthand. A quick glance at the canvas can save you a trip into the menu:

| Pill label | Meaning |
|------------|---------|
| *(no pill)* | Selected mode, default behavior |
| `2..last` | Range selector on Each/All |
| `1, 3, 5..last` | List selector on Each/All |
| `3` | Item mode, picking item 3 |
| `all runs` | Include previous runs, no filter |
| `runs: 1,3,last` | Include previous runs, filtered |
| `runs: 1,3 → items: 2..last` | Both filters active |

### Keep an eye on credit estimates

**Each** mode multiplies the downstream cost by the number of items. If you fan out over 50 list items into a video generation node at 20 credits each, that's 1,000 credits. The downstream node's Generate button shows the total estimate — always check it before running.

### Use Item mode for reproducibility

If you always want "the first image" or "the last video" regardless of how many results exist, Item mode with `1` or `last` is more reliable than guessing indexes. It also survives re-runs that change the total count.

### Selected vs. Include previous runs

- **Selected** = "the result you've currently picked." Good for linear workflows where upstream runs once (or a few times) and you choose which output to pass along.
- **Include previous runs** = "use the entire history of this node." Good for aggregation, recaps, or combining work from multiple sessions.

---

## Quick Reference Card

```
┌──────────────────────────────────────────────────────────┐
│                    EDGE MODE CHEAT SHEET                 │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  SELECTED  one in  → one out     (default, active pick)  │
│  EACH      many in → many runs   (fan-out)               │
│  ALL       many in → one run     (bundle)                │
│  ITEM      many in → one out     (pick by index)         │
│                                                          │
│  List / range syntax:                                    │
│     1, 2, last         pick items 1, 2, and last         │
│     1..5               items 1 through 5                 │
│     1..last:2          every other item                  │
│     last..1:-1         reverse order                     │
│                                                          │
│  Note: "last" inside a range/list expression means the   │
│  final index — different from the Selected mode above.   │
│                                                          │
│  Include previous runs:                                  │
│     off     →  latest batch only                         │
│     on      →  entire history of this node               │
│     runs:   →  same syntax as list, but filters runs     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

*Still stuck? Each edge dropdown has inline examples. And a malformed expression never crashes the workflow — it falls back to "all items" so you can keep experimenting safely.*
