import { useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, RefreshCw, Download, ChevronUp, ChevronDown,
  Trash2, RotateCcw, ExternalLink, FileText
} from 'lucide-react'
import { listJobs, retryJob, deleteJob, triggerExport } from '../lib/api'
import { StatusBadge, ProgressBar, Spinner, formatBytes } from '../components/ui'
import { useSSEProgress } from '../hooks/useSSEProgress'
import { useJobStore } from '../store/jobStore'
import { formatDistanceToNow } from 'date-fns'
import type { JobStatus, ProcessingJobSummary } from '../types'

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'finalized', label: 'Finalized' },
]

// ── Live row: subscribes to SSE for a single job ──────────────────────────────
function LiveJobRow({ job, onNavigate, onRetry, onDelete }: {
  job: ProcessingJobSummary
  onNavigate: (id: string) => void
  onRetry: (id: string) => void
  onDelete: (id: string) => void
}) {
  const liveProgress = useJobStore(s => s.liveProgress[job.id])
  const updateLiveProgress = useJobStore(s => s.updateLiveProgress)
  const updateJobStatus = useJobStore(s => s.updateJobStatus)

  const isActive = job.status === 'queued' || job.status === 'processing'

  useSSEProgress({
    jobId: job.id,
    enabled: isActive,
    onEvent: (e) => {
      updateLiveProgress(job.id, {
        progress: e.progress,
        status: e.status,
        message: e.message,
        event_type: e.event_type,
      })
      if (['completed', 'failed', 'finalized'].includes(e.status)) {
        updateJobStatus(job.id, e.status as JobStatus, e.progress)
      }
    },
  })

  const progress = liveProgress?.progress ?? job.progress
  const status = (liveProgress?.status as JobStatus) ?? job.status
  const message = liveProgress?.message

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={13} color="var(--text-3)" />
          <div style={{ minWidth: 0 }}>
            <div
              className="truncate"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, maxWidth: 220, cursor: 'pointer', color: 'var(--text)' }}
              onClick={() => onNavigate(job.id)}
            >
              {job.document?.original_filename ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
              {job.document ? formatBytes(job.document.file_size) : ''} · {job.document?.file_type}
            </div>
          </div>
        </div>
      </td>

      <td><StatusBadge status={status} /></td>

      <td style={{ minWidth: 160 }}>
        <ProgressBar value={progress} status={status} showLabel />
        {message && status === 'processing' && (
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
            {message}
          </div>
        )}
      </td>

      <td>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
          {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
        </span>
      </td>

      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onNavigate(job.id)}
            title="View detail"
          >
            <ExternalLink size={11} />
          </button>
          {status === 'failed' && job.retry_count < 3 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onRetry(job.id)}
              title="Retry"
            >
              <RotateCcw size={11} />
            </button>
          )}
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onDelete(job.id)}
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    jobs, total, loading, filters,
    setJobs, setLoading, setFilters, removeJob,
  } = useJobStore()

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listJobs(filters)
      setJobs(res.items, res.total)
    } catch {
      setJobs([], 0)
    } finally {
      setLoading(false)
    }
  }, [filters, setJobs, setLoading])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Auto-refresh every 8s for active jobs
  useEffect(() => {
    const timer = setInterval(fetchJobs, 8000)
    return () => clearInterval(timer)
  }, [fetchJobs])

  const handleSearch = (value: string) => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setFilters({ search: value, page: 1 }), 300)
  }

  const handleSort = (col: string) => {
    if (filters.sort_by === col) {
      setFilters({ sort_dir: filters.sort_dir === 'asc' ? 'desc' : 'asc' })
    } else {
      setFilters({ sort_by: col, sort_dir: 'desc' })
    }
  }

  const handleRetry = async (id: string) => {
    await retryJob(id)
    fetchJobs()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this job and its document?')) return
    await deleteJob(id)
    removeJob(id)
  }

  const totalPages = Math.ceil(total / filters.page_size) || 1

  const SortIcon = ({ col }: { col: string }) => {
    if (filters.sort_by !== col) return null
    return filters.sort_dir === 'asc'
      ? <ChevronUp size={11} />
      : <ChevronDown size={11} />
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{total} document{total !== 1 ? 's' : ''} in system</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchJobs} title="Refresh">
            {loading ? <Spinner size={12} /> : <RefreshCw size={12} />}
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              // simple dropdown-less export
              const menu = document.getElementById('export-menu')
              if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none'
            }}>
              <Download size={12} /> Export
            </button>
            <div id="export-menu" style={{
              display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', minWidth: 130, zIndex: 10,
            }}>
              {['json', 'csv'].map(fmt => (
                <button
                  key={fmt}
                  style={{
                    display: 'block', width: '100%', background: 'none', border: 'none',
                    padding: '8px 14px', textAlign: 'left', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)',
                  }}
                  onClick={() => {
                    triggerExport(fmt as 'json' | 'csv')
                    document.getElementById('export-menu')!.style.display = 'none'
                  }}
                >
                  Export as .{fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 160 }}>
          <Search size={12} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-3)', pointerEvents: 'none',
          }} />
          <input
            className="input"
            placeholder="Search by filename..."
            style={{ paddingLeft: 30 }}
            defaultValue={filters.search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <select
          className="input"
          style={{ flex: '0 0 160px' }}
          value={filters.status}
          onChange={e => setFilters({ status: e.target.value as JobStatus | '' })}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="input"
          style={{ flex: '0 0 120px' }}
          value={filters.page_size}
          onChange={e => setFilters({ page_size: Number(e.target.value) })}
        >
          {[10, 20, 50].map(n => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort('created_at')}>
                  Document <SortIcon col="created_at" />
                </th>
                <th className="sortable" onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th>Progress</th>
                <th className="sortable" onClick={() => handleSort('created_at')}>
                  Created <SortIcon col="created_at" />
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px 0' }}>
                    <Spinner size={18} />
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <FileText size={32} />
                      <p>No documents found</p>
                    </div>
                  </td>
                </tr>
              ) : jobs.map(job => (
                <LiveJobRow
                  key={job.id}
                  job={job}
                  onNavigate={id => navigate(`/jobs/${id}`)}
                  onRetry={handleRetry}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px', borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', flex: 1 }}>
              Page {filters.page} of {totalPages} · {total} total
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={filters.page <= 1}
              onClick={() => setFilters({ page: filters.page - 1 })}
            >
              ← Prev
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ page: filters.page + 1 })}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
