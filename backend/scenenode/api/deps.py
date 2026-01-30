from scenenode.config import settings


async def get_supabase_client():
    """Get a Supabase client instance."""
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
