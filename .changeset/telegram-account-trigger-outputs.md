---
"@nodaro/shared": minor
---

Telegram Account Trigger: named outputs (`videoLink`, `postText`, `postLink`, and the message facts) through `telegramAccountTriggerOutputs` and `isTelegramAccountTriggerNamedHandle`, and `telegramAccountListeningSignature` for the settings only a trigger's owner sets. `resolveFieldMappings` hands a wired field's source handle to the reader (`FieldEdgeSource`), so a field reads the wire's own output. A trigger's last run values (`__triggerData`) are run state and never saved; an exported account trigger never carries its switch or its account.
