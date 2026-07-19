export type Priority = "high" | "mid" | "low";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土"
};

export interface Subject {
  name: string;
  priority: Priority;
}

export type TimetableTemplate = Record<Weekday, string[]>;

export interface Period {
  subject: string;
  note: string;
  held: boolean;
}

export type ScheduleStatus = "draft" | "confirmed";

export interface DailySchedule {
  date: string; // YYYY-MM-DD
  status: ScheduleStatus;
  periods: Period[];
}

export type ReviewStatus = "pending" | "done" | "archived";

export type ReviewRating = "easy" | "normal" | "forgot";

export interface ReviewTask {
  id: string;
  subject: string;
  note: string;
  sourceDate: string; // 授業のあった日
  dueDate: string; // YYYY-MM-DD
  intervalIndex: number; // 0=1日後, 1=1週間後, 2=1ヶ月後
  intervalDays: number; // 現在の間隔(SM-2の伸縮用)
  status: ReviewStatus;
  priorityScore: number;
}

export interface Settings {
  dailyLimit: number; // 1日の復習表示上限
  queueCap: number; // キュー全体の上限(超えたら再分散を提案)
  lowPriorityGenerates: boolean; // 優先度「低」の科目でタスクを生成するか
}

export const DEFAULT_SETTINGS: Settings = {
  dailyLimit: 10,
  queueCap: 50,
  lowPriorityGenerates: true
};

export const DEFAULT_SUBJECTS: Subject[] = [
  { name: "数学", priority: "high" },
  { name: "英語", priority: "high" },
  { name: "国語", priority: "mid" },
  { name: "理科", priority: "mid" },
  { name: "社会", priority: "mid" },
  { name: "情報", priority: "low" },
  { name: "体育", priority: "low" }
];

export const EMPTY_TEMPLATE: TimetableTemplate = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: []
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "高",
  mid: "中",
  low: "低"
};
