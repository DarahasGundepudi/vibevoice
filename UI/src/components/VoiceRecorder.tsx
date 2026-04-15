"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Props = {
  onRecordingComplete: (blob: Blob, name: string) => void;
  maxDurationSec?: number;
};

// ─── Studio WAV Encoder ──────────────────────────────────────────────────────
const encodeWAV = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  view.setUint32(0, 0x52494646, false);
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  view.setUint32(8, 0x57415645, false);
  /* format chunk identifier */
  view.setUint32(12, 0x666d7420, false);
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  view.setUint32(36, 0x64617461, false);
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: "audio/wav" });
};

export function VoiceRecorder({ onRecordingComplete, maxDurationSec = 20 }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedDataRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef(false);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      recordedDataRef.current = [];
      isRecordingRef.current = true;
      
      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        recordedDataRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      recorderRef.current = processor;

      setIsRecording(true);
      setElapsed(0);
      setAudioPreview(null);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= maxDurationSec) {
            stopRecording();
            return maxDurationSec;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Mic access denied:", err);
      alert("Please allow microphone access to record.");
    }
  }, [maxDurationSec, isRecording]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    
    // Process the data
    if (audioContextRef.current && recordedDataRef.current.length > 0) {
      const sampleRate = audioContextRef.current.sampleRate;
      const totalLength = recordedDataRef.current.reduce((acc, curr) => acc + curr.length, 0);
      const result = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of recordedDataRef.current) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBlob = encodeWAV(result, sampleRate);
      const url = URL.createObjectURL(wavBlob);
      setAudioPreview(url);

      onRecordingComplete(wavBlob, `studio_recording_${Date.now()}.wav`);
    }

    // Cleanup tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current?.disconnect();
    try {
      audioContextRef.current?.close();
    } catch (e) {
      console.error("Error closing audio context:", e);
    }
  }, [onRecordingComplete]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const progressPct = (elapsed / maxDurationSec) * 100;

  return (
    <div className="voice-recorder">
      <div className="recorder-header">
        <span className="recorder-icon">{isRecording ? "🔴" : "🎙️"}</span>
        <span className="recorder-title">
          {isRecording ? "Recording..." : audioPreview ? "Studio Ready" : "Record Voice Sample"}
        </span>
      </div>

      <div className="recorder-progress-track">
        <div
          className="recorder-progress-fill"
          style={{
            width: `${progressPct}%`,
            background: isRecording
              ? "linear-gradient(90deg, #ef4444, #f59e0b)"
              : "var(--accent-green)",
          }}
        />
      </div>
      <div className="recorder-time">
        {elapsed}s / {maxDurationSec}s
      </div>

      <div className="recorder-controls">
        {!isRecording ? (
          <button 
            className="btn btn-primary" 
            onClick={startRecording} 
            style={{ gap: "0.4rem" }}
          >
            🎤 {audioPreview ? "Re-record" : "Start Recording"}
          </button>
        ) : (
          <button 
            className="btn btn-danger" 
            onClick={stopRecording} 
            style={{ gap: "0.4rem" }}
          >
            ⏹ Stop Recording
          </button>
        )}
      </div>

      {audioPreview && !isRecording && (
        <div className="recorder-preview">
          <audio controls src={audioPreview} style={{ width: "100%", borderRadius: "8px" }} />
        </div>
      )}
    </div>
  );
}
