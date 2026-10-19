# CLI

`@nodaro/cli` is a terminal client for Nodaro. It covers the core workflow/studio surface of the SDK — list and run workflows, run apps, run a single node directly, watch executions until they finish — wrapped in a small `commander` binary with multi-profile auth, JSON output for scripts, and `--watch` mode for interactive runs. (The CLI intentionally omits credits, developer-apps, OAuth, pipelines, reduce, and upload helpers — use the SDK directly for those.)

If you're integrating from code, prefer the [SDK](./sdk-quickstart.md) directly. The CLI is the convenience wrapper for terminal work, cron jobs, CI pipelines, and ad-hoc inspection.

## Install

### Option A — npm (cross-platform, requires Node ≥ 20)

```bash
npm install -g @nodaro/cli
nodaro --version
```

Or run a one-off without installing:

```bash
npx @nodaro/cli projects list
```

### Option B — standalone binary (no Node required)

Single-file executables compiled with `bun build --compile` — ~60 MB, ~10 ms cold start, no dependencies.

CLI releases are tagged `cli-vX.Y.Z`. This repository's **"latest" release is the app's**, not the CLI's, so a `releases/latest/download/…` link never reaches a CLI binary. Resolve the newest `cli-v*` tag first, then download from it:

```bash
# 1. The newest CLI version (e.g. 1.20.0)
NODARO_CLI_VERSION=$(curl -fsSL "https://api.github.com/repos/nodaroai/app.nodaro.ai/git/matching-refs/tags/cli-v?per_page=100" \
  | grep -o '"refs/tags/cli-v[0-9][0-9.]*"' | tr -d '"' | sed 's#refs/tags/cli-v##' \
  | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
echo "Installing @nodaro/cli $NODARO_CLI_VERSION"

# 2. Your platform: darwin-arm64 (Apple Silicon) · darwin-x64 (Intel Mac) · linux-x64 · linux-arm64
NODARO_CLI_PLATFORM=darwin-arm64

# 3. Download. -f fails on an HTTP error instead of saving the error page as the binary.
curl -fL "https://github.com/nodaroai/app.nodaro.ai/releases/download/cli-v$NODARO_CLI_VERSION/nodaro-$NODARO_CLI_PLATFORM" \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro
nodaro --version
```

Windows (PowerShell):

```powershell
$v = (Invoke-RestMethod "https://api.github.com/repos/nodaroai/app.nodaro.ai/git/matching-refs/tags/cli-v?per_page=100") |
  ForEach-Object { $_.ref -replace '^refs/tags/cli-v', '' } |
  Where-Object { $_ -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_ } | Select-Object -Last 1
Invoke-WebRequest "https://github.com/nodaroai/app.nodaro.ai/releases/download/cli-v$v/nodaro-windows-x64.exe" -OutFile nodaro.exe
.\nodaro.exe --version
```

To pin a version, skip step 1 and set `NODARO_CLI_VERSION` yourself. Every CLI release and its binaries: [releases tagged `cli-v`](https://github.com/nodaroai/app.nodaro.ai/releases?q=cli-v).

## Authentication

Generate a token at `https://app.nodaro.ai/settings/api`, then save it locally:

```bash
nodaro auth login                                   # interactive (opens a browser by default; use --no-browser to paste a token)
nodaro auth login --token "$NODARO_TOKEN"           # non-interactive
nodaro auth login --no-browser                      # skip browser flow, paste token instead
nodaro auth login --profile staging --base-url https://next.nodaro.ai
```

The token is stored at `~/.config/nodaro/config.json` with `chmod 0600`. Override the location with `NODARO_CONFIG_DIR`.

```bash
nodaro auth status                                  # show profile (token masked)
nodaro auth logout                                  # delete the saved profile
```

### Profiles

Switch between staging / prod / local instances with `--profile`:

```bash
nodaro auth login --profile prod    --base-url https://app.nodaro.ai
nodaro auth login --profile staging --base-url https://next.nodaro.ai
nodaro auth login --profile local   --base-url http://localhost:8000

nodaro projects list --profile staging
```

When you omit `--profile`, the CLI uses the profile named `production`.
The **first profile you create becomes the default**, so a single
`nodaro auth login` (no `--profile`) sets you up without any extra flags.

## Three ways to run something

The CLI exposes the three execution paths the platform supports — pick the one that matches what you've already built.

| Goal | Command |
|---|---|
| Run a saved DAG | `nodaro workflows run <workflowId>` |
| Run a published app (curated inputs/outputs) | `nodaro apps run <slug> --input k=v` |
| Run a single node directly (no DAG) | `nodaro nodes run <type> --param k=v` |

The `nodes run` path is the SDK / CLI equivalent of the MCP server's verb tools (`generate_image`, `generate_video`, etc.) — it posts to the node's route (`POST /v1/<type>` for most node types; the SDK reference's `nodes.run` section lists the ones with a route of their own, such as `llm-chat` and the `suno-*` nodes), so any node listed by `nodaro nodes list` that runs on its own can be invoked with `nodaro nodes run`. A node type with no route of its own (`modify-image`, `paint-mask`, …) fails before calling the API, naming what to run instead.

## Commands

```bash
# Auth
nodaro auth login [--profile <name>] [--token <token>] [--base-url <url>] [--no-browser]
nodaro auth status [--profile <name>] [--json]
nodaro auth logout [--profile <name>]

# Projects
nodaro projects list [--json]
nodaro projects get <id> [--json]
nodaro projects create --name <name> [--description <desc>] [--json]
nodaro projects update <id> [--name <name>] [--description <desc>] [--json]
nodaro projects delete <id> [--json]

# Generation sessions (inside projects; items are links to your jobs)
nodaro sessions list [--project <id>] [--tool <tool>] [--archived] [--limit <n>] [--cursor <c>] [--json]
nodaro sessions get <id> [--json]
nodaro sessions items <id> [--limit <n>] [--cursor <c>] [--json]
nodaro sessions create --tool <tool> [--project <id>] [--title <title>] [--json]
nodaro sessions update <id> [--title <title> | --untitled] [--archive | --unarchive] [--cover <jobId> | --auto-cover] [--json]
nodaro sessions import <id> --jobs <id,id,...> [--json]     # links, not copies; all-or-nothing
nodaro sessions remove <id> <jobId> [--json]                # the link only; the job stays
nodaro sessions delete <id> [--json]                        # its jobs are kept

# Workflows
nodaro workflows list --project <projectId> [--json]
nodaro workflows get <id> [--json]
nodaro workflows create --project <projectId> --name <name> [--file bundle.json] [--json]
nodaro workflows update <id> [--name <name>] [--file nodes-edges.json] [--json]
nodaro workflows delete <id> [--json]
nodaro workflows export <id> [--with-assets] [--output bundle.json]
nodaro workflows import <file> --project <projectId> [--json]
nodaro workflows run <id> [--watch] [--node n1 n2 ...] [--json]
nodaro workflows run <id> --continue-from <executionId> --from-failed [--node n1 n2 ...] [--idempotency-key <key>] [--watch]
#   --from-failed without --node considers the nodes the failed run's chain was first started on (every node for a full run), plus what that run left failed
#   with --node, every node named counts: one no run of the chain ever ran runs and is charged (a source, trigger or skipped node never does)
#   --idempotency-key (8+ characters) is sent as Idempotency-Key: the same key twice starts one run
nodaro workflows run <id> --continue-from <executionId> --node n1 n2 ... [--override n1.quality=final ...] [--watch]
#   a run of named nodes continuing a completed run; --override (nodeId.field=value, repeat) is a per-node override for this run only
nodaro workflows run <id> --next <json|file|-> [--idempotency-key <key>] [--watch]
#   sends the `next` of a continuation_preview_pending answer exactly as given (alone: no --node, --continue-from, --from-failed or --override;
#   a body with continueMode or renderFinal is refused: a `next` carries neither)
#   a --from-failed refused with continuation_preview_pending prints the exact command that finishes the held run (render-final, or run --next)
nodaro workflows render-final <id> --from <executionId> [--render <nodeId>] [--estimate] [--watch] [--json]
#   the Render final of a run that stopped at a Preview render: the render at Final and every node after it, continuing that run;
#   --render defaults to the workflow's only render; --estimate quotes it (nodes, credits) and runs nothing

# Sharing (workspace features)
nodaro workflows share <id> [--visibility workspace|private] [--json]
nodaro workflows move <id> --project <projectId> [--json]
nodaro workflows shared-with-me [--json]
nodaro workflows collaborators list <id> [--json]
nodaro workflows collaborators add <id> (--user <userId> | --email <email>) --role viewer|editor [--json]
nodaro workflows collaborators update <id> <userId> --role viewer|editor [--json]
nodaro workflows collaborators remove <id> <userId> [--json]

# Apps — workflows wrapped in a curated UI
nodaro apps list [--search <query>] [--limit <n>] [--cursor <token>] [--category <slug>]
nodaro apps get <slug>                                  # show input schema + outputs
nodaro apps run <slug> --input prompt="…" [--watch]
nodaro apps run <slug> --params-file inputs.json [--watch]
nodaro apps runs <slug> [--limit <n>] [--cursor <token>] [--json]  # list past runs
nodaro apps run-get <slug> <runId>

# Nodes — list types + run a single node directly
nodaro nodes list [--category input|parameter|ai-image|ai-video|ai-audio|ai-text|processing|composition|output|control|entity|trigger|utility] [--json]
nodaro nodes get <type>                                 # full input schema
nodaro nodes run <type> --param prompt="…" --param provider=flux [--watch]
nodaro nodes run <type> --params-file body.json [--watch] [--poll-interval 1000]
nodaro nodes run generate-image --param prompt="…" [--count 1-4] [--models <id,id,…>] [--watch]   # several images in one call

# Models — browse the model catalog (makers, capability sheets, credit pricing, prompt tips)
nodaro models list [--kind image|video|audio] [--mode t2v|i2v|t2i|tts|…] [--family <vendor>] [--featured] [--json]
#   table shows id, kind, family, maker (the company that made the model), modes, credit tiers, featured ★ and the doctrine ✓ flag
#   --json for the full sheets, incl. each model's maker { id, name } and the maker's logoUrl (null when the instance publishes no mark)

# Billing — plans and prices, your subscription (buying and changing plans stay in the app)
nodaro billing plans [--base-url <url>] [--json]        # plans and credit packs on sale, with prices (Nodaro Cloud; no sign-in needed)
nodaro billing subscription [--json]                    # your subscription, and the tier your account's entitlements follow (Nodaro Cloud)
nodaro billing account [--json]                         # your plan and balance as the deployment's billing provider reports them, in its unit
nodaro billing surface [--base-url <url>] [--json]      # how this deployment bills: whether it meters usage, and the unit costs display in (no sign-in needed)
#   `plans` and `surface` send no credential: they ask --base-url, else the profile's instance, else https://app.nodaro.ai
#   `plans` and `subscription` answer 404 on a self-hosted instance (no billing there)

# Pickers — valid values for parameter-picker nodes (setting, mood, person, …)
nodaro pickers list [--json]                            # all picker node types + option counts + how many options have a picture
nodaro pickers get <nodeType> [--full] [--category <c>] [--field <f>] [--json]
#   default (compact) carries id, label, category, term, icon, imageUrl — `term` is the short
#   professional phrase compact hint mode injects ("" for a no-op auto/none option);
#   `imageUrl` is the option's picture (absolute, absent when it has none), and
#   person / styling add `sections` — their topics, each with its round picture
#   --full adds each option's description + the prompt fragment it injects
#   --category filters a single-dim picker; --field picks one dimension of a multi-dim picker (person/styling/framing)
nodaro pickers analyze "<text>" [--target <types>] [--instructions <text>] [--model <id>] [--effort <level>] [--json]
#   AI Fill: choose picker values from a free-text description (credit-billed LLM call);
#   --target limits to a comma-separated list of picker node types (default: all analyzable)

# Presets — your saved node configs (and the built-in catalog), favorites and folders
nodaro presets list [--node-type <type>] [--factory [--base-url <url>]] [--json]
#   --factory lists the built-in catalog for --node-type (no sign-in needed; --base-url asks another
#   instance): `photos` = how many reference photos a preset works from (needsImage / minReferences),
#   `preview` = it has an example picture (previewUrl). Without --factory, your own presets (a profile is needed)
nodaro presets create --node-type <type> --name <name> (--data <json> | --data-file <path|->) [--description <text>] [--group <id>] [--tag <t>]... [--preview-url <url>] [--json]
#   --preview-url: an image already stored on this platform (an upload or a finished result)
nodaro presets update <id> [--name <name>] [--description <text>] [--data <json> | --data-file <path|->] [--group <id> | --no-group] [--tag <t>]... [--preview-url <url> | --no-preview-url] [--expected-updated-at <iso>] [--json]
nodaro presets delete <id> [--expected-updated-at <iso>] [--json]
nodaro presets export [--node-type <type>] [--output <file>]        # an import-compatible JSON envelope
nodaro presets import <file|-> [--json]                             # that envelope, or a JSON list of presets
nodaro presets favorites --node-type <type> [--json]
nodaro presets favorite <presetId> --node-type <type> [--json]      # a factory id or one of yours
nodaro presets unfavorite <presetId> --node-type <type> [--json]
nodaro presets groups list [--node-type <type>] [--json]            # your folders and sections (bare `groups` lists too)
nodaro presets groups create --node-type <type> --name <name> [--kind folder|section] [--sort-order <n>] [--json]
nodaro presets groups update <id> [--name <name>] [--sort-order <n>] [--json]
nodaro presets groups delete <id> [--json]                          # its presets move out of it
#   reordering is a drag in the editor; scripts use the SDK's presets.reorder

# Saved posts — the inspiration wall (posts saved from Social Search, with notes and tags)
nodaro saved-posts list [--platform <p>] [--tag <t>] [--q <words>] [--limit <n>] [--cursor <c>] [--json]
nodaro saved-posts save --file <post.json|-> [--index <n>] [--note <text>] [--tag <t>]... [--json]
#   --file holds one post, or a Social Search output list (--index picks one, default 0)
nodaro saved-posts update <id> [--note <text>] [--tag <t>]... [--clear-tags] [--json]
nodaro saved-posts delete <id>                         # also removes the copied still

# Collections — where a workflow's records live (text and links only, never files)
nodaro collections list [--json]                            # your collections, record counts, your caps
nodaro collections create <name> [--description <text>] [--json]
nodaro collections show <id> [--json] | update <id> [--name <n>] [--description <d>] | delete <id>
nodaro collections records <id> [--q <words>] [--since <iso>] [--until <iso>] [--usage all|unused|used] [--status active|trash] [--order newest|oldest] [--limit <n>] [--offset <n>] [--cursor <c>] [--json]
nodaro collections add <id> [--title <t>] [--text <t>] [--url <link>] [--file <item.json|->] [--index <n>] [--dedupe-key <k>] [--idempotency-key <k>] [--json]
#   --file holds any JSON item (a feed post, a search result) the server maps to a record; explicit flags win
#   the same link twice is one record ("already there"); the same --idempotency-key twice saves once
nodaro collections remove <id> <recordId> [--forever]       # to the collection's Trash; --forever deletes a record already in the Trash for good
nodaro collections restore <id> <recordId> [--json]         # back from the Trash
nodaro collections mark-used <id> <recordId> [--not-used] [--json]
nodaro collections export <id> [--format csv|json] [--since <iso>] [--until <iso>] [--usage all|unused|used] [--q <words>] [--out <path>]   # the live records, to stdout or a file

# Palettes and moodboards — use one on generate-image as direction.colorLook "palette:<id>" / direction.style "moodboard:<id>"
nodaro palettes list [--limit <n>] [--cursor <c>] [--json]
nodaro palettes get <id> [--json]
nodaro palettes create --name <name> --colors <#hex,#hex,...> [--description <text>] [--json]   # 2-12 colours
nodaro palettes update <id> [--name <name>] [--colors <#hex,...>] [--description <text> | --clear-description] [--json]
nodaro palettes delete <id> [--json]
nodaro moodboards list [--limit <n>] [--cursor <c>] [--json]
nodaro moodboards get <id> [--json]
nodaro moodboards create --name <name> --image <url[|caption]>... [--description <text>] [--json]   # 1-12 images; repeat --image
nodaro moodboards update <id> [--name <name>] [--description <text> | --clear-description] [--image <url[|caption]>...] [--json]   # --image replaces them all
nodaro moodboards delete <id> [--json]                      # the linked images are untouched

# Competitors — tracked brands, their scans and action cards (Nodaro Cloud)
nodaro competitors list [--json]
nodaro competitors add [--brand <name>] [--website <url>] [--tiktok <h>] [--instagram <h>] [--youtube <c>] [--x <h>] [--linkedin <page>] [--meta-ads <name>] [--about <platforms>] [--schedule off|weekly|daily] [--own] [--json]
#   --website with no account flags finds the accounts from the site first (guesses are named)
nodaro competitors discover <website> [--json]              # free
nodaro competitors scan <id> [--watch] [--json]             # one Social Search page per search
nodaro competitors cards [--json]                           # what to do now (shows the id to mark a card done)
nodaro competitors lessons <id> [--json]                    # what works for a brand (free)
nodaro competitors history <id> [--json]                    # its scans oldest first: posts, followers, usual reach per platform (free)
nodaro competitors compare <id> --from <iso> --to <iso> [--vs-from <iso> --vs-to <iso>] [--json]   # one period, or two side by side (free)
nodaro competitors done <card-id> [--link <url>] [--json]   # "I did this", with your post's full link (free)
nodaro competitors tried [--json]                           # did it work? each mark, how it went, and your record
nodaro competitors link <mark-id> <url> | link <mark-id> --remove
nodaro competitors undo <mark-id>                           # removes the mark and its result
nodaro competitors show <id> | update <id> [flags] [--clear <platforms>] | remove <id>
#   update changes only the accounts named (the others are kept); --clear tiktok,x removes accounts

# Catalog — maintain a deployment's VENDORED catalog packs (offline, file-based; no auth/client)
nodaro catalog snapshot --in <file>                     # echo a detail=full /v1/catalogs projection + sidecars JSON
nodaro catalog diff-upstream --baseline <f> --upstream <f> --pack <f> [--write <f>]
#   three-way merge: carries upstream edits for entries you left UNMODIFIED (with their 11-locale
#   sidecar strings), reports conflicts (you edited AND upstream changed — pack kept), lists new
#   upstream entries and upstream removals — NOTHING is auto-admitted. Exit code 2 on conflicts.
nodaro catalog validate --pack <file> [--exempt es,fr,…]
#   checks a pack snapshot has sidecar coverage across the 11 locales (or declared exemptions);
#   exit code 1 when a non-exempt locale is missing a translation

# Shots — Cine share → remix records
nodaro shots get <id> [--json]                          # public shots resolve for anyone holding the id
nodaro shots create [--file shot.json] [--visibility private|public] [--json]
nodaro shots update <id> [--file fields.json] [--visibility private|public] [--json]
nodaro shots delete <id>

# Recast — regenerate an analyzed video with your own cast + authored-script import (Cloud edition)
nodaro recast skill                                     # print the authoring guide for writing a script (markdown, free)
nodaro recast validate --file script.json [--json]      # free validation; exit code 1 while invalid
nodaro recast import --file script.json --rights-attested [--json]
#   imports a VALIDATED authored script as a completed analysis (free); --rights-attested asserts
#   the script is your own work — authored recasts render Faithful, exactly as written
nodaro recast estimate --analysis-job <id> [--fidelity faithful] [--resolution <r>] [--segment-pack scenes-max|scenes|max] [--json]
nodaro recast create --workflow <id> --analysis-job <id> [--rights-attested] [--fidelity faithful] [--resolution <r>] [--segment-pack scenes-max|scenes|max] [--json]
#   BUYS THE PLAN (credits) — run `estimate` first; returns the run id
nodaro recast start <recastId> [--segment-pack scenes-max|scenes|max] [--json]   # render a planned run (idempotent)
nodaro recast status <recastId> [--json]                # poll status + any pending interactive step

# Prompt — AI wizard that turns a rough idea into an optimized prompt
nodaro prompt wizard [--node-type <type>] [--prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--reasoning-effort <level>]   # interactive Q&A; node picker if --node-type omitted
nodaro prompt analyze --node-type <type> [--prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--reasoning-effort <level>] [--json]   # return guided questions
nodaro prompt generate --node-type <type> --selection category=value [--selection ...] [--original-prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--reasoning-effort <level>] [--json]   # build a prompt from selections
nodaro prompt enhance --node-type <type> --prompt "…" [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--reasoning-effort <level>] [--json]   # one-shot rewrite, no questions
#   --reasoning-effort <level>: none|low|medium|high|xhigh|max (model-dependent; unsupported/omitted -> vendor default). xhigh/max bill one tier up. `--advanced` (Gemini and Claude models) runs on the provider's own API so `--temperature` / `--max-tokens` / the full reasoning range apply, and also bills one tier up.

# Executions
nodaro executions get <id> [--watch] [--json]
nodaro executions cancel <id> [--mode cancelled|stopping]

# Jobs
nodaro jobs list [--status <s,s>] [--type <t,t>] [--origin <app>] [--favorited | --no-favorited] [--rating good|bad|rated|unrated] [--limit <n>] [--cursor <c>] [--json]
#   newest first; --status / --type take a comma-separated list; --no-favorited keeps the jobs you did not favorite; every filter combines with AND
nodaro jobs get <id> [--json]
nodaro jobs rate <id> good|bad|clear [--json]             # your rating of one of your jobs; clear removes it
nodaro jobs cancel <id> [--json]

# Gallery — the public gallery and your favorites
nodaro gallery browse [--type image|video|audio] [--user <id> | --favorites] [--limit <n>] [--cursor <c>] [--json]
#   --user: one person's work (your own id includes your private items); --favorites: your own items you favorited
nodaro gallery favorite <jobId> [--json]                  # toggles: favorites the job, or removes it when it is one
nodaro gallery favorites [--json]                         # your favorited job ids, newest first
# Webhooks — https endpoints Nodaro POSTs your job.completed / job.failed to, signed (docs/webhooks.md)
nodaro webhooks list [--json]
nodaro webhooks get <id> [--json]
nodaro webhooks create --url <https-url> [--events job.completed,job.failed] [--description <text>] [--json]
#   prints the endpoint's signing secret (whsec_…) ONCE — store it; --json emits { data, secret }
nodaro webhooks update <id> [--url <https-url>] [--events <list>] [--description <text> | --clear-description] [--enable | --disable] [--json]
#   --enable also clears an automatic switch-off (50 deliveries in a row that failed for good)
nodaro webhooks delete <id> [--json]                    # the endpoint and its delivery log
nodaro webhooks rotate-secret <id> [--grace <seconds>] [--json]   # a new secret, printed once; the old one keeps signing for --grace (default a day, 0 = stop it now)
nodaro webhooks deliveries <id> [--status pending|delivered|failed] [--limit <n>] [--cursor <c>] [--json]
nodaro webhooks test <id> [--wait] [--poll-interval <ms>] [--json]
#   sends a `ping` (tried once, even when the endpoint is switched off); --wait follows that delivery and shows how your server answered

# Generate Video Pro run control (segmented long-video engine; self-host runs it via the nodaro.ai connection)
nodaro video-pro stop <jobId> [--json]                     # graceful stop: keep + deliver completed segments, refund the rest
nodaro video-pro continue <jobId> [--from-segment N] [--watch] [--poll-interval <ms>] [--json]   # new job regenerating from segment N (default: first missing)

# Characters — full lifecycle + studio operations
nodaro characters list [--project <id>] [--archived] [--search <words> | --q <words>] [--limit <n>] [--json]   # every word (up to 5) in the name or description, any case, each literal
nodaro characters get <id>
nodaro characters create --name <name> [--description "..."] [--gender <gender>] [--style realistic|anime|3d-pixar|illustration] [--base-outfit "..."] [--seed-prompt "..."] [--node-id <id>] [--project <id>]
nodaro characters update <id> [--name <name>] [--description "..."] [--gender <gender>] [--style realistic|anime|3d-pixar|illustration] [--base-outfit "..."] [--seed-prompt "..."]
nodaro characters delete <id>
nodaro characters restore <id>
nodaro characters duplicate <id> [--node-id <id>] [--project <id>]
nodaro characters usage <id>
nodaro characters generate <id> [--seed-prompt "..."] [--description "..."] [--name <name>] [--count 1|2|4] [--provider <p>] [--watch]
nodaro characters generate-asset <id> --asset-type expressions|poses|lighting|angles|headAngles|bodyAngles|custom --variant <name> [--user-prompt "..."] [--description "..."] [--column <col>] [--attach-name <name>] [--provider <p>] [--watch]
nodaro characters generate-motion <id> --motion-prompt "..." [--attach-name <name>] [--description "..."] [--motion-description "..."] [--provider <p>] [--watch]
nodaro characters approve-portrait <id> --job <jobId>
nodaro characters recaption <id>
# High-fidelity training (Nodaro Cloud; paid per training, refunded if it fails)
nodaro characters train <id> [--image <url> ...] [--watch] [--poll-interval <ms>] [--json]   # --image repeats: train on those images only (at least 4); --watch follows the training's job
nodaro characters training <id> [--watch] [--poll-interval <ms>] [--json]                    # untrained | queued | training | succeeded | failed | cancelled; --watch exits 0 / 2 failed or not started / 130 cancelled or removed
nodaro characters delete-lora <id> [--json]                                                   # remove the trained model (cancels a training in flight, refunded) — cannot be undone

# Locations — full lifecycle + studio operations
nodaro locations list [--archived] [--search <words> | --q <words>] [--json]
nodaro locations get <id> [--json]
nodaro locations create <name> --node-id <id> [--description "..."] [--category indoor|outdoor|urban|nature|fantasy|sci-fi|historical|futuristic|other] [--style realistic|anime|3d-pixar|illustration] [--project <id>] [--json]
nodaro locations update <id> [--name <name>] [--description "..."] [--category <category>] [--style <style>] [--style-lock true|false] [--canonical-description "..."] [--expected-updated-at <iso>] [--json]
nodaro locations delete <id> [--json]
nodaro locations restore <id> [--json]
nodaro locations generate --name <name> [--description "..."] [--user-prompt "..."] [--category <category>] [--style <style>] [--provider <p>] [--count 1|2|4] [--attach-to-location-id <id>] [--watch] [--json]
nodaro locations generate-asset <id> --asset-type timeOfDay|weather|seasons|angles|lighting|custom --variant <name> [--user-prompt "..."] [--description "..."] [--column <col>] [--attach-name <name>] [--provider <p>] [--watch] [--json]
nodaro locations generate-motion --name <name> --motion-prompt "..." --source-image-url <url> [--provider kling|kling-turbo|kling-3.0|wan-i2v|wan-2.7-i2v|seedance-2] [--style realistic|anime|3d-pixar|illustration] [--canonical-description "..."] [--attach-to-location-id <id>] [--attach-name <name>] [--aspect-ratio 1:1|3:4|16:9|9:16] [--watch] [--json]
nodaro locations approve-main-image <id> --candidate-job-id <jobId> [--json]
nodaro locations recaption <id> [--json]

# Objects — full lifecycle + studio operations
nodaro objects list [--project <id>] [--archived] [--search <words> | --q <words>] [--json]
nodaro objects get <id> [--json]
nodaro objects create <name> --node-id <id> [--description "..."] [--category furniture|vehicle|weapon|food|clothing|electronics|nature|tool|animal|other] [--style realistic|anime|3d-pixar|illustration] [--project <id>] [--json]
nodaro objects update <id> [--name <name>] [--description "..."] [--category <category>] [--style <style>] [--style-lock true|false] [--canonical-description "..."] [--expected-updated-at <iso>] [--json]
nodaro objects delete <id> [--permanent] [--json]          # --permanent erases archived rows; default is soft-delete
nodaro objects restore <id> [--json]
nodaro objects generate --name <name> [--description "..."] [--user-prompt "..."] [--category <category>] [--style <style>] [--provider <p>] [--count 1|2|4] [--attach-to-object-id <id>] [--seed-prompt-hint "..."] [--watch] [--json]
nodaro objects generate-asset --asset-type angles|materials|variations|motion|custom --variant <name> --attach-to-object-id <id> [--attach-to-column <col>] [--name <name>] [--description "..."] [--seed-prompt-hint "..."] [--watch] [--json]
nodaro objects generate-motion --name <name> --motion-prompt "..." --source-image-url <url> [--provider kling-turbo|kling|kling-3.0|minimax|hailuo-2.3|wan-i2v|seedance|bytedance-lite] [--style realistic|anime|3d-pixar|illustration] [--canonical-description "..."] [--attach-to-object-id <id>] [--attach-name <name>] [--aspect-ratio 1:1|3:4|16:9|9:16|4:3] [--seed-prompt-hint "..."] [--watch] [--json]
nodaro objects approve-main-image <id> --candidate-job-id <jobId> [--expected-updated-at <iso>] [--json]
nodaro objects recaption <id> [--json]

# Voice — revoice an audio track or a talking video
nodaro voice list [--clones] [--json]                    # the premade voice catalog (or your clones) — names/ids for --voice / --voices
nodaro voice changer --voice <id> --audio <url>|--video <url> [--model <id>] [--stability <0..1>] [--similarity <0..1>] [--style <0..1>] [--use-speaker-boost] [--seed <n>] [--remove-background-noise] [--watch] [--poll-interval <ms>] [--json]
nodaro voice change ...                                  # alias of `voice changer`
nodaro voice recast --audio <url>|--video <url> --voices <v1,v2,...>|--voices-json <json> [--model <id>] [--output video|stems] [--analysis-json <json>|--analysis-file <path>] [--no-preserve-background] [--separation-quality fast|best] [--music-volume-mode match|normalize|manual] [--music-volume <0-200>] [--remove-background-noise] [--voice-fx <preset>] [--voice-fx-mix <0-100>] [--voice-fx-delay <20-2000>] [--voice-fx-decay <0-1>] [--watch] [--poll-interval <ms>] [--json]
                                                         # multi-speaker recast (Voice Changer Pro; self-host runs it via the nodaro.ai connection). --voices maps speakers in detection order;
                                                         # the literal `keep` keeps that speaker's original voice (e.g. --voices Rachel,keep,Aria).
                                                         # --voices-json takes the raw SDK array: voice ids, per-voice settings objects, or null keep-slots.
                                                         # --output stems returns dry per-track stems for an interactive mix (render with `voice export`).
nodaro voice pro ...                                     # alias of `voice recast`
nodaro voice analyze --audio <url>|--video <url> [--separation-quality fast|best] [--suggest-title] [--watch] [--poll-interval <ms>] [--json]
                                                         # detect the speakers WITHOUT recasting (Cloud only) — prints the speaker list on --watch.
                                                         # Save the completed job's output_data and pass it to `voice recast --analysis-file` to skip re-detection.
nodaro voice export --source <videoUrl> --tracks-json <json>|--tracks-file <path> [--voice-fx <preset>] [--voice-fx-mix <0-100>] [--voice-fx-delay <20-2000>] [--voice-fx-decay <0-1>] [--watch] [--poll-interval <ms>] [--json]
                                                         # render the final video from a mixed track set (Cloud only) — tracks are { url, gain 0-200, muted, kind? } lanes
                                                         # from a `voice recast --output stems` job; the video stream is copied, never re-encoded.
nodaro voice design --text <line> --description <desc> [--model <id>] [--loudness <-1..1>] [--guidance-scale <0-100>] [--seed <n>] [--quality <n>] [--enhance] [--user-prompt <text>] [--watch] [--poll-interval <ms>] [--json]
                                                         # design a brand-new synthetic voice from a text description
nodaro voice remix --text <text> --description <desc> [--user-prompt <text>] [--watch] [--poll-interval <ms>] [--json]
                                                         # speak a text in a described voice, without cloning
nodaro voice dub --audio <url> --target-language <code> [--source-language <code>] [--num-speakers <1-20>] [--disable-voice-cloning] [--drop-background-audio] [--watch] [--poll-interval <ms>] [--json]
                                                         # dub into another language while preserving each speaker's voice
nodaro voice clones list [--json]                        # clones made before cloning was retired
nodaro voice clones delete <id> [--json]

# Media — ingestion + compositing: social-video import, trim, split into parts, caption burn-in, still-to-video, slideshow, image collage, image overlay, image mask, video overlay, save-to-storage, metadata probe
nodaro media download <url> [--max-height <px>] [--section <a-b>] [--watch] [--json]
                                                         # YouTube / TikTok / Instagram / X / Facebook → your storage. --section fetches only
                                                         # that time range (seconds). --watch streams live progress (no job to poll later).
nodaro media metadata <url> [--json]                     # probe duration/dimensions/title WITHOUT downloading
nodaro media trim-video --video <url> --start <sec> --end <sec>|--keep-first <sec>|--keep-last <sec> [--watch] [--poll-interval <ms>] [--json]
nodaro media trim-audio --video <url>|--audio <url> [--start <sec>] [--end <sec>] [--format mp3|wav|aac] [--watch] [--poll-interval <ms>] [--json]
nodaro media split-media --video <url>|--audio <url> --chunk-duration <sec> [--min-part-duration <sec>] [--format mp3|wav|aac] [--watch] [--poll-interval <ms>] [--json]
                                                         # cut a video and/or audio file into parts of at most --chunk-duration and at
                                                         # least --min-part-duration (default 4) seconds, on whole frames; parts land on
                                                         # the job's output_data (videoUrls[] / audioUrls[], partDurationsSec[]). Rules: the
                                                         # Split into Chunks node page (nodes/processing-audio/split-media.md)
nodaro media add-captions <videoUrl> [--text <text>] [--captions-file <file.json>] [--style subtitle|word-highlight|karaoke|tiktok-words|word-pop|bouncy] [--look outline|clean] [--position bottom|top|center] [--position-y <pct>] [--font-size <px>] [--font-family <name>] [--font-weight <100-900>] [--color <c>] [--background-color <c>] [--stroke-color <c>] [--stroke-width <px>] [--highlight-color <c>] [--uppercase|--no-uppercase] [--max-words-per-line <1-20>] [--animate|--no-animate] [--no-auto-transcribe] [--transcribe-provider elevenlabs-stt|incredibly-fast-whisper|whisper] [--segments-file <file.json>] [--watch] [--poll-interval <ms>] [--json]
                                                         # burn captions in. `subtitle` is static (FFmpeg drawtext); the kinetic styles render
                                                         # via Remotion. On `subtitle`, --text is burned as-is as ONE static block for the whole
                                                         # video — never transcribed over, styled or not; omit --text to caption the speech. On a
                                                         # kinetic style --text is only the fallback when transcription returns nothing (or with
                                                         # --no-auto-transcribe). The STYLING levers (--look, --font-family, --font-weight, --stroke-*,
                                                         # --uppercase, --position-y, --max-words-per-line) ALSO style a `subtitle` — a styled
                                                         # subtitle renders via Remotion and bills at the kinetic price; a bare plain-text subtitle
                                                         # stays on the cheap path. Only --highlight-color and --animate are kinetic-only (rejected
                                                         # on subtitle). --animate is on by default; --no-animate freezes the per-word motion
                                                         # (grouping + highlight colour stay). On the kinetic styles an unset --look renders as
                                                         # `outline`; on `subtitle` as `clean`. --max-words-per-line <n> (1-20) caps the WORDS on
                                                         # one caption line (or tiktok-words page) on top of the frame-width budget, sentence ends
                                                         # and >=0.5s pauses — it counts words for any input (a longer phrase entry is split), and
                                                         # on a --text subtitle it only sets the line breaks. 1-2 is the punchy CapCut read, unset
                                                         # fits the width; inert on word-pop. word-highlight,
                                                         # karaoke and bouncy all show ONE held line at a time. --transcribe-provider picks the
                                                         # auto-transcribe engine: a kinetic style needs word timings (incredibly-fast-whisper,
                                                         # the default, or elevenlabs-stt); `subtitle` needs phrase timing only, so whisper is fine
                                                         # there. A Remotion render keeps the source frame rate (whole number, 15-60 fps; a
                                                         # variable-frame-rate or very long source renders at 30 fps).
                                                         # --captions-file is a JSON array of word-timed entries [{ text, startMs, endMs }] — one
                                                         # per WORD for the kinetic styles, and an `audio transcribe` job's output_data.words drops
                                                         # in verbatim (pair it with --no-auto-transcribe). --segments-file gives non-overlapping
                                                         # ranges their own style/look/position.
nodaro media still-to-video --image <url> --audio <url> [--motion none|zoom-in|zoom-out|pan-left|pan-right|ken-burns] [--intensity <1-10>] [--resolution 720p|1080p|4K] [--aspect-ratio <W:H>] [--fps 24|30] [--fit cover|contain] [--pad-color <hex>] [--watch] [--poll-interval <ms>] [--json]
                                                         # one still + one audio → MP4, local FFmpeg, 0 credits. Length = the audio's length
                                                         # (no duration flag by design). --motion animates the still.
nodaro media slideshow --images <url...> [--audio <url>] [--durations "10,auto,auto"] [--per-image <sec>] [--transition <id>] [--transition-duration <sec>] [--motion none|zoom-in|zoom-out|ken-burns|alternate] [--intensity <1-10>] [--resolution 720p|1080p|4K] [--aspect-ratio <W:H>] [--fps 24|30] [--fit cover|contain] [--pad-color <hex>] [--watch] [--json]
                                                         # 2-100 images + optional audio → MP4 slideshow, 0 credits. Audio wired = it sets the
                                                         # length (pins scale proportionally, disclosed); no audio = silent, N × per-image.
nodaro media collage <imageUrls...> [--sizes <0-3,...>] [--numbered] [--label <text>...] [--badge-position top-left|top-right] [--layout smart|grid] [--resolution 2K|4K] [--aspect-ratio <W:H>] [--gap <px>] [--background-color <hex>] [--watch] [--poll-interval <ms>] [--json]
                                                         # composite 2–30 images into one large image. --sizes gives per-image RELATIVE size
                                                         # hints aligned by position (0 auto, 1 big ≈2× linear, 2 medium, 3 small ≈½ — smart layout only).
                                                         # --numbered stamps 1-based sequence numbers at each image's corner (storyboard mode);
                                                         # --badge-position picks the corner for numbers and labels: top-left (default) or top-right.
                                                         # --label sets a per-image caption shown after the number; repeat once per image, in order ("" skips one, aligned with the image args).
nodaro media overlay <imageUrl> [layerUrls...] [--layers-file <path>] [--anchor <anchor>] [--x <%>] [--y <%>] [--width <%>] [--opacity <0-1>] [--platform <id>...] [--qr-text <text>] [--mask-mode none|layers|around|outside] [--mask-spread <px>] [--canvas <WxH>] [--base-fit contain|cover] [--background-color <hex>] [--output-format png|jpg|webp] [--watch] [--poll-interval <ms>] [--json]
                                                         # place up to 12 layers on a base image, pixel-exactly (local sharp, no AI). Positional URLs are
                                                         # image layers and share --anchor/--x/--y/--width/--opacity (the watermark case); --layers-file
                                                         # takes the full JSON array — per-layer options and the text / QR / shape kinds.
                                                         # Placement is in PERCENT of the base image, so one call fits a 1K preview and a 4K render.
                                                         # --platform (repeatable) also renders the composite at that platform's size (2 credits each
                                                         # on top of the 10-credit base); the job's output carries them as variants[].
nodaro media overlay-placement <imageUrl> [--intent <text>] [--aspect <ratio>] [--safe-area <x,y,w,h>] [--json]
                                                         # asks a vision model WHERE one layer should go and answers in the same percent units —
                                                         # anchor, x, y, width + a one-line reason. Synchronous (no job to poll); one image-to-text call.
nodaro media generate-mask <imageUrl> <prompt> [--threshold <n>] [--watch] [--poll-interval <ms>] [--json]
                                                         # selects a subject described in text in an image (Grounded SAM) and returns a black-and-white
                                                         # mask image (white = the subject). --threshold 0-1 (default 0.3; lower selects more). The job's
                                                         # output carries maskUrl (the mask) and imageUrl (the source, passed through) — feed both to an
                                                         # inpainting edit. Price: GET /v1/credits/model-cost?model=generate-mask. See docs/nodes/ai-image/generate-mask.md.
nodaro media video-overlay <videoUrl> [layerUrls...] [--at <start[-end]>...] [--preset card|corner-badge|full-frame] [--corner top-left|top-right|bottom-left|bottom-right] [--layers-file <path>] [--aspect 16:9|9:16|1:1|4:5] [--base-fit cover|contain] [--background-color <hex>] [--watch] [--poll-interval <ms>] [--json]
                                                         # 1-20 timed image layers over a video in one local FFmpeg render (no AI), 20 credits; the base
                                                         # audio is kept untouched. One --at per positional layer URL, in order ("3" = from 3 s to the end,
                                                         # "1.2-2.6"); --preset/--corner apply to every positional layer. --layers-file takes the full API
                                                         # layers array instead (per-layer boxes, opacity, animate, zIndex). --base-fit and --background-color
                                                         # need --aspect. See docs/nodes/processing-video/video-overlay.md.
nodaro media video-mask <videoUrl> <prompt> [--threshold <n>] [--model sam-3.1|sam-3] [--watch] [--poll-interval <ms>] [--json]
                                                         # tracks a subject described in text through a video (SAM 3.1 by default; --model sam-3 costs
                                                         # half) and returns a black-and-white mask video (white = the subject). --threshold 0.05-0.95
                                                         # (default 0.5; lower finds more). Clips up to 5 minutes at 30 fps (a faster clip counts
                                                         # proportionally longer), priced by length. See docs/nodes/ai-video/video-mask.md.
nodaro media mask-composite <foregroundUrl> <backgroundUrl> <maskUrl> [--invert] [--feather <px>] [--grow <px>] [--background-fit cover|contain|stretch] [--audio foreground|background|mix|none] [--watch] [--poll-interval <ms>] [--json]
                                                         # the foreground over the background through the mask (white = foreground), local FFmpeg, priced per started 5 s of the result (foreground up to 300 s).
                                                         # The result follows the foreground's size, rate and length; the background loops, the mask holds its
                                                         # last frame. --feather 0-20 px, --grow -10..10 px. See docs/nodes/processing-video/mask-composite.md.
nodaro media save <url> [--filename <name>] [--type image|video|audio] [--watch] [--poll-interval <ms>] [--json]

# Audio — the primitives Voice Changer Pro composes, standalone, plus speech-to-text
nodaro audio separate --audio <url> [--mode vocal_instrumental|stems] [--quality auto|fast|best] [--watch] [--poll-interval <ms>] [--json]
nodaro audio isolate --audio <url> [--watch] [--poll-interval <ms>] [--json]
nodaro audio fx --audio <url> [--preset <preset>] [--mix <0-100>] [--delay <20-2000>] [--decay <0-1>] [--eq-low <db>] [--eq-high <db>] [--watch] [--poll-interval <ms>] [--json]
nodaro audio mix --audio <url> --audio <url> ... [--volumes <csv>] [--duck-under <index> [--duck-amount <0-100>]] [--watch] [--poll-interval <ms>] [--json]
nodaro audio adjust-volume --audio <url>|--video <url> [--volume <0-200>] [--normalize] [--fade-in <sec>] [--fade-out <sec>] [--watch] [--poll-interval <ms>] [--json]
nodaro audio pitch-tempo --audio <url>|--video <url> [--semitones <-12..12>] [--tempo <0.5-2>] [--no-preserve-formants] [--watch] [--poll-interval <ms>] [--json]
nodaro audio combine --segment <url[@a-b]> --segment ... [--watch] [--poll-interval <ms>] [--json]
nodaro audio transcribe --audio <url> [--provider elevenlabs-stt|incredibly-fast-whisper|whisper] [--language <code>] [--diarize] [--tag-audio-events] [--word-timestamps] [--watch] [--poll-interval <ms>] [--json]
                                                         # speech → text. Three engines: elevenlabs-stt is always word-level and is the lane that
                                                         # honours --diarize / --tag-audio-events; incredibly-fast-whisper returns word timings
                                                         # with --word-timestamps; whisper returns phrase segments only — NO word timings, so
                                                         # --word-timestamps is refused there, before credits. OMITTING --provider still runs the
                                                         # legacy whisper lane, so name an engine whenever you need word timings.
                                                         # The completed job's output_data carries text, words (one per word, in MILLISECONDS)
                                                         # and json (the normalized transcript, also ms); top-level segments (SECONDS) exist only
                                                         # on the legacy lanes — elevenlabs-stt returns none, so read words.
                                                         # Feed output_data.words to `media add-captions --captions-file` for a kinetic render.

# Edit — editorial primitives for podcast / long-form video
nodaro edit silence-detect <audioUrl> [--threshold-db=-35] [--min-silence-ms <ms>] [--pad-ms <ms>] [--watch] [--poll-interval <ms>] [--json]
nodaro edit audio-sync (--source <[id=]url> ... | --sources-file <file.json>) [--reference <id>] [--watch] [--poll-interval <ms>] [--json]
                                                         # 2-6 recordings (audio or video); ids default to source-1, source-2, …
                                                         # output_data.json = { reference, offsets: [{ sourceId, offsetMs, confidence,
                                                         # driftMsPerHour }], notes } with referenceMs = sourceMs + offsetMs.
nodaro edit apply-edl --edl <file.json> [--transcript <file.json>] [--source <url> ...] [--output video|audio] [--quality proxy|final] [--crossfade-ms <ms>] [--clip-key <inMs-outMs>] [--watch] [--poll-interval <ms>] [--json]
                                                         # --quality proxy = a Preview to review (private, lower rate); final = the delivery.
                                                         # --clip-key = "<first inMs>-<last outMs>" of the clips-mode plan clip this render cuts;
                                                         # the result carries it back as output_data.clipKey, beside output_data.quality.
nodaro edit plan --mode tighten|clips|chapters|trailer --plan-tier economy|standard|premium --transcript <file.json> (--source <[id=]url[@audio|@video]> ... | --sources-file <file.json>) [--silence <file.json>] [--offsets <file.json>] [--transcript-source <id>] [--instructions <text>] [--style-guide <text>] [--count <n>] [--target-duration-sec <n>] [--target-aspect 16:9|9:16|1:1|4:5] [--platform <name>] [--watch] [--poll-interval <ms>] [--json]
                                                         # multicam: --offsets = an audio-sync job's output_data.json over the SAME
                                                         # source ids (both commands default to source-1, source-2, …); each source's
                                                         # offset is applied before the request — refused if one was not measured or
                                                         # matched weakly (set its offsetMs in --sources-file).
nodaro edit switch-cameras --edl <file.json> --transcript <file.json> [--speaker-map <file.json>] [--speaker-names <file.json>] [--min-shot-ms <ms>] [--lead-ms <ms>] [--max-shot-ms <ms>] [--wide-every <n>] [--layout-hints] [--watch] [--poll-interval <ms>] [--json]
                                                         # multicam: each cut on the speaker's camera; the transcript needs speaker labels.
                                                         # Multicam end to end: audio transcribe --provider elevenlabs-stt --diarize → edit audio-sync
                                                         # → edit plan --offsets → edit switch-cameras → edit apply-edl --quality proxy (review) → --quality final.
nodaro edit tighten-episode --media <url> [--music <url>] [--output video|audio] [--framing 16:9|9:16|1:1|4:5 [--layout auto|single|side-by-side|stacked|grid|pip]] (--layout only with --framing) [--no-captions] [--review] [--plan-tier economy|standard|premium] [--instructions <text>] [--watch] [--poll-interval <ms>] [--json]
                                                         # Tighten Episode: one recording (video or audio, up to 3 hours) in, the tightened
                                                         # episode out — transcribe, plan, render, plus captions / music / framing as set.
                                                         # Priced as its steps plus a per-run fee (the fees are listed after this block).
                                                         # --review stops at a preview; render its final with edit continue-use-case.
nodaro edit episode-chapters --media <url> [--plan-tier economy|standard|premium] [--instructions <text>] [--style-guide <text>] [--idempotency-key <key>] [--watch] [--poll-interval <ms>] [--json]
                                                         # Chapters: one recording (video or audio, up to 3 hours) in, its chapters out —
                                                         # transcribe, then plan the chapters; nothing is rendered. With --watch the show
                                                         # notes are printed when the run completes: one "0:00 Title" line per chapter.
                                                         # Priced as its steps plus a per-run fee (listed after this block). Not yet enabled on nodaro.ai.
nodaro edit episode-trailer --media <url> [--intro-card <url>] [--formats 9:16,1:1,4:5,16:9] [--review] [--plan-tier economy|standard|premium] [--instructions <text>] [--style-guide <text>] [--idempotency-key <key>] [--watch] [--poll-interval <ms>] [--json]
                                                         # Trailer: one video recording (up to 3 hours) in, a 20–40 second trailer out in each
                                                         # format of --formats (comma-separated; default 9:16,1:1,4:5), padded, never cropped;
                                                         # --intro-card plays a short video (15 s at most) first. With --watch each format's
                                                         # trailer is printed when the run completes ("9:16  <url>" per line), then any format
                                                         # that could not be rendered ("Could not render: 1:1"). --review stops at
                                                         # a preview of the trailer and prints the edit continue-use-case command that renders
                                                         # every format. Priced as its steps plus a per-run fee (listed after this block).
                                                         # Not yet enabled on nodaro.ai.
nodaro edit continue-use-case <jobId> --mode from-failed|render-final [--edit <file.json>] [--type tighten-episode|episode-chapters|episode-trailer] [--idempotency-key <key>] [--watch] [--poll-interval <ms>] [--json]
                                                         # continue a Tighten Episode, Chapters or Trailer run as a new job. from-failed: keep the steps
                                                         # that finished, run the rest (the fee is held again; the failed run's was refunded).
                                                         # render-final (Tighten Episode, Trailer): the full-quality result after a --review preview,
                                                         # with the preview's settings and no fee; --edit = the reviewer's edit of the plan (an EDL).
                                                         # A refusal naming another job prints its code and that job: already_running
                                                         # (follow it), continuation_superseded (continue it instead),
                                                         # render_final_already_rendered (its result is the one to use).
                                                         # With --json that refusal is written to stdout as
                                                         # { "error": { "code", "message" }, "jobId" } (exit 1); other errors as usual.
                                                         # The run is continued on its own type's route: --type names it; without
                                                         # --type the job is read for its type. When it cannot be read (a token
                                                         # without jobs:read, or a job that records no use-case type) nothing is
                                                         # sent: the command exits 1 asking for --type (code use_case_type_unknown).

# Organizations — only on instances that have them
nodaro org list [--json]
nodaro org get <id> [--json]
nodaro org create --name <name> --kind school|team [--slug <slug>] [--accept-terms] [--json]
nodaro org members <orgId> [--limit <n>] [--cursor <token>] [--json]
nodaro org invite <orgId> --email a@x.com --email b@x.com [--role admin|member] [--workspace <id>] [--workspace-role admin|member] [--json]
nodaro org invitations <orgId> [--status open|accepted|revoked|expired] [--limit <n>] [--cursor <token>] [--json]
nodaro org revoke <invitationId> [--json]
nodaro org audit <orgId> [--limit <n>] [--cursor <token>] [--json]
nodaro org usage <orgId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tz <iana>] [--group-by workspace|member|model|day|none] [--workspace <id>] [--user <id>] [--limit <n>] [--cursor <token>] [--csv] [--json]

# Workspaces — where work lands
nodaro workspace list [--json]
nodaro workspace current [--json]
nodaro workspace use <id> [--json]
nodaro workspace clear
nodaro workspace get <id> [--json]
nodaro workspace members <id> [--limit <n>] [--cursor <token>] [--json]
nodaro workspace join <code> [--json]
nodaro workspace usage [id] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tz <iana>] [--group-by member|model|day|none] [--user <id>] [--limit <n>] [--cursor <token>] [--csv] [--json]
```

The podcast use-case commands are priced as their steps at their own rates plus a per-run fee: 11 credits<!-- credits: use-case-fee:tighten-episode --> for `edit tighten-episode`, 11 credits<!-- credits: use-case-fee:episode-chapters --> for `edit episode-chapters`, and 11 credits<!-- credits: use-case-fee:episode-trailer --> for `edit episode-trailer`. A failed run's fee is refunded, and `edit continue-use-case --mode from-failed` holds it again.

### Working in a workspace

Instances with organizations put work inside a **workspace**. A browser shows
the current one on every screen; a terminal shows nothing, so the CLI makes it
explicit.

Three ways to say which workspace a command acts in, each beating the one below
it:

```bash
nodaro --workspace <id> workflows list   # 1. this command only
export NODARO_WORKSPACE=<id>             # 2. this shell, or this CI job
nodaro workspace use <id>                # 3. saved on the profile, until changed
```

`nodaro workspace current` answers "where am I", and names **which** of the
three decided — an inherited `NODARO_WORKSPACE` looks exactly like a saved one
otherwise.

`nodaro workspace use` verifies the workspace before saving it, so a typo fails
once, here, rather than on every later command.

The workspace decides which workspace a **list** reads from and where a
**create** lands. It never decides access: reading, updating, deleting or
running something you name by id is governed by that object's own workspace. So
a forgotten `--workspace` cannot hide your work, and a wrong one cannot reach
anyone else's — it just wastes a command.

With none set, everything happens in your personal space. On an instance
without organizations these commands are simply unavailable, and the header is
never sent.

### Inviting people

`nodaro org invite` is the reason this group exists: bringing a class or a team
onto an instance is a bulk, one-off, scriptable job.

```bash
nodaro org invite org_abc --email ada@school.edu --email grace@school.edu   --workspace ws_xyz --workspace-role member
```

It prints **one line per address**. An install with no mail provider — every
fresh self-host — cannot email anybody, and those rows come back with a link
instead:

```
✓ ada@school.edu — emailed
⚠ grace@school.edu — not emailed (link_only); send this link yourself:
  https://app.example.com/invite/9f3c…
```

Send those links yourself, or the invitation exists and nobody can reach it.

### Usage reports

`nodaro org usage` and `nodaro workspace usage` answer who spent how much on
what, over a date range. The default prints a table with a totals line; `--json`
emits the full report, and `--csv` writes the CSV to stdout so it pipes to a
file. Dates are inclusive `YYYY-MM-DD`; `--tz` defaults to your terminal's zone.

```bash
nodaro org usage org_abc --from 2026-09-01 --to 2026-09-30 --group-by member --csv > september.csv
```

### The interactive recast flow (analyze → recast stems → export)

The one-shot `voice recast` renders a finished video in a single call. The
three-step flow instead lets you inspect the speakers first and mix the result
before rendering:

```bash
# 1. Detect the speakers (prints the list; save output_data for the fast-path)
nodaro voice analyze --video https://.../panel.mp4 --watch --json > analyze.json
jq .output_data analyze.json > analysis.json

# 2. Recast to dry stems, reusing the analysis (no re-detection)
nodaro voice recast --video https://.../panel.mp4 --voices Rachel,keep,Aria \
  --analysis-file analysis.json --output stems --watch

# 3. Set levels/mutes per lane and render (video stream-copied, bit-identical)
nodaro voice export --source https://.../panel.mp4 --tracks-file mix.json \
  --voice-fx hall --voice-fx-mix 25 --watch
```

## Param syntax

Both `--input` (apps) and `--param` (nodes) accept repeated `key=value` pairs with primitive coercion:

```bash
nodaro nodes run generate-image \
  --param prompt="a futuristic city skyline at dusk" \
  --param provider=flux \
  --param resolution=2K \
  --param generateAudio=false
```

- `true` / `false` / `null` → boolean / null
- whole numbers → number
- decimals → number
- everything else → string (`=` is preserved in values, so `query=a=b=c` works)

For arrays, nested objects, or any value that doesn't fit the flag form, use `--params-file body.json`. Flag values override file values for the same key.

Several images in one call (`generate-image` only): `--count <n>` makes 1–4 images, each its own job, and `--models a,b` runs the same request on 2–4 image models instead of `provider` (with `--count`, per model; at most 8 images). The batch is checked against your balance and charged as a whole or not at all. The CLI prints every job id grouped by model and the batch id; `--watch` follows every job until each settles (exit `0` when all completed, `2` when any failed or was cancelled, `3` when the rest completed and some await review), and `--json --watch` prints every final status. The flags win over `count` / `models` in `--param` or `--params-file`. See [API integration § 4g](./api-integration.md#4g-several-images-in-one-call-count-models).

```bash
nodaro nodes run generate-image --param prompt="a lighthouse at dusk" --count 4 --watch
nodaro nodes run generate-image --param prompt="a lighthouse at dusk" --models gpt-image-2,flux-2-max --count 2 --watch
```

Who is in the shot, by catalog id (`subject` on `generate-image`, `text-to-video`): a value that starts with `{` is read as JSON, so the map fits in one `--param`. Field names and ids come from `nodaro pickers get person` (also `styling`, `held-prop`, `material`, `animal`); the platform writes the wording. See [API integration — Structured subject](./api-integration.md#structured-subject-subject).

```bash
nodaro nodes run generate-image --param prompt="on the seawall at dusk" \
  --param subject='{"type":"woman","age":"age-30s","heldProp":"smartphone"}' --watch
```

Input/source nodes run the same way. Meta Ads (`meta-ads-scrape`) pulls public Facebook + Instagram ads from Meta's Ad Library and answers synchronously (the result carries the ad array directly):

```bash
# By keyword
nodaro nodes run meta-ads-scrape \
  --param mode=search --param query="running shoes" --param count=20 --param period=30d

# By advertiser name(s) — resolved to Facebook Pages server-side; use a file for the array
echo '{"mode":"pages","advertiserNames":["Nike","Adidas"],"count":30}' > body.json
nodaro nodes run meta-ads-scrape --params-file body.json
```

Needs `APIFY_API_TOKEN` on the server, or a connected nodaro.ai account (the scrape is relayed and billed there).

Social Search (`social-search`, Nodaro Cloud) searches one platform — TikTok, Instagram, YouTube, X, Reddit, LinkedIn or Meta ads — by keyword or account. It answers with a job id; add `--watch` to wait for the posts (every post found is on the job's `output_data.json`):

```bash
# The 40 most popular TikTok videos about a topic this week
nodaro nodes run social-search   --param platform=tiktok --param query="ai video ad" --param count=40   --param period=week --param sort=popular --watch

# An advertiser's running ads on Meta
nodaro nodes run social-search   --param platform=meta_ads --param mode=account --param query="Brand Name" --watch
```

Video Depth (`video-depth`) turns a clip into a depth video (near is bright, far is dark); add `--watch` to wait for the result's `videoUrl`. See the [node page](nodes/processing-video/video-depth.md) for the providers, levers and length limits:

```bash
nodaro nodes run video-depth --param videoUrl=https://cdn.example.com/clip.mp4 --param colormap=turbo --watch
```

Keep the posts worth coming back to on your inspiration wall: save one from the run's output with a note and tags.

```bash
nodaro jobs get <jobId> --json | jq '.output_data.json' > posts.json
nodaro saved-posts save --file posts.json --index 2 --note "strong opener" --tag hooks
nodaro saved-posts list --tag hooks
```

## Output formatting

Every read command supports `--json` for machine-readable output:

```bash
nodaro projects list --json | jq '.[].id'
nodaro workflows run wf_abc --json
```

Without `--json` the output is a small ASCII table for `list` commands and a pretty-printed JSON block for `get` commands.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unauthorized / not found / argument error / network error |
| 2 | `--watch` finished and the execution ended in `failed` |
| 3 | `--watch` stopped because the job entered `pending_review` — a human decision is pending, not a failure |
| 130 | `--watch` finished and the execution ended in `cancelled` |

`--json` prints the payload and returns instead of setting 2 / 3 / 130 —
branch on `.status` in that mode.

**Exit 3 — a job held for review.** On a deployment that registers a job
policy, a job can enter `pending_review`: the work is done, the credits stay
reserved, and a human is deciding whether the result is released. That status
is in-flight but does not move on its own, so `--watch` stops on it, prints
`awaiting review (a human decision is pending; not a failure)`, and exits 3
rather than polling until you kill the process. **Do not re-run the request** —
a duplicate would be held too. Check back with `nodaro jobs get <id>`: it
resolves to `completed` (approved), `failed` (rejected — `error_hint.kind` is
`policy-block` and `error_hint.reason` is the text to show) or `cancelled`.

```bash
nodaro nodes run generate-image --param prompt="…" --watch
case $? in
  0) echo "released" ;;
  3) echo "awaiting review — check back later" ;;
  *) echo "failed" ;;
esac
```

## Examples

### Run a workflow nightly with cron

```cron
0 3 * * * /usr/local/bin/nodaro workflows run wf_abc123 --json >> /var/log/nodaro-nightly.log 2>&1
```

### Wait for completion and gate downstream work

```bash
nodaro workflows run wf_abc --watch && \
  echo "shipped" | mail -s "nodaro run done" me@example.com
```

### Generate an image from a single command

```bash
nodaro nodes run generate-image \
  --param prompt="a snow leopard on a mountain ridge, cinematic" \
  --param provider=flux \
  --param resolution=2K \
  --watch --json | jq -r '.output_data.imageUrl'
```

### Transcribe a track, then burn its words in as kinetic captions

```bash
# 1. word-level transcription (elevenlabs-stt is always word-level)
nodaro audio transcribe --audio https://example.com/talk.mp3 \
  --provider elevenlabs-stt --watch

# 2. take the words (MILLISECONDS; the top-level segments are in seconds)
nodaro jobs get <jobId> --json | jq '.output_data.words' > words.json

# 3. burn them in — supplying captions means add-captions runs no STT of its own
nodaro media add-captions https://example.com/talk.mp4 \
  --captions-file words.json \
  --style word-highlight --no-auto-transcribe --watch
```

Correct a word's `text` in `words.json` between steps 2 and 3 and the correction
is what burns in. Add `--max-words-per-line 2` to step 3 for the punchy
two-words-at-a-time read — it caps each held line on top of the frame-width
budget. Step 1 needs a word-capable engine (`elevenlabs-stt` or
`incredibly-fast-whisper`); `--provider whisper` returns phrase segments with no
words, so there would be nothing to feed a kinetic style.

### Wrap an app's prompt with hidden text for one run

```bash
nodaro apps run hair-styler-dd3erw --input prompt="curly red hair" \
  --override n1.promptPrefix="Studio portrait of" --override n1.promptSuffix=", 85mm, soft light"
```

See [Prompt pre & post text](./prompt-pre-post-text.md).

### Turn a rough idea into an optimized prompt

```bash
# one-shot enhance, then feed straight into a node run
PROMPT=$(nodaro prompt enhance \
  --node-type generate-image \
  --prompt "snow leopard" \
  --json | jq -r '.prompt')

nodaro nodes run generate-image --param prompt="$PROMPT" --watch
```

Need the wizard's guided questions in a script? Use the two-step path —
`prompt analyze --json` to fetch the questions, then `prompt generate
--selection category=value …` to build the final prompt (the interactive
`prompt wizard` requires a terminal).

## Programmatic alternative

If you're building integrations, prefer the typed SDK directly:

```bash
npm install @nodaro/sdk
```

```ts
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const nodaro = createClient({
  baseUrl: "https://app.nodaro.ai",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const exec = await nodaro.workflows.run("wf_abc")
```

The CLI is a thin convenience wrapper around `@nodaro/sdk`. Anything the CLI does, the SDK does too.

## See also

- [SDK Quickstart](./sdk-quickstart.md) — the typed REST client the CLI wraps
- [SDK Reference](./sdk-reference.md) — method-by-method index
- [API Integration](./api-integration.md) — raw REST endpoints
- [OAuth Flow](./oauth-flow.md) — building third-party developer apps
