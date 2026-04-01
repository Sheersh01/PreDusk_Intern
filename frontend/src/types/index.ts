export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "finalized";

export interface DocumentRecord {
  id: string;
  filename: string;
  original_filename: string;
  file_size: number;
  file_type: string;
  mime_type: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface JobEvent {
  id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  progress: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ExtractedData {
  title?: string;
  category?: string;
  summary?: string;
  keywords?: string[];
  word_count?: number;
  char_count?: number;
  file_metadata?: {
    filename: string;
    file_type: string;
    file_size_bytes: number;
    file_size_kb: number;
  };
  content_checksum?: string;
  extraction_timestamp?: string;
  processing_version?: string;
  field_confidence?: Record<string, number>;
  [key: string]: unknown;
}

export interface ProcessingJob {
  id: string;
  document_id: string;
  celery_task_id: string | null;
  status: JobStatus;
  current_stage: string | null;
  progress: number;
  extracted_data: ExtractedData | null;
  reviewed_data: ExtractedData | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  events: JobEvent[];
  document: DocumentRecord | null;
}

export interface ProcessingJobSummary {
  id: string;
  document_id: string;
  status: JobStatus;
  current_stage: string | null;
  progress: number;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
  document: DocumentRecord | null;
}

export interface UploadResponse {
  document: DocumentRecord;
  job: ProcessingJobSummary;
}

export interface BulkUploadResponse {
  results: UploadResponse[];
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface JobListResponse {
  items: ProcessingJobSummary[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface SSEProgressEvent {
  job_id: string;
  event_type: string;
  message: string;
  progress: number;
  status: string;
  timestamp: string;
}

export interface ListFilters {
  page: number;
  page_size: number;
  status?: JobStatus | "";
  search?: string;
  category?: string;
  confidence_min?: number;
  date_from?: string;
  date_to?: string;
  sort_by: string;
  sort_dir: "asc" | "desc";
}

export interface AnalyticsData {
  top_skills: { skill: string; count: number }[];
  category_distribution: { category: string; count: number }[];
  experience_distribution: { range: string; count: number }[];
  location_distribution: { location: string; count: number }[];
  total_documents: number;
  total_with_confidence: number;
  avg_confidence: number;
}
