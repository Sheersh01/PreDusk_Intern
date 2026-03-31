"""
Document processing Celery tasks.

Each document goes through a multi-stage pipeline:
  document_received → parsing_started → parsing_completed
  → extraction_started → extraction_completed
  → final_result_stored → job_completed
"""

import time
import json
import os
import re
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import requests
import sqlalchemy
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.workers.celery_app import celery_app
from app.core.config import settings
from app.core.redis_pubsub import publish_progress_sync
from app.models.document import ProcessingJob, JobStatus, JobEvent, Document

try:
    import cloudinary
    from cloudinary.utils import cloudinary_url
    CLOUDINARY_AVAILABLE = True
except ImportError:
    CLOUDINARY_AVAILABLE = False

# Sync DB engine for Celery workers
sync_engine = create_engine(
    settings.DATABASE_URL.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(bind=sync_engine)


def _get_job_and_doc(db: Session, job_id: str):
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        raise ValueError(f"Job {job_id} not found")
    doc = db.query(Document).filter(Document.id == job.document_id).first()
    return job, doc


def _download_file_to_tmp(doc: Document) -> str:
    """
    Download file from Cloudinary URL or read from local path.
    Returns the path to the file in /tmp/ for processing.
    """
    tmp_dir = Path("/tmp")
    tmp_dir.mkdir(exist_ok=True)
    
    # Preserve extension to keep parser behavior aligned with original type
    ext = doc.file_type if doc.file_type.startswith(".") else f".{doc.file_type}"
    tmp_filename = f"/tmp/document_{doc.id}{ext}"
    
    # Try Cloudinary URL first if available
    if doc.file_url:
        try:
            print(f"Downloading from Cloudinary: {doc.file_url}")
            response = requests.get(doc.file_url, timeout=30)
            response.raise_for_status()

            with open(tmp_filename, "wb") as f:
                f.write(response.content)
            print(f"Downloaded to {tmp_filename}")
            return tmp_filename
        except requests.HTTPError as e:
            status_code = e.response.status_code if e.response is not None else None
            print(f"Cloudinary direct download failed ({status_code}): {e}")

            # Some Cloudinary setups require signed delivery URLs for raw files.
            if status_code in (401, 403):
                signed_url = _build_signed_cloudinary_url(doc.file_url)
                if signed_url:
                    try:
                        print("Retrying Cloudinary fetch with signed URL")
                        response = requests.get(signed_url, timeout=30)
                        response.raise_for_status()
                        with open(tmp_filename, "wb") as f:
                            f.write(response.content)
                        print(f"Downloaded (signed URL) to {tmp_filename}")
                        return tmp_filename
                    except Exception as signed_err:
                        print(f"Signed URL download failed: {signed_err}")
        except Exception as e:
            print(f"Cloudinary download failed: {e}")

    # Fallback to local file path to avoid failing jobs when Cloudinary delivery is restricted
    if doc.file_path and Path(doc.file_path).exists():
        print(f"Using local file fallback: {doc.file_path}")
        local_path = Path(doc.file_path)
        content = local_path.read_bytes()
        with open(tmp_filename, "wb") as f:
            f.write(content)
        print(f"Copied fallback file to {tmp_filename}")
        return tmp_filename

    raise FileNotFoundError("File not found: neither downloadable Cloudinary URL nor local path available")


def _build_signed_cloudinary_url(file_url: str) -> str | None:
    if not CLOUDINARY_AVAILABLE:
        return None
    if not (settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET):
        return None

    try:
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
        )

        parsed = urlparse(file_url)
        marker = "/upload/"
        if marker not in parsed.path:
            return None

        raw_part = parsed.path.split(marker, 1)[1]
        if raw_part.startswith("v") and "/" in raw_part:
            version_part, maybe_rest = raw_part.split("/", 1)
            if version_part[1:].isdigit():
                raw_part = maybe_rest

        public_part = raw_part.lstrip("/")
        if not public_part:
            return None

        file_format = None
        public_id = public_part
        if "." in public_part.rsplit("/", 1)[-1]:
            public_id, file_format = public_part.rsplit(".", 1)

        signed, _ = cloudinary_url(
            public_id,
            resource_type="raw",
            type="upload",
            format=file_format,
            secure=True,
            sign_url=True,
        )
        return signed
    except Exception as e:
        print(f"Could not build signed Cloudinary URL: {e}")
        return None


def _emit(db: Session, job: ProcessingJob, event_type: str, message: str, progress: int, status: str):
    """Persist event to DB and publish via Redis Pub/Sub."""
    event = JobEvent(
        job_id=job.id,
        event_type=event_type,
        message=message,
        progress=progress,
    )
    db.add(event)
    job.current_stage = event_type
    job.progress = progress
    job.updated_at = datetime.utcnow()
    db.commit()

    publish_progress_sync(
        job_id=str(job.id),
        event_type=event_type,
        message=message,
        progress=progress,
        status=status,
    )


# ─── Text / Content Extraction Helpers ───────────────────────────────────────

def _extract_text_from_file(file_path: str, file_type: str) -> str:
    """Extract raw text from file. Supports PDF, TXT, CSV, JSON, MD."""
    path = Path(file_path)
    if not path.exists():
        return f"[File not found at {file_path}]"

    ext = file_type.lower()

    try:
        if ext == ".pdf":
            try:
                import fitz  # PyMuPDF
                doc = fitz.open(file_path)
                text = "\n".join(page.get_text() for page in doc)
                doc.close()
                return text[:5000] if text else "[Empty PDF]"
            except Exception:
                return "[PDF parsing failed - binary content]"

        elif ext in (".txt", ".md"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()[:5000]

        elif ext == ".csv":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            lines = content.strip().split("\n")
            preview = "\n".join(lines[:20])
            return f"CSV file with {len(lines)} rows.\nPreview:\n{preview}"

        elif ext == ".json":
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return json.dumps(data, indent=2)[:3000]

        elif ext == ".docx":
            return "[DOCX parsing requires python-docx - mocked content]"

        else:
            return f"[Unsupported file type: {ext}]"

    except Exception as e:
        return f"[Error reading file: {str(e)}]"


def _extract_structured_data(raw_text: str, filename: str, file_size: int, file_type: str) -> dict:
    """
    Extract structured fields from raw text.
    In production this could call an LLM or an OCR pipeline.
    Here we do a smart heuristic extraction.
    """
    words = re.findall(r"\b\w+\b", raw_text.lower())
    word_freq: dict[str, int] = {}
    stopwords = {"the", "a", "an", "and", "or", "in", "on", "at", "is", "it",
                 "to", "of", "for", "with", "this", "that", "as", "be", "was", "are"}
    for w in words:
        if len(w) > 3 and w not in stopwords:
            word_freq[w] = word_freq.get(w, 0) + 1

    top_keywords = sorted(word_freq, key=lambda k: word_freq[k], reverse=True)[:10]

    # Derive title
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]
    title = lines[0][:80] if lines else filename

    # Summary: first 3 non-empty lines (or fewer)
    summary_lines = lines[:3] if len(lines) >= 3 else lines
    summary = " ".join(summary_lines)[:300]

    # Category heuristic
    category = _infer_category(top_keywords, file_type)

    # Word / char stats
    word_count = len(words)
    char_count = len(raw_text)

    # Checksum for idempotency
    checksum = hashlib.md5(raw_text.encode()).hexdigest()

    return {
        "title": title,
        "category": category,
        "summary": summary,
        "keywords": top_keywords,
        "word_count": word_count,
        "char_count": char_count,
        "file_metadata": {
            "filename": filename,
            "file_type": file_type,
            "file_size_bytes": file_size,
            "file_size_kb": round(file_size / 1024, 2),
        },
        "content_checksum": checksum,
        "extraction_timestamp": datetime.utcnow().isoformat(),
        "processing_version": "1.0",
    }


def _infer_category(keywords: list[str], file_type: str) -> str:
    category_map = {
        "technical": {"code", "function", "class", "api", "data", "system", "software", "error",
                      "server", "database", "python", "java", "javascript"},
        "financial": {"revenue", "profit", "loss", "budget", "cost", "price", "market",
                      "quarter", "annual", "investment", "financial", "earnings"},
        "legal": {"agreement", "contract", "party", "parties", "clause", "terms", "liability",
                  "pursuant", "whereas", "obligations", "rights"},
        "report": {"report", "analysis", "results", "findings", "conclusion", "summary",
                   "overview", "assessment", "review", "evaluation"},
        "data": {"csv", "column", "rows", "values", "fields", "records", "dataset"},
    }

    if file_type == ".csv":
        return "data"

    scores = {cat: 0 for cat in category_map}
    for kw in keywords:
        for cat, terms in category_map.items():
            if kw in terms:
                scores[cat] += 1

    best = max(scores, key=lambda c: scores[c])
    return best if scores[best] > 0 else "general"


# ─── Main Celery Task ─────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="app.workers.tasks.process_document",
)
def process_document(self, job_id: str):
    """
    Full document processing pipeline.
    Published progress events at each stage via Redis Pub/Sub.
    """
    db: Session = SyncSession()
    file_path_to_process = None

    try:
        job, doc = _get_job_and_doc(db, job_id)

        # Mark as started
        job.status = JobStatus.PROCESSING
        job.started_at = datetime.utcnow()
        job.celery_task_id = self.request.id
        db.commit()

        # ── Stage 1: Document received ──────────────────────────────────────
        _emit(db, job, "document_received", "Document received and queued for processing", 5, "processing")
        time.sleep(0.5)

        # ── Stage 2: Parsing started ────────────────────────────────────────
        _emit(db, job, "parsing_started", f"Parsing document: {doc.original_filename}", 15, "processing")
        time.sleep(0.8)

        # Download file from Cloudinary or use local copy
        file_path_to_process = _download_file_to_tmp(doc)

        # Actual text extraction
        raw_text = _extract_text_from_file(file_path_to_process, doc.file_type)

        # ── Stage 3: Parsing completed ──────────────────────────────────────
        _emit(db, job, "parsing_completed", f"Parsed {len(raw_text)} characters from document", 35, "processing")
        time.sleep(0.6)

        # ── Stage 4: Extraction started ─────────────────────────────────────
        _emit(db, job, "extraction_started", "Extracting structured fields and metadata", 50, "processing")
        time.sleep(1.0)

        # Actual extraction
        structured = _extract_structured_data(
            raw_text=raw_text,
            filename=doc.original_filename,
            file_size=doc.file_size,
            file_type=doc.file_type,
        )

        # ── Stage 5: Extraction completed ───────────────────────────────────
        _emit(db, job, "extraction_completed",
              f"Extracted {len(structured)} fields | Category: {structured.get('category', 'unknown')}",
              75, "processing")
        time.sleep(0.5)

        # ── Stage 6: Store result ────────────────────────────────────────────
        _emit(db, job, "final_result_stored", "Persisting extracted data to database", 90, "processing")
        job.extracted_data = structured
        job.reviewed_data = structured.copy()  # pre-fill reviewed with extracted
        db.commit()
        time.sleep(0.3)

        # ── Stage 7: Completed ───────────────────────────────────────────────
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.completed_at = datetime.utcnow()
        db.commit()
        _emit(db, job, "job_completed", "Processing complete. Ready for review.", 100, "completed")

    except Exception as exc:
        db.rollback()

        try:
            job, doc = _get_job_and_doc(db, job_id)
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            job.updated_at = datetime.utcnow()
            db.commit()
            _emit(db, job, "job_failed", f"Processing failed: {str(exc)}", job.progress, "failed")
        except Exception:
            pass

        # Let Celery handle retries
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 5)

    finally:
        # Cleanup temp file if it was created
        if file_path_to_process and Path(file_path_to_process).exists():
            try:
                Path(file_path_to_process).unlink()
                print(f"Cleaned up temp file: {file_path_to_process}")
            except Exception as e:
                print(f"Failed to clean up temp file: {e}")
        
        db.close()
