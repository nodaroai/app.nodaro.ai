# Disposable CI runners

This pool runs Linux Node test jobs on Railway. Docker jobs, database services,
migrations and publishing remain on GitHub-hosted runners.

## Deployment

Use a dedicated Railway environment with no application secrets or databases.
Deploy this directory with `--path-as-root` and the appropriate Dockerfile:

| Service | Dockerfile | Replicas | Restart policy | Limits |
| --- | --- | --- | --- | --- |
| Each runner slot | `runner.Dockerfile` | 1 | `NEVER` | 2 vCPU, 8 GB |
| Controller | `controller.Dockerfile` | exactly 1 | `ALWAYS` | 1 vCPU, 1 GB |

No service needs a public domain, persistent volume or sleeping mode. Build each
runner slot once before starting the controller. Without an assignment, the
runner image exits successfully. The controller redeploys the built image when
work is queued. Do not attach slots to automatic Git deploys: rebuilding a busy
slot would interrupt its job. Drain the pool before updating its image.

The controller requires these environment variables:

| Variable | Value |
| --- | --- |
| `CI_REPOSITORY` | Private `owner/repository` |
| `CI_RUNNER_SERVICES` | Comma-separated runner service IDs, maximum twenty |
| `CI_GITHUB_TOKEN` | Fine-grained token for only that repository, Administration read/write and Actions read |
| `CI_RAILWAY_TOKEN` | Railway project token scoped to only the CI environment |

Railway supplies `RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID` automatically.
Store administrative tokens on the controller service only, never as shared
environment variables. Rotate expiring credentials before their expiry. The
controller logs API failures without response bodies or credential values.

## Job isolation and lifecycle

The controller checks queued GitHub jobs every 30 seconds and provisions only
jobs whose source repository matches `CI_REPOSITORY`. Slots receive a GitHub
single-use JIT configuration for labels `self-hosted,linux,x64,nodaro-ci`.
GitHub removes each runner after its first job. Every subsequent job gets a new
Railway deployment and filesystem; slots must never restart the same container.
The runner exits after five minutes without an assignment or one hour overall.
Vitest uses two workers because the host CPU count can exceed the container's
CPU allocation.

The image includes `zstd` to read the same npm download-cache format as hosted
runners. Hosted preparation maintains that cache; disposable test runners
restore it without uploading another copy. A missing cache falls back to a
normal clean dependency download and installation.

Busy slots are protected by both runner state and in-progress job state. An API
failure stops that scheduling cycle. Capacity is bounded by the configured slot
list. Keep exactly one controller replica to prevent competing schedulers.

For a rollout, retain GitHub-hosted routing until an identical-commit benchmark
and an intentional failed-job probe pass. Set repository variable
`CI_RAILWAY_PILOT_BRANCH` to a same-repository PR branch for a limited pilot.
After validating capacity and unattended scheduling, set `CI_RAILWAY_ENABLED`
to `true` to route the two test suites for trusted PRs and pushes to `main`.
Public mirrors and fork PRs always stay hosted. Both settings default to off.

To return to hosted runners, clear both `CI_RAILWAY_ENABLED` and
`CI_RAILWAY_PILOT_BRANCH`, cancel queued pool runs, and rerun them. Allow busy jobs to finish before removing
their runner deployments. A controller outage must leave checks pending or
failed; never turn a missing test into a successful check.

Validate scheduling and preparation locally with:

```sh
node --test tools/__tests__/ci-runner-*.test.mjs tools/__tests__/ci-build-artifact.test.mjs tools/__tests__/ci-preparation-gates.test.mjs
```

## Capacity experiment

`.github/workflows/ci-capacity-experiment.yml` measures the full frontend and
backend vitest suites (no test selection, no coverage, no reuse of earlier
results) under a chosen runner, worker count and shard count. It runs only
when a branch named `ci-experiment/<name>` is pushed (and, once the workflow is
on the default branch, from the Actions tab via `workflow_dispatch`). It is
never a required check and its job names (`Capacity …`) do not collide with
ci.yml's.

To launch one, branch from the revision to measure, edit
`tools/ci-experiment.json`, commit and push `ci-experiment/<name>`. Use a new
branch name per experiment: a second push to the same branch cancels the
run in progress.

| Field | Meaning | Default |
| --- | --- | --- |
| `runsOn` | A runner label, or an array of labels, for every cell | `"ubuntu-latest"` |
| `workers` | `VITEST_MAX_WORKERS` for every cell, or `"auto"` to leave vitest's own default | `"auto"` |
| `shards` | Vitest `--shard` count per project; each shard is its own job | `1` |
| `projects` | Any of `"frontend"`, `"backend"` | both |
| `repeat` | How many times each shard runs (concurrently, on separate runners) | `1` |
| `maxCells` | Cost cap: the plan refuses a run with more cells than this (at most 256) | `32` |
| `maxParallel` | Most cells holding a runner at the same time | `4` |

A run has `projects × shards × repeat` cells. Every cell is a separately billed
runner for its whole setup (checkout, ffmpeg, `npm ci`, package build — a few
minutes) plus its test time, so a run costs roughly cells × (setup + shard
wall). Beyond 32 cells the configuration must raise `maxCells` explicitly.
Instances of the same size have been measured 2-3x apart (see Backend Tests in
ci.yml), so compare configurations with `repeat` of at least 2. Repeats run
concurrently (up to `maxParallel`), so contention between them on a shared host
is part of the spread they show.

- `["self-hosted", "linux", "x64", "nodaro-ci"]` selects this Railway pool, at
  whatever size its slots are currently provisioned (see Deployment). The pool
  runs at most one cell per slot at a time, and an experiment competes with
  real PR CI for those slots: keep `maxParallel` well below the slot count, or
  run it when CI is quiet.
- A GitHub larger runner, or a resized pool, must be provisioned by the owner
  before an experiment can name it; a label nothing serves leaves the cells
  queued.
- On this pool, use an integer `workers`. The image sets `VITEST_MAX_WORKERS=2`
  and `"auto"` removes it, after which vitest sizes its workers from the host's
  core count, not the container's allocation, and oversubscribes the slot.

Each cell measures only `vitest run` (wall clock, user+sys CPU of vitest and
its workers, peak memory sampled once a second, and vitest's own phase
breakdown), and times checkout + install + package build as setup. It uploads
a `capacity-cell-*` artifact. The `Capacity Summary` job writes a table to the
run summary, per project: median shard wall, critical path (the slowest shard
of each repeat), runner-seconds (shards summed, with and without setup), and
any failed cell (a setup failure is reported as one) or missing cell. Cells
record their run id and attempt, and repeats are keyed by them, so the same
table can be built across several runs: download their `capacity-cell-*`
artifacts (named with the run id) into one folder and run
`node tools/ci-experiment-plan.mjs summary <folder>`; each run counts as its
own repeat.

Validate the plan and summary logic locally with:

```sh
node --test tools/__tests__/ci-experiment-plan.test.mjs
```
