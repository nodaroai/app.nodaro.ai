// Set required env vars before config.ts Zod validation fires
process.env.SUPABASE_URL = "https://test.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key"
process.env.EDITION = "cloud"
process.env.NODE_ENV = "test"
