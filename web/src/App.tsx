import { BookOpenText, Activity, LogOut, MessagesSquare, Moon, ShieldCheck, Sun } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useTheme } from "./lib/theme";
import ChatPage from "./pages/ChatPage";
import KnowledgePage from "./pages/KnowledgePage";
import TracesPage from "./pages/TracesPage";

export default function App() {
  const { session, loading, error, login, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();

  if (loading) return <div className="login muted">Signing in...</div>;

  if (!session) {
    return (
      <div className="login">
        <div className="card">
          <div className="brand-mark">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1>Secure Agent Workspace</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              An agent that acts with your own permissions. Sign in with Keycloak to continue.
            </p>
          </div>
          {error && <div className="banner err">{error}</div>}
          <button className="btn primary" onClick={login}>
            Sign in with Keycloak
          </button>
          <div className="creds">
            <b>Sample accounts</b> (demo realm, not real credentials): <code>viewer</code> / <code>viewer</code> can read orders, <code>admin</code> / <code>admin</code> can also change orders and add documents.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span>Agent Workspace</span>
        </div>
        <nav className="nav">
          <NavLink to="/chat">
            <MessagesSquare size={17} /> <span className="label">Chat</span>
          </NavLink>
          <NavLink to="/knowledge">
            <BookOpenText size={17} /> <span className="label">Knowledge</span>
          </NavLink>
          <NavLink to="/traces">
            <Activity size={17} /> <span className="label">Traces</span>
          </NavLink>
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <div className="userline">
            <b>{session.username}</b>
            {session.roles.map((r) => (
              <span key={r} className={`badge ${r === "admin" ? "accent" : ""}`}>
                {r}
              </span>
            ))}
          </div>
          <button className="btn sm" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />} <span className="label">{theme === "dark" ? "Light" : "Dark"} mode</span>
          </button>
          <button className="btn sm" onClick={logout}>
            <LogOut size={14} /> <span className="label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage session={session} />} />
          <Route path="/knowledge" element={<KnowledgePage session={session} />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  );
}
