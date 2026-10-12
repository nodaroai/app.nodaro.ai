---
description: Check a feature (or every feature) for completeness across the API, OpenAPI, SDK, CLI, MCP and docs, then review what the script can't judge
argument-hint: "<feature… | node:<type> | --category <c> | --all>"
---

# /surface-check

Check `$ARGUMENTS` for completeness across every public surface: the API route, its OpenAPI entry, the SDK method and its `docs/sdk-reference.md` entry, the CLI command and its `docs/cli.md` entry, the MCP tool and its `docs/mcp/tools.md` entry, the REST docs and, for nodes, the node docs pages.

When `$ARGUMENTS` is empty, ask which feature to check, and offer `--all` as the first choice.

## 1. Run the checker

```bash
npm run build:packages        # once per checkout, so @nodaro/shared and @nodaro/prompts resolve
npm run check:surfaces -- $ARGUMENTS --json > /tmp/surface-check.json
npm run check:surfaces -- $ARGUMENTS            # the readable table
```

- A feature is an SDK resource (`characters`, `workflows.collaborators`), a node (`node:generate-image`, or `--category ai-video`), or a route family no SDK resource claims (`route:<segment>`). `--all` prints one summary line per feature, ranked by gaps.
- Cells: `✓ file:line` present, `✗` missing, `n/a(<reason>)` not applicable (admin, internal, plugin-served, local-only, or listed in `backend/scripts/check-surfaces.exemptions.ts`), `·` report-only (OpenAPI is a curated subset, so it never counts as a gap).
- Exit 0 is a report. `--strict` exits 1 on any gap or stale exemption. Exit 2 is a usage error or an extractor crash: report it and stop.
- The default route source is a static scan of `backend/src/routes` and `backend/src/ee/routes`. When a route looks missing but you believe it exists, re-run with `--runtime` (it boots the app and records the exact route set for the edition) before calling it a gap.

Show the table (for `--all`, the summary lines with gaps) before going further.

## 2. Review what the script can't judge

For each feature with a gap or a doc to check (for `--all`, the ten with the most gaps unless asked for more), start one reviewer agent per feature, in parallel, with `model: "opus"` passed explicitly. Give each agent its feature's rows from `/tmp/surface-check.json` and these lenses:

1. **Real gap or intended?** For every `✗`, read the code and decide: a real gap (say what is missing and where it belongs), or intentionally absent (propose an exemption with a one-line reason saying *why* the surface doesn't apply, in public-safe wording).
2. **Stale or wrong prose.** Where a doc is present, compare it with the code: documented parameters against the route's Zod schema (validated inside the handler), SDK signatures in `docs/sdk-reference.md` against `packages/client/src/resources/`, CLI usage in `docs/cli.md` against the command's options, `docs/mcp/tools.md` against the tool's description and input schema, and worked price examples against the test cases that pin them.
3. **Cross-surface consistency.** The same defaults, enums, limits and error codes across the route, the SDK types, the MCP schema and the docs.
4. **Public safety** of any proposed doc text: credit prices and formulas only, never provider costs or margins (`node tools/check-pricing-leaks.mjs`), and no internal plan words (`node tools/check-public-surface.mjs`).

Rules for the agents:

- Report and propose only. Never edit, commit or push.
- Never propose closing an MCP gap by lengthening a tool description: the MCP wire budget has almost no headroom, so cross-references belong in the docs.
- A gap on a Cloud-plugin route is reported as a plugin gap, not as a missing app route.

## 3. Report

One section per feature:

- **Gaps to fix:** surface, what is missing, where it goes (file), and a one-line draft where it's a doc.
- **Proposed exemptions:** surface, atom, and the reason.
- **Stale or inconsistent docs:** file:line, what it says, what the code does.

End with totals (gaps, proposed exemptions, stale docs) and ask which fixes to make. Fixes follow the root `CLAUDE.md` Public Docs Maintenance Rule: a user-facing change updates `docs/` in the same PR.
