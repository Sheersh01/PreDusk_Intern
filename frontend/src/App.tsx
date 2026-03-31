import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { UploadCloud, LayoutDashboard, Github } from 'lucide-react'
import DashboardPage from './pages/DashboardPage'
import UploadPage from './pages/UploadPage'
import DetailPage from './pages/DetailPage'

function Topbar() {
  return (
    <header className="topbar">
      <NavLink to="/" className="topbar-logo">
        DOC<span>/</span>FLOW
      </NavLink>

      <nav className="topbar-nav">
        <NavLink
          to="/upload"
          className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
        >
          <UploadCloud size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
          Upload
        </NavLink>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
        >
          <LayoutDashboard size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
          Dashboard
        </NavLink>
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <div className="app-layout">
      <Topbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/jobs/:jobId" element={<DetailPage />} />
        </Routes>
      </main>
    </div>
  )
}
