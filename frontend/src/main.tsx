import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import WhatsApp from "./pages/WhatsApp";

const NAV = [
  ["/", "Dashboard"],
  ["/inbox", "Inbox Chat"],
  ["/whatsapp", "WhatsApp"],
  ["/models", "Model AI"],
  ["/providers", "Provider AI"],
  ["/prompts", "Prompt"],
  ["/playground", "Playground"],
  ["/logs", "Log AI"],
  ["/settings", "Pengaturan"],
] as const;

function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // tutup menu (mobile) setiap pindah halaman
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  if (!auth.token) return <Navigate to="/login" replace />;
  const current = NAV.find(([to]) => (to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to)))?.[1] ?? "";
  return (
    <div className="layout">
      <header className="topbar">
        <button className="icon-btn burger" aria-label="Menu" onClick={() => setMenuOpen(true)}><span /></button>
        <img className="topbar-mark" src="/mark.png" alt="" />
        <b>{current || "Solusi"}</b>
      </header>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo.png" alt="Solusi lokatali.my.id" />
          <span>Admin WhatsApp Bot</span>
        </div>
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
      <main className={`content ${loc.pathname.startsWith("/inbox") ? "content-inbox" : ""}`}>
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
          <Route path="/whatsapp" element={<WhatsApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
