---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Did it work? "I did this" on an action card, and how it went. `@nodaro/shared` adds the mark types (`CardAction`, `CardActionResult`, `CardOutcome`, `CardOutcomeState`, `CardSnapshot`, `CardVerdict`, `AdviceRecord`, `AdviceFamily`, `CompetitorActionsResult`, `MarkCardInput`, `UpdateCardActionInput`, `CARD_OUTCOME_STATES`, `ADVICE_FAMILIES`), `adviceFamilyOf` and `isMeasurableCard`, and `CompetitorCardsResult.record`. `@nodaro/sdk` adds `client.competitors.tried()`, `markDone(cardId, { postUrl })`, `linkPost(markId, url | null)`, `markSeen(markId)` and `unmark(markId)` (`/v1/competitors/actions*`), and re-exports the lesson and mark types. `@nodaro/cli` adds `nodaro competitors done`, `tried`, `link` and `undo`, and `cards` shows the id to mark a card done.
