import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Calendar } from "lucide-react";
import { getAnalytics } from "../lib/api";
import { Spinner } from "../components/ui";
import { useJobStore } from "../store/jobStore";
import type { AnalyticsData } from "../types";

export function AnalyticsPage() {
  const navigate = useNavigate();
  const {
    filters,
    setAnalytics,
    analytics,
    analyticsLoading,
    setAnalyticsLoading,
  } = useJobStore();
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [category, setCategory] = useState<string>("");

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await getAnalytics(
        category || undefined,
        dateFrom || undefined,
        dateTo || undefined,
      );
      setAnalytics(data);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [category, dateFrom, dateTo, setAnalytics, setAnalyticsLoading]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const data = analytics;

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate("/")}
              title="Back"
            >
              <ArrowLeft size={14} />
            </button>
            <div>
              <h1 className="page-title">Analytics</h1>
              <p className="page-subtitle">Document extraction insights</p>
            </div>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={fetchAnalytics}
          title="Refresh"
        >
          {analyticsLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          className="input"
          style={{ flex: "0 0 140px" }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          <option value="resume">Resume</option>
          <option value="technical">Technical</option>
          <option value="financial">Financial</option>
          <option value="legal">Legal</option>
          <option value="report">Report</option>
          <option value="data">Data</option>
          <option value="general">General</option>
        </select>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flex: "0 0 auto",
          }}
        >
          <Calendar size={12} style={{ color: "var(--text-3)" }} />
          <input
            className="input"
            type="date"
            style={{ width: 140 }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
            title="Filter from date"
          />
          <span style={{ color: "var(--text-3)" }}>to</span>
          <input
            className="input"
            type="date"
            style={{ width: 140 }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
            title="Filter to date"
          />
        </div>
      </div>

      {/* Stats Cards */}
      {data && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div className="card" style={{ padding: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}
            >
              Total Documents
            </div>
            <div
              style={{ fontSize: 24, fontWeight: "bold", color: "var(--text)" }}
            >
              {data.total_documents}
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}
            >
              With Confidence Scores
            </div>
            <div
              style={{ fontSize: 24, fontWeight: "bold", color: "var(--text)" }}
            >
              {data.total_with_confidence}
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}
            >
              Avg Confidence
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: "bold",
                color: "var(--accent)",
              }}
            >
              {(data.avg_confidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
          gap: 16,
        }}
      >
        {/* Top Skills */}
        <div className="card">
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", margin: 0 }}>
              Top 10 Skills
            </h2>
          </div>
          <div style={{ padding: 16 }}>
            {data?.top_skills && data.top_skills.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.top_skills.map((item, idx) => (
                  <div
                    key={idx}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "var(--text)" }}>
                        {item.skill}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: "bold",
                          color: "var(--accent)",
                        }}
                      >
                        {item.count}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        backgroundColor: "var(--accent)",
                        borderRadius: 2,
                        width: `${(item.count / Math.max(...data.top_skills.map((s) => s.count), 1)) * 80}px`,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                No data
              </div>
            )}
          </div>
        </div>

        {/* Category Distribution */}
        <div className="card">
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", margin: 0 }}>
              Categories
            </h2>
          </div>
          <div style={{ padding: 16 }}>
            {data?.category_distribution &&
            data.category_distribution.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.category_distribution.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        backgroundColor:
                          item.category === "resume"
                            ? "rgba(100, 200, 255, 0.1)"
                            : "rgba(255, 200, 100, 0.1)",
                        borderRadius: "var(--radius-sm)",
                        flex: 1,
                        textTransform: "capitalize",
                      }}
                    >
                      {item.category}
                    </span>
                    <span
                      style={{ fontSize: 11, fontWeight: "bold", minWidth: 30 }}
                    >
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                No data
              </div>
            )}
          </div>
        </div>

        {/* Experience Distribution */}
        <div className="card">
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", margin: 0 }}>
              Experience Level
            </h2>
          </div>
          <div style={{ padding: 16 }}>
            {data?.experience_distribution &&
            data.experience_distribution.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.experience_distribution.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 12, flex: 1 }}>{item.range}</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          height: 6,
                          backgroundColor: "var(--accent)",
                          borderRadius: 3,
                          width: `${(item.count / Math.max(...data.experience_distribution.map((e) => e.count), 1)) * 60}px`,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: "bold",
                          minWidth: 20,
                        }}
                      >
                        {item.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                No data
              </div>
            )}
          </div>
        </div>

        {/* Location Distribution */}
        <div className="card">
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", margin: 0 }}>
              Top Locations
            </h2>
          </div>
          <div style={{ padding: 16 }}>
            {data?.location_distribution &&
            data.location_distribution.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.location_distribution.slice(0, 8).map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{ fontSize: 12, flex: 1, color: "var(--text)" }}
                    >
                      {item.location || "Unknown"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: "bold",
                        color: "var(--accent)",
                        minWidth: 20,
                      }}
                    >
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                No data
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
