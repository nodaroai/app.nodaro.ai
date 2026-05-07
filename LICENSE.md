# Nodaro License Overview

Nodaro is fair-code: source-available with use-based restrictions. There are **three license tiers** in this repository.

## Community code (default)

All files **outside** the patterns listed below are licensed under the **Nodaro Sustainable Use License** in [`LICENSE`](./LICENSE) at the repository root.

- You may use, modify, and self-host this code for personal projects, internal business purposes, development, testing, and evaluation.
- You may NOT offer it as a commercial hosted, managed, or SaaS service to third parties.
- You may NOT use it as a component in products you sell or distribute to third parties without a separate commercial license.

## Enterprise code (`ee/`)

Files in either of the following patterns are licensed under the **Nodaro Enterprise License** in [`backend/src/ee/LICENSE`](./backend/src/ee/LICENSE) — a self-contained license requiring a paid Nodaro Enterprise subscription for production use:

1. Any file in a directory whose path contains a segment named `ee` or ending with `.ee` (e.g., `backend/src/ee/`, `frontend/src/ee/`).
2. Any file whose name contains the substring `.ee.` (e.g., `cost-tab.ee.tsx`, `094_admin_audit.ee.sql`).
3. Any compiled artifact derived from the above.

You may read, modify, and run enterprise code locally for development and testing without a subscription. Production deployment requires a valid Nodaro Cloud or Nodaro Enterprise subscription.

## Published SDK packages (Apache License 2.0)

The npm packages under `packages/client/` and `packages/shared/` are published to npm under the **Apache License 2.0**, not the Sustainable Use License. This is intentional: the SDK is meant to be embedded in third-party commercial applications consuming a Nodaro instance via its `/v1/` REST API.

The Apache 2.0 grant applies ONLY to:
- [`packages/client/`](./packages/client/) — `@nodaro/client` (typed REST client)
- [`packages/shared/`](./packages/shared/) — `@nodaro/shared` (types, model registries, prompt helpers)

Their full text lives in [`packages/client/LICENSE`](./packages/client/LICENSE) and [`packages/shared/LICENSE`](./packages/shared/LICENSE).

The rest of the repository — backend, frontend, `packages/remotion/`, scripts, infrastructure — remains under the root `LICENSE` (Sustainable Use License) plus the `ee/LICENSE` (Enterprise License) where applicable.

## Combined builds

When the resulting binary, container image, or distribution includes files from multiple tiers:

- **Community + ee/**: the binary as a whole is governed by `ee/LICENSE`. The community-code license terms continue to govern the community files in source form.
- **Apache 2.0 SDK packages**: when distributed independently as npm packages (`@nodaro/client`, `@nodaro/shared`), they retain Apache 2.0 terms regardless of how they are used downstream.

## FAQ

### Q: If I compile a binary with both community and enterprise code, which license applies?

The binary as a whole is governed by the Enterprise License. However:
- The source files retain their original licenses (community files stay under `LICENSE`).
- If you distribute only the source code (not a compiled binary), the community files remain under `LICENSE`.
- The Apache 2.0 SDK packages retain Apache 2.0 when consumed via `npm install`.

### Q: How long can I use the Enterprise Code for "development and testing" without a subscription?

The development and testing exception is not time-limited, but it is scope-limited. Per the Enterprise License, "development and testing purposes" means non-production use for evaluating, debugging, contributing to, or building against the Enterprise Software, and **excludes** any use that:

- processes production data,
- serves end users (whether internal or external), or
- otherwise supports a live business workflow.

If your environment does any of those, it is production and requires a subscription.

### Q: Can I use Nodaro to build a SaaS product I plan to sell?

No, not under the Community license. The "internal business purposes" permission does NOT extend to building products you distribute to third parties. Contact license@nodaro.ai for a commercial license.

### Q: I want to publish Nodaro outputs (videos, images, audio) commercially. Can I?

Yes — the outputs you generate through the Platform are yours. The license restrictions apply to the Software, not to the content you create with it. See `https://nodaro.ai/terms` for details on output ownership.

### Q: Is the SDK Apache 2.0 grant defensive against my downstream commercial use?

Yes — Apache 2.0 explicitly permits commercial use, modification, and redistribution. Embed `@nodaro/client` and `@nodaro/shared` in your products freely. The SDK does not require you to disclose source or open-source your own code.

## Branches

Only the contents of the `main` branch of github.com/nodaroai/app.nodaro.ai are governed by these licenses. Code on `dev`, feature branches, forks before merge, or any other branch is provided AS-IS without any license grant — do not redistribute or build upon it.

## Contributing

By submitting a contribution you agree to the Nodaro [Contributor License Agreement](./CLA.md). The same CLA covers individual and corporate contributions — Section 2 handles employer permission. The cla-assistant bot will automatically prompt you on your first pull request.

## Commercial licensing

For Nodaro Cloud or Enterprise subscriptions, contact license@nodaro.ai.

---

*License model inspired by n8n's FairCode and PostHog's hybrid OSS/EE approach. Last updated: 2026-05-05.*
