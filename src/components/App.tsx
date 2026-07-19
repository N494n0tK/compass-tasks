"use client";

import { useEffect, useState } from "react";
import { getSettings, getSubjects, saveSettings, saveSubjects } from "../lib/data";
import { Settings, Subject } from "../lib/types";
import { DailyCheckScreen } from "./DailyCheckScreen";
import { ReviewScreen } from "./ReviewScreen";
import { SettingsScreen } from "./SettingsScreen";
import { TemplateScreen } from "./TemplateScreen";

type Tab = "review" | "daily" | "template" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "review", label: "復習", icon: "📚" },
  { id: "daily", label: "今日の確認", icon: "✅" },
  { id: "template", label: "時間割", icon: "🗓" },
  { id: "settings", label: "設定", icon: "⚙️" }
];

export function App({ uid, email }: { uid: string; email: string }) {
  const [tab, setTab] = useState<Tab>("review");
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSubjects(uid), getSettings(uid)]).then(([subs, sets]) => {
      if (cancelled) return;
      setSubjects(subs);
      setSettings(sets);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!subjects || !settings) {
    return (
      <main className="auth-screen">
        <p className="auth-loading">読み込み中…</p>
      </main>
    );
  }

  const updateSubjects = (next: Subject[]) => {
    setSubjects(next);
    void saveSubjects(uid, next);
  };

  const updateSettings = (next: Settings) => {
    setSettings(next);
    void saveSettings(uid, next);
  };

  return (
    <div className="app">
      <main className="app-main">
        {tab === "review" && (
          <ReviewScreen uid={uid} subjects={subjects} settings={settings} />
        )}
        {tab === "daily" && (
          <DailyCheckScreen uid={uid} subjects={subjects} settings={settings} />
        )}
        {tab === "template" && <TemplateScreen uid={uid} subjects={subjects} />}
        {tab === "settings" && (
          <SettingsScreen
            email={email}
            subjects={subjects}
            settings={settings}
            onSubjectsChange={updateSubjects}
            onSettingsChange={updateSettings}
          />
        )}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-item ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
