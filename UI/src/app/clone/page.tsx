"use client";

import { useState, useRef, useCallback } from "react";
import { VoiceSelector } from "@/components/VoiceSelector";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { HistoryPanel } from "@/components/HistoryPanel";
import { useAudio } from "@/contexts/AudioContext";
import { useVoices } from "@/contexts/VoiceContext";

export default function ClonePage() {
  const [voiceName, setVoiceName] = useState("");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [audioSrc, setAudioSrc] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Carter (US Male)");
  const [inputMode, setInputMode] = useState<"upload" | "record">("upload");
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { playAudio } = useAudio();
  const { customVoices, addCustomVoice, deleteCustomVoice, renameCustomVoice, loading: voicesLoading } = useVoices();

  // ─── Clone a voice (upload sample) ───────────────────────────────────────
  const handleCloneVoice = async () => {
    const finalBlob = recordedBlob || (voiceFile ? new Blob([voiceFile], { type: voiceFile.type }) : null);

    if (!voiceName.trim() || !finalBlob) {
      alert("Please provide a name and audio sample for the voice.");
      return;
    }
    
    setIsGenerating(true);
    const success = await addCustomVoice(voiceName, finalBlob);
    
    if (success) {
      setSelectedVoice(voiceName);
      setVoiceName("");
      setVoiceFile(null);
      setRecordedBlob(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      alert("Failed to save voice to cloud storage.");
    }
    setIsGenerating(false);
  };

  const handleRecordingComplete = useCallback((blob: Blob, name: string) => {
    setRecordedBlob(blob);
    setVoiceName((prev) => prev || name);
  }, []);

  const handleRename = async (id: string, currentName: string) => {
    const newName = prompt("Enter new name for the voice:", currentName);
    if (newName && newName !== currentName) {
      const success = await renameCustomVoice(id, newName);
      if (!success) alert("Failed to rename voice.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This will remove the saved recording too.`)) {
      const success = await deleteCustomVoice(id);
      if (!success) alert("Failed to delete voice.");
    }
  };

  // ─── Generate speech with selected voice ─────────────────────────────────
  const generateSpeech = async () => {
    if (!text.trim() || !selectedVoice) {
      alert("Please enter text and select a voice.");
      return;
    }

    setIsGenerating(true);

    try {
      const voiceServerUrl = process.env.NEXT_PUBLIC_VOICE_SERVER_URL || "http://localhost:8000";

      // 1. Submit task
      const fd = new FormData();
      fd.append("text", text);
      fd.append("tier", "premium");
      fd.append("format", "wav");

      const customVoice = customVoices.find(v => v.name === selectedVoice);
      if (customVoice && customVoice.sampleUrl) {
          const blobRes = await fetch(customVoice.sampleUrl);
          const blob = await blobRes.blob();
          fd.append("voice", blob, "sample.wav");
      } else {
          // It's a preset!
          fd.append("preset", selectedVoice);
      }

      const res = await fetch(`${voiceServerUrl}/cloner/generate`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error(await res.text() || "Synthesis failed");

      const { task_id } = await res.json();
      
      // 2. Poll for results
      const poll = setInterval(async () => {
          try {
              const sRes = await fetch(`${voiceServerUrl}/cloner/status/${task_id}`);
              const sData = await sRes.json();

              if (sData.status === "complete") {
                  clearInterval(poll);
                  const audioUrl = `${voiceServerUrl}/cloner/download/${task_id}`;
                  setAudioSrc(audioUrl);
                  playAudio(audioUrl, `Clone: ${text.slice(0, 30)}...`, "clone");
                  setIsGenerating(false);

                  // Save to history
                  fetch("/api/history/clone", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ inputText: text, voiceUsed: selectedVoice }),
                  }).catch(() => {});
              } else if (sData.status === "failed") {
                  clearInterval(poll);
                  alert("Generation failed: " + sData.error);
                  setIsGenerating(false);
              }
          } catch (e) {
              clearInterval(poll);
              console.error("Polling error:", e);
              setIsGenerating(false);
          }
      }, 2000);

    } catch (err) {
      console.error(err);
      alert("Voice synthesis failed: " + err.message);
      setIsGenerating(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>🎧 Clone Desk</h2>
        <p>
          Clone any voice from a short sample, then generate unlimited voiceovers
        </p>
      </div>

      <HistoryPanel
        tool="clone"
        isOpen={historyOpen}
        onToggle={() => setHistoryOpen(!historyOpen)}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", maxWidth: 950 }}>
        {/* Left: Clone a new voice */}
        <div className="glass-panel">
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            🎤 Clone New Voice
          </h3>

          <div className="form-group">
            <label className="form-label">Voice Name</label>
            <input
              className="form-input"
              placeholder='e.g., "My Voice", "Morgan Freeman"'
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              id="voice-name-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Audio Sample (10-20 seconds)</label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <button
                className={`btn ${inputMode === "upload" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setInputMode("upload")}
                style={{ flex: 1, fontSize: "0.78rem", padding: "0.4rem" }}
              >
                📁 Upload
              </button>
              <button
                className={`btn ${inputMode === "record" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setInputMode("record")}
                style={{ flex: 1, fontSize: "0.78rem", padding: "0.4rem" }}
              >
                🎙️ Record
              </button>
            </div>

            {inputMode === "upload" ? (
              <label
                className={`upload-zone ${voiceFile ? "has-file" : ""}`}
                htmlFor="voice-sample-upload"
              >
                <div className="icon">{voiceFile ? "✅" : "🎤"}</div>
                <div className="label">
                  {voiceFile ? "Sample uploaded" : "Click to upload WAV or MP3"}
                </div>
                {voiceFile && <div className="filename">{voiceFile.name}</div>}
                <input
                  type="file"
                  id="voice-sample-upload"
                  accept=".wav,.mp3,.ogg,.webm"
                  style={{ display: "none" }}
                  ref={fileInputRef}
                  onChange={(e) => setVoiceFile(e.target.files?.[0] || null)}
                />
              </label>
            ) : (
              <VoiceRecorder onRecordingComplete={handleRecordingComplete} />
            )}
          </div>

          <button
            className="btn btn-primary w-full"
            onClick={handleCloneVoice}
            disabled={isGenerating}
            id="clone-voice-btn"
            style={{ background: "var(--gradient-clone)" }}
          >
            {isGenerating ? "⏳ Saving to Cloud..." : "Clone This Voice"}
          </button>

          {/* Persistent Voice Library */}
          <div className="mt-4">
            <div className="form-label">Your Permanent Voice Library</div>
            {voicesLoading ? (
              <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>Loading your voices...</div>
            ) : customVoices.length === 0 ? (
              <div style={{ fontSize: "0.75rem", opacity: 0.4 }}>No voices saved yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                {customVoices.map((v) => (
                  <div 
                    key={v.id} 
                    className="glass-panel" 
                    style={{ 
                      padding: "0.6rem 0.8rem", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "space-between",
                      border: selectedVoice === v.name ? "1px solid var(--accent-orange)" : "1px solid var(--bg-glass-border)",
                      background: selectedVoice === v.name ? "rgba(245, 158, 11, 0.05)" : "var(--bg-card)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", overflow: "hidden" }}>
                      <button 
                        onClick={() => playAudio(v.sampleUrl, `Sample: ${v.name}`, "clone")}
                        style={{ 
                          background: "var(--bg-glass)", 
                          border: "none", 
                          borderRadius: "50%", 
                          width: "28px", 
                          height: "28px", 
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontSize: "0.8rem"
                        }}
                        title="Play original sample"
                      >
                        ▶️
                      </button>
                      <span 
                        style={{ fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        onClick={() => setSelectedVoice(v.name)}
                      >
                        {v.name}
                      </span>
                    </div>
                    
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button 
                        className="btn-icon" 
                        onClick={() => handleRename(v.id, v.name)}
                        style={{ opacity: 0.6 }}
                        title="Rename"
                      >
                        ✏️
                      </button>
                      <button 
                        className="btn-icon" 
                        onClick={() => handleDelete(v.id, v.name)}
                        style={{ opacity: 0.6 }}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Generate speech */}
        <div className="glass-panel">
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            ✍️ Generate Voiceover
          </h3>

          <VoiceSelector
            value={selectedVoice}
            onChange={setSelectedVoice}
            label="Select Speaker"
          />

          <div className="form-group">
            <label className="form-label">Text to Speak</label>
            <textarea
              className="form-textarea"
              placeholder="Type the text you want to convert to speech..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              id="clone-text-input"
            />
          </div>

          <button
            className="btn btn-primary w-full"
            onClick={generateSpeech}
            disabled={isGenerating || !selectedVoice}
            id="generate-clone-btn"
            style={{ background: "var(--gradient-clone)" }}
          >
            {isGenerating ? "⏳ Generating..." : "🔊 Generate Speech"}
          </button>

          {audioSrc && (
            <div className="mt-3">
              <audio
                controls
                src={audioSrc}
                style={{ width: "100%", borderRadius: "8px" }}
                id="clone-audio-player"
              />
              <a
                className="btn btn-secondary w-full mt-1"
                href={audioSrc}
                download="voiceover.wav"
                style={{ marginTop: "0.5rem" }}
                id="download-clone-btn"
              >
                ⬇️ Download Audio
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
