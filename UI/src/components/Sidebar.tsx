"use client";

import { signOut } from "next-auth/react";
import type { TabId } from "@/components/AppShell";

const navItems: { id: TabId; icon: string; label: string; section: string }[] = [
  { id: "dashboard", icon: "🏠", label: "Dashboard", section: "main" },
  { id: "interview", icon: "👔", label: "Interview Prep", section: "tools" },
  { id: "tutor", icon: "🗣️", label: "Language Café", section: "tools" },
  { id: "podcast", icon: "🎙️", label: "Podcast Studio", section: "tools" },
  { id: "clone", icon: "🎧", label: "Clone Desk", section: "tools" },
];

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
};

export function Sidebar({ activeTab, onTabChange, user }: Props) {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <h1>The Vibe Suite</h1>
        <span>AI Voice Platform</span>
      </div>

      {/* User Profile */}
      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user.image ? (
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>{(user.name || user.email || "U")[0].toUpperCase()}</span>
            )}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name || "User"}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Main */}
        <div className="sidebar-section-label">Overview</div>
        {navItems
          .filter((item) => item.section === "main")
          .map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => onTabChange(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}

        {/* Tools */}
        <div className="sidebar-section-label" style={{ marginTop: "0.5rem" }}>
          Tools
        </div>
        {navItems
          .filter((item) => item.section === "tools")
          .map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => onTabChange(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="credits-badge">
          <span>⚡</span>
          <span>
            Credits: <span className="count">3</span>
          </span>
        </div>
        <button
          className="sidebar-logout-btn"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          🚪 Sign Out
        </button>
      </div>
    </aside>
  );
}
