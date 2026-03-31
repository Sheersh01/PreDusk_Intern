"""
API Routes for DocFlow.

POST   /upload                   - Upload one or more documents
GET    /jobs                     - List all jobs (search, filter, sort, paginate)
GET    /jobs/{job_id}            - Get job detail
GET    /jobs/{job_id}/progress   - SSE stream for live progress
GET    /jobs/{job_id}/status     - Polling-based status (Redis fallback)
PATCH  /jobs/{job_id}/review     - Update reviewed data
POST   /jobs/{job_id}/finalize   - Finalize job
POST   /jobs/{job_id}/retry      - Retry failed job
GET    /jobs/export/json         - Export as JSON
GET    /jobs/export/csv          - Export as CSV
DELETE /jobs/{job_id}            - Delete job
"""

import asyncio
import json
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, Request
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.redis_pubsub import get_async_redis, make_channel, get_latest_status
from app.db.session import get_db
from app.models.document import JobStatus
from app.schemas.document import (
    BulkUploadResponse, UploadResponse, JobListResponse,
    ProcessingJobRead, ProcessingJobSummary,
    ReviewedDataUpdate, FinalizeRequest,
)
from app.services import document_service
from app.workers.tasks import process_document

router = APIRouter()


# ─── Upload ───────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=BulkUploadResponse)
async def upload_documents(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    results = []
    errors = []

    for file in files:
        try:
            # Validate extension
            from pathlib import Path
            ext = Path(file.filename).suffix.lower()
            if ext not in settings.ALLOWED_EXTENSIONS:
                errors.append(f"{file.filename}: unsupported file type '{ext}'")
                continue

            content = await file.read()

            # Validate size
            if len(content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
                errors.append(f"{file.filename}: file exceeds {settings.MAX_FILE_SIZE_MB}MB limit")
                continue

            file_path, unique_name, file_type = await document_service.save_uploaded_file(
                content, file.filename
            )

            doc, job = await document_service.create_document_and_job(
                db=db,
                original_filename=file.filename,
                file_path=file_path,
                unique_filename=unique_name,
                file_size=len(content),
                file_type=file_type,
                mime_type=file.content_type,
            )

            # Dispatch Celery task
            process_document.apply_async(args=[str(job.id)], queue="documents")

            results.append(UploadResponse(document=doc, job=job))

        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")

    return BulkUploadResponse(
        results=results,
        total=len(files),
        succeeded=len(results),
        failed=len(errors),
        errors=errors,
    )


# ─── List Jobs ────────────────────────────────────────────────────────────────

@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    jobs, total = await document_service.list_jobs(
        db, page=page, page_size=page_size,
        status=status, search=search,
        sort_by=sort_by, sort_dir=sort_dir,
    )
    pages = (total + page_size - 1) // page_size
    return JobListResponse(
        items=jobs, total=total, page=page, page_size=page_size, pages=pages
    )


# ─── Export (must be before /{job_id} to avoid routing conflict) ───────────────

@router.get("/jobs/export/json")
async def export_json(
    job_ids: Optional[str] = Query(None, description="Comma-separated job IDs"),
    db: AsyncSession = Depends(get_db),
):
    ids = job_ids.split(",") if job_ids else None
    data = await document_service.export_jobs_json(db, ids)
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=docflow_export.json"},
    )


@router.get("/jobs/export/csv")
async def export_csv(
    job_ids: Optional[str] = Query(None, description="Comma-separated job IDs"),
    db: AsyncSession = Depends(get_db),
):
    ids = job_ids.split(",") if job_ids else None
    data = await document_service.export_jobs_csv(db, ids)
    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=docflow_export.csv"},
    )


# ─── Job Detail ───────────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}", response_model=ProcessingJobRead)
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await document_service.get_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ─── SSE Progress Stream ──────────────────────────────────────────────────────

@router.get("/jobs/{job_id}/progress")
async def stream_progress(job_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Server-Sent Events stream for live job progress.
    Subscribes to Redis Pub/Sub channel and forwards events to client.
    """
    # Verify job exists
    job = await document_service.get_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        client = await get_async_redis()
        pubsub = client.pubsub()
        channel = make_channel(job_id)
        await pubsub.subscribe(channel)

        try:
            # First send current state
            latest = await get_latest_status(job_id)
            if latest:
                yield f"data: {json.dumps(latest)}\n\n"

            # Stream new events
            while True:
                if await request.is_disconnected():
                    break

                msg = await asyncio.wait_for(pubsub.get_message(ignore_subscribe_messages=True), timeout=1.0)
                if msg and msg["type"] == "message":
                    yield f"data: {msg['data']}\n\n"

                    # Auto-close stream on terminal states
                    try:
                        payload = json.loads(msg["data"])
                        if payload.get("status") in ("completed", "failed", "finalized"):
                            yield f"data: {json.dumps({'event_type': 'stream_end', 'job_id': job_id})}\n\n"
                            break
                    except Exception:
                        pass

                await asyncio.sleep(0.1)

        except asyncio.TimeoutError:
            pass
        except Exception:
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
            await client.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/jobs/{job_id}/status")
async def poll_status(job_id: str):
    """Lightweight polling endpoint backed by Redis key."""
    latest = await get_latest_status(job_id)
    if latest:
        return latest
    return {"job_id": job_id, "status": "unknown", "progress": 0}


# ─── Review & Finalize ────────────────────────────────────────────────────────

@router.patch("/jobs/{job_id}/review", response_model=ProcessingJobRead)
async def update_review(
    job_id: str,
    update: ReviewedDataUpdate,
    db: AsyncSession = Depends(get_db),
):
    job = await document_service.update_reviewed_data(db, job_id, update)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/finalize", response_model=ProcessingJobRead)
async def finalize_job(
    job_id: str,
    body: FinalizeRequest,
    db: AsyncSession = Depends(get_db),
):
    job = await document_service.finalize_job(db, job_id, body.reviewed_data)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ─── Retry ────────────────────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/retry", response_model=ProcessingJobSummary)
async def retry_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await document_service.retry_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=400,
            detail="Job cannot be retried (not in failed state or max retries reached)"
        )
    # Dispatch new Celery task
    process_document.apply_async(args=[str(job.id)], queue="documents")
    return job


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select, delete
    from app.models.document import ProcessingJob, Document, JobEvent

    job = await document_service.get_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    doc_id = job.document_id

    await db.execute(delete(JobEvent).where(JobEvent.job_id == job_id))
    await db.execute(delete(ProcessingJob).where(ProcessingJob.id == job_id))
    await db.execute(delete(Document).where(Document.id == doc_id))
    await db.commit()
