import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  CheckSquare,
  RotateCcw,
  Download,
  FileText,
  Clock,
  Hash,
  Tag,
  AlignLeft,
  List,
  Activity,
} from "lucide-react";
import {
  getJob,
  updateReview,
  finalizeJob,
  retryJob,
  triggerExport,
} from "../lib/api";
import {
  StatusBadge,
  ProgressBar,
  SectionLabel,
  Spinner,
  formatBytes,
} from "../components/ui";
import { useSSEProgress } from "../hooks/useSSEProgress";
import { formatDistanceToNow, format } from "date-fns";
import { parseApiDate } from "../lib/datetime";
import type { ProcessingJob, ExtractedData } from "../types";

// ── Editable field component ──────────────────────────────────────────────────
function EditableField({
  label,
  icon,
  value,
  onChange,
  multiline,
  tags,
}: {
  label: string;
  icon: React.ReactNode;
  value: string | string[] | number | undefined;
  onChange: (v: string | string[]) => void;
  multiline?: boolean;
  tags?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const displayVal = Array.isArray(value)
    ? value.join(", ")
    : String(value ?? "");

  const startEdit = () => {
    setDraft(displayVal);
    setEditing(true);
  };
  const commit = () => {
    if (tags) {
      onChange(
        draft
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else {
      onChange(draft);
    }
    setEditing(false);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ color: "var(--text-3)" }}>{icon}</span>
        <SectionLabel>{label}</SectionLabel>
      </div>
      {editing ? (
        <div style={{ display: "flex", gap: 6 }}>
          {multiline ? (
            <textarea
              autoFocus
              className="input"
              style={{
                resize: "vertical",
                minHeight: 80,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
              }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
            />
          ) : (
            <input
              autoFocus
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          )}
          <button className="btn btn-ghost btn-sm" onClick={commit}>
            OK
          </button>
        </div>
      ) : (
        <div
          onClick={startEdit}
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            cursor: "text",
            minHeight: 36,
            fontSize: 13,
            color: displayVal ? "var(--text)" : "var(--text-3)",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-bright)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--border)")
          }
        >
          {tags && Array.isArray(value) ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(value as string[]).map((kw, i) => (
                <span key={i} className="tag">
                  {kw}
                </span>
              ))}
              {value.length === 0 && (
                <span style={{ color: "var(--text-3)" }}>
                  Click to add keywords...
                </span>
              )}
            </div>
          ) : (
            displayVal || (
              <span style={{ color: "var(--text-3)" }}>Click to edit...</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── Event timeline ────────────────────────────────────────────────────────────
function EventTimeline({ events }: { events: ProcessingJob["events"] }) {
  const getEventDotColor = (eventType: string) => {
    const stageColorMap: Record<string, string> = {
      job_queued: "var(--blue)",
      document_received: "var(--yellow)",
      parsing_started: "var(--accent-2)",
      parsing_completed: "var(--accent-2)",
      extraction_started: "var(--blue)",
      extraction_completed: "var(--blue)",
      final_result_stored: "var(--accent)",
      job_completed: "var(--accent)",
      job_failed: "var(--red)",
      job_finalized: "var(--blue)",
    };
    return stageColorMap[eventType] ?? "var(--border-bright)";
  };

  return (
    <div>
      {events.map((ev, i) => (
        <div
          key={ev.id}
          className="slide-in"
          style={{
            display: "flex",
            gap: 10,
            paddingBottom: 14,
            animationDelay: `${i * 0.03}s`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                marginTop: 4,
                background: getEventDotColor(ev.event_type),
                flexShrink: 0,
              }}
            />
            {i < events.length - 1 && (
              <div
                style={{
                  flex: 1,
                  width: 1,
                  background: "var(--border)",
                  marginTop: 4,
                }}
              />
            )}
          </div>
          <div style={{ paddingBottom: 2 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
              }}
            >
              {ev.event_type}
            </span>
            {ev.message && (
              <div
                style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}
              >
                {ev.message}
              </div>
            )}
            <div
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                marginTop: 2,
                fontFamily: "var(--font-mono)",
              }}
            >
              {format(parseApiDate(ev.created_at), "HH:mm:ss.SSS")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Detail Page ──────────────────────────────────────────────────────────
export default function DetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [draftData, setDraftData] = useState<ExtractedData | null>(null);
  const [liveMsg, setLiveMsg] = useState("");
  const [liveProgress, setLiveProgress] = useState(0);

  const loadJob = useCallback(async () => {
    if (!jobId) return;
    try {
      const j = await getJob(jobId);
      setJob(j);
      setDraftData(j.reviewed_data ?? j.extracted_data ?? {});
      setLiveProgress(j.progress);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  const isActive = job?.status === "queued" || job?.status === "processing";

  useSSEProgress({
    jobId: jobId ?? null,
    enabled: !!isActive,
    onEvent: (e) => {
      setLiveProgress(e.progress);
      setLiveMsg(e.message);
      if (["completed", "failed", "finalized"].includes(e.status)) {
        // Reload full job on completion
        setTimeout(loadJob, 500);
      }
    },
  });

  const updateField = (key: string, value: unknown) => {
    setDraftData((d) => ({ ...(d ?? {}), [key]: value }));
  };

  const handleSave = async () => {
    if (!jobId || !draftData) return;
    setSaving(true);
    try {
      const updated = await updateReview(jobId, draftData);
      setJob(updated);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!jobId || !draftData) return;
    if (
      !confirm(
        "Finalize this document? This marks it as reviewed and complete.",
      )
    )
      return;
    setFinalizing(true);
    try {
      const updated = await finalizeJob(jobId, draftData);
      setJob(updated);
    } finally {
      setFinalizing(false);
    }
  };

  const handleRetry = async () => {
    if (!jobId) return;
    await retryJob(jobId);
    await loadJob();
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="empty-state">
        <FileText size={32} />
        <p>Job not found</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/")}>
          ← Back
        </button>
      </div>
    );
  }

  const doc = job.document;
  const canEdit = ["completed", "finalized"].includes(job.status);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }} className="fade-in">
      {/* Back */}
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 20 }}
        onClick={() => navigate("/")}
      >
        <ArrowLeft size={12} /> Dashboard
      </button>

      {/* Header */}
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 16 }}>
            {doc?.original_filename ?? "Document"}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 6,
            }}
          >
            <StatusBadge status={job.status} />
            {doc && (
              <>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {formatBytes(doc.file_size)}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>·</span>
                <span className="tag">{doc.file_type}</span>
              </>
            )}
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                marginLeft: "auto",
              }}
            >
              {formatDistanceToNow(parseApiDate(job.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {job.status === "failed" && (
            <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
              <RotateCcw size={12} /> Retry
            </button>
          )}
          {canEdit && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => triggerExport("json", [job.id] as any)}
              >
                <Download size={12} /> JSON
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => triggerExport("csv", [job.id] as any)}
              >
                <Download size={12} /> CSV
              </button>
              {saving ? (
                <button className="btn btn-ghost btn-sm" disabled>
                  <Spinner size={11} /> Saving...
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={handleSave}>
                  <Save size={12} /> {saveMsg || "Save Draft"}
                </button>
              )}
              {job.status !== "finalized" && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleFinalize}
                  disabled={finalizing}
                >
                  {finalizing ? (
                    <Spinner size={11} />
                  ) : (
                    <CheckSquare size={12} />
                  )}
                  Finalize
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Progress strip */}
      {(isActive || job.status === "processing") && (
        <div
          className="card"
          style={{ padding: "12px 16px", marginBottom: 20 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
              }}
            >
              {liveMsg || job.current_stage || "Processing..."}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)",
              }}
            >
              {liveProgress || job.progress}%
            </span>
          </div>
          <ProgressBar
            value={liveProgress || job.progress}
            status={job.status}
          />
        </div>
      )}

      {/* Error */}
      {job.status === "failed" && job.error_message && (
        <div
          style={{
            background: "var(--red-dim)",
            border: "1px solid rgba(255,71,87,0.3)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--red)",
              marginBottom: 4,
            }}
          >
            ERROR · Retry {job.retry_count}/{job.max_retries}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            {job.error_message}
          </div>
        </div>
      )}

      {/* 2-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Left: Extracted fields */}
        <div>
          {draftData && canEdit ? (
            <div className="card" style={{ padding: "20px 20px 8px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 20,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-3)",
                    letterSpacing: "0.1em",
                  }}
                >
                  EXTRACTED DATA{" "}
                  {job.status === "finalized" ? "· FINALIZED" : "· EDITABLE"}
                </span>
                {job.status === "finalized" && (
                  <span className="badge badge-finalized">✓ finalized</span>
                )}
              </div>

              <EditableField
                label="Title"
                icon={<FileText size={12} />}
                value={draftData.title}
                onChange={(v) => updateField("title", v)}
              />
              <EditableField
                label="Category"
                icon={<Tag size={12} />}
                value={draftData.category}
                onChange={(v) => updateField("category", v)}
              />
              <EditableField
                label="Summary"
                icon={<AlignLeft size={12} />}
                value={draftData.summary}
                onChange={(v) => updateField("summary", v)}
                multiline
              />
              <EditableField
                label="Keywords"
                icon={<List size={12} />}
                value={draftData.keywords}
                onChange={(v) => updateField("keywords", v)}
                tags
              />

              {/* Raw stats */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                {[
                  { label: "Word count", val: draftData.word_count },
                  { label: "Char count", val: draftData.char_count },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      background: "var(--bg-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      padding: "8px 10px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-3)",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {item.label.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        color: "var(--text)",
                        marginTop: 2,
                      }}
                    >
                      {item.val?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 20 }}>
              {isActive ? (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    color: "var(--text-3)",
                  }}
                >
                  <Spinner />
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                  >
                    Processing... extracted data will appear here when complete.
                  </span>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: "30px 0" }}>
                  <FileText size={24} />
                  <p>No extracted data available</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Metadata + Timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Job metadata */}
          <div className="card" style={{ padding: "14px 16px" }}>
            <SectionLabel>Job Info</SectionLabel>
            {[
              { label: "Job ID", val: job.id.slice(0, 12) + "..." },
              {
                label: "Celery Task",
                val: job.celery_task_id
                  ? `${job.celery_task_id.slice(0, 12)}...`
                  : "—",
              },
              {
                label: "Retries",
                val: `${job.retry_count} / ${job.max_retries}`,
              },
              {
                label: "Created",
                val: format(parseApiDate(job.created_at), "MMM d, HH:mm"),
              },
              {
                label: "Completed",
                val: job.completed_at
                  ? format(parseApiDate(job.completed_at), "MMM d, HH:mm")
                  : "—",
              },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {row.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-2)",
                  }}
                >
                  {row.val}
                </span>
              </div>
            ))}
          </div>

          {/* Event timeline */}
          {job.events.length > 0 && (
            <div className="card" style={{ padding: "14px 16px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 14,
                }}
              >
                <Activity size={12} color="var(--text-3)" />
                <SectionLabel>Timeline</SectionLabel>
              </div>
              <EventTimeline events={job.events} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
