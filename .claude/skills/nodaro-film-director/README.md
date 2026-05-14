# Nodaro Film Director Skill

A Claude Skill that drives a 10-stage director workflow to produce a cinematic video. The user converses with Claude; Claude calls Nodaro MCP tools to assemble a fully editable workflow on the user's canvas in real-time.

## Source spec

***REDACTED-OSS-SCRUB***

## Local testing

1. Connect Claude Code (or Claude Desktop) to a Nodaro MCP endpoint via `docs/mcp/connecting-claude.md`
2. Open a Claude session; describe a film idea like "make a 30-second trailer about a fighter pilot"
3. The skill should auto-activate (its description matches film/video creation intents) and call `create_workflow` as Stage 0

## Distribution

Pending Phase 2+: publish to a public `nodaro-skills` repo per spec §10 Q6.

## Architecture references

***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
- 4-layer workflow construction model: spec §5.4
***REDACTED-OSS-SCRUB***
- Reference template workflow seed: `backend/scripts/seed-film-template-workflow.ts` (created by Phase B)
