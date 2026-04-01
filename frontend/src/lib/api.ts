import axios from "axios";
import type {
  BulkUploadResponse,
  JobListResponse,
  ProcessingJob,
  ProcessingJobSummary,
  ListFilters,
  ExtractedData,
  AnalyticsData,
} from "../types";

const BASE = (import.meta.env.VITE_API_URL || "") + "/api/v1";

const client = axios.create({ baseURL: BASE });

// ── Upload ──────────────────────────────────────────────────────────────────

export async function uploadDocuments(
  files: File[],
): Promise<BulkUploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await client.post<BulkUploadResponse>("/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listJobs(
  filters: Partial<ListFilters> = {},
): Promise<JobListResponse> {
  const params: Record<string, unknown> = { ...filters };
  if (!params.status) delete params.status;
  if (!params.search) delete params.search;
  if (!params.category) delete params.category;
  if (params.confidence_min === null || params.confidence_min === undefined)
    delete params.confidence_min;
  if (!params.date_from) delete params.date_from;
  if (!params.date_to) delete params.date_to;
  const res = await client.get<JobListResponse>("/jobs", { params });
  return res.data;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalytics(
  category?: string,
  date_from?: string,
  date_to?: string,
): Promise<AnalyticsData> {
  const params: Record<string, unknown> = {};
  if (category) params.category = category;
  if (date_from) params.date_from = date_from;
  if (date_to) params.date_to = date_to;
  const res = await client.get<AnalyticsData>("/jobs/analytics", { params });
  return res.data;
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function getJob(jobId: string): Promise<ProcessingJob> {
  const res = await client.get<ProcessingJob>(`/jobs/${jobId}`);
  return res.data;
}

// ── Polling status ────────────────────────────────────────────────────────────

export async function pollJobStatus(jobId: string): Promise<{
  status: string;
  progress: number;
  event_type: string;
  message: string;
}> {
  const res = await client.get(`/jobs/${jobId}/status`);
  return res.data;
}

// ── Review & Finalize ─────────────────────────────────────────────────────────

export async function updateReview(
  jobId: string,
  reviewedData: ExtractedData,
): Promise<ProcessingJob> {
  const res = await client.patch<ProcessingJob>(`/jobs/${jobId}/review`, {
    reviewed_data: reviewedData,
  });
  return res.data;
}

export async function finalizeJob(
  jobId: string,
  reviewedData?: ExtractedData,
): Promise<ProcessingJob> {
  const res = await client.post<ProcessingJob>(`/jobs/${jobId}/finalize`, {
    reviewed_data: reviewedData ?? null,
  });
  return res.data;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export async function retryJob(jobId: string): Promise<ProcessingJobSummary> {
  const res = await client.post<ProcessingJobSummary>(`/jobs/${jobId}/retry`);
  return res.data;
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteJob(jobId: string): Promise<void> {
  await client.delete(`/jobs/${jobId}`);
}

// ── Export ───────────────────────────────────────────────────────────────────

type ExportOptions = {
  jobIds?: string[];
  includeCompleted?: boolean;
};

export function exportUrl(
  format: "json" | "csv",
  options?: ExportOptions,
): string {
  const params = new URLSearchParams();

  if (options?.jobIds?.length) {
    params.set("job_ids", options.jobIds.join(","));
  }
  if (options?.includeCompleted) {
    params.set("include_completed", "true");
  }

  const query = params.toString();
  return `${BASE}/jobs/export/${format}${query ? `?${query}` : ""}`;
}

export async function triggerExport(
  format: "json" | "csv",
  options?: ExportOptions,
) {
  const url = exportUrl(format, options);
  const a = document.createElement("a");
  a.href = url;
  a.download = `docflow_export.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
