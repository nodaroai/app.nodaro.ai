# CLI

`@nodaro/cli` is a terminal client for Nodaro. Same surface area as the SDK — list and run workflows, run apps, run a single node directly, watch executions until they finish — wrapped in a small `commander` binary with multi-profile auth, JSON output for scripts, and `--watch` mode for interactive runs.

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
nodaro auth login                                   # interactive
nodaro auth login --token "$NODARO_TOKEN"           # non-interactive
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
nodaro auth login [--profile <name>] [--token <token>] [--base-url <url>]
nodaro auth status [--profile <name>] [--json]
nodaro auth logout [--profile <name>]

# Projects
nodaro projects list [--json]
nodaro projects get <id> [--json]

# Workflows
nodaro workflows list --project <projectId> [--json]
nodaro workflows get <id>
nodaro workflows run <id> [--watch] [--node n1 n2 ...] [--json]

# Apps — workflows wrapped in a curated UI
nodaro apps list [--search <query>] [--limit 20] [--cursor <token>] [--category <slug>]
nodaro apps get <slug>                                  # show input schema + outputs
nodaro apps run <slug> --input prompt="…" [--watch]
nodaro apps run <slug> --params-file inputs.json [--watch]
nodaro apps runs <slug>                                 # list past runs
nodaro apps run-get <slug> <runId>

# Nodes — list types + run a single node directly
nodaro nodes list [--category ai|processing|input|...]
nodaro nodes get <type>                                 # full input schema
nodaro nodes run <type> --param prompt="…" --param provider=flux [--watch]
nodaro nodes run <type> --params-file body.json [--watch] [--poll-interval 1000]

# Executions
nodaro executions get <id> [--watch] [--json]
nodaro executions cancel <id> [--mode cancelled|stopping]

# Jobs
nodaro jobs get <id>
nodaro jobs cancel <id>
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
  --watch --json | jq -r '.outputs.imageUrl'
```

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
