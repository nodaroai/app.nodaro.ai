# @nodaro/cli

Command-line interface for [Nodaro](https://nodaro.ai) — list and run workflows, inspect jobs and executions, and manage projects from the terminal.

```bash
npm install -g @nodaro/cli
nodaro auth login --profile production
nodaro projects list
nodaro workflows run <workflowId> --watch
```

## Install

```bash
npm install -g @nodaro/cli
# or run a one-off without installing:
npx @nodaro/cli --help
```

Requires Node.js ≥ 20.

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
nodaro workflows run <id>                # prints execution id, returns immediately
nodaro workflows run <id> --watch        # follow until completed/failed/cancelled
nodaro workflows run <id> --node n1 n2   # run only specific nodes

nodaro executions get <id>
nodaro executions get <id> --watch
nodaro executions cancel <id> [--mode cancelled|stopping]

nodaro jobs get <id>
nodaro jobs cancel <id>
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
