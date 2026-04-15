"use client";

import { useState } from "react";
import { VoiceSelector } from "@/components/VoiceSelector";
import { HistoryPanel } from "@/components/HistoryPanel";
import { useAudio } from "@/contexts/AudioContext";

type PodcastState = "setup" | "generating" | "done";

export default function PodcastPage() {
  const [state, setState] = useState<PodcastState>("setup");
  const [sourceText, setSourceText] = useState("");
  const [speakerCount, setSpeakerCount] = useState(2);
  const [hostVoice, setHostVoice] = useState("Carter");
  const [guestVoice, setGuestVoice] = useState("Emma");
  const [script, setScript] = useState("");
  const [audioSrc, setAudioSrc] = useState("");
  const [progress, setProgress] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const { playAudio } = useAudio();

  const generatePodcast = async () => {
    if (!sourceText.trim()) {
      alert("Please paste some text content for the podcast.");
      return;
    }

    setState("generating");
    setProgress("Generating podcast script with AI...");

    try {
      const voiceServerUrl = process.env.NEXT_PUBLIC_VOICE_SERVER_URL?.replace(
        "ws://",
        "http://"
      ).replace("wss://", "https://") || "http://localhost:4000";

      const res = await fetch(`${voiceServerUrl}/api/podcast/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          speakerCount,
          voices: [hostVoice, guestVoice],
        }),
      });

      if (!res.ok) throw new Error("Podcast generation failed");

      setProgress("Synthesizing multi-speaker audio with VibeVoice...");
      const data = await res.json();

      setScript(data.script);

      const audioBlob = new Blob(
        [Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0))],
        { type: "audio/mpeg" }
      );
      const url = URL.createObjectURL(audioBlob);
      setAudioSrc(url);
      playAudio(url, `Podcast: ${sourceText.slice(0, 30)}...`, "podcast");
      setState("done");

      // Save to history
      try {
        await fetch("/api/history/podcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputText: sourceText.slice(0, 200),
            voiceUsed: `${hostVoice}, ${guestVoice}`,
            metadata: { speakerCount },
          }),
        });
      } catch { /* best-effort */ }
    } catch (err) {
      console.error(err);
      setProgress("❌ Generation failed. Make sure the voice server is running.");
      setTimeout(() => setState("setup"), 3000);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>🎙️ Podcast Studio</h2>
        <p>
          Turn any article, blog post, or text into an engaging multi-speaker
          podcast
        </p>
      </div>

      <HistoryPanel
        tool="podcast"
        isOpen={historyOpen}
        onToggle={() => setHistoryOpen(!historyOpen)}
      />

      {state === "setup" && (
        <div className="glass-panel" style={{ maxWidth: 720 }}>
          <div className="form-group">
            <label className="form-label">Source Content</label>
            <textarea
              className="form-textarea"
              placeholder="Paste your article, blog post, or any text content here..."
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={8}
              id="podcast-source-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Number of Speakers</label>
            <select
              className="form-select"
              value={speakerCount}
              onChange={(e) => setSpeakerCount(Number(e.target.value))}
              id="speaker-count-select"
            >
              <option value={2}>2 Speakers (Host + Guest)</option>
              <option value={3}>3 Speakers (Host + 2 Guests)</option>
              <option value={4}>4 Speakers (Host + 3 Guests)</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <VoiceSelector value={hostVoice} onChange={setHostVoice} label="Host Voice" />
            <VoiceSelector value={guestVoice} onChange={setGuestVoice} label="Guest Voice" />
          </div>

          <button
            className="btn btn-primary btn-lg w-full"
            onClick={generatePodcast}
            id="generate-podcast-btn"
            style={{ background: "var(--gradient-podcast)" }}
          >
            🎬 Generate Podcast
          </button>
        </div>
      )}

      {state === "generating" && (
        <div className="glass-panel text-center" style={{ maxWidth: 500, margin: "0 auto" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🎙️</div>
          <div className="audio-visualizer" style={{ justifyContent: "center", marginBottom: "1rem" }}>
            <div className="bar" style={{ background: "var(--accent-purple)" }} />
            <div className="bar" style={{ background: "var(--accent-purple)" }} />
            <div className="bar" style={{ background: "var(--accent-purple)" }} />
            <div className="bar" style={{ background: "var(--accent-purple)" }} />
            <div className="bar" style={{ background: "var(--accent-purple)" }} />
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            {progress}
          </p>
        </div>
      )}

      {state === "done" && (
        <div style={{ maxWidth: 720 }}>
          <div className="glass-panel" style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ marginBottom: "1rem", fontSize: "1rem", fontWeight: 600 }}>
              🎧 Your Podcast
            </h3>
            <audio
              controls
              src={audioSrc}
              style={{ width: "100%", borderRadius: "8px" }}
              id="podcast-audio-player"
            />
            <div className="flex gap-2 mt-2">
              <a
                className="btn btn-secondary"
                href={audioSrc}
                download="podcast.mp3"
                id="download-podcast-btn"
              >
                ⬇️ Download MP3
              </a>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setState("setup");
                  setScript("");
                  setAudioSrc("");
                }}
                id="new-podcast-btn"
              >
                🔄 Generate Another
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: "1rem", fontSize: "1rem", fontWeight: 600 }}>
              📜 Generated Script
            </h3>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "0.82rem",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
                maxHeight: "400px",
                overflow: "auto",
              }}
            >
              {script}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
