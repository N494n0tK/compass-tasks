import {
  Priority,
  ReviewRating,
  ReviewTask,
  Settings,
  Subject,
  Weekday,
  WEEKDAYS
} from "./types";

// 復習間隔: 1日後 → 1週間後 → 1ヶ月後
export const INTERVALS = [1, 7, 30];

const PRIORITY_COEF: Record<Priority, number> = {
  high: 3,
  mid: 2,
  low: 1
};

export function todayString(): string {
  return toDateString(new Date());
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

export function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function weekdayOf(dateStr: string): Weekday | null {
  const d = new Date(`${dateStr}T00:00:00`);
  const idx = d.getDay(); // 0=日
  if (idx === 0) return null; // 日曜は時間割なし
  return WEEKDAYS[idx - 1];
}

export function subjectPriority(subjects: Subject[], name: string): Priority {
  return subjects.find((s) => s.name === name)?.priority ?? "mid";
}

// 優先度ごとの復習回数: 高=3回, 中=2回, 低=1回(設定でオフ可)
export function maxReviews(priority: Priority, settings: Settings): number {
  if (priority === "high") return 3;
  if (priority === "mid") return 2;
  return settings.lowPriorityGenerates ? 1 : 0;
}

// priorityScore = 科目優先度の係数 × 期限超過日数の係数
export function computePriorityScore(
  task: ReviewTask,
  subjects: Subject[],
  today: string
): number {
  const coef = PRIORITY_COEF[subjectPriority(subjects, task.subject)];
  const overdue = Math.max(0, diffDays(task.dueDate, today));
  return coef * (1 + overdue);
}

export function isOverdue(task: ReviewTask, today: string): boolean {
  return diffDays(task.dueDate, today) > 0;
}

// 予定間隔の2倍以上期限を過ぎたタスクは自動アーカイブ対象
export function shouldArchive(task: ReviewTask, today: string): boolean {
  const overdue = diffDays(task.dueDate, today);
  return overdue >= Math.max(2, task.intervalDays * 2);
}

// 自己評価から次のタスクを決める(簡易SM-2)
// 忘れてた → 翌日に同じ段階を再スケジュール
// 普通     → 次の間隔へ進む
// 余裕     → 次の間隔を2倍に延長して進む
export function nextTaskAfterRating(
  task: ReviewTask,
  rating: ReviewRating,
  subjects: Subject[],
  settings: Settings,
  today: string
): Omit<ReviewTask, "id"> | null {
  if (rating === "forgot") {
    return {
      ...stripId(task),
      dueDate: addDays(today, 1),
      intervalDays: 1,
      status: "pending",
      priorityScore: 0
    };
  }

  const priority = subjectPriority(subjects, task.subject);
  const nextIndex = task.intervalIndex + 1;
  if (nextIndex >= maxReviews(priority, settings) || nextIndex >= INTERVALS.length) {
    return null; // 復習完了
  }

  const base = INTERVALS[nextIndex];
  const interval = rating === "easy" ? base * 2 : base;
  return {
    ...stripId(task),
    dueDate: addDays(today, interval),
    intervalIndex: nextIndex,
    intervalDays: interval,
    status: "pending",
    priorityScore: 0
  };
}

function stripId(task: ReviewTask): Omit<ReviewTask, "id"> {
  const { id: _id, ...rest } = task;
  return rest;
}

// 同一科目の期限切れタスクを1件に統合する。統合で消すタスクのidを返す
export function mergeOverdueDuplicates(
  tasks: ReviewTask[],
  today: string
): { kept: ReviewTask[]; removedIds: string[] } {
  const overdueBySubject = new Map<string, ReviewTask[]>();
  const rest: ReviewTask[] = [];

  for (const t of tasks) {
    if (isOverdue(t, today)) {
      const list = overdueBySubject.get(t.subject) ?? [];
      list.push(t);
      overdueBySubject.set(t.subject, list);
    } else {
      rest.push(t);
    }
  }

  const kept: ReviewTask[] = [...rest];
  const removedIds: string[] = [];

  for (const list of overdueBySubject.values()) {
    if (list.length === 1) {
      kept.push(list[0]);
      continue;
    }
    list.sort((a, b) => a.sourceDate.localeCompare(b.sourceDate));
    const primary = list[0];
    const notes = list.map((t) => t.note).filter(Boolean);
    kept.push({
      ...primary,
      note: [...new Set(notes)].join(" / "),
      intervalIndex: Math.min(...list.map((t) => t.intervalIndex)),
      intervalDays: Math.min(...list.map((t) => t.intervalDays))
    });
    for (const t of list.slice(1)) removedIds.push(t.id);
  }

  return { kept, removedIds };
}

// 再分散: 全pendingタスクを今日から2週間、1日の上限内に再割り当てする
export function redistributeDueDates(
  tasks: ReviewTask[],
  settings: Settings,
  today: string
): ReviewTask[] {
  const sorted = [...tasks].sort((a, b) => b.priorityScore - a.priorityScore);
  return sorted.map((task, i) => {
    // 上位から dailyLimit 件ずつ今日→明日→…と割り当てる(2週間で収まらない分は後ろに続く)
    const dayOffset = Math.floor(i / settings.dailyLimit);
    return { ...task, dueDate: addDays(today, dayOffset) };
  });
}
