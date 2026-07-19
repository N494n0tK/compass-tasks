"use client";

import { useEffect, useState } from "react";
import { getTimetableTemplate, saveTimetableTemplate } from "../lib/data";
import {
  Subject,
  TimetableTemplate,
  Weekday,
  WEEKDAY_LABELS,
  WEEKDAYS
} from "../lib/types";
import { SubjectPicker } from "./SubjectPicker";

export function TemplateScreen({ uid, subjects }: { uid: string; subjects: Subject[] }) {
  const [template, setTemplate] = useState<TimetableTemplate | null>(null);
  const [day, setDay] = useState<Weekday>("mon");
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getTimetableTemplate(uid).then((t) => {
      if (!cancelled) setTemplate(t);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!template) return <p className="screen-loading">読み込み中…</p>;

  const update = (next: TimetableTemplate) => {
    setTemplate(next);
    void saveTimetableTemplate(uid, next);
  };

  const setSlot = (index: number, name: string) => {
    const list = template[day].map((s, i) => (i === index ? name : s));
    update({ ...template, [day]: list });
  };

  const removeSlot = (index: number) => {
    update({ ...template, [day]: template[day].filter((_, i) => i !== index) });
  };

  const addSlot = () => {
    update({ ...template, [day]: [...template[day], subjects[0]?.name ?? ""] });
    setPickerIndex(template[day].length);
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>時間割テンプレート</h1>
        <p className="screen-sub">週の基本時間割。学期の変わり目に更新してください。</p>
      </header>

      <div className="weekday-tabs">
        {WEEKDAYS.map((w) => (
          <button
            key={w}
            className={`weekday-tab ${day === w ? "active" : ""}`}
            onClick={() => setDay(w)}
          >
            {WEEKDAY_LABELS[w]}
          </button>
        ))}
      </div>

      {template[day].length === 0 && (
        <p className="empty-note">コマがありません。+ボタンで追加してください。</p>
      )}

      {template[day].map((subject, i) => (
        <div key={i} className="template-row">
          <span className="template-index">{i + 1}限</span>
          <button className="period-subject" onClick={() => setPickerIndex(i)}>
            {subject || "科目を選択"}
          </button>
          <button className="template-remove" onClick={() => removeSlot(i)}>
            ✕
          </button>
        </div>
      ))}

      <button className="add-period" onClick={addSlot}>
        + コマを追加
      </button>

      {pickerIndex !== null && (
        <SubjectPicker
          subjects={subjects}
          current={template[day][pickerIndex] ?? ""}
          onSelect={(name) => {
            setSlot(pickerIndex, name);
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}
