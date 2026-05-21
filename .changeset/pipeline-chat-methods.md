---
"@nodaro/client": minor
---

Add chat methods to the pipelines resource (Phase 1D.2b Guided Mode, §5.9):

- `pipelines.chatStage(pipelineId, stage, message)` — send a refinement message to the Showrunner Refinement Director; persists user+assistant turns and returns the assistant's reply plus an optional `proposed_change`.
- `pipelines.applyChatProposal(pipelineId, stage, turnId)` — accept a proposed `edit_artifact` change from a prior assistant turn; the backend validates the JSON Patch, inserts a new attempt, and flips the stage to approved.
- `pipelines.getStageChat(pipelineId, stage)` — fetch the chat history for a stage (empty array when no turns exist yet).
