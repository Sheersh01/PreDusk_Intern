import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { UploadCloud, LayoutDashboard, LogOut, Zap } from "lucide-react";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import DetailPage from "./pages/DetailPage";
import LoginPage from "./pages/LoginPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import RequireAuth from "./auth/RequireAuth";
import { getCurrentUsername, isAuthenticated, logoutDummy } from "./auth/auth";

function Topbar() {
  const navigate = useNavigate();
  const authed = isAuthenticated();
  const username = getCurrentUsername();

  const onLogout = () => {
    logoutDummy();
    navigate("/login", { replace: true });
  };

  return (
    <header className="topbar">
      <NavLink to="/" className="topbar-logo">
        EXTRACT<span>/</span>HUB
      </NavLink>

      {authed && (
        <>
          <nav className="topbar-nav">
            <NavLink
              to="/upload"
              className={({ isActive }) =>
                `topbar-link${isActive ? " active" : ""}`
              }
            >
              <UploadCloud
                size={13}
                style={{
                  display: "inline",
                  marginRight: 5,
                  verticalAlign: "middle",
                }}
              />
              Upload
            </NavLink>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `topbar-link${isActive ? " active" : ""}`
              }
            >
              <LayoutDashboard
                size={13}
                style={{
                  display: "inline",
                  marginRight: 5,
                  verticalAlign: "middle",
                }}
              />
              Dashboard
            </NavLink>
            <NavLink
              to="/analytics"
              className={({ isActive }) =>
                `topbar-link${isActive ? " active" : ""}`
              }
            >
              <Zap
                size={13}
                style={{
                  display: "inline",
                  marginRight: 5,
                  verticalAlign: "middle",
                }}
              />
              Analytics
            </NavLink>
          </nav>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginLeft: 12,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {username}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>
              <LogOut size={12} /> Logout
            </button>
          </div>
        </>
      )}
    </header>
  );
}

export default function App() {
  return (
    <div className="app-layout">
      <Topbar />
      <main className="main-content">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/upload"
            element={
              <RequireAuth>
                <UploadPage />
              </RequireAuth>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequireAuth>
                <AnalyticsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/jobs/:jobId"
            element={
              <RequireAuth>
                <DetailPage />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
