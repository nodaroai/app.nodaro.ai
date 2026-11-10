-- 613: Restore the MCP conversation markers an editor save erased.
--
-- Until the editor kept the settings keys it does not manage, every save from
-- the editor rebuilt `workflows.settings` from the editor's four keys and
-- erased `settings.mcpConversation` — which assistant chat built the flow,
-- when, and how far it got — and a hub's `settings.mcpHub`. Both are rebuilt
-- here from what the rows still hold. Rows are matched on data only, never on
-- an id, so the same file repairs any install.
--
--   1. A hub: no parent, named "MCP Conversations · YYYY-MM", with conversations
--      of its own under it, and no `mcpHub` — the month comes from its name.
--      Hubs first: a conversation is found through its hub's marker, so a hub
--      that lost its marker too is repaired before what hangs under it (a
--      migration runs once on an install).
--   2. A conversation flow: it hangs under a hub (its parent carries `mcpHub`),
--      has no `mcpConversation`, and holds nodes an assistant made
--      (`data.mcpProvenance`: the client, its name, the time, the user's
--      request). `client` / `clientName` come from the first step, `startedAt`
--      and `lastActivityAt` from the first and the last step's time, `steps`
--      from the count, `firstRequest` from the first step that carried one,
--      `part` from a " · Part N" name. The per-chat key cannot be recovered
--      (null); `continuedFrom` and `startedBy` are not recoverable and are
--      left out; `restored: true` marks the row for a later look.
--
-- A hub and its conversations are one user's, in one project, as the server
-- creates them (lib/mcp/flows/conversation-store.ts): a row that merely points
-- its parent at another user's hub is not repaired, and does not make a hub.
-- Copies ("copy to project") and imports have no hub parent and are untouched.
-- Rows the compatible-writer guard protects (migration 398: a Studio
-- production's dependency document, a node bound to its frames) are skipped,
-- as `apply_workflow_delta` skips them: the guard refuses a plain write to one,
-- and one refused row would fail this whole file.
-- Idempotent: only rows still missing the key are written, so a second run is
-- a no-op. `settings || …` adds the key and replaces nothing else. The version
-- trigger bumps `version`, so an editor that has the flow open sees the change:
-- a clean tab adopts it, a tab with unsaved edits conflicts on its next save
-- instead of writing over it. `set_updated_at` stays on (the few restored rows
-- carry this repair's time): switching it off takes a table lock that a
-- conversation step landing at that moment could deadlock with.

-- 1. Hubs that lost their month marker.
UPDATE public.workflows h
SET settings = coalesce(h.settings, '{}'::jsonb)
             || jsonb_build_object('mcpHub', jsonb_build_object('month', substring(h.name from '(\d{4}-(?:0[1-9]|1[0-2]))$')))
WHERE h.parent_workflow_id IS NULL
  AND NOT (coalesce(h.settings, '{}'::jsonb) ? 'mcpHub')
  AND h.name ~ '^MCP Conversations · \d{4}-(0[1-9]|1[0-2])$'
  AND NOT public.workflow_requires_compatible_writer(h.nodes, h.settings)
  AND EXISTS (SELECT 1 FROM public.workflows c
               WHERE c.parent_workflow_id = h.id
                 AND c.user_id = h.user_id
                 AND c.project_id = h.project_id);

-- 2. Conversation flows under a hub.
WITH steps AS (
  SELECT w.id,
         jsonb_agg(n.elem->'data'->'mcpProvenance'
                   ORDER BY (n.elem->'data'->'mcpProvenance'->>'at') NULLS LAST) AS prov,
         (array_agg(n.elem->'data'->'mcpProvenance'->>'userRequest'
                    ORDER BY (n.elem->'data'->'mcpProvenance'->>'at') NULLS LAST)
            FILTER (WHERE n.elem->'data'->'mcpProvenance'->>'userRequest' IS NOT NULL))[1] AS first_request
  FROM public.workflows w
  JOIN public.workflows hub
    ON hub.id = w.parent_workflow_id
   AND hub.user_id = w.user_id
   AND hub.project_id = w.project_id
   AND hub.parent_workflow_id IS NULL
   AND hub.settings ? 'mcpHub'
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(w.nodes) = 'array' THEN w.nodes ELSE '[]'::jsonb END) AS n(elem)
  WHERE NOT (coalesce(w.settings, '{}'::jsonb) ? 'mcpConversation')
    AND NOT public.workflow_requires_compatible_writer(w.nodes, w.settings)
    AND jsonb_typeof(n.elem->'data'->'mcpProvenance') = 'object'
  GROUP BY w.id
)
UPDATE public.workflows w
SET settings = coalesce(w.settings, '{}'::jsonb) || jsonb_build_object(
  'mcpConversation',
  jsonb_build_object(
    'client',         s.prov->0->>'client',
    'clientName',     s.prov->0->>'clientName',
    'key',            NULL,
    'startedAt',      s.prov->0->>'at',
    'lastActivityAt', s.prov->-1->>'at',
    'steps',          jsonb_array_length(s.prov),
    'restored',       true
  )
  || CASE WHEN s.first_request IS NOT NULL
          THEN jsonb_build_object('firstRequest', s.first_request) ELSE '{}'::jsonb END
  || CASE WHEN w.name ~ ' · Part \d{1,6}$'
          THEN jsonb_build_object('part', substring(w.name from ' · Part (\d{1,6})$')::int) ELSE '{}'::jsonb END)
FROM steps s
WHERE w.id = s.id
  AND NOT (coalesce(w.settings, '{}'::jsonb) ? 'mcpConversation')
  AND NOT public.workflow_requires_compatible_writer(w.nodes, w.settings)
  AND s.prov->0->>'client' IS NOT NULL
  AND s.prov->0->>'at' IS NOT NULL;
