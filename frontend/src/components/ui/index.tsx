import type { JobStatus } from '../../types'

// ── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_DOTS: Record<JobStatus, string> = {
  queued: '○',
  processing: '◉',
  completed: '●',
  failed: '✕',
  finalized: '◆',
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {STATUS_DOTS[status]} {status}
    </span>
  )
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number        // 0-100
  status?: JobStatus
  showLabel?: boolean
  style?: React.CSSProperties
}

export function ProgressBar({ value, status, showLabel, style }: ProgressBarProps) {
  const cls = status === 'failed' ? 'failed' : status === 'processing' ? 'processing' : ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...style }}>
      <div className="progress-bar-track" style={{ flex: 1 }}>
        <div
          className={`progress-bar-fill ${cls}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {showLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', minWidth: 28 }}>
          {value}%
        </span>
      )}
    </div>
  )
}

// ── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
    />
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--text-3)',
      marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

// ── File size formatter ───────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
