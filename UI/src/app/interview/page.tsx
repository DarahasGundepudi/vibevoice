"use client";

import { useState, useRef, useCallback } from "react";
import { VoiceSelector } from "@/components/VoiceSelector";
import { HistoryPanel } from "@/components/HistoryPanel";

type ChatMessage = {
  role: "ai" | "user";
  content: string;
};

type SessionState = "setup" | "connecting" | "active" | "ended";

export default function InterviewPage() {
  const [state, setState] = useState<SessionState>("setup");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [persona, setPersona] = useState("professional");
  const [interviewVoice, setInterviewVoice] = useState("Carter");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── PDF Upload Handler ──────────────────────────────────────────────────
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setResumeFile(file);

      // Parse PDF on the server
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/parse-pdf", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        setResumeText(data.text || "");
      } catch {
        // Fallback: let user paste manually
        console.error("PDF parse failed");
      }
    },
    []
  );

  // ─── Start Interview Session ─────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!resumeText.trim() || !jobDescription.trim()) {
      alert("Please provide both your resume and the job description.");
      return;
    }

    setState("connecting");

    const voiceServerUrl =
      process.env.NEXT_PUBLIC_VOICE_SERVER_URL || "ws://localhost:4000";
    const ws = new WebSocket(`${voiceServerUrl}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send session config
      ws.send(
        JSON.stringify({
          type: "session:start",
          sessionType: "interview",
          resumeText,
          jobDescription,
          persona,
          voice: interviewVoice,
        })
      );
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Audio data — play it
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
            if (last && last.role === "ai") {
              last.content += msg.text;
            }
            return updated;
          });
          break;

        case "ai_end":
          break;

        case "session:ended":
          setState("ended");
          break;

        case "error":
          console.error("Session error:", msg.message);
          break;
      }

      // Auto-scroll to bottom
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    ws.onerror = () => setState("setup");
    ws.onclose = () => {
      if (state === "active") setState("ended");
    };
  }, [resumeText, jobDescription, persona, state]);

  // ─── Microphone Toggle ───────────────────────────────────────────────────
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

      mediaRecorder.start(250); // Send chunks every 250ms
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, [isRecording]);

  // ─── End Session ─────────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "session:end" }));
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ─── SETUP VIEW ──────────────────────────────────────────────────────────
  if (state === "setup") {
    return (
      <>
        <div className="page-header">
          <h2>👔 Interview Prep Room</h2>
          <p>
            Upload your resume, paste the job description, and start a real-time
            mock interview
          </p>
        </div>

        <HistoryPanel
          tool="interview"
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
        />

        <div className="glass-panel" style={{ maxWidth: 720 }}>
          {/* Resume Upload */}
          <div className="form-group">
            <label className="form-label">Your Resume (PDF)</label>
            <label
              className={`upload-zone ${resumeFile ? "has-file" : ""}`}
              htmlFor="resume-upload"
            >
              <div className="icon">{resumeFile ? "✅" : "📄"}</div>
              <div className="label">
                {resumeFile
                  ? "Resume uploaded successfully"
                  : "Click to upload PDF resume"}
              </div>
              {resumeFile && (
                <div className="filename">{resumeFile.name}</div>
              )}
              <input
                type="file"
                id="resume-upload"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </label>
          </div>

          {/* Resume Text Fallback */}
          {!resumeFile && (
            <div className="form-group">
              <label className="form-label">Or paste resume text</label>
              <textarea
                className="form-textarea"
                placeholder="Paste your resume content here..."
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={4}
                id="resume-text-input"
              />
            </div>
          )}

          {/* Job Description */}
          <div className="form-group">
            <label className="form-label">Job Description</label>
            <textarea
              className="form-textarea"
              placeholder="Paste the full job description here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={5}
              id="jd-text-input"
            />
          </div>

          {/* Persona */}
          <div className="form-group">
            <label className="form-label">Interviewer Style</label>
            <select
              className="form-select"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              id="persona-select"
            >
              <option value="professional">Professional & Balanced</option>
              <option value="friendly">Friendly & Encouraging</option>
              <option value="tough">Tough & Challenging</option>
            </select>
          </div>

          <VoiceSelector
            value={interviewVoice}
            onChange={setInterviewVoice}
            label="Interviewer Voice"
          />

          <button
            className="btn btn-primary btn-lg w-full"
            onClick={startSession}
            id="start-interview-btn"
          >
            🎬 Start Mock Interview
          </button>
        </div>
      </>
    );
  }

  // ─── ACTIVE / ENDED VIEW ─────────────────────────────────────────────────
  return (
    <div className="session-panel">
      {/* Chat Messages */}
      <div className="session-chat">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="role">
              {msg.role === "ai" ? "Interviewer" : "You"}
            </div>
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

      {/* Controls */}
      <div className="session-controls">
        {state === "active" ? (
          <>
            <button
              className={`mic-button ${isRecording ? "recording" : ""}`}
              onClick={toggleMic}
              id="mic-toggle-btn"
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
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
              </div>
            )}

            <button
              className="btn btn-danger"
              onClick={endSession}
              id="end-interview-btn"
            >
              End Interview
            </button>
          </>
        ) : state === "connecting" ? (
          <div className="session-status">⏳ Connecting to AI interviewer...</div>
        ) : (
          <div className="session-status" style={{ textAlign: "center", width: "100%" }}>
            ✅ Interview complete! Check the transcript above.
            <br />
            <button
              className="btn btn-secondary mt-2"
              onClick={() => {
                setState("setup");
                setMessages([]);
              }}
              id="restart-interview-btn"
            >
              Start New Interview
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
