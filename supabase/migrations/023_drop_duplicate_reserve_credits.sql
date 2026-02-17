-- Migration 023: Drop duplicate reserve_credits overload
-- An older version with different parameter order (p_user_id, p_job_id, p_model_identifier, p_credits, ...)
-- coexisted with the correct version (p_user_id, p_credits, p_job_id, ...) from migration 022,
-- causing PostgREST RPC ambiguity errors ("Failed to reserve credits").

DROP FUNCTION IF EXISTS public.reserve_credits(uuid, uuid, text, integer, numeric, numeric);
