"use client";

import { useState, useRef, useCallback } from "react";
import { VoiceSelector } from "@/components/VoiceSelector";
import { HistoryPanel } from "@/components/HistoryPanel";

type ChatMessage = {
  role: "ai" | "user";
  content: string;
};

type SessionState = "setup" | "connecting" | "active" | "ended";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "es", name: "Spanish" },
];

export default function TutorPage() {
  const [state, setState] = useState<SessionState>("setup");
  const [language, setLanguage] = useState("fr");
  const [difficulty, setDifficulty] = useState("beginner");
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [tutorVoice, setTutorVoice] = useState("Emma");
  const [historyOpen, setHistoryOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── Start Tutor Session ─────────────────────────────────────────────────
  const startSession = useCallback(() => {
    setState("connecting");

    const voiceServerUrl =
      process.env.NEXT_PUBLIC_VOICE_SERVER_URL || "ws://localhost:4000";
    const ws = new WebSocket(`${voiceServerUrl}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session:start",
          sessionType: "tutor",
          language,
          difficulty,
          topic: topic || undefined,
        })
      );
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        const audioUrl = URL.createObjectURL(event.data);
        const audio = new Audio(audioUrl);
        audio.play();
        return;
      }

      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "session:started":
          setState("active");
          break;
        case "transcript":
          setLiveTranscript(msg.text);
          if (msg.isFinal) {
            setMessages((prev) => [
              ...prev,
              { role: "user", content: msg.text },
            ]);
            setLiveTranscript("");
          }
          break;
        case "ai_start":
          setMessages((prev) => [...prev, { role: "ai", content: "" }]);
          break;
        case "ai_text":
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "ai") last.content += msg.text;
            return updated;
          });
          break;
        case "ai_end":
          break;
        case "session:ended":
          setState("ended");
          break;
      }
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    ws.onerror = () => setState("setup");
    ws.onclose = () => {
      if (state === "active") setState("ended");
    };
  }, [language, difficulty, topic, state]);

  const toggleMic = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(e.data);
        }
      };
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, [isRecording]);

  const endSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "session:end" }));
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ─── SETUP VIEW ──────────────────────────────────────────────────────────
  if (state === "setup") {
    const selectedLang = LANGUAGES.find((l) => l.code === language);
    return (
      <>
        <div className="page-header">
          <h2>🗣️ Language Café</h2>
          <p>
            Have a real-time voice conversation with an AI tutor in any of 10
            supported languages
          </p>
        </div>

        <HistoryPanel
          tool="tutor"
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
        />

        <div className="glass-panel" style={{ maxWidth: 600 }}>
          <div className="form-group">
            <label className="form-label">Language to practice</label>
            <select
              className="form-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              id="language-select"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Difficulty Level</label>
            <select
              className="form-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              id="difficulty-select"
            >
              <option value="beginner">
                🌱 Beginner — Simple words, full translations
              </option>
              <option value="intermediate">
                🌿 Intermediate — Moderate vocabulary
              </option>
              <option value="advanced">
                🌳 Advanced — Native-level speech
              </option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Conversation Topic (optional)</label>
            <input
              className="form-input"
              placeholder={`e.g., "Ordering food at a café in Paris"`}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              id="topic-input"
            />
          </div>

          <VoiceSelector
            value={tutorVoice}
            onChange={setTutorVoice}
            label="Tutor Voice"
          />

          <button
            className="btn btn-primary btn-lg w-full"
            onClick={startSession}
            id="start-tutor-btn"
            style={{
              background: "var(--gradient-tutor)",
            }}
          >
            🎬 Start Conversation in {selectedLang?.name}
          </button>
        </div>
      </>
    );
  }

  // ─── ACTIVE / ENDED VIEW ─────────────────────────────────────────────────
  return (
    <div className="session-panel">
      <div className="session-chat">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="role">{msg.role === "ai" ? "Tutor" : "You"}</div>
            {msg.content}
          </div>
        ))}
        {liveTranscript && (
          <div className="chat-bubble user" style={{ opacity: 0.6 }}>
            <div className="role">You (live)</div>
            {liveTranscript}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="session-controls">
        {state === "active" ? (
          <>
            <button
              className={`mic-button ${isRecording ? "recording" : ""}`}
              onClick={toggleMic}
              id="tutor-mic-btn"
              style={
                isRecording
                  ? { background: "var(--gradient-tutor)" }
                  : { background: "var(--gradient-tutor)" }
              }
            >
              {isRecording ? "⏸️" : "🎤"}
            </button>
            <div className="session-status">
              {isRecording ? (
                <span className="live-indicator">
                  <span className="live-dot" /> Listening...
                </span>
              ) : (
                "Tap the mic to speak"
              )}
            </div>
            {isRecording && (
              <div className="audio-visualizer">
                <div className="bar" style={{ background: "var(--accent-green)" }} />
                <div className="bar" style={{ background: "var(--accent-green)" }} />
                <div className="bar" style={{ background: "var(--accent-green)" }} />
                <div className="bar" style={{ background: "var(--accent-green)" }} />
                <div className="bar" style={{ background: "var(--accent-green)" }} />
              </div>
            )}
            <button className="btn btn-danger" onClick={endSession} id="end-tutor-btn">
              End Session
            </button>
          </>
        ) : state === "connecting" ? (
          <div className="session-status">⏳ Connecting to your tutor...</div>
        ) : (
          <div
            className="session-status"
            style={{ textAlign: "center", width: "100%" }}
          >
            ✅ Session complete!
            <br />
            <button
              className="btn btn-secondary mt-2"
              onClick={() => {
                setState("setup");
                setMessages([]);
              }}
              id="restart-tutor-btn"
            >
              Start New Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
