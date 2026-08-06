'use client';

/**
 * Compass — 検索の判定と結果リスト（Phase 2B / TASK S0）
 *
 * 出典: HTML:2619-2630（`q` / `filtering` / `hit` / `subjectAliases` / `canonicalSubject` /
 * `hitSubject`）、3751-3785（`subjChips` / `searchResults`）。spec §2.5 / C-114〜C-127。
 *
 * `filtering` は Cockpit / Tests のリストも絞り込むので、**画面側もこのモジュールを使うこと**
 * （`hit` / `hitSubject` を各所で書き直すと表記揺れの扱いがずれる）。
 */

import { dayLabel, type DateContext } from '../../lib/logic/dates';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import type { AppState, Plans } from '../../lib/model/types';

/** 表記揺れの正規化表（HTML:2624） */
export const SUBJECT_ALIASES: Readonly<Record<string, string>> = {
  英語: '英コミ',
  英コ: '英コミ',
  歴総: '歴史',
  地総: '地理',
  化基: '化学',
  生基: '生物',
};

/** `canonicalSubject(name)`（HTML:2625） */
export function canonicalSubject(name: string | null | undefined): string {
  return SUBJECT_ALIASES[name ?? ''] || name || '';
}

/** `q` / `filtering` / `hit` / `hitSubject` をまとめたもの（HTML:2619-2630） */
export interface SearchMatcher {
  /** `(S.query || '').trim()` */
  q: string;
  /** `S.searchOpen && q.length > 0` — 裏の画面の絞り込みスイッチ */
  filtering: boolean;
  hit: (txt: string | null | undefined) => boolean;
  hitSubject: (name: string | null | undefined) => boolean;
}

export function makeSearchMatcher(state: Pick<AppState, 'query' | 'searchOpen'>): SearchMatcher {
  const q = (state.query || '').trim();
  const filtering = state.searchOpen && q.length > 0;
  const hit = (txt: string | null | undefined) =>
    (txt || '').toLowerCase().indexOf(q.toLowerCase()) >= 0;
  const hitSubject = (name: string | null | undefined) => {
    const raw = String(name || '').toLowerCase();
    const rawQ = q.toLowerCase();
    const canonical = canonicalSubject(name).toLowerCase();
    const canonicalQ = canonicalSubject(q).toLowerCase();
    return raw.indexOf(rawQ) >= 0 || canonical.indexOf(canonicalQ) >= 0;
  };
  return { q, filtering, hit, hitSubject };
}

/** 教科チップ 1 件（HTML:3758-3766） */
export interface SubjChip {
  name: string;
  c: string;
  bg: string;
  bd: string;
}

/** `subjChips`（HTML:3751-3766）。`Object.keys(SUBJ)` 順に代表名だけを 1 度ずつ */
export function buildSubjChips(subjColors: SubjColors, q: string): SubjChip[] {
  const chipSeen: Record<string, true> = {};
  const subjChipNames: string[] = [];
  Object.keys(subjColors).forEach((name) => {
    const canonical = canonicalSubject(name);
    if (!chipSeen[canonical]) {
      chipSeen[canonical] = true;
      subjChipNames.push(canonical);
    }
  });
  return subjChipNames.map((name) => {
    const sub = subjectColorFor(subjColors, name);
    const active = canonicalSubject(q) === name;
    return {
      name,
      c: active ? 'var(--onAcc)' : sub.c,
      bg: active ? sub.c : sub.bg,
      bd: sub.c,
    };
  });
}

/** 検索結果 1 件（HTML:3767-3785） */
export interface SearchResultRow {
  /** `segs` / `reviews` / `extras` のどれ由来か（`onAdd` の分岐に使う。表示には出ない） */
  kind: 'seg' | 'rev' | 'extra';
  id: string;
  title: string;
  where: string;
  c: string;
  canAdd: boolean;
  tag: string | false;
}

/**
 * `searchResults`（HTML:3767-3785）。**`q` が空なら空配列**。
 * 順番は segs → reviews → extras（各々 state 配列順）。
 */
export function buildSearchResults(
  state: AppState,
  plans: Plans,
  subjColors: SubjColors,
  ctx: DateContext,
  matcher: SearchMatcher
): SearchResultRow[] {
  const out: SearchResultRow[] = [];
  const { q, hit, hitSubject } = matcher;
  const T = ctx.today;
  if (!q) return out;

  state.segs.forEach((s) => {
    const pl = plans[s.plan];
    if (hit(s.title) || hit(pl.name) || hitSubject(pl.subj)) {
      out.push({
        kind: 'seg',
        id: s.id,
        title: s.title,
        where: pl.name + ' · ' + dayLabel(ctx, s.day),
        c: subjectColorFor(subjColors, pl.subj).c,
        canAdd: !s.done && s.day !== T,
        tag: s.done ? '✓済' : s.day === T ? '今日' : false,
      });
    }
  });
  state.reviews.forEach((r) => {
    if (hit(r.title) || hitSubject(r.subj)) {
      out.push({
        kind: 'rev',
        id: r.id,
        title: r.title,
        where: r.stage + 'の復習 · ' + dayLabel(ctx, r.due),
        c: subjectColorFor(subjColors, r.subj).c,
        // `due` が未来でも追加できる（C-125）
        canAdd: !r.added && !r.done,
        tag: r.added ? '追加済' : r.done ? '✓済' : false,
      });
    }
  });
  state.extras.forEach((x) => {
    if (hit(x.title) || hitSubject(x.subj)) {
      out.push({
        kind: 'extra',
        id: x.id,
        title: x.title,
        where: x.src,
        c: subjectColorFor(subjColors, x.subj).c,
        canAdd: false,
        tag: '今日',
      });
    }
  });
  return out;
}

/** 検索結果の「＋ 今日へ」トースト（HTML:3775 / 3781） */
export const searchAddSegToast = (title: string) => '「' + title + '」を今日に移動しました';
export const searchAddReviewToast = (title: string) =>
  '「' + title + '」を今日のToDoに追加しました';
