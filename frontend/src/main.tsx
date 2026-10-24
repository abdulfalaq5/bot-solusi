import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import "./styles.css";
import { auth } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import Providers from "./pages/Providers";
import Models from "./pages/Models";
import Prompts from "./pages/Prompts";
import Settings from "./pages/Settings";
import Playground from "./pages/Playground";
import Logs from "./pages/Logs";

const NAV = [
  ["/", "Dashboard"],
  ["/inbox", "Inbox Chat"],
  ["/models", "Model AI"],
  ["/providers", "Provider AI"],
  ["/prompts", "Prompt"],
  ["/playground", "Playground"],
  ["/logs", "Log AI"],
  ["/settings", "Pengaturan"],
] as const;

function Layout() {
  const nav = useNavigate();
  if (!auth.token) return <Navigate to="/login" replace />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🤖 Bot Solusi</div>
        <nav>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          className="btn ghost logout"
          onClick={() => {
            auth.clear();
            nav("/login");
          }}
        >
          Keluar
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:id" element={<Inbox />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/models" element={<Models />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
