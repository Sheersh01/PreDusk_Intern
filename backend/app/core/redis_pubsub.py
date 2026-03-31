import json
import redis.asyncio as aioredis
import redis as sync_redis
from datetime import datetime
from app.core.config import settings


# Sync client for use inside Celery workers (no event loop)
def get_sync_redis():
    return sync_redis.from_url(settings.REDIS_URL, decode_responses=True)


# Async client for FastAPI
async def get_async_redis():
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def make_channel(job_id: str) -> str:
    return f"job_progress:{job_id}"


def publish_progress_sync(
    job_id: str,
    event_type: str,
    message: str,
    progress: int,
    status: str,
    extra: dict | None = None,
):
    """Publish a progress event from a Celery worker (sync context)."""
    client = get_sync_redis()
    payload = {
        "job_id": job_id,
        "event_type": event_type,
        "message": message,
        "progress": progress,
        "status": status,
        "timestamp": datetime.utcnow().isoformat(),
        **(extra or {}),
    }
    channel = make_channel(job_id)
    client.publish(channel, json.dumps(payload))

    # Also store latest status in a key for polling fallback
    client.setex(f"job_status:{job_id}", 3600, json.dumps(payload))
    client.close()


async def get_latest_status(job_id: str) -> dict | None:
    """Get the most recently published status via Redis key (polling fallback)."""
    client = await get_async_redis()
    try:
        raw = await client.get(f"job_status:{job_id}")
        if raw:
            return json.loads(raw)
        return None
    finally:
        await client.aclose()
