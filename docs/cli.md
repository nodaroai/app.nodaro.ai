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

```bash
# macOS Apple Silicon
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-darwin-arm64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# macOS Intel
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-darwin-x64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# Linux x86_64
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-linux-x64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# Linux ARM64
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-linux-arm64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro
```

Windows: download `nodaro-windows-x64.exe` from the [releases page](https://github.com/nodaroai/app.nodaro.ai/releases) and rename to `nodaro.exe`.

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

The `nodes run` path is the SDK / CLI equivalent of the MCP server's verb tools (`generate_image`, `generate_video`, etc.) — the route convention is `POST /v1/<type>` for every generation node, so any node listed by `nodaro nodes list` can be invoked with `nodaro nodes run`.

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

# Workflows
nodaro workflows list --project <projectId> [--json]
nodaro workflows get <id> [--json]
nodaro workflows create --project <projectId> --name <name> [--file bundle.json] [--json]
nodaro workflows update <id> [--name <name>] [--file nodes-edges.json] [--json]
nodaro workflows delete <id> [--json]
nodaro workflows export <id> [--with-assets] [--output bundle.json]
nodaro workflows import <file> --project <projectId> [--json]
nodaro workflows run <id> [--watch] [--node n1 n2 ...] [--json]

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

# Prompt — AI wizard that turns a rough idea into an optimized prompt
nodaro prompt wizard [--node-type <type>] [--prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>]   # interactive Q&A; node picker if --node-type omitted
nodaro prompt analyze --node-type <type> [--prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--json]   # return guided questions
nodaro prompt generate --node-type <type> --selection category=value [--selection ...] [--original-prompt "…"] [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--json]   # build a prompt from selections
nodaro prompt enhance --node-type <type> --prompt "…" [--provider <name>] [--style <name>] [--aspect-ratio <ratio>] [--duration <seconds>] [--llm-model <id>] [--json]   # one-shot rewrite, no questions

# Executions
nodaro executions get <id> [--watch] [--json]
nodaro executions cancel <id> [--mode cancelled|stopping]

# Jobs
nodaro jobs get <id> [--json]
nodaro jobs cancel <id> [--json]

# Characters — full lifecycle + studio operations
nodaro characters list [--project <id>] [--archived] [--limit <n>] [--json]
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

# Locations — full lifecycle + studio operations
nodaro locations list [--archived] [--json]
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
nodaro objects list [--project <id>] [--archived] [--json]
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
nodaro voice changer --voice <id> --audio <url>|--video <url> [--stability <0..1>] [--similarity <0..1>] [--style <0..1>] [--remove-background-noise] [--watch] [--poll-interval <ms>] [--json]
nodaro voice change ...                                  # alias of `voice changer`
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
| 130 | `--watch` finished and the execution ended in `cancelled` |

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
npm install @nodaro/client
```

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const nodaro = createClient({
  baseUrl: "https://app.nodaro.ai",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const exec = await nodaro.workflows.run("wf_abc")
```

The CLI is a thin convenience wrapper around `@nodaro/client`. Anything the CLI does, the SDK does too.

## See also

- [SDK Quickstart](./sdk-quickstart.md) — the typed REST client the CLI wraps
- [SDK Reference](./sdk-reference.md) — method-by-method index
- [API Integration](./api-integration.md) — raw REST endpoints
- [OAuth Flow](./oauth-flow.md) — building third-party developer apps
