# Nodaro License Overview

Nodaro is fair-code: source-available with use-based restrictions. There are **four license tiers** in this repository.

## Community code (default)

All files **outside** the patterns listed below are licensed under the **Nodaro Sustainable Use License** in [`LICENSE`](./LICENSE) at the repository root.

- Free self-hosting for: personal projects; development, testing, and evaluation at any company size; and internal business use by organizations of up to 3 people (founders, employees, and contractors all count — see FAQ).
- Organizations of 4+ people need a commercial license for production use: license@nodaro.ai.
- You may NOT offer it as a hosted, managed, or SaaS service to third parties — at any company size, whether free or paid.
- You may NOT use it as a component in products you sell or distribute to third parties without a separate commercial license.

## Enterprise code (`ee/`)

Files in either of the following patterns are licensed under the **Nodaro Enterprise License** in [`backend/src/ee/LICENSE`](./backend/src/ee/LICENSE) — a self-contained license requiring a paid Nodaro Enterprise subscription to use Enterprise features in production:

1. Any file in a directory whose path contains a segment named `ee` or ending with `.ee` (e.g., `backend/src/ee/`, `frontend/src/ee/`).
2. Any file whose name contains the substring `.ee.` (e.g., `cost-tab.ee.tsx`, `094_admin_audit.ee.sql`).
3. Any compiled artifact derived from the above.

You may read, modify, and run enterprise code locally for development and testing without a subscription. Using Enterprise features in production requires a valid Nodaro Cloud or Nodaro Enterprise subscription. Enterprise code that remains dormant — no license key installed, no Enterprise features enabled — does not require a subscription (see "Combined builds" below).

## Prompt layer (`packages/prompts/` — Functional Source License)

The npm package [`@nodaro/prompts`](./packages/prompts/) carries Nodaro's
prompt-engineering content (picker catalogs with hints, prompt builders,
doctrine, presets) under the **Functional Source License,
FSL-1.1-Apache-2.0** ([full text](./packages/prompts/LICENSE)): free for any
non-competing use — including embedding in commercial applications built
against the Nodaro platform — but not licensed for use in competing products
or services. Each version additionally becomes Apache-2.0 two years after
its release.

## Published SDK packages (Apache License 2.0)

The npm packages under `packages/client/`, `packages/shared/`, and `packages/cli/` are published to npm under the **Apache License 2.0**, not the Nodaro Sustainable Use License. This is intentional: the SDK and CLI are meant to be embedded in or invoked from third-party commercial applications consuming a Nodaro instance via its `/v1/` REST API.

The Apache 2.0 grant applies ONLY to:

- [`packages/client/`](./packages/client/) — `@nodaro/sdk` (typed REST client)
- [`packages/shared/`](./packages/shared/) — `@nodaro/shared` (types, model catalog, wire contracts, structural vocabularies)
- [`packages/cli/`](./packages/cli/) — `@nodaro/cli` (terminal CLI consuming `@nodaro/sdk`)

Their full text lives in [`packages/client/LICENSE`](./packages/client/LICENSE), [`packages/shared/LICENSE`](./packages/shared/LICENSE), and [`packages/cli/LICENSE`](./packages/cli/LICENSE).

The rest of the repository — backend, frontend, `packages/remotion/`, scripts, infrastructure — remains under the root `LICENSE` (Nodaro Sustainable Use License) plus the `ee/LICENSE` (Enterprise License) where applicable.

## Combined builds

When the resulting binary, container image, or distribution includes files from multiple tiers:

- **Community + ee/**: the artifact as a whole is governed by `ee/LICENSE`, which permits production use while the Enterprise code stays dormant — no license key installed, no Enterprise features enabled. The community-code license terms continue to govern the community files in source form.
- **Apache 2.0 SDK packages**: when distributed independently as npm packages (`@nodaro/sdk`, `@nodaro/shared`), they retain Apache 2.0 terms regardless of how they are used downstream.

## FAQ

### Q: Can I run the official build / Docker image in production without any subscription?

Yes — provided you qualify under the Community license (organization of up to 3 people, no hosted service to third parties) and you do not install an Enterprise license key or enable any Enterprise features. Dormant Enterprise code inside the build does not require a subscription.

### Q: How do you count "3 people"?

Total headcount of your organization — founders, employees, and contractors, full-time or part-time, across all affiliated entities — regardless of how many of them actually use Nodaro. Clients who only receive the videos, images, or audio you produce do not count.

### Q: We're more than 3 people. Can we self-host at all?

For development, testing, and evaluation — yes, free, at any size, as long as the environment doesn't process production data, serve end users, or support a live business workflow. Production use requires a commercial license: license@nodaro.ai.

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

### Q: Can I use Nodaro to create content for a product or business I run?

Yes. Creating and selling content (videos, images, audio) made with Nodaro is permitted at any commercial scale, subject to the Community license limits (organization size, no hosted service). What you sell is your content, not Nodaro.

### Q: Can I embed Nodaro itself in a product I sell, or offer its features to my users?

No, not under the Community license. Offering Nodaro's features to your own users — embedded, white-labeled, or hosted — requires a commercial license. Contact license@nodaro.ai.

### Q: I want to publish Nodaro outputs (videos, images, audio) commercially. Can I?

Yes — the outputs you generate through the Platform are yours. The license restrictions apply to the Software, not to the content you create with it. See `https://nodaro.ai/terms` for details on output ownership.

### Q: Is the SDK Apache 2.0 grant defensive against my downstream commercial use?

Yes — Apache 2.0 explicitly permits commercial use, modification, and redistribution. Embed `@nodaro/sdk` and `@nodaro/shared` in your products freely. The SDK does not require you to disclose source or open-source your own code.

### Q: Does the Nodaro license cover third-party components like Remotion?

No. Third-party components keep their own licenses. In particular, `packages/remotion/` builds on Remotion, which has its own company license — free for individuals and companies of up to 3 employees, paid above that. Self-hosters are responsible for their own compliance with third-party licenses.

## Branches

Only the contents of the `main` branch of github.com/nodaroai/app.nodaro.ai are governed by these licenses. Content of other branches (e.g., `dev`, feature branches) is provided for reference and development purposes only.

## Contributing

By submitting a contribution you agree to the Nodaro [Contributor License Agreement](./CLA.md). The same CLA covers individual and corporate contributions — Section 2 handles employer permission. The cla-assistant bot will automatically prompt you on your first pull request.

## Commercial licensing

For Nodaro Cloud or Enterprise subscriptions, or a commercial license for organizations of more than 3 people, contact license@nodaro.ai.

---

*License model inspired by n8n's fair-code model, Remotion's company license, and PostHog's hybrid CE/EE approach. Last updated: 2026-07-05.*
