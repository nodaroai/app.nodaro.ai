"""Security utilities for API key generation and webhook signing."""

import hashlib
import hmac
import secrets


def generate_api_key(prefix: str = "sn_live_") -> str:
    """Generate a new API key with the given prefix."""
    random_part = secrets.token_urlsafe(32)
    return f"{prefix}{random_part}"


def hash_api_key(key: str) -> str:
    """Hash an API key for storage."""
    return hashlib.sha256(key.encode()).hexdigest()


def get_key_prefix(key: str) -> str:
    """Extract the prefix portion of an API key for identification."""
    return key[:16]


def sign_webhook_payload(payload: bytes, secret: str) -> str:
    """Create HMAC-SHA256 signature for webhook payload."""
    signature = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={signature}"


def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify a webhook signature."""
    expected = sign_webhook_payload(payload, secret)
    return hmac.compare_digest(expected, signature)
