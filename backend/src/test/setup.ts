// Set required env vars before config.ts Zod validation fires
process.env.SUPABASE_URL = "https://test.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key"
process.env.EDITION = "cloud"
process.env.NODE_ENV = "test"
process.env.INTERNAL_ORCHESTRATOR_SECRET = "0".repeat(64)
// Dummy Stripe key so the eager `new Stripe(...)` in billing/stripe-client.ts
// doesn't throw at module load when buildApp() imports the full route tree.
// Tests that exercise Stripe behavior should mock @/billing/stripe-client.js.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
