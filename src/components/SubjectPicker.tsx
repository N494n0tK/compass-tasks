"use client";

import { useState } from "react";
import { PRIORITY_LABELS, Subject } from "../lib/types";

export function SubjectPicker({
  subjects,
  current,
  onSelect,
  onDelete,
  onClose
}: {
  subjects: Subject[];
  current: string;
  onSelect: (name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2 className="sheet-title">科目を選択</h2>
        <div className="sheet-list">
          {subjects.map((s) => (
            <button
              key={s.name}
              className={`sheet-item ${s.name === current ? "selected" : ""}`}
              onClick={() => onSelect(s.name)}
            >
              <span>{s.name}</span>
              <span className={`priority-chip priority-${s.priority}`}>
                {PRIORITY_LABELS[s.priority]}
              </span>
            </button>
          ))}
        </div>
        <form
          className="sheet-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) onSelect(custom.trim());
          }}
        >
          <input
            type="text"
            placeholder="その他の科目名を入力"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="submit" disabled={!custom.trim()}>
            決定
          </button>
        </form>
        {onDelete && (
          <button className="sheet-delete" onClick={onDelete}>
            このコマを削除
          </button>
        )}
        <button className="sheet-cancel" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
