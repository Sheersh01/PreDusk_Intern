"""
Tests for DocFlow backend.
Run: pytest tests/ -v
"""

import pytest
import json
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from types import SimpleNamespace

from app.services import document_service
from app.api.routes import documents as documents_routes
from app.workers.tasks import _extract_text_from_file, _extract_structured_data, _infer_category


# ── Unit: text extraction helpers ────────────────────────────────────────────

def test_extract_text_missing_file(tmp_path):
    result = _extract_text_from_file(str(tmp_path / "ghost.txt"), ".txt")
    assert "not found" in result.lower()


def test_extract_text_txt(tmp_path):
    f = tmp_path / "sample.txt"
    f.write_text("Hello world. This is a test document for DocFlow.")
    result = _extract_text_from_file(str(f), ".txt")
    assert "Hello world" in result


def test_extract_text_json(tmp_path):
    f = tmp_path / "data.json"
    f.write_text(json.dumps({"name": "DocFlow", "version": "1.0"}))
    result = _extract_text_from_file(str(f), ".json")
    assert "DocFlow" in result


def test_extract_text_csv(tmp_path):
    f = tmp_path / "data.csv"
    f.write_text("id,name,value\n1,Alice,100\n2,Bob,200\n")
    result = _extract_text_from_file(str(f), ".csv")
    assert "2 rows" in result or "rows" in result.lower()


# ── Unit: structured data extraction ─────────────────────────────────────────

def test_extract_structured_returns_all_fields():
    text = "DocFlow System\nThis document describes the DocFlow processing system for async workflows."
    result = _extract_structured_data(text, "docflow.txt", 1024, ".txt")

    assert "title" in result
    assert "category" in result
    assert "summary" in result
    assert "keywords" in result
    assert "word_count" in result
    assert "char_count" in result
    assert "file_metadata" in result
    assert "content_checksum" in result
    assert "field_confidence" in result


def test_extract_structured_title_is_first_line():
    text = "My Document Title\nSome content here."
    result = _extract_structured_data(text, "test.txt", 100, ".txt")
    assert result["title"].startswith("My Document Title")


def test_extract_structured_keywords_are_list():
    text = "The quick brown fox jumps over the lazy system database service code"
    result = _extract_structured_data(text, "test.txt", 100, ".txt")
    assert isinstance(result["keywords"], list)
    assert len(result["keywords"]) <= 10


def test_extract_structured_file_metadata():
    result = _extract_structured_data("content", "sample.pdf", 2048, ".pdf")
    meta = result["file_metadata"]
    assert meta["filename"] == "sample.pdf"
    assert meta["file_type"] == ".pdf"
    assert meta["file_size_bytes"] == 2048
    assert meta["file_size_kb"] == pytest.approx(2.0)


def test_extract_structured_word_count():
    text = "one two three four five"
    result = _extract_structured_data(text, "test.txt", 50, ".txt")
    assert result["word_count"] == 5


def test_checksum_is_md5():
    result = _extract_structured_data("hello", "test.txt", 5, ".txt")
    assert len(result["content_checksum"]) == 32  # MD5 hex length


def test_extract_structured_resume_fields():
    text = (
        "Sheersh Saxena\n"
        "Email: saxenasheersh1@gmail.com\n"
        "Phone: +91 7458902737\n"
        "Location: Nagpur, India\n"
        "Portfolio: https://sheersh.dev\n"
        "LinkedIn: www.linkedin.com/in/sheersh\n"
        "Skills: React, Node, TypeScript, Docker\n"
        "Experience: 3 years in full-stack development\n"
        "B.Tech in Computer Science, XYZ University\n"
    )

    result = _extract_structured_data(text, "resume.pdf", 8192, ".pdf")

    assert "saxenasheersh1@gmail.com" in result["emails"]
    assert any("7458902737" in p for p in result["phone_numbers"])
    assert any("sheersh.dev" in u for u in result["links"])
    assert "react" in result["skills"]
    assert result["experience_years"] == 3
    assert any("b.tech" in line.lower() for line in result["education"])
    assert result["location"] in ("Nagpur, India", "Nagpur")
    assert isinstance(result["field_confidence"], dict)
    assert result["field_confidence"].get("emails", 0) > 0


# ── Unit: category inference ──────────────────────────────────────────────────

def test_category_technical():
    keywords = ["code", "function", "api", "server", "database"]
    assert _infer_category(keywords, ".txt") == "technical"


def test_category_financial():
    keywords = ["revenue", "profit", "budget", "investment", "earnings"]
    assert _infer_category(keywords, ".txt") == "financial"


def test_category_csv_always_data():
    keywords = ["hello", "world"]
    assert _infer_category(keywords, ".csv") == "data"


def test_category_unknown_defaults_general():
    keywords = ["hello", "world", "random", "stuff"]
    assert _infer_category(keywords, ".txt") == "general"


# ── Unit: publish_progress_sync (mocked) ─────────────────────────────────────

def test_publish_progress_sync_calls_redis():
    with patch("app.core.redis_pubsub.get_sync_redis") as mock_get:
        mock_client = MagicMock()
        mock_get.return_value = mock_client

        from app.core.redis_pubsub import publish_progress_sync
        publish_progress_sync(
            job_id="test-123",
            event_type="parsing_started",
            message="Parsing document",
            progress=15,
            status="processing",
        )

        mock_client.publish.assert_called_once()
        channel, payload_str = mock_client.publish.call_args[0]
        assert channel == "job_progress:test-123"

        payload = json.loads(payload_str)
        assert payload["event_type"] == "parsing_started"
        assert payload["progress"] == 15
        assert payload["status"] == "processing"

        mock_client.setex.assert_called_once()
        mock_client.close.assert_called_once()


# ── Unit: export filtering behavior ──────────────────────────────────────────

def test_export_jobs_json_default_excludes_completed():
    fake_db = AsyncMock()
    fake_job = SimpleNamespace(reviewed_data={}, extracted_data={}, document=None, status=SimpleNamespace(value="finalized"), completed_at=None, retry_count=0, id="j1")

    with patch("app.services.document_service._fetch_export_jobs", AsyncMock(return_value=[fake_job])) as mock_fetch:
        with patch("app.services.document_service._job_to_export_dict", return_value={"status": "finalized"}):
            output = asyncio.run(document_service.export_jobs_json(fake_db))

    assert '"status": "finalized"' in output
    assert mock_fetch.await_count == 1
    assert mock_fetch.await_args.kwargs["include_completed"] is False


def test_export_jobs_json_allows_include_completed_opt_in():
    fake_db = AsyncMock()

    with patch("app.services.document_service._fetch_export_jobs", AsyncMock(return_value=[])) as mock_fetch:
        asyncio.run(document_service.export_jobs_json(fake_db, include_completed=True))

    assert mock_fetch.await_count == 1
    assert mock_fetch.await_args.kwargs["include_completed"] is True


def test_export_routes_forward_include_completed_flag():
    fake_db = AsyncMock()

    with patch("app.api.routes.documents.document_service.export_jobs_json", AsyncMock(return_value="[]")) as mock_json:
        asyncio.run(documents_routes.export_json(job_ids=None, include_completed=True, db=fake_db))
    assert mock_json.await_count == 1
    assert mock_json.await_args.kwargs["include_completed"] is True

    with patch("app.api.routes.documents.document_service.export_jobs_csv", AsyncMock(return_value="")) as mock_csv:
        asyncio.run(documents_routes.export_csv(job_ids=None, include_completed=True, db=fake_db))
    assert mock_csv.await_count == 1
    assert mock_csv.await_args.kwargs["include_completed"] is True
