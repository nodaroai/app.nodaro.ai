# Nodaro skills for LLM coding systems

Drop-in skill files for Claude Code, Cursor, and similar LLM coding harnesses. Each file has YAML frontmatter (`name`, `description`) plus markdown instructions designed to be activated when an LLM is helping a developer with that specific task.

## Available skills

- [`using-nodaro-client`](./using-nodaro-client.md) — integrate the `@nodaro/client` TypeScript SDK (install, three auth modes, 17 resources, error hierarchy, common recipes, when NOT to use the SDK)
- [`building-nodaro-oauth-app`](./building-nodaro-oauth-app.md) — implement OAuth 2.0 against a Nodaro instance (app registration, scope vocabulary, redirect URL, code exchange, token storage, revocation, common errors)

## Installing in Claude Code

Drop a skill file into your project's `.claude/skills/` directory (or your global `~/.claude/skills/`). The frontmatter `name` becomes the skill identifier, and `description` is what triggers Claude to load it.

For team-wide use, commit `.claude/skills/<name>.md` symlinks pointing at this docs folder, or copy the files in.

## Authoring guide

Skills should:
- Have a focused trigger (the `description`) so they activate at the right moment, not for unrelated tasks
- Be actionable — give the LLM concrete steps + code, not just background
- Cite source files in the repo so the LLM can verify details
- Stay in sync with the canonical docs (this folder is mirrored from the regular `docs/` content)

When adding a new skill, also link it from this README and consider whether the underlying capability is documented in the main docs (most should be).

## Why these exist

Most LLM coding integrations don't have first-class docs about Nodaro's API surface. These skills bridge that — they're the equivalent of project-specific man pages that an LLM coding assistant can consult when the developer asks "how do I add OAuth to this Next.js app?" or "what's the right way to call Nodaro from a serverless function?"
