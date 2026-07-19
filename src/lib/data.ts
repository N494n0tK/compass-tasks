// データアクセス層: Firestore の読み書きはすべてこのファイルを経由する。
// UIコンポーネントから Firestore SDK を直接呼ばないこと。
import {
  doc,
  getDoc,
  setDoc
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  computePriorityScore,
  maxReviews,
  mergeOverdueDuplicates,
  nextTaskAfterRating,
  redistributeDueDates,
  shouldArchive,
  subjectPriority,
  todayString,
  addDays,
  weekdayOf
} from "./reviewLogic";
import {
  DailySchedule,
  DEFAULT_SETTINGS,
  DEFAULT_SUBJECTS,
  EMPTY_TEMPLATE,
  ReviewRating,
  ReviewTask,
  Settings,
  Subject,
  TimetableTemplate
} from "./types";

type ReviewQueueDoc = {
  items?: ReviewTask[];
};

function compassSettingsDoc(uid: string, key: string) {
  return doc(getDb(), "users", uid, "settings", `compass-${key}`);
}

function templateDoc(uid: string) {
  return compassSettingsDoc(uid, "timetableTemplate");
}

function settingsDoc(uid: string) {
  return compassSettingsDoc(uid, "settings");
}

function subjectsDoc(uid: string) {
  return compassSettingsDoc(uid, "subjects");
}

function dailyDoc(uid: string, date: string) {
  return compassSettingsDoc(uid, `daily-${date}`);
}

function queueDoc(uid: string) {
  return compassSettingsDoc(uid, "reviewQueue");
}

function createTaskId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getAllReviewTasks(uid: string): Promise<ReviewTask[]> {
  const snap = await getDoc(queueDoc(uid));
  if (!snap.exists()) return [];
  return ((snap.data() as ReviewQueueDoc).items ?? []) as ReviewTask[];
}

async function saveAllReviewTasks(uid: string, tasks: ReviewTask[]): Promise<void> {
  await setDoc(queueDoc(uid), { items: tasks });
}

// ---- 時間割テンプレート ----

export async function getTimetableTemplate(uid: string): Promise<TimetableTemplate> {
  const snap = await getDoc(templateDoc(uid));
  if (!snap.exists()) return structuredClone(EMPTY_TEMPLATE);
  return { ...structuredClone(EMPTY_TEMPLATE), ...(snap.data() as TimetableTemplate) };
}

export async function saveTimetableTemplate(
  uid: string,
  template: TimetableTemplate
): Promise<void> {
  await setDoc(templateDoc(uid), template);
}

// ---- 科目マスタ・設定 ----

export async function getSubjects(uid: string): Promise<Subject[]> {
  const snap = await getDoc(subjectsDoc(uid));
  if (!snap.exists()) return structuredClone(DEFAULT_SUBJECTS);
  return (snap.data().list ?? []) as Subject[];
}

export async function saveSubjects(uid: string, subjects: Subject[]): Promise<void> {
  await setDoc(subjectsDoc(uid), { list: subjects });
}

export async function getSettings(uid: string): Promise<Settings> {
  const snap = await getDoc(settingsDoc(uid));
  if (!snap.exists()) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Settings) };
}

export async function saveSettings(uid: string, settings: Settings): Promise<void> {
  await setDoc(settingsDoc(uid), settings);
}

// ---- その日の実績(遅延生成) ----

// なければテンプレートから下書きを生成して保存する。未来の日付にも使える。
export async function getOrCreateDailySchedule(
  uid: string,
  date: string
): Promise<DailySchedule> {
  const snap = await getDoc(dailyDoc(uid, date));
  if (snap.exists()) return snap.data() as DailySchedule;

  const template = await getTimetableTemplate(uid);
  const weekday = weekdayOf(date);
  const subjects = weekday ? template[weekday] : [];
  const schedule: DailySchedule = {
    date,
    status: "draft",
    periods: subjects.map((subject) => ({ subject, note: "", held: true }))
  };
  await setDoc(dailyDoc(uid, date), schedule);
  return schedule;
}

export async function saveDailySchedule(
  uid: string,
  schedule: DailySchedule
): Promise<void> {
  await setDoc(dailyDoc(uid, schedule.date), schedule);
}

// 確定: status を confirmed にし、held のコマから復習タスクを生成する
export async function confirmDailySchedule(
  uid: string,
  schedule: DailySchedule,
  subjects: Subject[],
  settings: Settings
): Promise<number> {
  const confirmed: DailySchedule = { ...schedule, status: "confirmed" };
  await setDoc(dailyDoc(uid, schedule.date), confirmed);

  let created = 0;
  const queue = await getAllReviewTasks(uid);
  for (const period of schedule.periods) {
    if (!period.held || !period.subject) continue;
    const priority = subjectPriority(subjects, period.subject);
    if (maxReviews(priority, settings) === 0) continue;

    const task: ReviewTask = {
      id: createTaskId(),
      subject: period.subject,
      note: period.note,
      sourceDate: schedule.date,
      dueDate: addDays(schedule.date, 1),
      intervalIndex: 0,
      intervalDays: 1,
      status: "pending",
      priorityScore: 0
    };
    queue.push(task);
    created += 1;
  }

  if (created > 0) await saveAllReviewTasks(uid, queue);
  return created;
}

// ---- 復習キュー ----

// pendingタスクを取得し、メンテナンス(自動アーカイブ・同一科目統合・スコア再計算)も行う
export async function getReviewQueue(
  uid: string,
  subjects: Subject[]
): Promise<ReviewTask[]> {
  const today = todayString();
  const all = await getAllReviewTasks(uid);
  const raw = all.filter((task) => task.status === "pending");
  let dirty = false;
  const archived: ReviewTask[] = [];

  // 1. 予定間隔の2倍以上超過 → 自動アーカイブ
  const active: ReviewTask[] = [];
  for (const task of raw) {
    if (shouldArchive(task, today)) {
      archived.push({ ...task, status: "archived" });
      dirty = true;
    } else {
      active.push(task);
    }
  }

  // 2. 同一科目の期限切れタスクを統合
  const { kept, removedIds } = mergeOverdueDuplicates(active, today);
  if (removedIds.length > 0) dirty = true;

  // 3. priorityScore を再計算して保存
  const scored = kept.map((task) => ({
    ...task,
    priorityScore: computePriorityScore(task, subjects, today)
  }));
  for (const task of scored) {
    const before = raw.find((t) => t.id === task.id);
    if (!before || before.priorityScore !== task.priorityScore || removedIds.length > 0) {
      dirty = true;
    }
  }

  if (dirty) {
    const nextAll = [
      ...all.filter((task) => task.status !== "pending"),
      ...archived,
      ...scored
    ];
    await saveAllReviewTasks(uid, nextAll);
  }
  return scored.sort((a, b) => b.priorityScore - a.priorityScore);
}

// タスク完了: 自己評価を受けて done にし、必要なら次回タスクを生成する
export async function completeReviewTask(
  uid: string,
  task: ReviewTask,
  rating: ReviewRating,
  subjects: Subject[],
  settings: Settings
): Promise<void> {
  const today = todayString();
  const all = await getAllReviewTasks(uid);
  const next = nextTaskAfterRating(task, rating, subjects, settings, today);
  const updated = all.map((item) =>
    item.id === task.id ? { ...item, status: "done" as const } : item
  );
  if (next) updated.push({ ...next, id: createTaskId() });

  await saveAllReviewTasks(uid, updated);
}

export async function deleteReviewTask(uid: string, taskId: string): Promise<void> {
  const all = await getAllReviewTasks(uid);
  await saveAllReviewTasks(
    uid,
    all.filter((task) => task.id !== taskId)
  );
}

// 再分散(リセット週): 全pendingタスクの dueDate を今日から上限内で再割り当て
export async function redistributeQueue(
  uid: string,
  tasks: ReviewTask[],
  settings: Settings
): Promise<ReviewTask[]> {
  const today = todayString();
  const redistributed = redistributeDueDates(tasks, settings, today);
  const all = await getAllReviewTasks(uid);
  const redistributedById = new Map(redistributed.map((task) => [task.id, task]));
  const updated = all.map((task) => redistributedById.get(task.id) ?? task);
  await saveAllReviewTasks(uid, updated);
  return redistributed;
}
