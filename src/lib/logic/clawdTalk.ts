/**
 * Compass — Clawd くんの言葉（純ロジック）
 *
 * 要望の原文（2026-08-28）:
 * 「チャットタブっていう隠しタブ…そこには真ん中にClawdくんがいて、そこで励ましてもらったり
 *   応援してもらったり、Clawdくんと触れ合ったりできる」
 * 「タスクをクリアするごとに、下にClawdくんからメッセージが届くように」
 *
 * ## 言葉づかいの方針
 *
 * これは高校生が自分ひとりで使う学習アプリで、Clawd は**採点する側ではない**。
 * だから守ることが 3 つある:
 *
 *  1. **evaluate せず、見ている**。「えらい」「すごい」の断定は、次にできなかった日に
 *     裏返って刺さる。「1 つ片づいた」「ここまで来た」と、起きたことだけを言う。
 *  2. **数を作らない**。「あと少し！」のような煽りは、残りが多い日ほど嘘になる。
 *     残り件数は画面が既に出しているので、Clawd は数えない。
 *  3. **短い**。下から出てくる祝いは 1 行で読み終わること。長い励ましは
 *     読む手間になり、片づけの流れを止める。
 *
 * ## 乱数を使わない
 *
 * `Math.random()` を使うと、同じ操作をしても毎回違うものが出てテストが書けない。
 * ここでは**通し番号（`n`）で選ぶ**。n はタスクを片づけた回数や会話の長さなので、
 * 続けて触れば必ず違う言葉になり、同じ n なら必ず同じ言葉になる。
 *
 * 純ロジック。React / firebase / localStorage を import しない。
 */

/** タスクを 1 つ片づけたときに下から届く一言 */
const CHEER: readonly string[] = [
  '1つ片づいた。いい流れ',
  'ここまで来たね',
  'よし、次いこう',
  '手が動いてる。それがいちばん強い',
  'ちゃんと進んでる',
  'いま1つ減った',
  'その調子',
  '積み上がってきた',
];

/** その日ぶんを全部片づけたとき。ここだけは素直に祝う */
const CHEER_ALL: readonly string[] = [
  '今日のぶん、やりきった！',
  '全部片づいた。おつかれさま',
  'これで今日は終わり。えらいとかじゃなく、単純にすごい',
];

/** 画面を開いたときの挨拶。時間帯で変える */
const HELLO_MORNING = 'おはよう。今日はどこから手をつける？';
const HELLO_DAY = 'やってる？ 手が止まったらここで少し休んでいいよ';
const HELLO_EVENING = 'おつかれさま。今日はどうだった？';
const HELLO_NIGHT = 'まだ起きてるの。無理しない範囲でね';

/**
 * 触られたとき（Clawd をタップ）に返す言葉。
 * **同じ言葉を連続で返さない**ように `n` で順に回す。
 */
const POKE: readonly string[] = [
  'ここにいるよ',
  'ん？',
  'いつでも見てる',
  'ちょっと休憩する？',
  '深呼吸してみて',
  'えらいよ、ここまで来たの',
  '完璧じゃなくていい',
  '手が止まってもいい。戻ってこれたらそれで十分',
  'ノート、あとで見返すと効くよ',
  '水飲んだ？',
];

/** ボタンで選べる話しかけ。文章の自由入力は扱わず、作業時間だけ専用欄で受け取る。 */
export interface ClawdPrompt {
  /** ボタンの字 = 自分が言うこと */
  say: string;
  /** Clawd の返し。複数あるときは `n` で回す */
  reply: readonly string[];
  /**
   * 押したあと会話の続きに**操作**が出るもの。
   * `'work'` … 長さを選ぶ札が出て、選ぶと一緒に作業する浮き窓が開く。
   * 言葉を返して終わりではない選択肢はこれで区別する。
   */
  kind?: 'work';
}

/**
 * 一緒に作業する長さの候補（分）。
 *
 * 25 を真ん中に置いたのはポモドーロの慣習に合わせたから。15 は「とりあえず机に向かう」、
 * 60 は「腰を据える」。固定候補はここまでにして、必要な人だけ自由入力（上限 720 分）を使う。
 * 最初から長時間を約束させるのではなく、選びやすい短い札を中心に置く。
 */
export const CLAWD_WORK_MINUTES: readonly number[] = [15, 25, 45, 60];

/** 自由入力で許可する作業時間の上限（分）。桁外れの誤入力を防ぐため 12 時間まで。 */
export const CLAWD_WORK_MAX_MINUTES = 720;

export type ClawdWorkMinutesValidation =
  | { ok: true; minutes: number }
  | { ok: false; reason: 'empty' | 'integer' | 'range' };

/**
 * チャットから入力された作業時間を検証する。
 *
 * 入力欄はモバイルの数字キーボードを出しつつ、指数表記や小数も入力できるため、
 * ここでは文字列の形を先に確認してから安全な整数へ変換する。
 */
export function validateClawdWorkMinutes(raw: string): ClawdWorkMinutesValidation {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (!/^\d+$/.test(value)) return { ok: false, reason: 'integer' };

  const minutes = Number(value);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > CLAWD_WORK_MAX_MINUTES) {
    return { ok: false, reason: 'range' };
  }
  return { ok: true, minutes };
}

/** Enter/Return で送信してよいキー入力か。IME 変換中は確定しない。 */
export function shouldSubmitClawdWorkMinutes(
  key: string,
  isComposing: boolean,
  validation: ClawdWorkMinutesValidation,
): boolean {
  return (key === 'Enter' || key === 'Return') && !isComposing && validation.ok;
}

/**
 * 話しかけの候補。
 *
 * 文章の自由入力欄は置かない。何を打っても返せるふりをするのは、この画面が
 * できることを偽ることになる（Clawd の言葉はここに書いてある固定の文で、
 * その場で考えているわけではない）。言えることを最初から見せて選ばせるほうが正直で、
 * 疲れているときに文章を考えなくて済むぶん、実際に押せる。
 */
export const CLAWD_PROMPTS: readonly ClawdPrompt[] = [
  {
    say: '一緒に作業して',
    kind: 'work',
    reply: [
      'いいよ。どれくらいやる？',
      'やろう。何分にする？',
      'つきあうよ。長さだけ決めて',
    ],
  },
  {
    say: '疲れた',
    reply: [
      'そりゃ疲れるよ、ここまでやってれば。5分だけ何もしないのも手',
      '疲れたって言えるのはちゃんとやった証拠。休もう',
      '今日はもう十分かも。明日の自分に少し渡していい',
    ],
  },
  {
    say: 'やる気が出ない',
    reply: [
      'やる気は出てから動くものじゃなくて、動くと出てくるやつ。いちばん小さいの1つだけやってみる？',
      '5分だけタイマー回してみて。切れたらやめていい',
      '出ない日もある。今日は「開いた」で合格にしよう',
    ],
  },
  {
    say: '不安',
    reply: [
      '何が不安か、1行でいいから書き出すと形が見える。ノートのまとめ欄でもいいよ',
      '全部を今日どうにかしなくていい。今日のぶんだけ',
      '不安なままでも手は動かせる。動かしてるうちに小さくなることが多い',
    ],
  },
  {
    say: '応援して',
    reply: [
      'いける。ここまで積んできたのは本当だから',
      '見てる。ちゃんと見てるよ',
      '今日のきみ、悪くないよ',
    ],
  },
  {
    say: '聞いて',
    reply: [
      'うん、聞いてる',
      'どうぞ。急がなくていい',
      'ここでは何を思っててもいい',
    ],
  },
];

/** 0 以上の整数に丸める（`n` が負や NaN でも落ちないように） */
function idx(n: number, len: number): number {
  if (!len) return 0;
  const v = Number.isFinite(n) ? Math.floor(Math.abs(n)) : 0;
  return v % len;
}

/**
 * タスクを片づけたときの一言。
 *
 * @param n     何個目の完了か（回すための通し番号）
 * @param allDone その日ぶんを全部片づけたか
 */
export function clawdCheerText(n: number, allDone: boolean): string {
  const pool = allDone ? CHEER_ALL : CHEER;
  return pool[idx(n, pool.length)];
}

/**
 * 画面を開いたときの挨拶。
 *
 * @param hour 0–23。呼び出し側が `new Date().getHours()` を渡す
 *   （ここで時刻を読まないのは、純ロジックを時計から切り離してテストできるようにするため）
 */
export function clawdHello(hour: number): string {
  const h = Number.isFinite(hour) ? Math.floor(hour) : 12;
  if (h >= 5 && h < 11) return HELLO_MORNING;
  if (h >= 11 && h < 17) return HELLO_DAY;
  if (h >= 17 && h < 23) return HELLO_EVENING;
  return HELLO_NIGHT;
}

/** Clawd を触ったときの返し */
export function clawdPoke(n: number): string {
  return POKE[idx(n, POKE.length)];
}

/** 話しかけへの返し。同じボタンを続けて押しても言葉が回る */
export function clawdReply(prompt: ClawdPrompt, n: number): string {
  return prompt.reply[idx(n, prompt.reply.length)];
}

/** 長さを決めて始めるときの一言 */
export function clawdWorkGo(min: number): string {
  return min + '分ね。じゃあ始めよう。となりで打ってるから';
}

/** 終わったときの一言。`n` で回す */
const WORK_DONE: readonly string[] = [
  '終わり！ よくやった',
  'おつかれさま。ちゃんと座りきったね',
  '時間ぶん、やりきった',
  'おわり。少し立って歩こう',
];

export function clawdWorkDone(min: number, n: number): string {
  return clawdWorkDoneDuration(min * 60, n);
}

/** 秒単位のOfficeタイマーでも、実際に座った長さをそのまま言う。 */
export function clawdWorkDoneDuration(totalSeconds: number, n: number): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const duration = minutes > 0
    ? `${minutes}分${rest > 0 ? `${rest}秒` : ''}`
    : `${rest}秒`;
  return WORK_DONE[idx(n, WORK_DONE.length)] + '（' + duration + '）';
}

/** 途中でやめたときの一言。**責めない**（やめられるのも力のうち） */
export function clawdWorkStop(): string {
  return 'ここまでにしよう。座った時間は消えないよ';
}
