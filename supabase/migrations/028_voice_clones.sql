-- Voice Clones table for user-created ElevenLabs instant voice clones
CREATE TABLE IF NOT EXISTS public.voice_clones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    elevenlabs_voice_id TEXT NOT NULL,
    sample_audio_url TEXT,
    preview_url TEXT,
    gender TEXT,
    accent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_clones_user_id ON public.voice_clones(user_id);

ALTER TABLE public.voice_clones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own voice clones" ON public.voice_clones
    FOR ALL USING (user_id = auth.uid());

-- Credit cost for voice cloning (5 credits)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled)
VALUES ('voice-clone', 5, true)
ON CONFLICT (model_identifier) DO NOTHING;
