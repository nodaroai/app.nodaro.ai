# Tutorials

Tutorials are curated learning material from the Nodaro team — short videos
and hands-on workflows organized by topic. Open the **Explore** tab on the
home screen (`/projects`, or **Tutorials** in the sidebar): the **Tutorials**
row under **Level up** shows them as cards, and **All tutorials** opens the
full list, organized by category.

## Two kinds of tutorial

The full list has a filter for each kind — **All**, **Video Courses** and
**Written Tutorials** — and under **All** it shows them as two sections with
those names. Inside a section, tutorials are grouped by category.

### Video Courses

Walk through a feature in a few minutes. These cards are marked **Video**;
click one to open the video in a player. They are read-only — you watch, you
learn, you go back to your work.

### Written Tutorials

Hands-on workflow templates you can run yourself. Each one is a complete,
pre-wired Nodaro workflow with the right nodes, providers, and parameters
already in place. These cards are marked **Tutorial**; the complexity badge
tells you roughly how involved one is, and the credit estimate is what one
run will cost.

## Guided walkthroughs

Some written tutorials open into a **guided walkthrough** — a full-screen
page that explains the workflow before you run anything. A card opens its
walkthrough when it has one, and the template preview (below) otherwise.

A walkthrough has two views, switched from the bar at the top:

- **Tutorial mode** — the lesson. A numbered step rail on the left, and on
  the right the actual run this tutorial was built from: the real prompts,
  the images and videos it produced, the audio it generated. Hover a step
  to focus it. Every walkthrough is laid out a little differently, because
  each one teaches a different idea.
- **Canvas mode** — the same workflow as a read-only canvas, every node and
  connection exactly as it sits in the editor. Nothing here is editable and
  nothing costs credits; it is there so you can see the machine behind the
  lesson. Sticky notes are hidden, since Tutorial mode already covers what
  they say — the node count at the bottom tells you how many.

Nothing on either view spends credits. **Run tutorial** in the top-right
copies the workflow into your default project (**My Recent Flows**) and
opens the copy in the editor, and that copy is what you run.

Every walkthrough lives at a shareable `/tutorials/<slug>` URL. The page is
viewable without signing in — sending someone a link just works; they are
asked to log in only when they press **Run tutorial**.

## Clone to Project

A written tutorial without a walkthrough opens in the template preview. To
copy its workflow into one of your projects:

1. Pick the target project from the **Select project** dropdown
2. Click **Clone to Project**
3. You land on that project's page, with the copy in its workflow list

The original tutorial is untouched — you're working on your own copy. Run
it as-is, tweak the parameters, or pull the graph apart to see how each
node connects. The clone is free; you only spend credits when you actually
run the workflow.

If you don't have any projects yet, create one from `/projects` first.

## Categories

Categories like **Getting Started**, **Workflows**, and **Advanced** are
curated by the Nodaro team. They decide which tutorials appear in which
category and in what order. New tutorials show up here as the team
publishes them — there's nothing for end users to configure.

If the **Tutorials** row under **Level up** is empty, it's because no
tutorials are published yet for your edition. Check back later.

## Self-hosted installs

A self-hosted Nodaro seeds a starter set of guided walkthroughs the first
time it boots, so the Tutorials row has something in it on a fresh
install. They are ordinary workflow templates owned by a built-in
`Nodaro` account — clone them, run them, take them apart.

Seeding is idempotent: it runs on every boot, creates only what is
missing, and updates a seeded tutorial only when the shipped version has
actually changed. Editing your own clone never affects it.

The seeder is self-healing for anything **missing**: delete a seeded
tutorial's row (or its underlying workflow) and the next boot recreates it.

It does not, however, override a tutorial you deliberately turned **off**.
Two things are treated as decisions about *your install* rather than as
content, and a reseed leaves both alone:

- **whether the tutorial is active** (`is_active`), and
- **whether it appears in the Tutorials list** — the `tutorial` tag, which
  admins toggle from the Flow Tutorials screen.

The usual reason to turn one off is that the flow needs a provider this
install has no key or balance for. Whichever way you switched it off, it
stays off across content updates, and switching it back on is done the same
way you switched it off. Any other tag on the template (for example a
marketplace listing) is preserved too. Before this, every content release
silently switched such a tutorial back on.

Everything else about a seeded tutorial is still content the release owns:
its name, description, the workflow snapshot, and its tutorial category and
ordering all update in place when the shipped version changes.

The workflows are seeded from the repo, but the images, videos, and audio
they display are fetched from Nodaro's CDN, so a walkthrough's media needs
an internet connection to render.

## Operator tutorial packs (self-host)

Self-hosted **business** installs can add their own tutorials without
rebuilding the image. Point `NODARO_TUTORIAL_PACKS` at one or more directories
(comma-separated), each containing:

- `manifest.json` — the pack's `name`, the `categories` its tutorials use
  (`slug` + `name`, optional `sortOrder` and `description`), and optional
  `locale`, `version`, `forbiddenPromptTerms`, and `creatorDisplayName`
  (pack-wide author name shown on every tutorial card, e.g. your studio's name —
  stamped onto each tutorial that does not set its own).
- one `*.json` per tutorial — a workflow snapshot with its nodes, edges, and
  **baked demo outputs** (the real run the tutorial teaches). When a viewer
  clones the tutorial, those baked results come with it, so the copy opens
  showing the finished run rather than empty boxes. Optional card metadata the
  full tutorials list (Explore › Level up › All tutorials) surfaces:
  `estimatedCredits` (credits a run costs), `nodeTypesUsed` / `providersUsed`
  (the chips shown on the card), a per-tutorial `creatorDisplayName`
  (overrides the pack-wide author for this one tutorial), and `listedIn`
  (which channel the tutorial is first listed in — `["tutorial"]` for the
  Tutorials tab, the default, or `["marketplace"]` to surface it in the
  template marketplace browse instead). Omit any of them and the card falls
  back to `0` / no chips / the default author / the Tutorials tab. `listedIn`
  applies only on first seed; afterward the install owns the listing.

Packs are **additive**: they add tutorials to the built-in set and never change
it. Each tutorial's category must be declared in the pack's `manifest.json`
(the category is created automatically on first boot). Every referenced media
asset must be a public `https://` URL so the tutorial loads on any machine.

A pack that fails validation — invalid JSON, an undeclared category, a
non-public asset URL, or a slug that collides with an existing tutorial — is
**skipped whole and logged**; it can never corrupt the built-in tutorials.
Restart the container to pick up pack changes. Cloud installs are seeded
separately and ignore this variable.

## See also

- [Embed App Guide](./embed-app-guide.md) — ship your own workflows as runnable MiniApps
- [SDK Quickstart](./sdk-quickstart.md) — drive workflows from code
- [API Integration](./api-integration.md) — server-to-server REST recipes, including the multi-speaker interview recast walkthrough (ingest → detect → recast → mix → export)
- [Node Reference](./nodes/) — what each node does, and when to use it
