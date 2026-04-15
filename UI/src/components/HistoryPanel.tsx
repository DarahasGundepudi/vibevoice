"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

type HistoryEntry = {
  id: string;
  tool: string;
  voiceUsed: string | null;
  inputText: string;
  audioUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type Props = {
  tool: string;
  isOpen: boolean;
  onToggle: () => void;
  onReload?: (entry: HistoryEntry) => void;
};

export function HistoryPanel({ tool, isOpen, onToggle, onReload }: Props) {
  const { data: session } = useSession();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/history/${tool}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
    setLoading(false);
  }, [tool, session]);

  useEffect(() => {
    if (isOpen) fetchHistory();
  }, [isOpen, fetchHistory]);

  const deleteEntry = async (id: string) => {
    try {
      await fetch(`/api/history/${tool}/${id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const truncate = (s: string, len: number = 80) =>
    s.length > len ? s.slice(0, len) + "..." : s;

  return (
    <>
      {/* Toggle button */}
      <button
        className={`history-toggle-btn ${isOpen ? "open" : ""}`}
        onClick={onToggle}
        title="Session History"
      >
        📋
      </button>

      {/* Panel */}
      <div className={`history-panel ${isOpen ? "open" : ""}`}>
        <div className="history-header">
          <h3>📋 History</h3>
          <button className="history-close" onClick={onToggle}>✕</button>
        </div>

        <div className="history-entries">
          {loading && (
            <div className="history-empty">Loading...</div>
          )}

          {!loading && entries.length === 0 && (
            <div className="history-empty">
              <span style={{ fontSize: "1.5rem" }}>📭</span>
              <p>No history yet</p>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Your generations will appear here
              </p>
            </div>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className="history-entry">
              <div className="history-entry-header">
                <span className="history-date">{formatDate(entry.createdAt)}</span>
                <div className="history-entry-actions">
                  {onReload && (
                    <button
                      className="history-action-btn"
                      onClick={() => onReload(entry)}
                      title="Reload"
                    >
                      🔄
                    </button>
                  )}
                  <button
                    className="history-action-btn delete"
                    onClick={() => deleteEntry(entry.id)}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <div className="history-entry-text">
                {truncate(entry.inputText)}
              </div>

              {entry.voiceUsed && (
                <div className="history-entry-voice">
                  🎤 {entry.voiceUsed}
                </div>
              )}

              {entry.audioUrl && (
                <audio
                  controls
                  src={entry.audioUrl}
                  className="history-entry-audio"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
