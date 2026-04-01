import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock, LogIn } from "lucide-react";
import {
  getAuthEnvironmentLabel,
  isAuthenticated,
  loginDummy,
} from "../auth/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const envLabel = getAuthEnvironmentLabel();

  const from = (location.state as { from?: string } | null)?.from || "/";

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    loginDummy(username);
    navigate(from, { replace: true });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
      className="fade-in"
    >
      <form
        className="card"
        style={{ width: 360, padding: 20 }}
        onSubmit={onSubmit}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Lock size={14} color="var(--accent)" />
          <h1
            style={{
              fontSize: 16,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.05em",
            }}
          >
            DOC/FLOW LOGIN
          </h1>
        </div>

        <p style={{ color: "var(--text-2)", fontSize: 12, marginBottom: 14 }}>
          Dummy auth for demo use. Enter any username to continue.
        </p>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
            padding: "4px 8px",
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-2)",
            letterSpacing: "0.04em",
          }}
        >
          ENV: {envLabel}
        </div>

        <label
          style={{
            display: "block",
            fontSize: 11,
            color: "var(--text-3)",
            marginBottom: 6,
          }}
        >
          Username
        </label>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter username"
          required
          autoFocus
          style={{ marginBottom: 12 }}
        />

        <button
          className="btn btn-primary"
          type="submit"
          style={{ width: "100%" }}
        >
          <LogIn size={12} /> Login
        </button>
      </form>
    </div>
  );
}
