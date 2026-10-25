import { Activity, BookOpenText, LogOut, MessagesSquare, Moon, ShieldCheck, Sun } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Banner, Loading } from "./components/ui";
import { useAuth } from "./lib/auth";
import { useTheme } from "./lib/theme";
import ChatPage from "./pages/ChatPage";
import KnowledgePage from "./pages/KnowledgePage";
import TracesPage from "./pages/TracesPage";

const NAV_ITEMS = [
  { to: "/chat", label: "Chat", Icon: MessagesSquare },
  { to: "/knowledge", label: "Knowledge", Icon: BookOpenText },
  { to: "/traces", label: "Traces", Icon: Activity },
];

export default function App() {
  const { session, loading, error, login, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();

  if (loading) {
    return (
      <div className="login">
        <Loading label="Signing in" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="login">
        <div className="card">
          <div className="brand-mark">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1>Secure Agent Workspace</h1>
            <p className="muted login-lead">
              An agent that acts with your own permissions. Sign in with Keycloak to continue.
            </p>
          </div>
          {error && <Banner kind="err">{error}</Banner>}
          <button className="btn primary block" onClick={login}>
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
        <nav className="nav" aria-label="Main">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} title={label}>
              <Icon size={17} aria-hidden /> <span className="label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <div className="userline">
            <b className="username">{session.username}</b>
            {session.roles.map((r) => (
              <span key={r} className={`badge ${r === "admin" ? "accent" : ""}`}>
                {r}
              </span>
            ))}
          </div>
          <button className="btn sm" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />} <span className="label">{theme === "dark" ? "Light" : "Dark"} mode</span>
          </button>
          <button className="btn sm" onClick={logout} title="Sign out">
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
