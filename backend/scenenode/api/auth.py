import hashlib

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    token = credentials.credentials

    if token.startswith("sn_live_") or token.startswith("sn_test_"):
        key_hash = hash_api_key(token)
        # TODO: Look up key_hash in database
        raise HTTPException(status_code=401, detail="Invalid API key")

    # TODO: Validate Supabase JWT
    raise HTTPException(status_code=401, detail="Invalid token")
