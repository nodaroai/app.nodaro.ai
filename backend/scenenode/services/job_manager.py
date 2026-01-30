"""Job lifecycle management."""


class JobManager:
    """Manages job creation, status updates, and lifecycle."""

    async def create(self, workflow_id: str, user_id: str, input_data: dict) -> dict:
        """Create a new job for a workflow execution."""
        # TODO: Create job record and queue it
        raise NotImplementedError

    async def get_status(self, job_id: str) -> dict:
        """Get current job status and progress."""
        raise NotImplementedError

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running or queued job."""
        raise NotImplementedError
