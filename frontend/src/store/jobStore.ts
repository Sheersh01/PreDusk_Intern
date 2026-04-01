import { create } from "zustand";
import type {
  ProcessingJobSummary,
  ListFilters,
  JobStatus,
  AnalyticsData,
} from "../types";

interface JobStore {
  // List state
  jobs: ProcessingJobSummary[];
  total: number;
  loading: boolean;
  filters: ListFilters;

  // Analytics state
  analytics: AnalyticsData | null;
  analyticsLoading: boolean;

  // Live progress map: jobId -> { progress, status, message, event_type }
  liveProgress: Record<
    string,
    {
      progress: number;
      status: string;
      message: string;
      event_type: string;
    }
  >;

  setJobs: (jobs: ProcessingJobSummary[], total: number) => void;
  setLoading: (v: boolean) => void;
  setFilters: (f: Partial<ListFilters>) => void;
  setAnalytics: (data: AnalyticsData | null) => void;
  setAnalyticsLoading: (v: boolean) => void;
  updateLiveProgress: (
    jobId: string,
    data: {
      progress: number;
      status: string;
      message: string;
      event_type: string;
    },
  ) => void;
  updateJobStatus: (jobId: string, status: JobStatus, progress: number) => void;
  removeJob: (jobId: string) => void;
}

export const useJobStore = create<JobStore>((set) => ({
  jobs: [],
  total: 0,
  loading: false,
  analytics: null,
  analyticsLoading: false,
  filters: {
    page: 1,
    page_size: 20,
    status: "",
    search: "",
    category: "",
    confidence_min: undefined,
    date_from: undefined,
    date_to: undefined,
    sort_by: "created_at",
    sort_dir: "desc",
  },
  liveProgress: {},

  setJobs: (jobs, total) => set({ jobs, total }),
  setLoading: (loading) => set({ loading }),
  setFilters: (f) =>
    set((s) => ({ filters: { ...s.filters, ...f, page: f.page ?? 1 } })),
  setAnalytics: (analytics) => set({ analytics }),
  setAnalyticsLoading: (analyticsLoading) => set({ analyticsLoading }),

  updateLiveProgress: (jobId, data) =>
    set((s) => ({
      liveProgress: { ...s.liveProgress, [jobId]: data },
    })),

  updateJobStatus: (jobId, status, progress) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId ? { ...j, status, progress } : j,
      ),
    })),

  removeJob: (jobId) =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.id !== jobId),
      total: Math.max(0, s.total - 1),
    })),
}));
