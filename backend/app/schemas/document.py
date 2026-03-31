from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Any
from datetime import datetime
from uuid import UUID
from app.models.document import JobStatus


# ─── Document Schemas ────────────────────────────────────────────────────────

class DocumentBase(BaseModel):
    original_filename: str
    file_size: int
    file_type: str
    mime_type: Optional[str] = None


class DocumentRead(DocumentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ─── Job Event Schemas ────────────────────────────────────────────────────────

class JobEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    event_type: str
    message: Optional[str] = None
    progress: Optional[int] = None
    metadata: Optional[dict] = Field(default=None, validation_alias="extra_metadata")
    created_at: datetime


# ─── Processing Job Schemas ───────────────────────────────────────────────────

class ProcessingJobBase(BaseModel):
    status: JobStatus
    current_stage: Optional[str] = None
    progress: int = 0


class ProcessingJobRead(ProcessingJobBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    celery_task_id: Optional[str] = None
    extracted_data: Optional[dict] = None
    reviewed_data: Optional[dict] = None
    error_message: Optional[str] = None
    retry_count: int
    max_retries: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    events: list[JobEventRead] = []
    document: Optional[DocumentRead] = None


class ProcessingJobSummary(ProcessingJobBase):
    """Lighter version for list views"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    retry_count: int
    created_at: datetime
    completed_at: Optional[datetime] = None
    document: Optional[DocumentRead] = None


# ─── Review / Edit Schemas ────────────────────────────────────────────────────

class ReviewedDataUpdate(BaseModel):
    reviewed_data: dict[str, Any]


class FinalizeRequest(BaseModel):
    reviewed_data: Optional[dict[str, Any]] = None  # if provided, replaces existing reviewed_data


# ─── Upload Response ──────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    document: DocumentRead
    job: ProcessingJobSummary


class BulkUploadResponse(BaseModel):
    results: list[UploadResponse]
    total: int
    succeeded: int
    failed: int
    errors: list[str] = []


# ─── List / Filter Schemas ────────────────────────────────────────────────────

class JobListResponse(BaseModel):
    items: list[ProcessingJobSummary]
    total: int
    page: int
    page_size: int
    pages: int


# ─── Export Schemas ───────────────────────────────────────────────────────────

class ExportField(BaseModel):
    job_id: str
    document_name: str
    status: str
    title: Optional[str]
    category: Optional[str]
    summary: Optional[str]
    keywords: Optional[list[str]]
    file_size: Optional[int]
    file_type: Optional[str]
    processed_at: Optional[str]
    finalized: bool


# ─── SSE Event Schema ─────────────────────────────────────────────────────────

class SSEProgressEvent(BaseModel):
    job_id: str
    event_type: str
    message: str
    progress: int
    status: str
    timestamp: str
