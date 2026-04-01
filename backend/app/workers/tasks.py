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
from typing import Any

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

MAX_EXTRACT_CHARS = 20000

SECTION_HEADING_ALIASES: dict[str, set[str]] = {
    "summary": {"summary", "profile", "professional summary", "about", "objective"},
    "experience": {"experience", "work experience", "professional experience", "employment"},
    "education": {"education", "academic", "academics", "qualification", "qualifications"},
    "skills": {"skills", "technical skills", "core skills", "technologies", "tech stack"},
    "projects": {"projects", "project experience", "key projects"},
    "certifications": {"certifications", "certificates", "licenses"},
}


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
                text = _extract_pdf_text_by_blocks(file_path)
                return text if text else "[Empty PDF]"
            except Exception:
                return "[PDF parsing failed - binary content]"

        elif ext in (".txt", ".md"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()[:MAX_EXTRACT_CHARS]

        elif ext == ".csv":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            lines = content.strip().split("\n")
            preview = "\n".join(lines[:20])
            return f"CSV file with {len(lines)} rows.\nPreview:\n{preview}"

        elif ext == ".json":
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return json.dumps(data, indent=2)[:MAX_EXTRACT_CHARS]

        elif ext == ".docx":
            return "[DOCX parsing requires python-docx - mocked content]"

        else:
            return f"[Unsupported file type: {ext}]"

    except Exception as e:
        return f"[Error reading file: {str(e)}]"


def _extract_pdf_text_by_blocks(file_path: str) -> str:
    """Read PDF using positioned text blocks to preserve natural reading order better than plain joined page text."""
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    try:
        ordered_blocks: list[tuple[int, float, float, str]] = []
        for page_index, page in enumerate(doc):
            blocks = page.get_text("blocks")
            for block in blocks:
                x0, y0, _x1, _y1, text, *_ = block
                text = (text or "").strip()
                if not text:
                    continue
                ordered_blocks.append((page_index, float(y0), float(x0), text))

        ordered_blocks.sort(key=lambda b: (b[0], b[1], b[2]))
        joined = "\n".join(block_text for *_coords, block_text in ordered_blocks)
        return joined[:MAX_EXTRACT_CHARS]
    finally:
        doc.close()


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
    sections = _extract_sections(raw_text)

    # Derive title
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]
    title = _derive_title(lines, filename)

    # Summary: section-aware, fallback to first lines
    summary_source = sections.get("summary") or raw_text
    summary_lines = [l.strip() for l in summary_source.split("\n") if l.strip()][:3]
    summary = " ".join(summary_lines)[:300]

    # Category heuristic
    category = _infer_category(top_keywords, file_type, sections, raw_text)

    # Resume-style entity extraction
    emails = _extract_emails(raw_text)
    phones = _extract_phone_numbers(raw_text)
    links = _extract_links(raw_text)
    skills, skills_confidence = _extract_skills(raw_text, sections)
    experience_years, experience_confidence = _extract_experience_years(raw_text, sections)
    education = _extract_education(raw_text, sections)
    location, location_confidence = _extract_location(raw_text, sections)

    # Word / char stats
    word_count = len(words)
    char_count = len(raw_text)

    # Checksum for idempotency
    checksum = hashlib.md5(raw_text.encode()).hexdigest()
    field_confidence = _build_field_confidence(
        title=title,
        summary=summary,
        category=category,
        keywords=top_keywords,
        emails=emails,
        phones=phones,
        links=links,
        skills=skills,
        skills_confidence=skills_confidence,
        experience_years=experience_years,
        experience_confidence=experience_confidence,
        education=education,
        location=location,
        location_confidence=location_confidence,
    )

    return {
        "title": title,
        "category": category,
        "summary": summary,
        "keywords": top_keywords,
        "emails": emails,
        "phone_numbers": phones,
        "links": links,
        "skills": skills,
        "experience_years": experience_years,
        "education": education,
        "location": location,
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
        "processing_version": "1.1",
        "field_confidence": field_confidence,
    }


def _extract_sections(raw_text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {"general": []}
    current = "general"

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        heading = _normalize_heading(line)
        if heading:
            current = heading
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    return {name: "\n".join(lines).strip() for name, lines in sections.items() if lines}


def _normalize_heading(line: str) -> str | None:
    cleaned = re.sub(r"[^a-zA-Z ]", "", line).strip().lower()
    if not cleaned or len(cleaned) > 40:
        return None

    for canonical, aliases in SECTION_HEADING_ALIASES.items():
        if cleaned in aliases:
            return canonical
    return None


def _derive_title(lines: list[str], filename: str) -> str:
    for line in lines[:8]:
        lower = line.lower()
        if "@" in line or re.search(r"(?:\+?\d[\d\s().-]{8,}\d)", line):
            continue
        if len(line) < 2:
            continue
        if _normalize_heading(line):
            continue
        return line[:80]
    return filename


def _extract_emails(raw_text: str) -> list[str]:
    matches = re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw_text)
    unique = []
    seen = set()
    for email in matches:
        email = email.strip().lower()
        key = email
        if key not in seen:
            seen.add(key)
            unique.append(email)
    return unique[:5]


def _extract_phone_numbers(raw_text: str) -> list[str]:
    candidates = re.findall(r"(?:\+?\d[\d\s().-]{8,}\d)", raw_text)
    unique = []
    seen = set()
    for phone in candidates:
        digits = re.sub(r"\D", "", phone)
        if 10 <= len(digits) <= 15:
            normalized = f"+{digits}" if (phone.strip().startswith("+") or len(digits) > 10) else digits
            if normalized not in seen:
                seen.add(normalized)
                unique.append(normalized)
    return unique[:5]


def _extract_links(raw_text: str) -> list[str]:
    url_matches = re.findall(r"(?:https?://|www\.)[^\s<>)\]]+", raw_text)
    unique = []
    seen = set()
    for url in url_matches:
        cleaned = url.rstrip(".,;:")
        if cleaned.startswith("www."):
            cleaned = f"https://{cleaned}"
        key = cleaned.lower()
        if key not in seen:
            seen.add(key)
            unique.append(cleaned)
    return unique[:10]


def _extract_skills(raw_text: str, sections: dict[str, str]) -> tuple[list[str], float]:
    skill_aliases: dict[str, set[str]] = {
        "react": {"react", "reactjs", "react.js"},
        "next.js": {"nextjs", "next.js"},
        "node": {"node", "nodejs", "node.js"},
        "typescript": {"typescript", "ts"},
        "javascript": {"javascript", "js"},
        "python": {"python"},
        "fastapi": {"fastapi"},
        "django": {"django"},
        "flask": {"flask"},
        "sql": {"sql"},
        "postgresql": {"postgresql", "postgres"},
        "mongodb": {"mongodb", "mongo"},
        "redis": {"redis"},
        "docker": {"docker"},
        "kubernetes": {"kubernetes", "k8s"},
        "aws": {"aws"},
        "azure": {"azure"},
        "gcp": {"gcp", "google cloud"},
        "git": {"git"},
        "linux": {"linux"},
        "html": {"html"},
        "css": {"css"},
        "tailwind": {"tailwind"},
        "redux": {"redux"},
        "zustand": {"zustand"},
        "graphql": {"graphql"},
        "rest": {"rest", "rest api"},
        "microservices": {"microservices", "microservice"},
        "jest": {"jest"},
        "pytest": {"pytest"},
        "cypress": {"cypress"},
        "java": {"java"},
        "spring": {"spring", "spring boot"},
        "c++": {"c++", "cpp"},
        "go": {"go", "golang"},
    }

    skills_text = sections.get("skills", "")
    source_text = skills_text if skills_text else raw_text
    lower_text = source_text.lower()

    found: list[str] = []
    for canonical, aliases in skill_aliases.items():
        if any(re.search(r"\b" + re.escape(alias) + r"\b", lower_text) for alias in aliases):
            found.append(canonical)

    confidence = 0.0
    if found:
        confidence = 0.88 if skills_text else 0.68
    return found[:25], confidence


def _extract_experience_years(raw_text: str, sections: dict[str, str]) -> tuple[int | None, float]:
    experience_text = sections.get("experience", "")
    source_text = experience_text if experience_text else raw_text
    matches = re.findall(r"(\d{1,2}(?:\.\d)?)(?:\+)?\s*(?:years?|yrs?)", source_text.lower())
    if not matches:
        return None, 0.0
    values = []
    for m in matches:
        try:
            values.append(float(m))
        except ValueError:
            continue
    if not values:
        return None, 0.0
    confidence = 0.86 if experience_text else 0.65
    return int(max(values)), confidence


def _extract_education(raw_text: str, sections: dict[str, str]) -> list[str]:
    source_text = sections.get("education") or raw_text
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    markers = (
        "b.tech", "btech", "b.e", "be ", "bachelor", "m.tech", "mtech", "master",
        "mca", "bca", "b.sc", "msc", "phd", "university", "college", "school",
    )
    out = []
    seen = set()
    for line in lines:
        lower = line.lower()
        if any(marker in lower for marker in markers):
            cleaned = line[:120]
            key = cleaned.lower()
            if key not in seen:
                seen.add(key)
                out.append(cleaned)
    return out[:5]


def _extract_location(raw_text: str, sections: dict[str, str]) -> tuple[str | None, float]:
    contact_source = "\n".join(filter(None, [sections.get("summary"), sections.get("general")])) or raw_text
    labeled = re.search(r"(?:location|address|based in)\s*[:\-]?\s*([^\n]{2,80})", contact_source, flags=re.IGNORECASE)
    if labeled:
        return labeled.group(1).strip(" ,.-"), 0.85

    city_candidates = [
        "nagpur", "mumbai", "pune", "delhi", "bengaluru", "bangalore", "hyderabad",
        "chennai", "kolkata", "noida", "gurgaon", "ahmedabad", "jaipur", "lucknow",
    ]
    text = raw_text.lower()
    for city in city_candidates:
        if re.search(r"\b" + re.escape(city) + r"\b", text):
            return city.title(), 0.6
    return None, 0.0


def _build_field_confidence(**fields: Any) -> dict[str, float]:
    scores = {
        "title": 0.78 if fields.get("title") else 0.0,
        "summary": 0.7 if fields.get("summary") else 0.0,
        "category": 0.88 if fields.get("category") == "resume" else (0.72 if fields.get("category") and fields.get("category") != "general" else 0.5),
        "keywords": 0.75 if fields.get("keywords") else 0.0,
        "emails": 0.95 if fields.get("emails") else 0.0,
        "phone_numbers": 0.9 if fields.get("phones") else 0.0,
        "links": 0.86 if fields.get("links") else 0.0,
        "skills": float(fields.get("skills_confidence", 0.0)),
        "experience_years": float(fields.get("experience_confidence", 0.0)),
        "education": 0.84 if fields.get("education") else 0.0,
        "location": float(fields.get("location_confidence", 0.0)),
    }
    return {k: round(max(0.0, min(1.0, v)), 2) for k, v in scores.items()}


def _infer_category(keywords: list[str], file_type: str, sections: dict = None, raw_text: str = "") -> str:
    """Infer document category from keywords, file type, sections, and content patterns."""
    if sections is None:
        sections = {}
    
    # Resume detection: Check for resume-specific sections
    has_resume_sections = any(key in sections for key in ["experience", "education", "skills"])
    has_resume_keywords = any(kw in {"resume", "cv", "curriculum", "vitae"} for kw in keywords)
    
    # Check for employment/education patterns in text
    resume_patterns = [
        r"(?i)(professional\s+summary|work\s+experience|employment|education|academic|qualification|skill|technical|certif)",
    ]
    text_has_resume_pattern = any(re.search(pattern, raw_text) for pattern in resume_patterns) if raw_text else False
    
    if has_resume_sections or has_resume_keywords or text_has_resume_pattern:
        return "resume"
    
    category_map = {
        "technical": {"code", "function", "class", "api", "data", "system", "software", "error",
                      "server", "database", "python", "java", "javascript", "algorithm", "debug"},
        "financial": {"revenue", "profit", "loss", "budget", "cost", "price", "market",
                      "quarter", "annual", "investment", "financial", "earnings", "accounting"},
        "legal": {"agreement", "contract", "party", "parties", "clause", "terms", "liability",
                  "pursuant", "whereas", "obligations", "rights", "legal", "law"},
        "report": {"report", "analysis", "results", "findings", "conclusion", "summary",
                   "overview", "assessment", "review", "evaluation", "executive"},
        "data": {"csv", "column", "rows", "values", "fields", "records", "dataset", "table"},
    }

    if file_type == ".csv":
        return "data"

    scores = {cat: 0 for cat in category_map}
    for kw in keywords:
        for cat, terms in category_map.items():
            if kw.lower() in terms:
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
