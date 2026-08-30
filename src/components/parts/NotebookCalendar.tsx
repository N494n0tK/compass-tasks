'use client';

/**
 * Compass — サイドバーの月カレンダー（docs/notebook/ux-refresh.md §4）
 *
 * `NotebookSidebar` の中にあったカレンダーを独立させたもの。
 * 月を送り、ノートのある日に点を打ち、下にその月のノートを日付順で並べる。
 *
 * 2026-08 の UX 刷新で「**日を指したらその日だけの一覧にする**」を足した。
 * それまでは日をクリックしてもただ 1 冊目が開くだけで、下の一覧は常に月ぜんぶ。
 * カレンダーで日を指したのに一覧が絞られないのは、日付を指した意味がない。
 *
 * 絞り込みは `nbDay`（`ISODate | null`）1 つで表す。`null` = 月ぜんぶ。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { dowOf, fmtMD, longDayLabel, monthLabel } from '../../lib/logic/dates';
import { timetablePeriodsFor } from '../../lib/logic/timetable';
import type { Note } from '../../lib/model/notes';
import { DOW_HEADS, MINI_BTN, SECTION_LABEL, daysInMonth, shiftMonth } from './NotebookShared';
import { NoteRow } from './NoteRow';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

export interface NotebookCalendarProps {
  /** 絞り込み後のノート（親から渡す） */
  notes: readonly Note[];
  today: string;
  onSelect: (n: Note) => void;
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
}

/** 矢印キー 1 回ぶんの移動量（左右 = 1 日、上下 = 1 週） */
const ARROW_STEP: Record<string, number | undefined> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export function NotebookCalendar({ notes, today, onSelect, onContextMenu }: NotebookCalendarProps) {
  const { state: S, plans } = useAppStore();
  // 教科色は行ごとに作らず、ここで 1 回だけ作って配る（`NoteRow` の props を見よ）
  const subjColors = useSubjColors(S, plans);
  const month = S.nbMonth || today.slice(0, 8) + '01';
  const offset = new Date(month + 'T00:00:00Z').getUTCDay();
  const dim = daysInMonth(month);
  const rows = Math.ceil((offset + dim) / 7);

  const byDate = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((n) => {
      const list = map.get(n.date);
      if (list) list.push(n);
      else map.set(n.date, [n]);
    });
    return map;
  }, [notes]);

  /**
   * 描画に使う「選んでいる日」。**今の月の中にある日しか信じない**。
   * 月を送るときに `nbDay` も一緒に落としている（`goMonth`）ので普段はここを通らないが、
   * 前の月の日が残ったままだと一覧が空で固まり「ノートが消えた」ように見える ――
   * この画面でいちばん困る事故なので、描画側にも保険を置く。
   */
  const day = S.nbDay && S.nbDay.slice(0, 7) === month.slice(0, 7) ? S.nbDay : null;

  const inMonth = notes.filter((n) => n.date.slice(0, 7) === month.slice(0, 7));
  const listed = day ? byDate.get(day) || [] : inMonth;

  /**
   * マス目のうち Tab の的にする 1 日（roving tabindex）。
   * 42 マスすべてを Tab で拾わせるとサイドバーを通り抜けるだけで 40 回打つことになるので、
   * 入口は 1 つにして、中は矢印キーで動かす。
   */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [rove, setRove] = useState<number | null>(null);
  const entry = day
    ? parseInt(day.slice(8, 10), 10)
    : today.slice(0, 7) === month.slice(0, 7)
      ? parseInt(today.slice(8, 10), 10)
      : 1;
  // 31 日から 2 月へ送るような場合に的が消えないよう、必ず月内へ丸める
  const tabDay = Math.min(dim, Math.max(1, rove ?? entry));

  /**
   * 月を送る。選んでいた日は必ず今の月の中にあるので、送った先では必ず月の外になる。
   * 送ったあとに直す（`useEffect`）のではなく、月と一緒に `nbDay` を落とす ――
   * 「月を送ったら月ぜんぶに戻る」を 1 回の更新で言い切るほうが、動く部分が少ない。
   */
  const goMonth = (n: number) => {
    setRove(null); // Tab の入口も、新しい月の既定（今日 / 1 日）へ戻す
    store.setState({ nbMonth: shiftMonth(month, n), nbDay: null });
  };

  const moveFocus = (e: React.KeyboardEvent, from: number) => {
    const step = ARROW_STEP[e.key];
    let next: number | null = null;
    if (step != null) next = from + step;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = dim;
    if (next == null) return;
    // 月をまたぐ移動はしない（月が変わると足元の一覧まで入れ替わって、
    // どこへ飛んだのか分からなくなる）。端で止める。
    e.preventDefault();
    next = Math.min(dim, Math.max(1, next));
    setRove(next);
    gridRef.current?.querySelector<HTMLButtonElement>('[data-day="' + next + '"]')?.focus();
  };

  /**
   * 日を選ぶ / 同じ日をもう一度で解除。
   *
   * **ノートが 0 冊の日もそのまま選べる**。カレンダーは日付を指す道具で、
   * 「この日は無い」も答えのうちだから（空状態と「月ぜんぶに戻す」ですぐ戻れる）。
   * 空の日を不活性にすると `disabled` でフォーカスも当てられなくなり、
   * 矢印キーの移動が穴だらけになってしまう。
   */
  const pickDay = (iso: string, dayNo: number, hits: readonly Note[]) => {
    // 押した日を Tab の入口にもする。矢印キーで動かした古い位置が残っていると、
    // 次に Tab で入ったとき見当違いのマス目に着地する
    setRove(dayNo);
    if (day === iso) {
      store.setState({ nbDay: null });
      return;
    }
    store.setState({ nbDay: iso });
    // 1 冊しかない日は「選ぶ＝開く」で迷いがない（もとの挙動の良いところ）。
    // 2 冊以上あるのに 1 冊目を勝手に開くと、選びたかった 2 冊目が本文の裏に隠れる。
    if (hits.length === 1) onSelect(hits[0]);
  };

  /**
   * 絞り込みを外す。**このボタン自身が消える**ので、フォーカスの行き先も一緒に決める
   * （放っておくと body に落ちて、次の Tab がアプリの先頭からやり直しになる）。
   * 戻し先はいま外した日のマス目 ―― 目で追っていた場所がそのまま残る。
   */
  const clearDay = () => {
    const back = day ? parseInt(day.slice(8, 10), 10) : null;
    store.setState({ nbDay: null });
    if (back == null) return;
    setRove(back);
    gridRef.current?.querySelector<HTMLButtonElement>('[data-day="' + back + '"]')?.focus();
  };

  /**
   * 一覧の入れ替わりに向きを付ける（絞る = 右から / 戻す = 左から）。
   * **月送りでは流さない** ―― 見出しの月名が変わるので何が起きたかは既に見えているし、
   * ここで動かすと「右から入る = 絞った」という向きの意味が薄まる。
   * 直前の値はコミット後に控える（描画中に ref を書き換えない）。
   */
  const prevSwap = useRef({ day, month });
  const swap =
    prevSwap.current.month !== month || prevSwap.current.day === day ? '' : day ? ' in' : ' back';
  useEffect(() => {
    prevSwap.current = { day, month };
  }, [day, month]);

  return (
    <div style={{ flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
        <button
          className="hv-acc-outline"
          onClick={() => goMonth(-1)}
          style={MINI_BTN}
          aria-label="前の月"
        >
          ‹
        </button>
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            font: '700 13px var(--f-num)',
            color: 'var(--tx1)',
          }}
        >
          {month.slice(0, 4) + '年' + monthLabel(month)}
        </div>
        <button
          className="hv-acc-outline"
          onClick={() => goMonth(1)}
          style={MINI_BTN}
          aria-label="次の月"
        >
          ›
        </button>
      </div>
      <div
        ref={gridRef}
        role="group"
        aria-label={month.slice(0, 4) + '年' + monthLabel(month) + 'のカレンダー'}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px' }}
      >
        {/* 曜日の見出しは飾り。日付ボタンの読み上げに曜日が入っているので二重に読ませない */}
        {DOW_HEADS.map((d) => (
          <div
            key={d}
            aria-hidden="true"
            style={{
              textAlign: 'center',
              font: '400 9.5px var(--f-ui)',
              color: 'var(--tx3)',
              padding: '2px 0',
            }}
          >
            {d}
          </div>
        ))}
        {Array.from({ length: rows * 7 }, (_, i) => {
          const dayNo = i - offset + 1;
          if (dayNo < 1 || dayNo > dim) return <div key={i} aria-hidden="true" />;
          const iso = month.slice(0, 8) + String(dayNo).padStart(2, '0');
          const hits = byDate.get(iso) || [];
          const picked = day === iso;
          // 「開いているノートがある日」は**選んだ日とは別の印**（弱い地の色）にする。
          // 面の塗りつぶしは、いま自分が指した日ひとつのために取っておきたい。
          const opened = !picked && hits.some((n) => n.id === S.nbSelNoteId);
          return (
            <button
              key={i}
              data-day={dayNo}
              className={
                'nbcal-d' +
                (hits.length ? ' has' : '') +
                (iso === today ? ' today' : '') +
                (opened ? ' open' : '') +
                (picked ? ' pick' : '')
              }
              onClick={() => pickDay(iso, dayNo, hits)}
              onKeyDown={(e) => moveFocus(e, dayNo)}
              tabIndex={dayNo === tabDay ? 0 : -1}
              aria-pressed={picked}
              aria-label={
                longDayLabel(iso) + ' ' + (hits.length ? 'ノート' + hits.length + '件' : 'ノートなし')
              }
              title={hits.length ? hits.map((n) => n.unit).join(' / ') : undefined}
            >
              {dayNo}
              {hits.length ? (
                <span className="nbcal-dots" aria-hidden="true">
                  {/* 何冊あるかも点の数で見えるように（4 冊以上は 3 つ止まり） */}
                  {Array.from({ length: Math.min(hits.length, 3) }, (_, k) => (
                    <span key={k} className="nbcal-dot" />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* v2 と同じく下にノートを並べるが、日を指しているあいだはその日だけにする */}
      <div className="nbcal-head">
        <div style={{ ...SECTION_LABEL, margin: 0 }}>
          {(day ? fmtMD(day) + '(' + dowOf(day) + ')' : monthLabel(month)) +
            'のノート · ' +
            listed.length +
            '件'}
        </div>
        {/* 絞り込みの外し方は、マス目をもう一度押す以外にも見えるところに置く */}
        {day ? (
          <button className="hv-acc-outline nbcal-clear" onClick={clearDay}>
            × 月ぜんぶに戻す
          </button>
        ) : null}
      </div>
      {listed.length ? (
        // key を替えて作り直させ、絞る/戻すのたびに動きを流し直す
        // （どちらへ切り替わったのかを、入ってくる向きで見せる）
        <div key={day || month} className={'nbcal-list' + swap}>
          {listed.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              colors={subjColors}
              on={n.id === S.nbSelNoteId}
              onClick={onSelect}
              onContextMenu={onContextMenu}
              showSubject
              periods={timetablePeriodsFor(n.date, n.subject, S.dayOverrides)}
            />
          ))}
        </div>
      ) : (
        <div key={'e:' + (day || month)} className={'nbcal-empty' + swap}>
          {day ? 'この日のノートはありません。' : 'この月のノートはまだありません。'}
        </div>
      )}
    </div>
  );
}
