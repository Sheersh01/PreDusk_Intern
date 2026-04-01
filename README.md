# DocFlow — Async Document Processing Workflow System

A production-style full-stack application for uploading documents, processing them asynchronously through a multi-stage pipeline, tracking real-time progress, reviewing and editing extracted output, and exporting finalized results.

---

## Demo

Demo video (3–5 min): `ADD_YOUR_VIDEO_LINK_HERE`

Suggested walkthrough: upload -> live progress -> detail review -> edit -> finalize -> export.

---

## Tech Stack

| Layer              | Technology                                        |
| ------------------ | ------------------------------------------------- |
| Frontend           | React 18 + Vite + TypeScript                      |
| Frontend Routing   | React Router 6                                    |
| Frontend UI        | Lucide React Icons, react-dropzone                |
| Frontend State     | Zustand                                           |
| Frontend Auth      | Dummy auth (localStorage) + route guards          |
| Backend            | Python 3.11 + FastAPI                             |
| Database           | PostgreSQL 15                                     |
| Background workers | Celery 5                                          |
| Broker / Pub-Sub   | Redis 7                                           |
| Progress streaming | Server-Sent Events (SSE)                          |
| ORM                | SQLAlchemy 2 (async) + asyncpg                    |
| File Storage       | Cloudinary (CDN) + Local filesystem (fallback)    |
| Document parsing   | PyMuPDF (PDF), python-magic (file type detection) |
| Containerisation   | Docker Compose                                    |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React + Vite (5173)                       │
│  UploadPage  │  DashboardPage  │  DetailPage                     │
│     SSE client (EventSource)  │  Axios REST client               │
│       react-router-dom for routing & navigation                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │  HTTP / SSE
┌───────────────────────▼─────────────────────────────────────────┐
│                     FastAPI  (8000)                              │
│  POST /upload    GET /jobs    GET /jobs/:id/progress  (SSE)      │
│  PATCH /review   POST /finalize   POST /retry   GET /export      │
│  GET /health                                                     │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │  API Routes  │ → │Service Layer │ → │  PostgreSQL (5432)   │ │
│  └──────────────┘   └──────────────┘   └──────────────────────┘ │
│           │                                                      │
│  ├→ Upload to Cloudinary (if configured)                         │
│  └→ Save locally as fallback                                     │
│                                                                  │
│  apply_async()  (Celery task dispatch)                           │
└───────────┬─────────────────────────────────────────────────────┘
            │  Redis broker (DB 1)
┌───────────▼─────────────────────────────────────────────────────┐
│                   Celery Worker  (concurrency=4)                 │
│  process_document task                                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 1: Acquire file (Cloudinary or local fallback)      │   │
│  │  ├→ Try Cloudinary download (if URL exists)              │   │
│  │  ├→ Fallback to signed Cloudinary URL (if 401/403)       │   │
│  │  └→ Fallback to /uploads directory if Cloudinary fails   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Stage 1: document_received          (5%)                        │
│  Stage 2: parsing_started            (15%)                       │
│           → extract raw text (PDF/TXT/CSV/JSON/MD)              │
│  Stage 3: parsing_completed          (35%)                       │
│  Stage 4: extraction_started         (50%)                       │
│           → build structured fields (title, keywords, etc.)      │
│  Stage 5: extraction_completed       (75%)                       │
│  Stage 6: final_result_stored        (90%)                       │
│           → persist to PostgreSQL                                │
│  Stage 7: job_completed / job_failed (100% or ERR)               │
│           │                                                      │
│  publish_progress_sync() → Redis Pub/Sub (DB 0)                  │
└───────────┬─────────────────────────────────────────────────────┘
            │  PUBLISH job_progress:{job_id}
┌───────────▼─────────────────────────────────────────────────────┐
│  FastAPI SSE handler subscribes to Redis channel                 │
│  → streams events to browser via text/event-stream              │
└─────────────────────────────────────────────────────────────────┘
```

### Key design decisions

- **No processing in request handlers.** Upload endpoint saves the file locally, uploads to Cloudinary (if configured), creates DB records, and calls `apply_async()`. The response returns immediately with job metadata.
- **Dual-storage strategy.** Files are stored on Cloudinary for scalability and CDN delivery. Local storage (`/uploads`) serves as a fallback when Cloudinary is unreachable or unconfigured, ensuring resilience.
- **Dynamic Cloudinary retrieval.** Workers first attempt to download from Cloudinary URL; if delivery is restricted (401/403), they try signed URLs. If both fail, they fall back to the local copy.
- **Redis Pub/Sub for decoupled progress events.** Workers publish to `job_progress:{job_id}`; FastAPI SSE handlers subscribe per-job. A `job_status:{job_id}` key is also written as a polling fallback.
- **SSE over WebSockets.** SSE is simpler, HTTP/1.1 compatible, and sufficient for one-directional progress streaming. No upgrade handshake needed.
- **Sync DB session in Celery, async in FastAPI.** Celery workers use a psycopg2-backed sync engine; FastAPI uses asyncpg. Both share the same PostgreSQL instance.
- **Service layer isolation.** All DB queries and business rules live in `app/services/document_service.py`. Routes are thin — they validate, delegate, and return.
- **Idempotent retry.** Retry increments `retry_count`, resets state, and dispatches a new Celery task. The same processing logic is re-run cleanly.

---

## Project Structure

```
docflow/
├── docker-compose.yml
├── samples/                        # Test files and sample exports
│   ├── sample_document.txt
│   ├── sample_data.csv
│   ├── sample_config.json
│   ├── sample_export.json
│   └── sample_export.csv
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI app + lifespan
│       ├── core/
│       │   ├── config.py           # Pydantic settings
│       │   └── redis_pubsub.py     # Pub/Sub helpers (sync + async)
│       ├── db/
│       │   └── session.py          # SQLAlchemy engine + get_db
│       ├── models/
│       │   └── document.py         # Document, ProcessingJob, JobEvent
│       ├── schemas/
│       │   └── document.py         # Pydantic request/response schemas
│       ├── services/
│       │   └── document_service.py # Business logic
│       ├── api/routes/
│       │   └── documents.py        # All API endpoints
│       └── workers/
│           ├── celery_app.py       # Celery config
│           └── tasks.py            # process_document task
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
    ├── App.tsx                 # Routes + Topbar + auth-aware navigation
        ├── index.css               # Design system
        ├── types/index.ts          # Shared TypeScript types
    ├── auth/
    │   ├── auth.ts             # Dummy auth (login/logout/session expiry)
    │   └── RequireAuth.tsx     # Protected route wrapper
        ├── lib/api.ts              # Axios API client
        ├── hooks/
        │   └── useSSEProgress.ts   # EventSource hook
        ├── store/
        │   └── jobStore.ts         # Zustand global state
        ├── components/ui/
        │   └── index.tsx           # StatusBadge, ProgressBar, Spinner, etc.
        └── pages/
      ├── LoginPage.tsx
            ├── UploadPage.tsx
            ├── DashboardPage.tsx
            └── DetailPage.tsx
```

---

## Setup & Run Instructions

### Option A — Docker Compose (recommended)

**Prerequisites:** Docker Desktop or Docker Engine + Compose plugin.

```bash
# Clone / enter the repo
cd docflow

# Build and start all services
docker compose up --build

# Services will be available at:
#   Frontend:  http://localhost:5173
#   Backend:   http://localhost:8000
#   API docs:  http://localhost:8000/docs
```

All tables are created automatically on first backend start via `init_db()`.

To stop:

```bash
docker compose down          # keep volumes
docker compose down -v       # also remove data volumes
```

---

### Option B — Local development (without Docker)

**Prerequisites:** Python 3.11+, Node 20+, PostgreSQL 15, Redis 7.

#### 1. Start infrastructure

```bash
# PostgreSQL
createdb docflow_db
# or via psql:
psql -c "CREATE USER docflow WITH PASSWORD 'docflow_secret'; CREATE DATABASE docflow_db OWNER docflow;"

# Redis
redis-server
```

#### 2. Backend

```bash
cd backend

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure environment (copy and edit as needed)
cp .env.example .env

# Start API server
uvicorn app.main:app --reload --port 8000

# In a separate terminal — start Celery worker
celery -A app.workers.celery_app worker --loglevel=info --concurrency=4
```

#### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# App at http://localhost:5173
```

#### Environment variables (backend `.env`)

```env
# Database
DATABASE_URL=postgresql+asyncpg://docflow:docflow_secret@localhost:5432/docflow_db
DATABASE_URL_SYNC=postgresql+psycopg2://docflow:docflow_secret@localhost:5432/docflow_db

# Redis
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2

# File storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50
ALLOWED_EXTENSIONS=[.pdf, .txt, .docx, .csv, .json, .md]

# Cloudinary (optional, but recommended for production)
# Leave empty to use local storage only
USE_CLOUDINARY=true
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# App
DEBUG=true
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]
```

---

## File Storage & Cloudinary Configuration

DocFlow supports two storage modes:

### Local Storage Only (Default)

To use local filesystem storage without Cloudinary:

```env
USE_CLOUDINARY=false
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50
```

Files are saved to `./uploads` and processed from there. This is ideal for development and small deployments.

### Cloudinary + Local Fallback (Recommended for Production)

To enable Cloudinary as the primary storage with local fallback:

```env
USE_CLOUDINARY=true
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
UPLOAD_DIR=./uploads
```

**How it works:**

1. **Upload phase:** File is saved locally AND uploaded to Cloudinary (generates a CDN URL).
2. **Processing phase:** Worker downloads from Cloudinary URL first. If delivery is restricted (401/403), it tries a signed URL. If both fail, it falls back to the local copy.
3. **Resilience:** Local storage ensures that even if Cloudinary is unavailable or unreachable, processing continues.

**Getting Cloudinary credentials:**

1. Sign up at [cloudinary.com](https://cloudinary.com)
2. Go to Dashboard → Settings
3. Copy your **Cloud Name**, **API Key**, and **API Secret**
4. Set environment variables with these values

---

## Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

The test suite covers:

- Text extraction for `.txt`, `.json`, `.csv`, `.pdf` formats
- Missing file handling
- Structured data field extraction (title, keywords, word count, checksum)
- Category inference heuristics
- Redis Pub/Sub publish (mocked)
- File upload and validation
- Job state transitions

---

## Dummy Auth (Frontend Only)

The app includes a lightweight demo authentication flow on the frontend.

- `/login` page accepts any username (dummy login).
- Protected routes: `/`, `/upload`, `/jobs/:jobId`.
- Logout button is available in the top bar when logged in.
- Sessions are stored in localStorage and expire automatically.

### Session expiry

- Default expiry: **8 hours**.
- Expiry is checked whenever auth state is read.
- If expired, the session is removed and protected routes redirect to `/login`.

To override session duration for local testing:

```js
localStorage.setItem("docflow_dummy_session_hours", "2"); // 2-hour session
```

### Environment badge on login screen

Login screen shows an auth environment badge:

- `Local Mode` on `localhost` / `127.0.0.1`
- `Demo Mode` on deployed hosts

---

## API Reference

| Method   | Endpoint                     | Description                                                        |
| -------- | ---------------------------- | ------------------------------------------------------------------ |
| `POST`   | `/api/v1/upload`             | Upload one or more documents                                       |
| `GET`    | `/api/v1/jobs`               | List jobs with search / filter / sort / paginate                   |
| `GET`    | `/api/v1/jobs/{id}`          | Full job detail with events                                        |
| `GET`    | `/api/v1/jobs/{id}/progress` | SSE stream for live progress                                       |
| `GET`    | `/api/v1/jobs/{id}/status`   | Polling fallback (Redis key)                                       |
| `PATCH`  | `/api/v1/jobs/{id}/review`   | Save reviewed/edited data                                          |
| `POST`   | `/api/v1/jobs/{id}/finalize` | Finalize a completed job (`400` for invalid states)                |
| `POST`   | `/api/v1/jobs/{id}/retry`    | Retry a failed job                                                 |
| `GET`    | `/api/v1/jobs/export/json`   | Export finalized jobs as JSON (`?include_completed=true` optional) |
| `GET`    | `/api/v1/jobs/export/csv`    | Export finalized jobs as CSV (`?include_completed=true` optional)  |
| `DELETE` | `/api/v1/jobs/{id}`          | Delete job and document                                            |

Interactive docs available at `http://localhost:8000/docs`.

### Dashboard Export Options

The dashboard export menu supports grouped options:

- **All Jobs**
  - Finalized only (`.json`, `.csv`)
  - Completed + finalized (`.json`, `.csv`)
- **Current Page**
  - Finalized only (`.json`, `.csv`)
  - Completed + finalized (`.json`, `.csv`)

Implementation notes:

- `include_completed=true` includes completed records in addition to finalized.
- `job_ids` query parameter exports only selected jobs from the current page.

---

## Processing Pipeline Detail

Each document runs through this Celery task sequence with Redis Pub/Sub events:

```
job_queued           (0%)  — job created, task dispatched
document_received    (5%)  — worker picked up task
parsing_started      (15%) — file read initiated
parsing_completed    (35%) — raw text extracted
extraction_started   (50%) — field analysis started
extraction_completed (75%) — structured data ready
final_result_stored  (90%) — data persisted to DB
job_completed        (100%)— done, ready for review

job_failed           (any) — on exception, with error message
```

Each event is:

1. Persisted as a `JobEvent` row in PostgreSQL
2. Published to Redis channel `job_progress:{job_id}`
3. Written to Redis key `job_status:{job_id}` (TTL 1 hour) for polling fallback
4. Streamed to connected SSE clients

SSE behavior notes:

- Pub/Sub read timeouts do not terminate the stream.
- Stream closes only on client disconnect or terminal job statuses.

---

## Assumptions

- Processing logic is heuristic (keyword frequency, line-based title extraction). The architecture is production-grade; the NLP is intentionally simple.
- **File storage uses Cloudinary** for scalability and CDN delivery when configured. Local storage (`/uploads`) is a fallback. `USE_CLOUDINARY=false` disables Cloudinary and uses local storage only.
- **Supported formats**: PDF (via PyMuPDF), TXT, Markdown, CSV, JSON, and DOCX (mocked—no actual parsing, requires `python-docx` to implement).
- Authentication is currently frontend-only dummy auth for demo UX. Backend APIs are not protected by JWT/OAuth yet.
- A single Celery queue (`documents`) is used. For scale, separate queues per priority or document type would be straightforward.
- SSE connections auto-close on terminal job states. Clients reconnect if they navigate back to a processing job.

---

## Tradeoffs

| Decision                                         | Rationale                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Cloudinary + Local storage                       | Cloudinary provides CDN and scalability; local storage ensures resilience. Fallback prevents uploads from failing without backups |
| SSE over WebSocket                               | Simpler, stateless, works through HTTP proxies. Sufficient for unidirectional progress.                                           |
| Sync SQLAlchemy in Celery                        | Celery workers run in their own process/thread pool without an async event loop. Using sync psycopg2 avoids event loop conflicts. |
| Redis dual-role (broker + pubsub)                | Reduces infrastructure surface area. Separate DBs (0, 1, 2) prevent key collisions.                                               |
| `reviewed_data` pre-filled from `extracted_data` | User sees extracted results immediately on the review screen without having to copy them manually.                                |
| DB-persisted events + Redis Pub/Sub              | Events in DB give permanent audit trail. Redis gives low-latency live streaming. Both serve different consumers.                  |
| Heuristic text extraction over ML                | Fast, deterministic, no ML model overhead. For production NLP, integrate LLM APIs (OpenAI, Anthropic, etc.).                      |

---

## Known Limitations

- **DOCX parsing is mocked** (returns placeholder text). Full DOCX support requires installing and integrating `python-docx`, which is not included to keep dependencies lean.
- **Cloudinary dependency:** If `USE_CLOUDINARY=true` but credentials are missing/invalid, the upload fails. Set `USE_CLOUDINARY=false` or provide valid credentials.
- **Signed URL generation:** When Cloudinary enforces delivery restrictions (401/403), fallback retrieval requires the stored local file. Network-only storage (no local copy) will fail in that scenario.
- No file deduplication (same file can be uploaded twice, creating separate jobs).
- SSE reconnection on network drop is handled by the browser's native EventSource retry, but no explicit resume-from-offset is implemented.
- Default export returns finalized jobs only; `include_completed=true` can broaden the scope.
- No rate limiting on upload endpoint.
- Dummy auth is client-side only (localStorage). It is not security-grade authentication.

---

## Bonus Features Implemented

- [x] Docker Compose setup
- [x] Test suite (pytest)
- [x] Idempotent retry handling (retry_count + max_retries guard)
- [x] Polling fallback (`/status` endpoint via Redis key)
- [x] Clean deployment-ready structure
- [x] Dummy login/logout with protected routes
- [x] Session expiry with auto-logout

---

## AI Tools Note

This project was developed with assistance from Claude (Anthropic) for code generation, architectural scaffolding, and documentation drafting. All generated code was reviewed, understood, and validated before inclusion.
