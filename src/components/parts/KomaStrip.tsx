'use client';

/**
 * Compass — 今日のコマ帯（2026-08 デザイン刷新の署名要素）
 *
 * Compass の前提は「時間割をデータ源にして入力の手間をなくす」こと。その時間割を
 * コックピットの一番上にそのまま置き、1 日の骨格として見せる。
 *
 *  - 平日は**その日**の 7 コマ。土日は**次の登校日**（= 予習が積まれる日、
 *    `logic/prepAutogen.nextSchoolDay`）を出す。だから週末に開いても
 *    「何に向けて予習しているのか」が最初に目に入る。
 *  - 各コマの下の目盛りは、そのコマから生まれた今日のタスク（`timetablePeriod` /
 *    `timetableDate` で厳密に対応づく）。塗り潰しが完了ぶん。
 *  - まだ残っているコマだけが蛍光オレンジでベタ塗りになる。
 *    面をベタで塗るのは「いま」だけ、というのが配色の決めごと（globals.css [C-2]）。
 *  - コマを押すと、その教科で検索が開く（既存の検索の絞り込みをそのまま使う）。
 *
 * 表示だけのコンポーネント。状態は検索クエリしか触らない。
 */

import { dowOf, fmtMD, isWeekend } from '../../lib/logic/dates';
import { nextSchoolDay } from '../../lib/logic/prepAutogen';
import { EMPTY_SLOTS, TIMETABLE } from '../../lib/logic/timetable';
import type { AppState, ISODate } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import type { TodayItem } from './ShellTodayItems';

/** 目盛りの上限。これを超えたぶんは描かない（帯の高さを一定に保つため） */
const MAX_TALLY = 6;

export interface KomaStripProps {
  state: AppState;
  store: CompassStore;
  today: ISODate;
  todayItems: readonly TodayItem[];
}

export function KomaStrip({ state, store, today, todayItems }: KomaStripProps) {
  // 土日は次の登校日を出す。予習が積まれるのと同じ日（spec §5 / N-041〜N-043）
  const isAhead = isWeekend(today);
  const target = isAhead ? nextSchoolDay(today) : today;
  const dow = dowOf(target);
  const slots = TIMETABLE[dow] || EMPTY_SLOTS;
  const overrides = state.dayOverrides?.[target] || {};

  const komas = slots.map((base, i) => {
    const period = i + 1;
    const ov = overrides[String(period)] || {};
    const subj = (ov.subj || '').trim() || base || null;
    const held = ov.held !== false;
    const items = todayItems.filter(
      (it) => it.timetableDate === target && it.timetablePeriod === period,
    );
    const doneCount = items.filter((it) => it.done).length;
    return {
      period,
      subj,
      held,
      total: items.length,
      doneCount,
      /** まだ残っている = いま。ここだけが面で塗られる */
      pending: held && items.some((it) => !it.done),
    };
  });

  const pendingKomas = komas.filter((k) => k.pending).length;
  const classCount = komas.filter((k) => k.subj && k.held).length;
  const note = isAhead
    ? '次の登校日 · ' + classCount + 'コマ'
    : pendingKomas > 0
      ? '残り ' + pendingKomas + 'コマぶん'
      : classCount > 0
        ? classCount + 'コマ · 残りなし'
        : '授業なし';

  return (
    <div className="koma-strip" aria-label={fmtMD(target) + '(' + dow + ')の時間割'}>
      <div className="koma-strip__axis">
        <div className="koma-strip__dow">
          {fmtMD(target)}
          <span>{dow}</span>
        </div>
        <div className="koma-strip__note">{note}</div>
      </div>
      {komas.map((k) => (
        <button
          key={k.period}
          type="button"
          className={
            'koma' +
            (k.subj ? '' : ' koma--empty') +
            (k.subj && !k.held ? ' koma--off' : '') +
            (k.pending ? ' koma--now' : '')
          }
          disabled={!k.subj}
          onClick={() => store.setState({ query: k.subj || '', searchOpen: true })}
          title={
            k.subj
              ? k.period + '限 ' + k.subj + (k.held ? '' : '（休講）') + ' — この教科で検索'
              : k.period + '限 なし'
          }
        >
          <span className="koma__no">{k.period}</span>
          <span className="koma__subj">{k.subj || '—'}</span>
          <span className="koma__tally" aria-hidden="true">
            {Array.from({ length: Math.min(k.total, MAX_TALLY) }, (_, n) => (
              <i key={n} className={n < k.doneCount ? 'is-done' : ''} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
