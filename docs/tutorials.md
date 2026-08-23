# Tutorials

The **Tutorials** tab on your dashboard surfaces curated learning material
from the Nodaro team — short videos and hands-on workflows organized by
topic. Open it from `/projects` (it sits alongside Apps, Templates, and
Statistics).

## Two flavors per category

Each category mixes two kinds of tutorial. Categories with both flavors
show two subsections; categories with only one drop the subheading.

### 📹 Watch & Learn — video tutorials

Walk through a feature in a few minutes. Click any card to open the video
in a modal player. These are read-only — you watch, you learn, you go back
to your work.

### ⚡ Try It Yourself — flow tutorials

Hands-on workflow templates you can run yourself. Each one is a complete,
pre-wired Nodaro workflow with the right nodes, providers, and parameters
already in place. The complexity badge tells you roughly how involved it
is, and the credit estimate is what one run will cost.

## Guided walkthroughs

Some flow tutorials open into a **guided walkthrough** instead of dropping
you straight into the editor — a full-screen page that explains the
workflow before you run anything. Cards that have one say so; the rest go
to the usual template preview.

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
clones the workflow into one of your projects, exactly like Clone & Try
below, and that copy is what you run.

Every walkthrough lives at a shareable `/tutorials/<slug>` URL. The page is
viewable without signing in — sending someone a link just works; they are
asked to log in only when they press **Run tutorial**.

## Clone & Try

Hit **Clone & Try** on any flow tutorial card to copy the workflow into one
of your projects:

1. Pick the target project from the dropdown
2. Click **Clone & Open**
3. You land in the editor with a fresh copy of the workflow

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

If your Tutorials tab is empty, it's because no tutorials are published
yet for your edition. Check back later.

## Self-hosted installs

A self-hosted Nodaro seeds a starter set of guided walkthroughs the first
time it boots, so the Tutorials tab has something in it on a fresh
install. They are ordinary workflow templates owned by a built-in
`Nodaro` account — clone them, run them, take them apart.

Seeding is idempotent: it runs on every boot, creates only what is
missing, and updates a seeded tutorial only when the shipped version has
actually changed. Editing your own clone never affects it.

The seeder is self-healing for anything **missing**: delete a seeded
tutorial's row (or its underlying workflow) and the next boot recreates it.
It does not, however, override the state of a tutorial you deliberately
turned **off** — a tutorial deactivated in the database (`is_active =
false`, typically because the flow needs a provider this install has no key
or balance for) stays off across content updates, and reactivating it is
likewise a database change. Before this behaviour existed, every content
release silently switched such a tutorial back on.

The workflows are seeded from the repo, but the images, videos, and audio
they display are fetched from Nodaro's CDN, so a walkthrough's media needs
an internet connection to render.

## See also

- [Embed App Guide](./embed-app-guide.md) — ship your own workflows as runnable MiniApps
- [SDK Quickstart](./sdk-quickstart.md) — drive workflows from code
- [API Integration](./api-integration.md) — server-to-server REST recipes, including the multi-speaker interview recast walkthrough (ingest → detect → recast → mix → export)
- [Node Reference](./nodes/) — what each node does, and when to use it
