"use client";

import { useCallback, useEffect, useState } from "react";
import { completeReviewTask, getReviewQueue, redistributeQueue } from "../lib/data";
import { diffDays, todayString } from "../lib/reviewLogic";
import { ReviewRating, ReviewTask, Settings, Subject } from "../lib/types";

const RATING_BUTTONS: { rating: ReviewRating; label: string; className: string }[] = [
  { rating: "easy", label: "余裕", className: "rate-easy" },
  { rating: "normal", label: "普通", className: "rate-normal" },
  { rating: "forgot", label: "忘れてた", className: "rate-forgot" }
];

export function ReviewScreen({
  uid,
  subjects,
  settings
}: {
  uid: string;
  subjects: Subject[];
  settings: Settings;
}) {
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
  const [showRedistribute, setShowRedistribute] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayString();

  const load = useCallback(async () => {
    const queue = await getReviewQueue(uid, subjects);
    setTasks(queue);
    if (queue.length > settings.queueCap) setShowRedistribute(true);
  }, [uid, subjects, settings.queueCap]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!tasks) return <p className="screen-loading">読み込み中…</p>;

  // 今日やる分: 期限が今日以前のタスクをスコア順に、1日の上限まで
  const dueTasks = tasks.filter((t) => t.dueDate <= today);
  const todayTasks = dueTasks.slice(0, settings.dailyLimit);
  const heldBack = dueTasks.length - todayTasks.length;
  const upcoming = tasks.filter((t) => t.dueDate > today);

  const complete = async (task: ReviewTask, rating: ReviewRating) => {
    setTasks((prev) => (prev ? prev.filter((t) => t.id !== task.id) : prev));
    await completeReviewTask(uid, task, rating, subjects, settings);
  };

  const redistribute = async () => {
    setBusy(true);
    try {
      await redistributeQueue(uid, tasks, settings);
      setShowRedistribute(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>今日の復習</h1>
        <p className="screen-sub">
          {todayTasks.length > 0
            ? `あと ${todayTasks.length} 件`
            : "今日の復習は完了です 🎉"}
        </p>
      </header>

      {todayTasks.map((task) => {
        const overdue = diffDays(task.dueDate, today);
        return (
          <article key={task.id} className="task-card">
            <div className="task-head">
              <span className="task-subject">{task.subject}</span>
              {overdue > 0 && <span className="task-overdue">{overdue}日超過</span>}
            </div>
            <p className="task-meta">
              {task.sourceDate} の授業 ・ {task.intervalIndex + 1}回目
            </p>
            {task.note && <p className="task-note">{task.note}</p>}
            <div className="task-actions">
              {RATING_BUTTONS.map((b) => (
                <button
                  key={b.rating}
                  className={`rate-button ${b.className}`}
                  onClick={() => void complete(task, b.rating)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </article>
        );
      })}

      {heldBack > 0 && (
        <p className="queue-note">
          あと {heldBack} 件は明日以降に表示されます(1日の上限 {settings.dailyLimit} 件)
        </p>
      )}

      {upcoming.length > 0 && (
        <details className="upcoming">
          <summary>これからの復習({upcoming.length}件)</summary>
          {upcoming
            .slice()
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .map((t) => (
              <div key={t.id} className="upcoming-row">
                <span>{t.subject}</span>
                <span className="upcoming-date">{t.dueDate}</span>
              </div>
            ))}
        </details>
      )}

      {showRedistribute && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <h2>タスクが溜まっています</h2>
            <p>
              復習キューが {tasks.length} 件(上限 {settings.queueCap} 件)を超えました。
              全タスクを今後2週間に分散し直しますか?
            </p>
            <div className="dialog-actions">
              <button className="button-secondary" onClick={() => setShowRedistribute(false)}>
                あとで
              </button>
              <button className="button-primary" disabled={busy} onClick={() => void redistribute()}>
                {busy ? "処理中…" : "分散し直す"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
