"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmDailySchedule,
  getOrCreateDailySchedule,
  saveDailySchedule
} from "../lib/data";
import { addDays, todayString } from "../lib/reviewLogic";
import { DailySchedule, Settings, Subject } from "../lib/types";
import { SubjectPicker } from "./SubjectPicker";

export function DailyCheckScreen({
  uid,
  subjects,
  settings
}: {
  uid: string;
  subjects: Subject[];
  settings: Settings;
}) {
  const today = todayString();
  const [date, setDate] = useState(today);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSchedule(null);
    void getOrCreateDailySchedule(uid, date).then((s) => {
      if (!cancelled) setSchedule(s);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, date]);

  const update = useCallback(
    (next: DailySchedule) => {
      setSchedule(next);
      void saveDailySchedule(uid, next);
    },
    [uid]
  );

  if (!schedule) return <p className="screen-loading">読み込み中…</p>;

  const isFuture = date > today;
  const isConfirmed = schedule.status === "confirmed";

  const setPeriod = (index: number, patch: Partial<DailySchedule["periods"][number]>) => {
    const periods = schedule.periods.map((p, i) => (i === index ? { ...p, ...patch } : p));
    update({ ...schedule, periods });
  };

  const removePeriod = (index: number) => {
    update({ ...schedule, periods: schedule.periods.filter((_, i) => i !== index) });
  };

  const addPeriod = () => {
    const fallback = subjects[0]?.name ?? "";
    update({
      ...schedule,
      periods: [...schedule.periods, { subject: fallback, note: "", held: true }]
    });
    setPickerIndex(schedule.periods.length);
  };

  const startLongPress = (index: number) => {
    longPressTimer.current = setTimeout(() => {
      if (window.confirm(`${schedule.periods[index].subject || "このコマ"} を削除しますか?`)) {
        removePeriod(index);
      }
    }, 550);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      const created = await confirmDailySchedule(uid, schedule, subjects, settings);
      setSchedule({ ...schedule, status: "confirmed" });
      setConfirmedCount(created);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>{date === today ? "今日の確認" : "時間割の確認"}</h1>
        <div className="date-nav">
          <button className="date-arrow" onClick={() => setDate(addDays(date, -1))}>
            ◀
          </button>
          <input
            className="date-input"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button className="date-arrow" onClick={() => setDate(addDays(date, 1))}>
            ▶
          </button>
        </div>
        {isFuture && (
          <p className="screen-sub">未来の日付です。特別時間割を事前に修正できます。</p>
        )}
        {isConfirmed && <p className="badge-confirmed">確定済み</p>}
      </header>

      {schedule.periods.length === 0 && (
        <p className="empty-note">
          この日のコマはありません。「時間割」タブでテンプレートを設定するか、
          下の+ボタンでコマを追加してください。
        </p>
      )}

      {schedule.periods.map((period, i) => (
        <div
          key={i}
          className={`period-row ${period.held ? "" : "period-skipped"}`}
          onTouchStart={() => startLongPress(i)}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <label className="period-check">
            <input
              type="checkbox"
              checked={period.held}
              onChange={(e) => setPeriod(i, { held: e.target.checked })}
            />
          </label>
          <div className="period-body">
            <button className="period-subject" onClick={() => setPickerIndex(i)}>
              {period.subject || "科目を選択"}
              {!period.held && <span className="held-label"> ・休講</span>}
            </button>
            <input
              className="period-note"
              type="text"
              placeholder="一言メモ(任意)"
              value={period.note}
              onChange={(e) => setPeriod(i, { note: e.target.value })}
            />
          </div>
        </div>
      ))}

      <button className="add-period" onClick={addPeriod}>
        + コマを追加
      </button>
      <p className="hint-note">コマを長押しすると削除できます</p>

      {!isFuture && !isConfirmed && (
        <button
          className="confirm-button"
          disabled={confirming}
          onClick={() => void confirm()}
        >
          {confirming ? "確定中…" : "確定して復習タスクを作成"}
        </button>
      )}

      {confirmedCount !== null && (
        <p className="confirm-done">復習タスクを {confirmedCount} 件作成しました ✅</p>
      )}

      {pickerIndex !== null && (
        <SubjectPicker
          subjects={subjects}
          current={schedule.periods[pickerIndex]?.subject ?? ""}
          onSelect={(name) => {
            setPeriod(pickerIndex, { subject: name });
            setPickerIndex(null);
          }}
          onDelete={() => {
            removePeriod(pickerIndex);
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}
