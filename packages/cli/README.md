# @nodaro/cli

Command-line interface for [Nodaro](https://nodaro.ai) — list and run workflows, inspect jobs and executions, and manage projects from the terminal.

```bash
npm install -g @nodaro/cli
nodaro auth login --profile production
nodaro projects list
nodaro workflows run <workflowId> --watch
```

## Install

### Option A — npm (cross-platform, requires Node)

```bash
npm install -g @nodaro/cli
# or run a one-off without installing:
npx @nodaro/cli --help
```

Requires Node.js ≥ 20.

### Option B — standalone binary (no Node required, ~10ms cold start)

Download a pre-built binary from the [Releases page](https://github.com/nodaroai/app.nodaro.ai/releases?q=cli-v):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-darwin-arm64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# macOS (Intel)
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-darwin-x64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# Linux (x86_64)
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-linux-x64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# Linux (ARM64)
curl -L https://github.com/nodaroai/app.nodaro.ai/releases/latest/download/nodaro-linux-arm64 \
  -o /usr/local/bin/nodaro && chmod +x /usr/local/bin/nodaro

# Windows (x86_64) — download nodaro-windows-x64.exe and rename to nodaro.exe
```

Binaries are ~60 MB single-file executables compiled with [`bun build --compile`](https://bun.com/docs/bundler/executables) — no dependencies, no Node runtime needed. Cold-start is ~15× faster than the npm version.

## Authentication

Generate an API token at `https://app.nodaro.ai/settings/api`, then save it:

```bash
nodaro auth login                                   # interactive prompt
nodaro auth login --token "$NODARO_TOKEN"           # non-interactive
nodaro auth login --profile staging --base-url https://next.nodaro.ai
```

The token is stored at `~/.config/nodaro/config.json` with `chmod 0600`. Override the location with `NODARO_CONFIG_DIR`.

```bash
nodaro auth status         # show current profile (token masked)
nodaro auth logout         # delete the saved profile
```

### Profiles

Switch between staging / prod / local instances with `--profile`:

```bash
nodaro auth login --profile prod    --base-url https://api.nodaro.ai
nodaro auth login --profile staging --base-url https://next.nodaro.ai
nodaro auth login --profile local   --base-url http://localhost:8000

nodaro projects list --profile staging
```

## Commands

```bash
nodaro projects list
nodaro projects get <id>

nodaro workflows list --project <projectId>
nodaro workflows get <id>
nodaro workflows create --project <projectId> --name <name> [--file bundle.json]
nodaro workflows update <id> [--name <name>] [--file nodes-edges.json]
nodaro workflows delete <id>
nodaro workflows export <id> [--with-assets] [--output bundle.json]   # → stdout if no --output
nodaro workflows import <file> --project <projectId>
nodaro workflows run <id>                # prints execution id, returns immediately
nodaro workflows run <id> --watch        # follow until completed/failed/cancelled
nodaro workflows run <id> --node n1 n2   # run only specific nodes

# Apps — workflows wrapped in a curated UI (the things at app.nodaro.ai/app/<slug>)
nodaro apps list [--search <query>] [--limit 20] [--cursor <token>] [--category <slug>]
nodaro apps get <slug>                                  # show input schema + outputs
nodaro apps run <slug> --input prompt="…" --input duration=8 [--watch]
nodaro apps run <slug> --params-file inputs.json [--watch]
nodaro apps runs <slug>                                 # list past runs
nodaro apps run-get <slug> <runId>

# Nodes — list types + run a single node directly (no workflow, no DAG)
nodaro nodes list [--category ai|processing|input|...]
nodaro nodes get <type>                                 # full input schema
nodaro nodes run <type> --param prompt="…" --param provider=flux [--watch]
nodaro nodes run <type> --params-file body.json [--watch] [--poll-interval 1000]

nodaro executions get <id>
nodaro executions get <id> --watch
nodaro executions cancel <id> [--mode cancelled|stopping]

nodaro jobs get <id>
nodaro jobs cancel <id>
```

### Three ways to run something

| Want | Command |
|---|---|
| Run a saved DAG | `nodaro workflows run <workflowId>` |
| Run a published app (with curated inputs/outputs) | `nodaro apps run <slug> --input k=v` |
| Run a single node directly (one-shot, no DAG) | `nodaro nodes run <type> --param k=v` |

The `nodes run` path is the SDK / CLI equivalent of the MCP server's verb tools (`generate_image`, `generate_video`, etc.) — the route convention is `POST /v1/<type>` for every generation node, so any node listed by `nodaro nodes list` can be invoked with `nodaro nodes run`.

### Param syntax

Both `--input` (apps) and `--param` (nodes) accept repeated `key=value` pairs with primitive coercion:

```bash
nodaro nodes run generate-image \
  --param prompt="a futuristic city skyline at dusk" \
  --param provider=flux \
  --param resolution=2K \
  --param generateAudio=false
```

- `true`/`false`/`null` → boolean / null
- whole numbers → number
- decimals → number
- everything else → string (preserves `=` in values, so `query=a=b=c` works)

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

### Run a workflow nightly with `cron`

```cron
0 3 * * * /usr/local/bin/nodaro workflows run wf_abc123 --json >> /var/log/nodaro-nightly.log 2>&1
```

### Wait for completion and gate downstream work

```bash
nodaro workflows run wf_abc --watch && \
  echo "shipped" | mail -s "nodaro run done" me@example.com
```

### List all running executions across projects

```bash
nodaro projects list --json | jq -r '.[].id' | while read pid; do
  nodaro workflows list --project "$pid" --json | jq -r '.[] | .id'
done
# (then call nodaro executions get on each)
```

## Programmatic alternative

If you're building integrations, prefer the typed SDK directly:

```bash
npm install @nodaro/client
```

```ts
import { createClient, StaticTokenAuth } from "@nodaro/client"

const nodaro = createClient({
  baseUrl: "https://api.nodaro.ai",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const exec = await nodaro.workflows.run("wf_abc")
```

The CLI is a thin convenience wrapper around `@nodaro/client`. Anything the CLI does, the SDK does too.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
