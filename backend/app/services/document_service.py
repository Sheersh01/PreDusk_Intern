"""
Service layer: all business logic for documents and jobs.
API routes delegate to this layer; no DB code in routes.
"""

import csv
import json
import uuid
from uuid import UUID
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import select, func, desc, asc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.document import Document, ProcessingJob, JobStatus, JobEvent
from app.schemas.document import ReviewedDataUpdate

# Cloudinary setup
try:
    import cloudinary
    import cloudinary.uploader
    CLOUDINARY_AVAILABLE = True
except ImportError:
    CLOUDINARY_AVAILABLE = False


class InvalidJobTransitionError(Exception):
    """Raised when a job transition is not allowed."""


def _to_uuid(value) -> Optional[UUID]:
    if isinstance(value, UUID):
        return value
    if not value:
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


# ─── Cloudinary ───────────────────────────────────────────────────────────────

def _init_cloudinary():
    """Initialize Cloudinary with settings."""
    if not CLOUDINARY_AVAILABLE:
        return False
    
    if not (settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET):
        return False
    
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    return True


def upload_to_cloudinary(file_content: bytes, original_filename: str) -> str:
    """
    Upload file to Cloudinary and return a secure URL.
    Raises RuntimeError when upload is enabled but cannot be completed.
    """
    if not CLOUDINARY_AVAILABLE:
        raise RuntimeError("cloudinary package is not installed")
    
    if not _init_cloudinary():
        raise RuntimeError("Cloudinary credentials are missing or invalid")
    
    try:
        # Upload with generated public_id under docflow folder
        public_id = f"docflow/{uuid.uuid4().hex}"
        
        result = cloudinary.uploader.upload(
            file_content,
            public_id=public_id,
            resource_type="raw",
            type="upload",
            access_mode="public",
            overwrite=True,
            filename_override=Path(original_filename).name,
        )

        url = result.get("secure_url") or result.get("url")
        if not url:
            raise RuntimeError("Cloudinary did not return a file URL")
        return url
    except Exception as e:
        raise RuntimeError(f"Cloudinary upload failed: {e}") from e


# ─── Upload ───────────────────────────────────────────────────────────────────

async def save_uploaded_file(file_content: bytes, original_filename: str) -> tuple[str, str, str]:
    """
    Save uploaded file to disk. Returns (saved_path, unique_filename, file_type).
    """
    ext = Path(original_filename).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / unique_name
    dest.write_bytes(file_content)
    return str(dest), unique_name, ext


async def create_document_and_job(
    db: AsyncSession,
    original_filename: str,
    file_path: str,
    unique_filename: str,
    file_size: int,
    file_type: str,
    mime_type: Optional[str] = None,
    file_url: Optional[str] = None,
) -> tuple[Document, ProcessingJob]:
    doc = Document(
        original_filename=original_filename,
        filename=unique_filename,
        file_path=file_path,
        file_url=file_url,  # Store Cloudinary URL if provided
        file_size=file_size,
        file_type=file_type,
        mime_type=mime_type,
    )
    db.add(doc)
    await db.flush()  # get doc.id

    job = ProcessingJob(
        document_id=doc.id,
        status=JobStatus.QUEUED,
        progress=0,
    )
    db.add(job)
    await db.flush()  # ✅ ensures job.id exists
    # Initial event
    event = JobEvent(
        job_id=job.id,
        event_type="job_queued",
        message="Job created and queued for processing",
        progress=0,
    )
    db.add(event)
    await db.commit()
    await db.refresh(doc)
    await db.refresh(job)
    return doc, job


# ─── List / Query ─────────────────────────────────────────────────────────────

async def list_jobs(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> tuple[list[ProcessingJob], int]:
    query = (
        select(ProcessingJob)
        .options(selectinload(ProcessingJob.document))
        .join(ProcessingJob.document)
    )

    # Filter by status
    if status:
        query = query.where(ProcessingJob.status == status)

    # Search by filename
    if search:
        query = query.where(Document.original_filename.ilike(f"%{search}%"))

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    # Sort
    sort_col = getattr(ProcessingJob, sort_by, ProcessingJob.created_at)
    order = desc(sort_col) if sort_dir == "desc" else asc(sort_col)
    query = query.order_by(order)

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    jobs = result.scalars().all()
    return list(jobs), total


async def get_job_detail(db: AsyncSession, job_id: str) -> Optional[ProcessingJob]:
    parsed_job_id = _to_uuid(job_id)
    if not parsed_job_id:
        return None

    result = await db.execute(
        select(ProcessingJob)
        .where(ProcessingJob.id == parsed_job_id)
        .options(
            selectinload(ProcessingJob.document),
            selectinload(ProcessingJob.events),
        )
    )
    return result.scalar_one_or_none()


# ─── Review & Finalize ────────────────────────────────────────────────────────

async def update_reviewed_data(
    db: AsyncSession, job_id: str, update: ReviewedDataUpdate
) -> Optional[ProcessingJob]:
    job = await get_job_detail(db, job_id)
    if not job:
        return None
    job.reviewed_data = update.reviewed_data
    job.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(job)
    return job


async def finalize_job(
    db: AsyncSession, job_id: str, reviewed_data: Optional[dict] = None
) -> Optional[ProcessingJob]:
    job = await get_job_detail(db, job_id)
    if not job:
        return None

    # Idempotent finalize for already finalized jobs.
    if job.status == JobStatus.FINALIZED:
        return job

    if job.status != JobStatus.COMPLETED:
        raise InvalidJobTransitionError(
            f"Only completed jobs can be finalized. Current status: {job.status.value}"
        )

    if reviewed_data:
        job.reviewed_data = reviewed_data
    job.status = JobStatus.FINALIZED
    job.updated_at = datetime.utcnow()
    event = JobEvent(
        job_id=job.id,
        event_type="job_finalized",
        message="Job reviewed and finalized by user",
        progress=100,
    )
    db.add(event)
    await db.commit()
    await db.refresh(job)
    return job


# ─── Retry ────────────────────────────────────────────────────────────────────

async def retry_job(db: AsyncSession, job_id: str) -> Optional[ProcessingJob]:
    job = await get_job_detail(db, job_id)
    if not job or job.status not in (JobStatus.FAILED,):
        return None
    if job.retry_count >= job.max_retries:
        return None

    job.status = JobStatus.QUEUED
    job.progress = 0
    job.current_stage = None
    job.error_message = None
    job.retry_count += 1
    job.updated_at = datetime.utcnow()

    event = JobEvent(
        job_id=job.id,
        event_type="job_queued",
        message=f"Retry #{job.retry_count} queued",
        progress=0,
    )
    db.add(event)
    await db.commit()
    await db.refresh(job)
    return job


# ─── Export ───────────────────────────────────────────────────────────────────

def _job_to_export_dict(job: ProcessingJob) -> dict:
    data = job.reviewed_data or job.extracted_data or {}
    return {
        "job_id": str(job.id),
        "document_name": job.document.original_filename if job.document else "",
        "status": job.status.value,
        "title": data.get("title"),
        "category": data.get("category"),
        "summary": data.get("summary"),
        "keywords": data.get("keywords", []),
        "word_count": data.get("word_count"),
        "file_size_bytes": data.get("file_metadata", {}).get("file_size_bytes"),
        "file_type": data.get("file_metadata", {}).get("file_type"),
        "processed_at": job.completed_at.isoformat() if job.completed_at else None,
        "finalized": job.status == JobStatus.FINALIZED,
        "retry_count": job.retry_count,
    }


async def export_jobs_json(
    db: AsyncSession,
    job_ids: Optional[list[str]] = None,
    include_completed: bool = False,
) -> str:
    jobs = await _fetch_export_jobs(db, job_ids, include_completed=include_completed)
    records = [_job_to_export_dict(j) for j in jobs]
    return json.dumps(records, indent=2, default=str)


async def export_jobs_csv(
    db: AsyncSession,
    job_ids: Optional[list[str]] = None,
    include_completed: bool = False,
) -> str:
    jobs = await _fetch_export_jobs(db, job_ids, include_completed=include_completed)
    records = [_job_to_export_dict(j) for j in jobs]
    if not records:
        return ""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=records[0].keys())
    writer.writeheader()
    for rec in records:
        flat = rec.copy()
        flat["keywords"] = ", ".join(rec.get("keywords") or [])
        writer.writerow(flat)
    return output.getvalue()


async def _fetch_export_jobs(
    db: AsyncSession,
    job_ids: Optional[list[str]],
    include_completed: bool = False,
) -> list[ProcessingJob]:
    query = select(ProcessingJob).options(selectinload(ProcessingJob.document))
    if job_ids:
        parsed_job_ids = [jid for jid in (_to_uuid(j) for j in job_ids) if jid is not None]
        if not parsed_job_ids:
            return []
        query = query.where(ProcessingJob.id.in_(parsed_job_ids))
    else:
        statuses = [JobStatus.FINALIZED]
        if include_completed:
            statuses.append(JobStatus.COMPLETED)
        query = query.where(ProcessingJob.status.in_(statuses))
    result = await db.execute(query)
    return list(result.scalars().all())


async def delete_job_and_document(db: AsyncSession, job_id: str, document_id) -> None:
    await db.execute(delete(JobEvent).where(JobEvent.job_id == job_id))
    await db.execute(delete(ProcessingJob).where(ProcessingJob.id == job_id))
    await db.execute(delete(Document).where(Document.id == document_id))
    await db.commit()
