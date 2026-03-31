import { create } from 'zustand';
import type { ProcessingJobSummary, ListFilters, JobStatus } from '../types';

interface JobStore {
  // List state
  jobs: ProcessingJobSummary[];
  total: number;
  loading: boolean;
  filters: ListFilters;

  // Live progress map: jobId -> { progress, status, message, event_type }
  liveProgress: Record<string, {
    progress: number;
    status: string;
    message: string;
    event_type: string;
  }>;

  setJobs: (jobs: ProcessingJobSummary[], total: number) => void;
  setLoading: (v: boolean) => void;
  setFilters: (f: Partial<ListFilters>) => void;
  updateLiveProgress: (jobId: string, data: { progress: number; status: string; message: string; event_type: string }) => void;
  updateJobStatus: (jobId: string, status: JobStatus, progress: number) => void;
  removeJob: (jobId: string) => void;
}

export const useJobStore = create<JobStore>((set) => ({
  jobs: [],
  total: 0,
  loading: false,
  filters: {
    page: 1,
    page_size: 20,
    status: '',
    search: '',
    sort_by: 'created_at',
    sort_dir: 'desc',
  },
  liveProgress: {},

  setJobs: (jobs, total) => set({ jobs, total }),
  setLoading: (loading) => set({ loading }),
  setFilters: (f) =>
    set((s) => ({ filters: { ...s.filters, ...f, page: f.page ?? 1 } })),

  updateLiveProgress: (jobId, data) =>
    set((s) => ({
      liveProgress: { ...s.liveProgress, [jobId]: data },
    })),

  updateJobStatus: (jobId, status, progress) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId ? { ...j, status, progress } : j
      ),
    })),

  removeJob: (jobId) =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.id !== jobId),
      total: Math.max(0, s.total - 1),
    })),
}));
