'use client';

/**
 * Compass — ノート 1 冊の表示・編集（docs/notebook/spec.md §8）
 *
 * 移植元: `CompassNotebook/チャートノート v3.dc.html` のノートビュー
 * （想起 / 解説 / 演習 / 疑問・連絡の 4 セクション、開閉アニメーション、編集モード）。
 *
 * レガシーからの主な変更:
 *  - 解説ブロックが想起問題を指すキーが `qi`（配列インデックス）→ `cardId`（安定 ID）。
 *    想起問題を消してもほかのブロックの対応がズレない。
 *  - 各カードに**復習カードの状態**（次回の日付・段階・「今日へ」ボタン）を出す。
 *    これがノートと Compass の復習エンジンをつなぐ唯一の可視面。
 *  - 保存は `commitNote`（ノート保存 + 復習の生成・同期・カスケードを 1 か所で）。
 */

import type { CSSProperties } from 'react';
import { fmtD, longDayLabel } from '../../lib/logic/dates';
import { noteSeriesId } from '../../lib/logic/noteCards';
import { canAddToToday, isAddedToToday } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import { NOTE_CARD_MAX, NOTE_SUBJECTS, type Note, type NoteBlock, type NoteCard } from '../../lib/model/notes';
import type { Review } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { commitNote, removeNote } from './NotebookPersistence';
import { addToOrder, mutReview } from './ShellActions';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/** 小見出しの脇に添える細字（「方針」「解答」など）。鉛筆の走り書きの調子で */
const FIELD_LABEL: CSSProperties = {
  font: "600 11px var(--f-hand)",
  color: 'var(--tx3)',
  letterSpacing: '.1em',
  marginBottom: '2px',
};

const INPUT: CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  padding: '8px 10px',
  color: 'var(--tx1)',
  font: "400 13px var(--f-ui)",
  lineHeight: 1.7,
  outline: 'none',
  resize: 'vertical',
};

const MINI_BTN: CSSProperties = {
  padding: '4px 9px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: "500 11px var(--f-ui)",
  cursor: 'pointer',
};

/** 開閉のアニメーション（v3 の `wrapSt`。grid-template-rows で高さを補間する） */
function wrapStyle(open: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    transition: 'grid-template-rows .45s cubic-bezier(.22,1,.36,1)',
  };
}

const WRAP_INNER: CSSProperties = { overflow: 'hidden', minHeight: 0 };

export interface NoteViewProps {
  note: Note;
}

export function NoteView({ note }: NoteViewProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;
  const T = ctx.today;
  const edit = S.nbEdit;
  const subjColor = subjectColorFor(subjColors, note.subject);

  /** ノートを書き換えて保存する（復習の生成・同期も `commitNote` が面倒を見る） */
  const patch = (fn: (draft: Note) => void, removedCardIds?: string[]) => {
    const draft: Note = JSON.parse(JSON.stringify(note));
    fn(draft);
    draft.updatedAt = T;
    commitNote(store, draft, T, { removedCardIds, debounce: !removedCardIds });
  };

  const isOpen = (key: string) => !!S.nbRevealed[key] || edit;
  const toggle = (key: string) =>
    store.setState((s) => ({ nbRevealed: { ...s.nbRevealed, [key]: !s.nbRevealed[key] } }));

  /** 「復習」ボタン: このノートの解答をすべて閉じる（v3 の `v.review`） */
  const closeAll = () => {
    store.setState((s) => {
      const next = { ...s.nbRevealed };
      note.cards.forEach((c) => delete next['r:' + note.id + ':' + c.cardId]);
      delete next['e:' + note.id];
      return { nbRevealed: next, nbEdit: false };
    });
  };

  const del = () => {
    if (!window.confirm('このノートと、未完了の復習カードを削除しますか？')) return;
    const removed = removeNote(store, note.id);
    store.showToast(
      '「' + note.unit + '」を削除しました' + (removed ? '(復習カード' + removed + '件も削除)' : ''),
    );
  };

  const overwrite = () =>
    store.setState({ nbImportOpen: true, nbImportTarget: note.id, nbImportText: '' });

  // ── 各カードの復習状態
  const reviewOf = (cardId: string): { pending: Review | null; done: boolean } => {
    const sid = noteSeriesId(note.id, cardId);
    let pending: Review | null = null;
    let done = false;
    S.reviews.forEach((r) => {
      if ((r.seriesId || r.id) !== sid) return;
      if (r.done) done = true;
      else if (!pending || r.due < pending.due) pending = r;
    });
    return { pending, done };
  };

  const addToToday = (r: Review) => {
    mutReview(store, r.id, (x) => ((x.added = true), x));
    addToOrder(store, r.id);
    store.showToast('「' + r.title + '」を今日のToDoに追加しました');
  };

  return (
    <article className="nb-sheet" style={{ animation: 'fadeUp .22s ease' }}>
      <div className="nb-sheet__holes" aria-hidden="true" />
      <div className="nb-sheet__body">
        {/* ── ヘッダ */}
        {/* ページ頭の日付欄。ノートの一番上に赤で引く 1 本と同じ */}
        <header
          style={{
            borderBottom: '2px solid var(--nb-margin)',
            paddingBottom: '12px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}
          >
            {edit ? (
              <input
                className="fc-acc"
                type="date"
                value={note.date}
                onChange={(e) => patch((d) => void (d.date = e.target.value))}
                style={{ ...INPUT, width: 'auto', font: "500 11.5px var(--f-num)" }}
              />
            ) : (
              <span style={{ font: "400 13px var(--f-hand)", color: 'var(--tx2)' }}>
                {note.date ? note.date.slice(0, 4) + '年' + longDayLabel(note.date) : '日付なし'}
              </span>
            )}
            <span
              style={{
                font: "700 10px var(--f-ui)",
                color: subjColor.c,
                background: subjColor.bg,
                borderRadius: 'var(--rad-s)',
                padding: '2px 9px',
              }}
            >
              {note.subject}
            </span>
            <span style={{ flex: 1 }} />
            <button className="hv-acc-outline" onClick={closeAll} style={MINI_BTN}>
              復習
            </button>
            <button
              className="hv-acc-outline"
              onClick={() => store.setState({ nbEdit: !edit })}
              style={{
                ...MINI_BTN,
                ...(edit ? { borderColor: 'var(--view)', color: 'var(--view)' } : null),
              }}
            >
              {edit ? '✓ 完了' : '編集'}
            </button>
            <button className="hv-acc-outline" onClick={overwrite} style={MINI_BTN}>
              JSONで上書き
            </button>
            <button className="hv-pink-text" onClick={del} style={MINI_BTN}>
              削除
            </button>
          </div>
          {edit ? (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', margin: '10px 0' }}>
              {NOTE_SUBJECTS.map((s) => {
                const on = note.subject === s;
                return (
                  <span
                    key={s}
                    onClick={() => patch((d) => void (d.subject = s))}
                    style={{
                      font: "600 11px var(--f-ui)",
                      color: on ? 'var(--onAcc)' : 'var(--tx2)',
                      background: on ? 'var(--view)' : 'var(--bg2)',
                      border: '1px solid ' + (on ? 'var(--view)' : 'var(--line2)'),
                      borderRadius: 'var(--rad-s)',
                      padding: '4px 11px',
                      cursor: 'pointer',
                    }}
                  >
                    {s}
                  </span>
                );
              })}
            </div>
          ) : null}
          {edit ? (
            <input
              className="fc-acc-glow"
              value={note.unit}
              onChange={(e) => patch((d) => void (d.unit = e.target.value))}
              placeholder="単元名"
              style={{ ...INPUT, marginTop: '8px', font: "600 20px var(--f-hand)" }}
            />
          ) : (
            <h1 style={{ margin: '10px 0 0', font: "600 26px var(--f-hand)", color: 'var(--tx0)' }}>
              <span className="nb-marker">{note.unit || '(単元名なし)'}</span>
            </h1>
          )}
        </header>

        {/* ── 想起。枠で囲わず、問番号を左の余白にぶら下げる（ノートの書き方そのまま） */}
        <section style={{ marginBottom: '26px' }}>
          <div className="nb-label">想起</div>
          <div style={{ display: 'grid', gap: '18px' }}>
            {note.cards.map((card, i) => {
              const key = 'r:' + note.id + ':' + card.cardId;
              const open = isOpen(key);
              const { pending, done } = reviewOf(card.cardId);
              return (
                <div key={card.cardId}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="nb-no" aria-hidden="true">
                        {'問' + (i + 1)}
                      </span>
                      {edit ? (
                        <textarea
                          className="fc-acc"
                          value={card.q}
                          onChange={(e) =>
                            patch((d) => void (d.cards[i].q = e.target.value))
                          }
                          placeholder="問題文(数式は $...$ で LaTeX)"
                          style={{ ...INPUT, minHeight: '52px' }}
                        />
                      ) : (
                        <NoteMath className="nb-write" src={card.q} />
                      )}
                    </div>
                    {edit ? (
                      <button
                        className="hv-pink-text"
                        onClick={() => {
                          if (note.cards.length <= 1) {
                            store.showToast('想起問題は1問以上必要です');
                            return;
                          }
                          if (!window.confirm('この想起問題と、その復習カードを削除しますか？'))
                            return;
                          patch((d) => {
                            d.cards.splice(i, 1);
                            d.blocks = d.blocks.map((b) =>
                              b.t === 'ex' && b.cardId === card.cardId ? { ...b, cardId: null } : b,
                            );
                          }, [card.cardId]);
                        }}
                        style={MINI_BTN}
                      >
                        削除
                      </button>
                    ) : null}
                  </div>

                  {/* 復習カードの状態 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '9px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      onClick={() => toggle(key)}
                      style={{
                        padding: 0,
                        border: 0,
                        background: 'none',
                        font: "600 12px var(--f-hand)",
                        color: 'var(--nb-red)',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {(open ? '▾ ' : '▸ ') + (open ? '解答を隠す' : '解答を見る')}
                    </button>
                    <span style={{ flex: 1 }} />
                    {pending ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
                        {'次回 ' + fmtD(ctx, pending.due) + ' · ' + pending.stage}
                      </span>
                    ) : done ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--grn)' }}>定着 🎉</span>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>復習カードなし</span>
                    )}
                    {pending && canAddToToday(pending, T) ? (
                      <button
                        className="hv-acc-outline"
                        onClick={() => addToToday(pending)}
                        style={{ ...MINI_BTN, padding: '3px 8px' }}
                      >
                        ＋ 今日へ
                      </button>
                    ) : pending && isAddedToToday(pending) ? (
                      <span style={{ fontSize: '10.5px', color: 'var(--grn)' }}>✓ 追加済み</span>
                    ) : null}
                  </div>

                  <div style={wrapStyle(open)}>
                    <div style={WRAP_INNER}>
                      {/* 解答は赤ペンで書いた体。あとから書き足したぶんなので少し下げる */}
                      <div
                        style={{
                          paddingLeft: '2px',
                          marginTop: '6px',
                          display: 'grid',
                          gap: '10px',
                        }}
                      >
                        {edit || card.guide ? (
                          <div>
                            <div style={FIELD_LABEL}>方針</div>
                            {edit ? (
                              <textarea
                                className="fc-acc"
                                value={card.guide}
                                onChange={(e) =>
                                  patch((d) => void (d.cards[i].guide = e.target.value))
                                }
                                placeholder="方針(どう考えるか)"
                                style={{ ...INPUT, minHeight: '44px' }}
                              />
                            ) : (
                              <NoteMath className="nb-write nb-write--sm" src={card.guide} />
                            )}
                          </div>
                        ) : null}
                        <div>
                          <div style={FIELD_LABEL}>解答</div>
                          {edit ? (
                            <textarea
                              className="fc-acc"
                              value={card.a}
                              onChange={(e) => patch((d) => void (d.cards[i].a = e.target.value))}
                              placeholder="解答(表示数式は $$...$$)"
                              style={{ ...INPUT, minHeight: '52px' }}
                            />
                          ) : (
                            <NoteMath className="nb-write nb-write--red" src={card.a} />
                          )}
                        </div>
                        {edit ? (
                          <input
                            className="fc-acc"
                            value={card.src}
                            onChange={(e) => patch((d) => void (d.cards[i].src = e.target.value))}
                            placeholder="出典(任意)"
                            style={{ ...INPUT, font: "400 11.5px var(--f-ui)" }}
                          />
                        ) : card.src ? (
                          <div style={{ font: "400 11px var(--f-hand)", color: 'var(--tx3)' }}>
                            {'出典: ' + card.src}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {edit ? (
            <button
              className="hv-acc-outline"
              onClick={() => {
                if (note.cards.length >= NOTE_CARD_MAX) {
                  store.showToast('想起問題は' + NOTE_CARD_MAX + '問までです');
                  return;
                }
                patch((d) => {
                  d.cards.push({
                    cardId: 'c' + Date.now().toString(36) + d.cards.length.toString(36),
                    q: '',
                    a: '',
                    guide: '',
                    src: '',
                  });
                });
              }}
              style={{ ...MINI_BTN, marginTop: '10px' }}
            >
              ＋ 想起問題
            </button>
          ) : null}
        </section>

        {/* ── 解説 */}
        {note.blocks.length || edit ? (
          <section style={{ marginBottom: '26px' }}>
            <div className="nb-label">解説</div>
            <div style={{ display: 'grid', gap: '16px' }}>
              {note.blocks.map((block, bi) => (
                <NoteBlockRow
                  key={bi}
                  note={note}
                  block={block}
                  index={bi}
                  edit={edit}
                  onPatch={patch}
                />
              ))}
            </div>
            {edit ? (
              <div style={{ display: 'flex', gap: '7px', marginTop: '10px' }}>
                <button
                  className="hv-acc-outline"
                  onClick={() =>
                    patch((d) => void d.blocks.push({ t: 'def', title: '定義', body: '' }))
                  }
                  style={MINI_BTN}
                >
                  ＋ 定義
                </button>
                <button
                  className="hv-acc-outline"
                  onClick={() =>
                    patch(
                      (d) =>
                        void d.blocks.push({
                          t: 'ex',
                          cardId: d.cards[0]?.cardId ?? null,
                          guide: '',
                          solution: '',
                          caution: '',
                        }),
                    )
                  }
                  style={MINI_BTN}
                >
                  ＋ 問の解説
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── 演習 */}
        {note.exercise.q || edit ? (
          <section style={{ marginBottom: '26px' }}>
            <div className="nb-label">演習</div>
            <div>
              {edit ? (
                <textarea
                  className="fc-acc"
                  value={note.exercise.q}
                  onChange={(e) => patch((d) => void (d.exercise.q = e.target.value))}
                  placeholder="演習問題"
                  style={{ ...INPUT, minHeight: '52px' }}
                />
              ) : (
                <NoteMath className="nb-write" src={note.exercise.q} />
              )}
              <button
                onClick={() => toggle('e:' + note.id)}
                style={{
                  marginTop: '8px',
                  padding: 0,
                  border: 0,
                  background: 'none',
                  font: "600 12px var(--f-hand)",
                  color: 'var(--nb-red)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {isOpen('e:' + note.id) ? '▾ 解答を隠す' : '▸ 解答を見る'}
              </button>
              <div style={wrapStyle(isOpen('e:' + note.id))}>
                <div style={WRAP_INNER}>
                  <div style={{ marginTop: '6px' }}>
                    <div style={FIELD_LABEL}>解答</div>
                    {edit ? (
                      <textarea
                        className="fc-acc"
                        value={note.exercise.a}
                        onChange={(e) => patch((d) => void (d.exercise.a = e.target.value))}
                        placeholder="解答"
                        style={{ ...INPUT, minHeight: '60px' }}
                      />
                    ) : (
                      <NoteMath className="nb-write nb-write--red" src={note.exercise.a} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* ── 疑問 / 連絡（付箋） */}
        {note.doubt || note.notice || edit ? (
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))',
              gap: '12px',
            }}
          >
            {[
              { key: 'doubt' as const, label: '疑問', value: note.doubt, tone: 'doubt' },
              { key: 'notice' as const, label: '連絡', value: note.notice, tone: 'notice' },
            ].map((s) =>
              s.value || edit ? (
                <div key={s.key} className={'nb-sticky nb-sticky--' + s.tone}>
                  <div
                    style={{
                      font: "600 12px var(--f-hand)",
                      letterSpacing: '.1em',
                      opacity: 0.7,
                      marginBottom: '4px',
                    }}
                  >
                    {s.label}
                  </div>
                  {edit ? (
                    <textarea
                      className="fc-acc"
                      value={s.value}
                      onChange={(e) => patch((d) => void (d[s.key] = e.target.value))}
                      placeholder={s.label}
                      style={{ ...INPUT, minHeight: '68px', background: 'transparent' }}
                    />
                  ) : (
                    <NoteMath
                      src={s.value}
                      style={{ font: "400 14px/1.85 var(--f-hand)" }}
                    />
                  )}
                </div>
              ) : null,
            )}
          </section>
        ) : null}
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// 解説ブロック 1 個
// ─────────────────────────────────────────────────────────────

function NoteBlockRow({
  note,
  block,
  index,
  edit,
  onPatch,
}: {
  note: Note;
  block: NoteBlock;
  index: number;
  edit: boolean;
  onPatch: (fn: (draft: Note) => void) => void;
}) {
  const card: NoteCard | null =
    block.t === 'ex' && block.cardId
      ? note.cards.find((c) => c.cardId === block.cardId) || null
      : null;
  const cardNo = card ? note.cards.indexOf(card) + 1 : null;

  const move = (delta: number) =>
    onPatch((d) => {
      const to = index + delta;
      if (to < 0 || to >= d.blocks.length) return;
      const [b] = d.blocks.splice(index, 1);
      d.blocks.splice(to, 0, b);
    });

  return (
    <div
      style={cssVars({
        /* 赤の縦線は用紙のマージン 1 本だけにしたいので、ここは鉛筆の線で括る */
        borderLeft: '2px solid var(--nb-rule)',
        paddingLeft: '14px',
      })}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        {block.t === 'def' ? (
          edit ? (
            <input
              className="fc-acc"
              value={block.title}
              onChange={(e) =>
                onPatch((d) => {
                  const b = d.blocks[index];
                  if (b.t === 'def') b.title = e.target.value;
                })
              }
              placeholder="見出し"
              style={{ ...INPUT, font: "600 14px var(--f-hand)" }}
            />
          ) : (
            /* 用語の見出しは蛍光マーカーで塗る */
            <span style={{ font: "600 15px var(--f-hand)", color: 'var(--tx0)' }}>
              <span className="nb-marker">{block.title || '定義'}</span>
            </span>
          )
        ) : (
          <span style={{ font: "600 13px var(--f-hand)", color: 'var(--nb-red)' }}>
            {cardNo ? '問' + cardNo + ' の解説' : '解説(対象未設定)'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {edit ? (
          <>
            {block.t === 'ex' ? (
              <select
                className="fc-acc"
                value={block.cardId ?? ''}
                onChange={(e) =>
                  onPatch((d) => {
                    const b = d.blocks[index];
                    if (b.t === 'ex') b.cardId = e.target.value || null;
                  })
                }
                style={{
                  ...INPUT,
                  width: 'auto',
                  padding: '4px 8px',
                  font: "400 11px var(--f-ui)",
                }}
              >
                <option value="">対象なし</option>
                {note.cards.map((c, i) => (
                  <option key={c.cardId} value={c.cardId}>
                    {'問' + (i + 1)}
                  </option>
                ))}
              </select>
            ) : null}
            <button className="hv-acc-outline" onClick={() => move(-1)} style={MINI_BTN}>
              ↑
            </button>
            <button className="hv-acc-outline" onClick={() => move(1)} style={MINI_BTN}>
              ↓
            </button>
            <button
              className="hv-pink-text"
              onClick={() => onPatch((d) => void d.blocks.splice(index, 1))}
              style={MINI_BTN}
            >
              削除
            </button>
          </>
        ) : null}
      </div>

      {block.t === 'def' ? (
        edit ? (
          <textarea
            className="fc-acc"
            value={block.body}
            onChange={(e) =>
              onPatch((d) => {
                const b = d.blocks[index];
                if (b.t === 'def') b.body = e.target.value;
              })
            }
            placeholder="本文(数式は $...$ / $$...$$)"
            style={{ ...INPUT, minHeight: '70px' }}
          />
        ) : (
          <NoteMath className="nb-write" src={block.body} />
        )
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {!edit && card ? (
            <NoteMath
              className="nb-write nb-write--sm"
              src={card.q}
              style={{ color: 'var(--tx2)' }}
            />
          ) : null}
          {(
            [
              { key: 'guide', label: '方針' },
              { key: 'solution', label: '解答' },
              { key: 'caution', label: '注意' },
            ] as const
          ).map((f) => {
            const value = block[f.key];
            if (!edit && !value) return null;
            return (
              <div key={f.key}>
                <div style={FIELD_LABEL}>{f.label}</div>
                {edit ? (
                  <textarea
                    className="fc-acc"
                    value={value}
                    onChange={(e) =>
                      onPatch((d) => {
                        const b = d.blocks[index];
                        if (b.t === 'ex') b[f.key] = e.target.value;
                      })
                    }
                    placeholder={f.label}
                    style={{ ...INPUT, minHeight: '46px' }}
                  />
                ) : (
                  /* 解答と注意は赤ペン。方針は鉛筆のまま */
                  <NoteMath
                    className={
                      'nb-write nb-write--sm' +
                      (f.key === 'guide' ? '' : ' nb-write--red')
                    }
                    src={value}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
