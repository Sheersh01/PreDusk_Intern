import { useState, useCallback, type MouseEvent } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud,
  X,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
  Files,
} from "lucide-react";
import { uploadDocuments } from "../lib/api";
import { formatBytes } from "../components/ui";
import type { BulkUploadResponse } from "../types";

const ALLOWED_EXT = [".pdf", ".txt", ".docx", ".csv", ".json", ".md"];

interface QueuedFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BulkUploadResponse | null>(null);

  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    const newFiles: QueuedFile[] = accepted.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      status: "pending",
    }));
    const rejectedFiles: QueuedFile[] = rejected.map((r) => ({
      id: Math.random().toString(36).slice(2),
      file: r.file,
      status: "error",
      error: "Unsupported file type",
    }));
    setQueue((q) => [...q, ...newFiles, ...rejectedFiles]);
    setResult(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
      "text/csv": [".csv"],
      "application/json": [".json"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
    },
    maxSize: 50 * 1024 * 1024,
  });

  const removeFile = (id: string) => {
    setQueue((q) => q.filter((f) => f.id !== id));
  };

  const clearAll = () => {
    setQueue([]);
    setResult(null);
  };

  const handleUpload = async () => {
    const pending = queue.filter((f) => f.status === "pending");
    if (!pending.length) return;
    setUploading(true);
    setResult(null);

    // Mark as uploading
    setQueue((q) =>
      q.map((f) =>
        f.status === "pending" ? { ...f, status: "uploading" } : f,
      ),
    );

    try {
      const files = pending.map((f) => f.file);
      const res = await uploadDocuments(files);
      setResult(res);

      // Update statuses
      setQueue((q) =>
        q.map((f) => {
          if (f.status !== "uploading") return f;
          const matched = res.results.find(
            (r) => r.document.original_filename === f.file.name,
          );
          if (matched) return { ...f, status: "done" };
          const errored = res.errors.find((e) => e.startsWith(f.file.name));
          if (errored) return { ...f, status: "error", error: errored };
          return { ...f, status: "done" };
        }),
      );
    } catch (e: any) {
      setQueue((q) =>
        q.map((f) =>
          f.status === "uploading"
            ? { ...f, status: "error", error: e?.message || "Upload failed" }
            : f,
        ),
      );
    } finally {
      setUploading(false);
    }
  };

  const pendingCount = queue.filter((f) => f.status === "pending").length;
  const doneCount = queue.filter((f) => f.status === "done").length;
  const errorCount = queue.filter((f) => f.status === "error").length;

  const handlePanelMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rx = (y / rect.height - 0.5) * -4;
    const ry = (x / rect.width - 0.5) * 6;

    e.currentTarget.style.setProperty("--mx", `${x}px`);
    e.currentTarget.style.setProperty("--my", `${y}px`);
    e.currentTarget.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
  };

  const handlePanelMouseLeave = (e: MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform =
      "perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0)";
  };

  return (
    <div style={{ maxWidth: 1020, margin: "0 auto" }} className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 22 }}>
            Upload Workspace
          </h1>
          <p className="page-subtitle">
            Drop one or more files to create async processing jobs.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: 14,
          marginBottom: 16,
        }}
      >
        {/* Main upload panel */}
        <div
          className="card upload-micro-panel"
          onMouseMove={handlePanelMouseMove}
          onMouseLeave={handlePanelMouseLeave}
          style={{
            padding: 16,
            background: "linear-gradient(180deg, var(--bg-1), var(--bg-2))",
            borderColor: isDragActive
              ? "rgba(0,212,170,0.45)"
              : "var(--border)",
            boxShadow: isDragActive
              ? "0 0 0 1px rgba(0,212,170,0.3) inset"
              : "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)",
                letterSpacing: "0.08em",
              }}
            >
              UPLOAD ZONE
            </span>
            <span className="tag">MAX 50 MB</span>
          </div>

          <div
            {...getRootProps()}
            className="upload-micro-dropzone"
            style={{
              border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "var(--radius-md)",
              padding: "34px 20px",
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color 0.2s, background 0.2s",
              background: isDragActive ? "var(--accent-dim)" : "var(--bg-1)",
            }}
          >
            <input {...getInputProps()} />
            <UploadCloud
              size={34}
              style={{
                margin: "0 auto 12px",
                color: isDragActive ? "var(--accent)" : "var(--text-3)",
                transition: "color 0.2s",
              }}
            />
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--text-2)",
                marginBottom: 6,
              }}
            >
              {isDragActive
                ? "Drop files to queue upload"
                : "Drag & drop files, or click to browse"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>
              Supported: {ALLOWED_EXT.join(" · ")}
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            {[
              { label: "Queued", value: pendingCount },
              { label: "Done", value: doneCount },
              { label: "Errors", value: errorCount },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "8px 10px",
                  background: "var(--bg-1)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-3)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.07em",
                  }}
                >
                  {item.label.toUpperCase()}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    fontSize: 14,
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Context panel */}
        <div
          className="card upload-micro-panel"
          onMouseMove={handlePanelMouseMove}
          onMouseLeave={handlePanelMouseLeave}
          style={{ padding: 16 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <Sparkles size={13} color="var(--accent)" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
                letterSpacing: "0.08em",
              }}
            >
              UPLOAD NOTES
            </span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <ShieldCheck
                size={14}
                color="var(--yellow)"
                style={{ marginTop: 2 }}
              />
              <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                Use text-based PDFs for best extraction quality.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Files size={14} color="var(--blue)" style={{ marginTop: 2 }} />
              <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                Multiple files are uploaded and queued in one action.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <CheckCircle2
                size={14}
                color="var(--accent)"
                style={{ marginTop: 2 }}
              />
              <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                Finalize jobs later to include them in default exports.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* File queue */}
      {queue.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)",
                letterSpacing: "0.08em",
              }}
            >
              QUEUE ({queue.length} FILE{queue.length !== 1 ? "S" : ""})
            </span>
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>
              Clear all
            </button>
          </div>

          {queue.map((qf, i) => (
            <div
              key={qf.id}
              className="slide-in upload-micro-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                borderBottom:
                  i < queue.length - 1 ? "1px solid var(--border)" : "none",
                animationDelay: `${i * 0.04}s`,
              }}
            >
              <FileText size={15} color="var(--text-3)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="truncate"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  {qf.file.name}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}
                >
                  {formatBytes(qf.file.size)}
                  {qf.error && (
                    <span style={{ color: "var(--red)", marginLeft: 8 }}>
                      · {qf.error}
                    </span>
                  )}
                </div>
              </div>

              {/* Status icon */}
              {qf.status === "uploading" && (
                <Loader2
                  size={14}
                  color="var(--yellow)"
                  style={{ animation: "spin 0.7s linear infinite" }}
                />
              )}
              {qf.status === "done" && (
                <CheckCircle2 size={14} color="var(--accent)" />
              )}
              {qf.status === "error" && (
                <AlertCircle size={14} color="var(--red)" />
              )}
              {qf.status === "pending" && (
                <button
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-3)",
                    padding: 2,
                    display: "flex",
                  }}
                  onClick={() => removeFile(qf.id)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {pendingCount > 0 && (
        <button
          className="btn btn-primary"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "11px 0",
            fontSize: 13,
          }}
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <span className="spinner" style={{ width: 13, height: 13 }} />{" "}
              Creating jobs...
            </>
          ) : (
            <>
              <UploadCloud size={14} /> Start processing {pendingCount} file
              {pendingCount !== 1 ? "s" : ""}
            </>
          )}
        </button>
      )}

      {/* Result */}
      {result && (
        <div className="card fade-in" style={{ marginTop: 20, padding: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <CheckCircle2 size={15} color="var(--accent)" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--accent)",
              }}
            >
              Upload complete
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--text-3)",
              }}
            >
              {result.succeeded}/{result.total} succeeded
            </span>
          </div>

          {result.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {result.errors.map((e, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: "var(--red)",
                    display: "flex",
                    gap: 6,
                    alignItems: "flex-start",
                  }}
                >
                  <AlertCircle
                    size={12}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  {e}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate("/")}
            >
              View Dashboard →
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>
              Upload more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
