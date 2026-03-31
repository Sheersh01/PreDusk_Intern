import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Float, DateTime, JSON,
    ForeignKey, Text, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.session import Base
import enum


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    FINALIZED = "finalized"


class ProcessingStage(str, enum.Enum):
    RECEIVED = "document_received"
    PARSING_STARTED = "parsing_started"
    PARSING_COMPLETED = "parsing_completed"
    EXTRACTION_STARTED = "extraction_started"
    EXTRACTION_COMPLETED = "extraction_completed"
    STORING = "final_result_stored"
    COMPLETED = "job_completed"
    FAILED = "job_failed"


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_size = Column(Integer, nullable=False)  # bytes
    file_type = Column(String(50), nullable=False)
    mime_type = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    job = relationship("ProcessingJob", back_populates="document", uselist=False, cascade="all, delete-orphan")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    celery_task_id = Column(String(255), nullable=True)

    status = Column(SAEnum(JobStatus), default=JobStatus.QUEUED, nullable=False)
    current_stage = Column(String(100), nullable=True)
    progress = Column(Integer, default=0)  # 0-100

    # Processing results
    extracted_data = Column(JSON, nullable=True)
    reviewed_data = Column(JSON, nullable=True)  # user-edited version
    error_message = Column(Text, nullable=True)

    # Retry tracking
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Relationship
    document = relationship("Document", back_populates="job")
    events = relationship("JobEvent", back_populates="job", cascade="all, delete-orphan", order_by="JobEvent.created_at")


class JobEvent(Base):
    __tablename__ = "job_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("processing_jobs.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(100), nullable=False)
    message = Column(Text, nullable=True)
    progress = Column(Integer, nullable=True)
    extra_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    job = relationship("ProcessingJob", back_populates="events")
