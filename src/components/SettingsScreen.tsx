"use client";

import { useState } from "react";
import { signOut } from "../lib/firebase";
import { Priority, PRIORITY_LABELS, Settings, Subject } from "../lib/types";

const PRIORITIES: Priority[] = ["high", "mid", "low"];

export function SettingsScreen({
  email,
  subjects,
  settings,
  onSubjectsChange,
  onSettingsChange
}: {
  email: string;
  subjects: Subject[];
  settings: Settings;
  onSubjectsChange: (next: Subject[]) => void;
  onSettingsChange: (next: Settings) => void;
}) {
  const [newSubject, setNewSubject] = useState("");

  const setPriority = (index: number, priority: Priority) => {
    onSubjectsChange(subjects.map((s, i) => (i === index ? { ...s, priority } : s)));
  };

  const removeSubject = (index: number) => {
    const target = subjects[index];
    if (window.confirm(`「${target.name}」を削除しますか?`)) {
      onSubjectsChange(subjects.filter((_, i) => i !== index));
    }
  };

  const addSubject = () => {
    const name = newSubject.trim();
    if (!name || subjects.some((s) => s.name === name)) return;
    onSubjectsChange([...subjects, { name, priority: "mid" }]);
    setNewSubject("");
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>設定</h1>
        <p className="screen-sub">{email}</p>
      </header>

      <section className="settings-section">
        <h2>科目と優先度</h2>
        <p className="settings-help">
          優先度で復習回数が変わります: 高=3回(1日/1週/1ヶ月)・中=2回・低=1回
        </p>
        {subjects.map((s, i) => (
          <div key={s.name} className="subject-row">
            <span className="subject-name">{s.name}</span>
            <div className="priority-toggle">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  className={`priority-option ${s.priority === p ? `on priority-${p}` : ""}`}
                  onClick={() => setPriority(i, p)}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
            <button className="template-remove" onClick={() => removeSubject(i)}>
              ✕
            </button>
          </div>
        ))}
        <form
          className="sheet-custom"
          onSubmit={(e) => {
            e.preventDefault();
            addSubject();
          }}
        >
          <input
            type="text"
            placeholder="科目を追加"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
          />
          <button type="submit" disabled={!newSubject.trim()}>
            追加
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h2>復習キュー</h2>
        <label className="settings-row">
          <span>1日の表示上限</span>
          <input
            type="number"
            min={1}
            max={50}
            value={settings.dailyLimit}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                dailyLimit: Math.max(1, Number(e.target.value) || 1)
              })
            }
          />
        </label>
        <label className="settings-row">
          <span>キュー全体の上限(再分散の提案)</span>
          <input
            type="number"
            min={10}
            max={300}
            value={settings.queueCap}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                queueCap: Math.max(10, Number(e.target.value) || 10)
              })
            }
          />
        </label>
        <label className="settings-row">
          <span>優先度「低」の科目も復習タスクを作る</span>
          <input
            type="checkbox"
            checked={settings.lowPriorityGenerates}
            onChange={(e) =>
              onSettingsChange({ ...settings, lowPriorityGenerates: e.target.checked })
            }
          />
        </label>
      </section>

      <button className="button-secondary signout" onClick={() => void signOut()}>
        ログアウト
      </button>
    </div>
  );
}
