from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    environment: str = "development"
    version: str = "0.1.0"
    debug: bool = False

    # Database (Supabase)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Storage (Cloudflare R2)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "scenenode-assets"
    r2_public_url: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Security
    api_secret_key: str = ""
    webhook_secret_key: str = ""
    encryption_key: str = ""

    # AI Providers - Image
    gemini_api_key: str = ""
    replicate_api_token: str = ""
    openai_api_key: str = ""

    # AI Providers - Video
    kling_api_key: str = ""
    runway_api_key: str = ""

    # AI Providers - Voice
    elevenlabs_api_key: str = ""
    playht_api_key: str = ""

    # AI Providers - Script
    anthropic_api_key: str = ""

    # Payments (Cloud only)
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Monitoring
    sentry_dsn: str = ""

    # Feature flags
    enable_analytics: bool = False
    enable_watermark: bool = True

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
