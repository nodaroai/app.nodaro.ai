"""Credit balance and usage management."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CreditResult:
    success: bool
    new_balance: int = 0
    error: str = ""


CREDIT_COSTS: dict[str, int] = {
    "generate-script": 2,
    "generate-image": 5,
    "image-to-video": 20,
    "text-to-speech": 3,
    "qa-check": 1,
    "combine-videos": 2,
    "add-audio": 1,
    "add-captions": 2,
    "resize-video": 1,
    "extract-audio": 1,
    "mix-audio": 1,
    "adjust-volume": 0,
    "trim-video": 0,
}


class CreditManager:
    """Manages credit balances, deductions, and cost estimation."""

    def estimate(self, nodes: list[dict], scene_count: int = 1) -> int:
        """Estimate the total credit cost for a workflow."""
        total = 0
        for node in nodes:
            node_type = node.get("type", "")
            cost = CREDIT_COSTS.get(node_type, 0)
            if node_type in ("generate-image", "image-to-video"):
                cost *= scene_count
            total += cost
        return total

    async def deduct(self, user_id: str, amount: int) -> CreditResult:
        """Deduct credits from a user's balance."""
        # TODO: Implement with database
        raise NotImplementedError

    async def get_balance(self, user_id: str) -> int:
        """Get current credit balance for a user."""
        raise NotImplementedError
