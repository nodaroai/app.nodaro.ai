# Content Recipes (`get_recipe`)

A **content recipe** is a curated, terminal-verb-anchored playbook that walks an LLM
client through a full multi-tool flow to produce a specific outcome — for example, the
`video-explainer` recipe drives an LLM through style-locking an image, writing narration,
rendering silent clips, voicing them, and finishing in
[`assemble_narrated_video`](./tools.md#video-generation-tools) to produce one narrated
video.

`get_recipe` is **pure content delivery**: it returns markdown instructions for the LLM to
follow. It never calls another tool, makes no API calls, and has no side effects — same
posture as `start_workflow_editor` / `get_node_skill` / `start_video_director`. The
*actions* a recipe instructs the LLM to take (e.g. `generate_video`, `generate_speech`,
`assemble_narrated_video`) are each gated by their own tool's scope, same as if the LLM
called them directly.

## Using `get_recipe`

**Scope:** none — always visible (all editions, free, no credits).

| Field | Type | Notes |
|-------|------|-------|
| `recipe` | string | Recipe name, e.g. `"video-explainer"`. Omit to list all. |
| `file` | string | Relative path inside the recipe folder, e.g. `"references/prompts.md"`. Requires `recipe`. |

Three call shapes:

1. **No argument** — lists the catalog: every recipe's `name`, `description`, and trigger
   phrases. Use this to discover what's available.
2. **`recipe` only** — loads that recipe's full body (the complete instruction set the LLM
   should follow).
3. **`recipe` + `file`** — loads a bundled reference file inside that recipe's folder (for
   recipes that ship supplementary material, like prompt templates, alongside the main
   instructions).

Unknown recipe names or files return an error listing the valid recipe names, rather than
a generic 404.

## Current catalog

| Recipe | What it produces | Triggers |
|--------|-------------------|----------|
| `video-explainer` | A narrated, non-photoreal animated explainer video: one style-locked visual key, N narration blocks each rendered as a silent clip, one consistent voice, finished via `assemble_narrated_video` | "explainer video", "animated explainer", "narrated explainer", "how-it-works video", "concept video", and similar |

**`video-explainer`'s first question is method, not settings.** Before asking about
duration, narration language, mascot, or aspect ratio, the recipe's Phase 0 asks the user
to choose between this animated-footage path (~45cr per 10-second block ≈ 270cr/min of
video, illustrated scenes) and the motion-graphics alternative (`start_video_director` /
`create_explainer` — typography + shapes, a fixed ~20cr total via `create_explainer` or
~11cr driving the pipeline manually). If the user picks motion graphics, the recipe stops
and hands off to `start_video_director` instead of continuing. If the user already stated
a style, the question is skipped.

See [Video Director](./video-director.md) and [Shot Sequence](./shot-sequence.md) for a
related but distinct family — those tools *execute* a narrated-video pipeline server-side
in one call; `video-explainer` is a *recipe* the LLM follows itself, tool call by tool
call, giving it control over every intermediate asset (style key, individual clips, voice
takes) along the way.

## Authoring a new recipe

Recipes live on disk under `backend/skills/recipes/<name>/`, loaded at runtime (the
catalog is read once at server startup) — no database, no deploy-time registration beyond
adding the folder.

**Folder layout:**

```
backend/skills/recipes/<name>/
  RECIPE.md              # required — frontmatter + instruction body
  references/            # optional — any files loadable via the `file` param
    prompts.md
    ...
```

**`RECIPE.md` format** — a `---`-fenced YAML frontmatter block followed by the markdown
instruction body:

```markdown
---
name: video-explainer
description: Narrated non-photoreal animated explainer video on Nodaro — style-key lock, per-block clips, one voice, audio-led assembly
triggers: ["explainer video", "explain X in a video", "animated explainer", "narrated explainer"]
version: 1
---

# Video Explainer

You are producing ONE narrated, non-photoreal animated explainer video. ...
```

Trigger phrases must not contain commas — the frontmatter parser splits the `triggers`
array on `,`, so a comma inside a single phrase silently breaks it into two trigger
entries.

The **folder name** is what callers pass as `recipe` (e.g. `recipe: "video-explainer"`
loads `backend/skills/recipes/video-explainer/RECIPE.md`) — it must be kebab-case
(lowercase letters, digits, hyphens only), enforced both when the catalog walks the
directory and when a caller's `recipe` argument is resolved to a path. This alone blocks
path-traversal attempts before any disk read.

**Frontmatter fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Should match the folder name — it's what the catalog listing shows, and the folder name is what actually resolves a `get_recipe(recipe: ...)` call. The two are not cross-validated at runtime, so a mismatch here means the catalog advertises a name that doesn't load. |
| `description` | Yes | One line, shown in the no-argument catalog listing. |
| `triggers` | Yes | A `["...", "..."]` array of phrases a user might say that should surface this recipe. Shown in the catalog listing so an LLM can match user intent to a recipe before calling `get_recipe(recipe: ...)`. |
| `version` | No | Integer. Bump when you materially change the instructions, so an LLM following a stale cached copy of the body can self-check via a version reference inside the recipe text. |

A recipe missing any of `name` / `description` / `triggers`, or missing the frontmatter
fence entirely, fails to parse and is **skipped from the catalog** (it does not crash the
whole catalog load — one malformed recipe folder never takes down discovery for the
others). `get_recipe(recipe: "<name>")` for a folder that exists but fails to parse
returns the same "No recipe '`<name>`'" error as a name that doesn't exist at all, with
the list of valid recipe names.

**The instruction body** (everything after the closing `---`) is returned verbatim as the
tool's response text when a client calls `get_recipe(recipe: "<name>")` — write it as a
direct, imperative brief to the LLM that will execute it: hard rules first, then the
phased flow, citing exact tool names and parameter shapes it should call. See
`backend/skills/recipes/video-explainer/RECIPE.md` for the reference example (hard rules →
phased pipeline → a parameter table for the finishing tool call).

**Reference files** (optional `references/` subfolder) are for supplementary material you
don't want inlined into the main body on every load — e.g. a longer prompt-template guide.
Load them explicitly with `file`, e.g.
`get_recipe(recipe: "video-explainer", file: "references/prompts.md")`. Paths are resolved
relative to the recipe's own folder and validated to never escape it (no `../` traversal
outside the recipe directory) — a recipe can only serve files bundled inside its own
folder.

**Testing a new recipe:** call `get_recipe()` with no argument and confirm your entry
appears in the catalog listing; then `get_recipe(recipe: "<name>")` and confirm the body
matches what you authored; then, for any reference file, `get_recipe(recipe: "<name>",
file: "<path>")`.

## Related

- [MCP Tools Reference](./tools.md#get_recipe) — the tool's scope, input schema, and
  response shape
- [Video Director](./video-director.md) — one-shot server-executed narrated-video tools
  (`create_explainer`, `create_launch_video`) — a different way to reach a similar outcome
- [Shot Sequence](./shot-sequence.md) — the underlying voiceover-paced motion-graphics
  pipeline
