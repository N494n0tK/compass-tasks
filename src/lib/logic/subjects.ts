/**
 * Compass — 教科カラー（レガシー `Compass App.dc.html` の `SUBJ` / `_palette` / `subjOf` の 1:1 移植）
 *
 * 出典: HTML:2013-2035（`sj()` と `SUBJ` の 21 件）、2052（`_palette`）、2053-2059（`subjOf`）、
 * 2060（`TIMETABLE` の先行登録）、2609-2618（`renderVals` 冒頭 `knownSubjects` の先行登録）、
 * 3402-3413（円グラフのループ内で `studyLog` 限定教科が初めて採番される）。
 * spec §3.2「教科カラー」/ §8.1 要点4 / Q35、architecture §6。
 *
 * ## レガシーとの違い（architecture §6 で承認済み）
 * レガシーの `subjOf(name)` は**レンダー中に `this.SUBJ` を変異させる副作用**を持つ
 * （未知教科ならパレットから採番して登録し、その色を返す）。React の StrictMode 二重レンダーで
 * 採番順が変わりうるため、ここでは**純関数**に切り出す:
 *
 * - `assignSubjectColors(existing, names)` … `names` の出現順に未登録教科だけへ採番して
 *   **新規割当のみ**を返す（`existing` は変更しない）。
 * - 呼び出し側は「データ変更時に 1 回だけ」`withSubjectColors()` でマージした表を作り、
 *   描画中は表を引くだけにする。
 *
 * 採番結果をレガシーと一致させる鍵は **`names` の順序**。`subjectAppearanceOrder()` が
 * レガシーと同じ順序を組み立てる（下記「出現順」を参照）。
 *
 * 純ロジック。React / firebase を import しない。
 */

import type { Extra, Plans, Review, Score, Seg } from '../model/types';

// ─────────────────────────────────────────────────────────────
// 色トークン
// ─────────────────────────────────────────────────────────────

/** `subjOf()` が返す 1 教科ぶんの色（HTML:2013 の `sj()` / 2056 のパレット割当） */
export interface SubjColor {
  /** 文字・アクセント色 */
  c: string;
  /** 背景色（チップ等） */
  bg: string;
}

/** 教科名 → 色。**キーの挿入順が `Object.keys(SUBJ)` の順**（復習の教科チップ等が依存, spec §6.4） */
export type SubjColors = Record<string, SubjColor>;

/**
 * `sj(token, mix)`（HTML:2013）。
 * 文字列は**空白まで 1:1**（`color-mix(in srgb,var(--sj-terra) 16%,var(--bg2))`）。
 */
function sj(token: string, mix: number): SubjColor {
  return {
    c: 'var(--sj-' + token + ')',
    bg: 'color-mix(in srgb,var(--sj-' + token + ') ' + mix + '%,var(--bg2))',
  };
}

/**
 * `this.SUBJ` の初期 21 件（HTML:2014-2035）。**宣言順を変えてはいけない**
 * （`Object.keys().length % 6` のパレット巡回と `Object.keys(SUBJ)` の走査順に効く）。
 */
export const BUILTIN_SUBJ_COLORS: Readonly<SubjColors> = {
  古文: sj('terra', 16),
  現国: sj('rose', 16),
  言語: sj('rose', 16),
  数学: sj('indigo', 18),
  歴史: sj('ochre', 16),
  地理: sj('forest', 20),
  化学: sj('teal', 16),
  生物: sj('olive', 16),
  英コミ: sj('amber', 17),
  論表: sj('plum', 18),
  LHR: sj('graphite', 18),
  物理: sj('steel', 17),
  体育: sj('graphite', 16),
  保健: sj('graphite', 16),
  芸術: sj('plum', 16),
  英語: sj('amber', 17),
  英コ: sj('amber', 17),
  歴総: sj('ochre', 16),
  地総: sj('forest', 20),
  化基: sj('teal', 16),
  生基: sj('olive', 16),
};

/**
 * `this._palette`（HTML:2052）。自由入力教科へ巡回で割り当てる 6 色。
 * 順序は vio → blue → acc → pink → grn → org。
 */
export const SUBJ_PALETTE: readonly Readonly<SubjColor>[] = [
  { c: 'var(--vio)', bg: 'var(--vioBg)' },
  { c: 'var(--blue)', bg: 'var(--blueBg)' },
  { c: 'var(--acc)', bg: 'var(--accBg)' },
  { c: 'var(--pink)', bg: 'var(--pinkBg)' },
  { c: 'var(--grn)', bg: 'var(--grnBg)' },
  { c: 'var(--org)', bg: 'var(--orgBg)' },
];

/**
 * 採番の起点になる表を作る（レガシー constructor 終了時点の `this.SUBJ` と同一）。
 *
 * HTML:2060 は `TIMETABLE` の全教科を `subjOf` に通すが、そこに出る教科
 * （言語/英コ/体育/数学/歴総/論表/化基/芸術/生基/地総/現国/保健/LHR）は**すべて
 * 初期 21 件に含まれる**ため 1 件も追加されない。したがって最初の自由入力教科は
 * `21 % 6 = 3` → パレット 4 番目（pink）から始まる。
 */
export function createSubjectColors(): SubjColors {
  return { ...BUILTIN_SUBJ_COLORS };
}

// ─────────────────────────────────────────────────────────────
// 採番（`subjOf` の純関数版）
// ─────────────────────────────────────────────────────────────

/**
 * `subjOf` の採番規則（HTML:2053-2059）を副作用なしで適用する。
 *
 * ```js
 * const p = this._palette[Object.keys(this.SUBJ).length % this._palette.length];
 * this.SUBJ[name] = { c: p[0], bg: p[1] };
 * ```
 *
 * - **既に `existing` にある教科は再割当されない**（＝色が変わらない）。
 * - 分母（`% 6`）は「登録済み教科の総数」で、**1 件採番するたびに +1 される**。
 * - `names` 内の重複は最初の 1 回だけ採番される（2 回目以降は登録済みになるため）。
 * - `''` のような falsy な名前も**除外しない**（レガシー `subjOf('')` は `SUBJ['']` を
 *   本当に作る）。呼び出し側で除外したい場合は `subjectAppearanceOrder()` を使う
 *   ——そちらはレガシー `knownSubjects` と同じ truthy ガードを持つ。
 *
 * @param existing 現在の教科色表（変更しない）
 * @param names    **レガシーと同じ出現順**に並べた教科名（`subjectAppearanceOrder()` 参照）
 * @returns 新規割当だけを持つ表（1 件も無ければ空オブジェクト）
 */
export function assignSubjectColors(
  existing: Readonly<SubjColors>,
  names: readonly string[]
): SubjColors {
  const added: SubjColors = {};
  let count = Object.keys(existing).length;
  for (const name of names) {
    if (existing[name] || added[name]) continue;
    const p = SUBJ_PALETTE[count % SUBJ_PALETTE.length];
    added[name] = { c: p.c, bg: p.bg };
    count++;
  }
  return added;
}

/**
 * `assignSubjectColors` の結果を `existing` にマージした新しい表を返す。
 * キー順は「既存の順 → 新規の採番順」でレガシー `this.SUBJ` の `Object.keys` 順と一致する。
 */
export function withSubjectColors(
  existing: Readonly<SubjColors>,
  names: readonly string[]
): SubjColors {
  const added = assignSubjectColors(existing, names);
  return Object.keys(added).length === 0 ? { ...existing } : { ...existing, ...added };
}

/**
 * 1 教科ぶんの色を引く。レガシー `subjOf(name)` の**戻り値**と同一だが表を変異させない。
 * 未登録なら「今この場で採番したらこうなる」色を返す（表には入らない）。
 *
 * 描画時は原則として採番済みの表を引くだけにする（architecture §6）。この関数は
 * 取りこぼし（`studyLog` 限定教科など）に対する防御用。
 */
export function subjectColorFor(existing: Readonly<SubjColors>, name: string): SubjColor {
  const hit = existing[name];
  if (hit) return hit;
  const p = SUBJ_PALETTE[Object.keys(existing).length % SUBJ_PALETTE.length];
  return { c: p.c, bg: p.bg };
}

// ─────────────────────────────────────────────────────────────
// レガシーの「出現順」
// ─────────────────────────────────────────────────────────────

/**
 * `subjectAppearanceOrder()` の入力。レガシー `renderVals` 冒頭の `knownSubjects`
 * （HTML:2610-2618）と、円グラフのループ（3402-3413）に対応する。
 */
export interface SubjectAppearanceInput {
  /** `this.PLANS`。走査順は `Object.keys(PLANS)`（＝挿入順）。`planOrder` ではない */
  plans: Plans;
  /** `state.segs`。**`Seg` は `subj` を持たない**ので実質 0 件（レガシーの空振りをそのまま再現） */
  segs: readonly Seg[];
  extras: readonly Extra[];
  reviews: readonly Review[];
  scores: readonly Score[];
  /** `state.addSubj`（Add 画面の入力中の教科） */
  addSubj?: string;
  /** `state.scoreSubj`（データ画面のテスト記録フォーム） */
  scoreSubj?: string;
  /**
   * `studyLog` にしか存在しない教科の採番順（spec Q35）。
   * レガシーでは円グラフのループが `Object.keys(pieTotals).sort(分数の降順)` で回るため、
   * **全期間の円グラフの並び順**がそのまま採番順になる（`dataRange` の初期値は `'all'` なので
   * 初回レンダーは必ず全期間）。`aggregate.ts` の `allTimeSubjectOrder(entries)` を渡す。
   */
  studySubjects?: readonly string[];
}

/**
 * レガシーが未知教科を採番する**正確な順序**を組み立てる（spec Q35 の回答）。
 *
 * 1. `PLANS[*].subj`（`Object.keys(PLANS)` 順）
 * 2. `state.segs` → `state.extras` → `state.reviews` → `state.scores` の各配列順
 *    （HTML:2612 の `['segs','extras','reviews','scores']` というキー順そのまま。
 *    `segs` は `subj` フィールドを持たないので何も足さない）
 * 3. `state.addSubj`
 * 4. `state.scoreSubj`
 *    —— ここまでが `renderVals` 冒頭の先行登録（HTML:2610-2618）。**`studyLog` は対象外**。
 * 5. `studyLog` 限定の教科（＝上のどれにも出ない教科）は円グラフのループで初めて採番される。
 *    その順序は**全期間 `pieTotals` の分数降順**（同値は `studyEntries` の出現順 =
 *    studyLog → 完了 seg → 完了 extra）。`studySubjects` に渡す。
 *
 * 各段の truthy ガード（`if (pl && pl.subj)` / `if (row && row.subj)` / `if (S.addSubj)`）も
 * レガシーどおり。重複は最初の出現だけ残す（`subjOf` が 2 回目以降を無視するのと同値）。
 */
export function subjectAppearanceOrder(input: SubjectAppearanceInput): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  const push = (name: string | undefined | null): void => {
    if (!name) return;
    if (seen[name]) return;
    seen[name] = true;
    out.push(name);
  };

  for (const id of Object.keys(input.plans)) {
    const pl = input.plans[id];
    if (pl && pl.subj) push(pl.subj);
  }
  // レガシーは `['segs','extras','reviews','scores'].forEach(...)` で 4 配列を続けて走査する。
  // `Seg` だけ `subj` を持たないので、`'subj' in row` が false になり何も足さない（＝空振り）。
  for (const row of [...input.segs, ...input.extras, ...input.reviews, ...input.scores]) {
    if (row && 'subj' in row) push(row.subj);
  }
  push(input.addSubj);
  push(input.scoreSubj);
  for (const name of input.studySubjects ?? []) push(name);

  return out;
}

/**
 * `subjOrdered` / `addSubjOptions`（HTML:3538-3541 / C-435）—
 * 最近使った教科（`recentSubjs` のうち `SUBJ` に存在するもの）を先頭に、
 * 残りを `SUBJ` のキー挿入順で後ろへ。Add 画面の教科チップ・datalist と
 * データ画面の教科 datalist が同じ並びを使う。
 *
 * @param subjNames `Object.keys(SUBJ)` 相当（`useSubjColors()` の表のキー順）
 */
export function orderedSubjectNames(
  subjNames: readonly string[],
  recentSubjs: readonly string[],
): string[] {
  const recent = recentSubjs.filter((n) => subjNames.indexOf(n) >= 0);
  return recent.concat(subjNames.filter((n) => recent.indexOf(n) < 0));
}
