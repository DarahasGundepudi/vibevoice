"use client";

import { useState, useEffect } from "react";
import { useVoices } from "@/contexts/VoiceContext";

type Voice = {
  id: string;
  name: string;
  gender: string | null;
  type: string;
  lang?: string;
};

type Props = {
  value: string;
  onChange: (voiceId: string) => void;
  label?: string;
};

const LANG_MAP: Record<string, { label: string; flag: string }> = {
  de: { label: "German", flag: "🇩🇪" },
  en: { label: "English", flag: "🇺🇸" },
  fr: { label: "French", flag: "🇫🇷" },
  in: { label: "Indian", flag: "🇮🇳" },
  it: { label: "Italian", flag: "🇮🇹" },
  jp: { label: "Japanese", flag: "🇯🇵" },
  kr: { label: "Korean", flag: "🇰🇷" },
  nl: { label: "Dutch", flag: "🇳🇱" },
  pl: { label: "Polish", flag: "🇵🇱" },
  pt: { label: "Portuguese", flag: "🇵🇹" },
  sp: { label: "Spanish", flag: "🇪🇸" },
};

export function VoiceSelector({ value, onChange, label = "Select Speaker" }: Props) {
  const { customVoices } = useVoices();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVoices = async () => {
      try {
        const gpuUrl = process.env.NEXT_PUBLIC_GPU_SERVER_URL || "http://localhost:8000";
        const res = await fetch(`${gpuUrl}/voices`);
        if (res.ok) {
          const data = await res.json();
          // The backend returns { "voices": [{id, name, gender, lang, type}] }
          setVoices(data.voices || []);
        }
      } catch (err) {
        console.error("Failed to fetch voices:", err);
        // Fallback: hardcode the known presets
        setVoices([
          { id: "Carter (US Male)", name: "Carter", gender: "male", type: "preset", lang: "en" },
          { id: "Emma (US Female)", name: "Emma", gender: "female", type: "preset", lang: "en" },
        ]);
      }
      setLoading(false);
    };
    fetchVoices();
  }, []);

  const getLanguageGroup = (lang?: string) => {
    if (!lang || !LANG_MAP[lang]) return { label: "Global", flag: "🎤" };
    return LANG_MAP[lang];
  };

  // Group presets by language
  const presetsByLang: Record<string, Voice[]> = {};
  voices.filter(v => v.type === "preset").forEach(v => {
    const lang = v.lang || "en";
    if (!presetsByLang[lang]) presetsByLang[lang] = [];
    presetsByLang[lang].push(v);
  });

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select
        className="form-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        {loading && <option>Loading voices...</option>}
        {!loading && <option value="">Choose a voice...</option>}

        {/* 📋 Your Persistent Clones (Highest Priority) */}
        {customVoices.length > 0 && (
          <optgroup label="✨ Your Saved Voices">
            {customVoices.map((v) => (
              <option key={v.id} value={v.name}>
                🎙️ {v.name}
              </option>
            ))}
          </optgroup>
        )}

        {/* 🌎 International Presets (Grouped) */}
        {Object.entries(presetsByLang).map(([langCode, langVoices]) => {
          const group = getLanguageGroup(langCode);
          return (
            <optgroup key={langCode} label={`${group.flag} ${group.label} Voices`}>
              {langVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.gender === "male" ? "♂️" : "♀️"} {v.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
