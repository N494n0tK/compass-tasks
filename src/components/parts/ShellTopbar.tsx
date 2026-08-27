'use client';

/**
 * Compass — トップバー + 検索ポップオーバー（Phase 2B / TASK S0）
 *
 * 出典: HTML:922-965（テンプレート）、4130-4133（`todayHeader` / `viewTitle` / `viewSub`）、
 * 4196-4206（検索の開閉と結果）、4232（`donutPct`）、4247（`doneCount` / `totalCount`）、
 * 4155-4157（`hasOverdue` / `openRedist`）。spec §2.4 / §2.5 / C-100〜C-128。
 *
 * DOM 順は ランチャー → `.app-search` → `.app-view-title` → `.app-top-actions` → `.app-progress`。
 * 見た目の並びは CSS の `order`（0/2/1/3）が担当するので **DOM 順を変えないこと**（C-100）。
 *
 * ── 検索は「いま見ている画面のもの」をさがす ─────────────────────────
 * ノート / 問題抽出のタブにいるあいだだけ、この欄は**ノートの中身**をさがす
 * （`logic/noteSearch.ts`）。ノートの画面で「タスク名・教科」をさがしても、
 * 手元にある紙面と関係のない結果が返るだけだから。
 * どちらをさがしているかは入力欄の左のチップ（`.app-search-scope`）に出す。
 *
 * ── 動き（ux-refresh.md §10 / `app/motion.css` の語彙）────────────────
 * 足したのは「**変わったことを言う**」ぶんだけ。画面を移ったら見出しを書き直し、
 * 検索の面は入力欄の下辺から開き、ヒットは頭の 8 件だけ順に降ろす。
 * 一度きりの動きは class の付け替えではなく **key** で鳴らす ―― React が同じ DOM を
 * 使い回すあいだ、CSS の animation は二度と鳴らないから。
 */

import type { CSSProperties } from 'react';
import type { DateContext } from '../../lib/logic/dates';
import { searchNotes, type NoteHit } from '../../lib/logic/noteSearch';
import type { SubjColors } from '../../lib/logic/subjects';
import type { AppState, Plans } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { addToOrder, mutReview, mutSeg } from './ShellActions';
import {
  buildSearchResults,
  buildSubjChips,
  canonicalSubject,
  makeSearchMatcher,
  searchAddReviewToast,
  searchAddSegToast,
} from './ShellSearch';
import { Clawd, clawdForView, type ClawdKind } from './Clawd';
import { TITLES } from './ShellTheme';

/**
 * Clawd を触ったときの一言。画面ごとに住人が違うので、返す言葉も住人ぶん用意する。
 * 中身に意味は無い ―― 押したら何か返ってくる、という手応えだけが要る。
 */
const CLAWD_HELLO: Record<ClawdKind, string> = {
  type: 'Clawdも打ちはじめました',
  play: 'Clawdは玉で遊んでいる',
  cheer: 'Clawdが祝ってくれた',
};
import { todayTotals, type TodayItem } from './ShellTodayItems';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/** ノート内検索のヒットが「紙面のどこ」だったか（`logic/noteSearch.ts` の 3 種） */
const HIT_KIND_LABEL: Readonly<Record<NoteHit['kind'], string>> = {
  cue: 'キュー',
  body: '本文',
  card: '想起',
};

export interface ShellTopbarProps {
  state: AppState;
  plans: Plans;
  store: CompassStore;
  ctx: DateContext;
  subjColors: SubjColors;
  todayItems: readonly TodayItem[];
  /** `overdue.length`（HTML:2689）。ナビのバッジと同じ数え方 */
  overdueCount: number;
  onOpenAppSwitcher: () => void;
}

export function ShellTopbar({
  state,
  plans,
  store,
  ctx,
  subjColors,
  todayItems,
  overdueCount,
  onOpenAppSwitcher,
}: ShellTopbarProps) {
  const S = state;
  const T = ctx.today;
  const matcher = makeSearchMatcher(S);
  const { q } = matcher;
  const totals = todayTotals(todayItems);
  // ノートのタブだけは中に 2 つの面がある（読む面 / その授業の今日ぶんを解くドリル面）。
  // ドリルに入っているあいだは見出しもそれに合わせる
  const title: readonly [string, string] =
    S.view === 'notebook' && S.nbMode === 'drill'
      ? ['今日の復習', 'この授業の、今日ぶんの問題だけを解く']
      : TITLES[S.view];
  // `parseInt(T.slice(5,7),10)+'月'+parseInt(T.slice(8,10),10)+'日('+DAYS[0].dow+')'`（HTML:4130）
  const todayHeader =
    parseInt(T.slice(5, 7), 10) +
    '月' +
    parseInt(T.slice(8, 10), 10) +
    '日(' +
    ctx.days[0].dow +
    ')';

  // ノートの画面では、さがす相手がタスクではなくノートの中身になる
  const noteScope = S.view === 'notebook' || S.view === 'extract';
  const subjChips = S.searchOpen && !noteScope ? buildSubjChips(subjColors, q) : [];
  const searchResults =
    S.searchOpen && !noteScope ? buildSearchResults(S, plans, subjColors, ctx, matcher) : [];
  const noteHits: NoteHit[] = S.searchOpen && noteScope ? searchNotes(S.notes, q) : [];

  /** ヒットを 1 件選ぶ: そのノートを開き、語に蛍光ペンを敷いたまま検索を閉じる */
  const openHit = (hit: NoteHit) =>
    store.setState({
      view: 'notebook',
      nbSelNoteId: hit.noteId,
      nbMode: 'note',
      nbEdit: false,
      // 伏せたままだと敷いた蛍光ペンが読めない
      nbCheck: false,
      nbFind: q,
      searchOpen: false,
    });

  return (
    <div
      className="compass-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '12px 20px',
        borderBottom: '1px solid var(--line)',
        flex: 'none',
      }}
    >
      <button
        type="button"
        className="mobile-app-launcher mo-tap"
        onClick={onOpenAppSwitcher}
        aria-label="Compassアプリ一覧を開く"
        aria-haspopup="dialog"
      >
        <img src="/compass-icon.svg?v=20260728-ink" alt="" width="25" height="25" />
      </button>
      <div className={'app-search' + (noteScope ? ' app-search--note' : '')}>
        <svg
          className="app-search-icon"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2"></circle>
          <line
            x1="13.5"
            y1="13.5"
            x2="18"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          ></line>
        </svg>
        {/* いま何をさがしているかを、入力する前に言っておく。
            画面を移るとさがす相手そのものが変わるので、チップは黙って差し替えず
            key で入れ替わりを鳴らす（同じ場所で字だけ変わると、まず気づかれない） */}
        <span key={noteScope ? 'note' : 'task'} className="app-search-scope mo-swap">
          {noteScope ? 'ノート内' : 'タスク'}
        </span>
        <input
          id="app-search-input"
          className="app-search-input"
          value={S.query}
          onChange={(e) => store.setState({ query: e.target.value })}
          onFocus={() => store.setState({ searchOpen: true })}
          // Esc で閉じたあと、同じ欄をもう一度押しても開く（onFocus は焦点が
          // 既にここにあると鳴らない。閉じた欄に打ち込めてしまうのを防ぐ）
          onClick={() => store.setState({ searchOpen: true })}
          onKeyDown={(e) => {
            // Enter で先頭のヒットへ飛ぶ（一覧を触らずに引ける）
            if (e.key === 'Enter' && noteScope && noteHits.length) {
              e.preventDefault();
              openHit(noteHits[0]);
            }
          }}
          placeholder={noteScope ? 'ノートの中の語を検索…' : 'タスク名・教科で検索…'}
          aria-label={noteScope ? 'ノートの中の語で検索' : 'タスク名・教科で検索'}
        />
        {S.query.trim().length > 0 ? (
          <button
            className="app-search-clear mo-tap"
            onClick={() => store.setState({ query: '', searchOpen: true })}
            aria-label="検索語を消去"
          >
            ✕
          </button>
        ) : null}
        <span className="app-search-shortcut">⌘K</span>
        {S.searchOpen ? (
          // `mo-pop` は入力欄の下辺を起点に開く（motion.css）。どこから出てきた面なのかが
          // 分かると、閉じるために目を戻す先も分かる
          <div className="app-search-popover mo-pop">
            <div className="app-search-popover__head">
              <span className="app-search-popover__title">
                {noteScope ? 'ノート内検索' : '検索'}
              </span>
              <span className="app-search-popover__sub">
                {noteScope
                  ? 'キュー欄の重要語 → 本文 → 想起問題 の順'
                  : '入力と同時に絞り込みます'}
              </span>
              <button
                className="app-search-clear mo-tap"
                onClick={() => store.setState({ searchOpen: false, query: '' })}
                aria-label="検索を閉じる"
                style={{ marginLeft: 'auto' }}
              >
                ✕
              </button>
            </div>

            {/* ── ノートの画面: 紙面の中の語をさがす */}
            {noteScope ? (
              <>
                {q.length === 0 ? (
                  <div className="app-search-empty">
                    ノートに書いてある語を入れてください。
                    <br />
                    コーネル欄（左）の重要語から順にさがします
                  </div>
                ) : (
                  <div className="app-search-count">
                    {'ヒット ' + noteHits.length + '件 — 選ぶとその紙面を開いて語に色を敷きます'}
                  </div>
                )}
                <div className="app-search-results">
                  {noteHits.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      className={
                        'app-search-hit mo-in app-search-hit--' +
                        h.kind +
                        (h.color ? ' nb-key--' + h.color : '')
                      }
                      // 頭の 8 件だけ順に降ろす（--i の頭打ちは motion.css の決まり 2）。
                      // key が添字なので、打ち込むたびに鳴り直すことはない
                      // ―― 動くのは「面が開いた」ときと「候補が増えた」ときだけ
                      style={cssVars({ '--i': Math.min(i, 7) })}
                      onClick={() => openHit(h)}
                      // 細かい在りか（「本文 · 基本 3 型」など）はここに置く。
                      // 1 行に出すと、どの冊子かが省略記号に飲まれてしまう
                      title={h.where}
                    >
                      <span className="app-search-hit__kind">{HIT_KIND_LABEL[h.kind]}</span>
                      <span className="app-search-hit__main">
                        <span className="app-search-hit__term">{h.term}</span>
                        {h.snippet ? (
                          <span className="app-search-hit__snip">{h.snippet}</span>
                        ) : null}
                      </span>
                      <span className="app-search-hit__where">{h.unit || '(単元名なし)'}</span>
                    </button>
                  ))}
                  {q.length > 0 && noteHits.length === 0 ? (
                    <div className="app-search-empty">どのノートにも見つかりません</div>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* ── それ以外の画面: これまでどおり予定（タスク・復習）をさがす */}
            {noteScope ? null : (
              <>
                <div style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>教科で絞り込み</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {subjChips.map((s, i) => (
                    <span
                      key={s.name}
                      className="mo-in mo-lift mo-press"
                      onClick={() =>
                        store.setState({
                          query: canonicalSubject(store.getState().query) === s.name ? '' : s.name,
                          searchOpen: true,
                        })
                      }
                      style={cssVars({
                        '--i': Math.min(i, 7),
                        font: "700 10.5px var(--f-ui)",
                        color: s.c,
                        background: s.bg,
                        border: '1px solid ' + s.bd,
                        borderRadius: 'var(--rad-s)',
                        padding: '4px 10px',
                        cursor: 'pointer',
                      })}
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
                {q.length === 0 ? (
                  <div
                    style={{
                      padding: '18px 10px',
                      textAlign: 'center',
                      color: 'var(--tx3)',
                      fontSize: '11.5px',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    上のバーにタスク名または教科を入力してください
                  </div>
                ) : null}
                {q.length > 0 ? (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--tx3)',
                      borderTop: '1px solid var(--line)',
                      paddingTop: '10px',
                    }}
                  >
                    {'結果 ' + searchResults.length + '件 — 今日のToDoへ追加できます'}
                  </div>
                ) : null}
                <div className="app-search-results">
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      className="mo-in"
                      style={cssVars({
                        '--i': Math.min(i, 7),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '9px',
                        padding: '9px 10px',
                        background: 'var(--bg2)',
                        borderRadius: 'var(--rad-s)',
                      })}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: 'var(--rad-s)',
                          background: r.c,
                          flex: 'none',
                        }}
                      ></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            font: "500 12px var(--f-ui)",
                            color: 'var(--tx0)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {r.title}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>{r.where}</div>
                      </div>
                      {r.canAdd ? (
                        <button
                          className="mo-press"
                          onClick={() => {
                            if (r.kind === 'seg') {
                              mutSeg(store, r.id, (x) => ((x.day = T), x));
                              addToOrder(store, r.id);
                              store.showToast(searchAddSegToast(r.title));
                            } else if (r.kind === 'rev') {
                              mutReview(store, r.id, (x) => ((x.added = true), x));
                              addToOrder(store, r.id);
                              store.showToast(searchAddReviewToast(r.title));
                            }
                          }}
                          style={{
                            font: "700 10.5px var(--f-ui)",
                            color: 'var(--acc)',
                            background: 'var(--accBg)',
                            border: 'none',
                            borderRadius: 'var(--rad-s)',
                            padding: '4px 10px',
                            cursor: 'pointer',
                            flex: 'none',
                          }}
                        >
                          ＋ 今日へ
                        </button>
                      ) : null}
                      {r.tag ? (
                        <span style={{ fontSize: '10px', color: 'var(--tx3)', flex: 'none' }}>
                          {r.tag}
                        </span>
                      ) : null}
                    </div>
                  ))}
                  {q.length > 0 && searchResults.length === 0 ? (
                    <div
                      style={{
                        padding: '18px 10px',
                        textAlign: 'center',
                        color: 'var(--tx3)',
                        fontSize: '11.5px',
                      }}
                    >
                      一致するタスクがありません
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
      {/* 画面を移っても、ここは黙って字だけ差し替わる ―― それでは「移った」ことが
          言えていないので、key で丸ごと書き直させる。左端の差し色の縦罫（::before）も
          一緒に引き直されるので、紙が差し替わったことがトップバーの左端に出る。
          小見出しは半拍（--i:1 = 24ms）だけ遅らせて、見出し → 説明の順に読ませる */}
      <div className="app-view-title mo-title" key={title[0]}>
        <div className="app-view-title__name mo-swap">{title[0]}</div>
        <div className="app-view-title__sub mo-swap" style={cssVars({ '--i': 1 })}>
          {title[1]}
        </div>
      </div>
      <div
        className="app-top-actions"
        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        {/* Clawd くん。**画面ごとに違う 1 匹**が居る（`clawdForView`）ので、
            タブを移ると住人が替わる ―― 字の見出しだけでなく、ここでも移ったことが分かる。
            触ると 1 周ぶん動く。常設なので、触られるまでは 1 コマ目で静止したまま */}
        <Clawd
          key={S.view}
          kind={clawdForView(S.view)}
          size={26}
          onTap={() => store.showToast(CLAWD_HELLO[clawdForView(S.view)])}
        />
        {overdueCount > 0 ? (
          // 遅れが出た / 片づいた は、出たり消えたりすること自体が知らせ。
          // 何も無いところに黙って現れないよう、出るときだけ下から起こす
          <button
            className="app-alert-pill mo-in mo-press"
            onClick={() =>
              store.setState({
                view: 'tests',
                redistOpen: true,
                redistPlan: 'all',
                redistPickMode: false,
                redistMode: 'even',
              })
            }
          >
            {'⚠ 未完了 ' + overdueCount + '件 → 再配分'}
          </button>
        ) : null}
        <div className="app-day-meter" role="group" aria-label="今日の進捗">
          <span className="app-day-meter__date">{todayHeader}</span>
          <span className="app-day-meter__count">
            {/* 今日の消化数。1 つ終えるたびにここが増えるのに、字が入れ替わるだけでは
                気づかれない。key を数そのものにして、変わった回だけ短く弾ませる
                （分母は自分の手柄ではないので動かさない） */}
            <span key={totals.doneCount} className="mo-tick">
              {totals.doneCount}
            </span>
            <i>/</i>
            {totals.totalCount}
          </span>
        </div>
      </div>
      <div
        className="app-progress"
        role="progressbar"
        aria-label="今日の完了率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={totals.donutPct}
        style={cssVars({ '--done': totals.donutPct + '%' })}
      >
        <span></span>
      </div>
    </div>
  );
}
