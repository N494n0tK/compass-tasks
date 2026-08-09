'use client';

/**
 * Compass — ノート 1 冊の表示・編集（docs/notebook/spec.md §8）
 *
 * 紙面の下敷き: `CompassNotebook/チャートノート v2.dc.html`（Broadsheet DS）。
 * v2 の作りをそのまま引き継いでいる:
 *  - ページ頭は「太 3px + 細 1px」の 2 本組（`.nb-masthead`）。罫を刷るのはここだけ
 *  - 想起 / 解説 / 演習 / 疑問・連絡 の 4 セクションを**枠で囲わず余白で**分ける
 *  - 解答は伏せておき、`▸ 解答を見る` で下に伸ばす（`.nb-open` / `.nb-ans`）
 *  - 「方針 / 解答 / 注意」は小札 + 本文の 2 段組（`.nb-row` / `.nb-sub`）
 *
 * レガシー（v3 の手書きノート）からの変更:
 *  - 罫線用紙・赤ペン・蛍光マーカー・赤シートをやめ、活字の紙面にした。
 *    ノートは「配られた問題集の紙面」として読む方が他画面と地続きになる。
 *  - 解説ブロックが想起問題を指すキーは `qi`（配列インデックス）ではなく
 *    `cardId`（安定 ID）。想起問題を消してもほかのブロックの対応がズレない。
 *  - 各カードに**復習カードの状態**（次回の日付・段階・「今日へ」）を出す。
 *    これがノートと Compass の復習エンジンをつなぐ唯一の可視面。
 *  - 保存は `commitNote`（ノート保存 + 復習の生成・同期・カスケードを 1 か所で）。
 */

import type { CSSProperties, ReactNode } from 'react';
import { fmtD, longDayLabel } from '../../lib/logic/dates';
import { noteSeriesId } from '../../lib/logic/noteCards';
import { canAddToToday, isAddedToToday } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import {
  NOTE_CARD_MAX,
  NOTE_SUBJECTS,
  type Note,
  type NoteBlock,
  type NoteCard,
} from '../../lib/model/notes';
import type { Review } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { commitNote, removeNote } from './NotebookPersistence';
import { addToOrder, mutReview } from './ShellActions';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

const INPUT: CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  padding: '8px 10px',
  color: 'var(--tx1)',
  font: '400 13px var(--f-ui)',
  lineHeight: 1.8,
  outline: 'none',
  resize: 'vertical',
};

const MINI_BTN: CSSProperties = {
  padding: '4px 9px',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--rad-s)',
  background: 'none',
  color: 'var(--tx2)',
  font: '500 11px var(--f-ui)',
  cursor: 'pointer',
};

/** 開閉のアニメーション（v2 の `wrapSt`。grid-template-rows で高さを補間する） */
function wrapStyle(open: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    transition: 'grid-template-rows .45s cubic-bezier(.22,1,.36,1)',
  };
}

const WRAP_INNER: CSSProperties = { overflow: 'hidden', minHeight: 0 };

/** `▸ 解答を見る` / `▾ 解答を隠す`（v2 の `ansPack`） */
export function RevealButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="nb-open" onClick={onClick} aria-expanded={open}>
      <span className={'nb-caret' + (open ? ' is-open' : '')} aria-hidden="true">
        ▸
      </span>
      {open ? '解答を隠す' : '解答を見る'}
    </button>
  );
}

/** セクションの見出し。版（`.nb-badge`）+ 名前 + ひとこと */
function SectionHead({
  badge,
  title,
  hint,
  tone,
}: {
  badge: string;
  title?: string;
  hint: string;
  tone?: 'quiet' | 'warn';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        flexWrap: 'wrap',
        marginBottom: '16px',
      }}
    >
      <span className={'nb-badge' + (tone ? ' nb-badge--' + tone : '')}>{badge}</span>
      {title ? <span className="nb-sec-title">{title}</span> : null}
      <span className="nb-sec-hint">{hint}</span>
    </div>
  );
}

/** 小札 + 本文の 1 行（「方針」「解答」「注意」） */
function SubRow({
  label,
  warn,
  children,
}: {
  label: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="nb-row">
      <span className={'nb-sub' + (warn ? ' nb-sub--warn' : '')}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

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

  /** 「復習」ボタン: このノートの解答をすべて閉じる（v2 の `v.review`） */
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

  /** 想起問題 → その解説ブロックへ滑らかに送る（v2 の `goExplain`） */
  const jumpToBlock = (cardId: string) => {
    const el = document.querySelector('[data-block-card="' + cardId + '"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <article style={{ maxWidth: '880px', animation: 'fadeUp .22s ease' }}>
      {/* ── ページ頭。罫を刷るのはここだけ */}
      <header className="nb-masthead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {edit ? (
            <input
              className="fc-acc"
              type="date"
              value={note.date}
              onChange={(e) => patch((d) => void (d.date = e.target.value))}
              style={{ ...INPUT, width: 'auto', font: '500 12px var(--f-num)' }}
            />
          ) : (
            <span className="nb-dateline">
              {note.date ? note.date.slice(0, 4) + '年' + longDayLabel(note.date) : '日付なし'}
            </span>
          )}
          <span style={{ color: 'var(--tx3)' }}>・</span>
          <span
            style={{
              font: '700 10px var(--f-ui)',
              color: subjColor.c,
              background: subjColor.bg,
              borderRadius: 'var(--rad-s)',
              padding: '2px 9px',
            }}
          >
            {note.subject}
          </span>
          <span style={{ flex: 1 }} />
          <button className="hv-acc-outline" onClick={closeAll} style={MINI_BTN} title="解答をすべて閉じて復習">
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
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '10px' }}>
            {NOTE_SUBJECTS.map((s) => {
              const on = note.subject === s;
              return (
                <button
                  key={s}
                  onClick={() => patch((d) => void (d.subject = s))}
                  style={{
                    font: '600 11px var(--f-ui)',
                    color: on ? 'var(--onAcc)' : 'var(--tx2)',
                    background: on ? 'var(--view)' : 'transparent',
                    border: '1px solid ' + (on ? 'var(--view)' : 'var(--line2)'),
                    borderRadius: 'var(--rad-s)',
                    padding: '4px 11px',
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
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
            style={{ ...INPUT, marginTop: '10px', font: '700 22px var(--f-disp)' }}
          />
        ) : (
          <h1 className="nb-title">{note.unit || '(単元名なし)'}</h1>
        )}
      </header>

      {/* ── 想起 */}
      <section style={{ marginTop: '30px' }}>
        <SectionHead badge="想起" title="想起問題" hint="解答を隠したまま思い出してから開く" />
        <div style={{ display: 'grid', gap: '20px' }}>
          {note.cards.map((card, i) => {
            const key = 'r:' + note.id + ':' + card.cardId;
            const open = isOpen(key);
            const { pending, done } = reviewOf(card.cardId);
            const hasExplain = note.blocks.some((b) => b.t === 'ex' && b.cardId === card.cardId);
            return (
              <div key={card.cardId} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <span className="nb-no" aria-hidden="true">
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {edit ? (
                    <textarea
                      className="fc-acc"
                      value={card.q}
                      onChange={(e) => patch((d) => void (d.cards[i].q = e.target.value))}
                      placeholder="問題文(数式は $...$ で LaTeX)"
                      style={{ ...INPUT, minHeight: '52px' }}
                    />
                  ) : (
                    <NoteMath className="nb-body" src={card.q} />
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <RevealButton open={open} onClick={() => toggle(key)} />
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
                      <div className="nb-ans">
                        {edit || card.guide ? (
                          <SubRow label="方針">
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
                              <NoteMath className="nb-body nb-body--sm" src={card.guide} />
                            )}
                          </SubRow>
                        ) : null}
                        <SubRow label="解答">
                          {edit ? (
                            <textarea
                              className="fc-acc"
                              value={card.a}
                              onChange={(e) => patch((d) => void (d.cards[i].a = e.target.value))}
                              placeholder="解答(表示数式は $$...$$)"
                              style={{ ...INPUT, minHeight: '52px' }}
                            />
                          ) : (
                            <NoteMath className="nb-body" src={card.a} />
                          )}
                        </SubRow>
                        {edit ? (
                          <input
                            className="fc-acc"
                            value={card.src}
                            onChange={(e) => patch((d) => void (d.cards[i].src = e.target.value))}
                            placeholder="出典(任意)"
                            style={{ ...INPUT, font: '400 11.5px var(--f-ui)' }}
                          />
                        ) : card.src ? (
                          <div style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
                            {'出典: ' + card.src}
                          </div>
                        ) : null}
                        {!edit && hasExplain ? (
                          <div>
                            <button className="nb-jump" onClick={() => jumpToBlock(card.cardId)}>
                              解説へ ↓
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                {edit ? (
                  <button
                    className="hv-pink-text"
                    onClick={() => {
                      if (note.cards.length <= 1) {
                        store.showToast('想起問題は1問以上必要です');
                        return;
                      }
                      if (!window.confirm('この想起問題と、その復習カードを削除しますか？')) return;
                      patch((d) => {
                        d.cards.splice(i, 1);
                        d.blocks = d.blocks.map((b) =>
                          b.t === 'ex' && b.cardId === card.cardId ? { ...b, cardId: null } : b,
                        );
                      }, [card.cardId]);
                    }}
                    style={{ ...MINI_BTN, flex: 'none' }}
                  >
                    削除
                  </button>
                ) : null}
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
            style={{ ...MINI_BTN, marginTop: '15px' }}
          >
            ＋ 想起問題
          </button>
        ) : null}
      </section>

      {/* ── 解説 */}
      {note.blocks.length || edit ? (
        <section style={{ marginTop: '30px' }}>
          <SectionHead badge="解説" title="解説" hint="定義と、解けなかった想起問題の解説" />
          <div style={{ display: 'grid', gap: '30px' }}>
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
            <div style={{ display: 'flex', gap: '7px', marginTop: '15px' }}>
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
        <section style={{ marginTop: '30px' }}>
          <SectionHead badge="演習" hint="その場で 1 問、手を動かして解く" />
          {edit ? (
            <textarea
              className="fc-acc"
              value={note.exercise.q}
              onChange={(e) => patch((d) => void (d.exercise.q = e.target.value))}
              placeholder="演習問題"
              style={{ ...INPUT, minHeight: '52px' }}
            />
          ) : (
            <NoteMath className="nb-body" src={note.exercise.q} />
          )}
          <RevealButton
            open={isOpen('e:' + note.id)}
            onClick={() => toggle('e:' + note.id)}
          />
          <div style={wrapStyle(isOpen('e:' + note.id))}>
            <div style={WRAP_INNER}>
              <div className="nb-ans">
                {edit ? (
                  <textarea
                    className="fc-acc"
                    value={note.exercise.a}
                    onChange={(e) => patch((d) => void (d.exercise.a = e.target.value))}
                    placeholder="解答"
                    style={{ ...INPUT, minHeight: '60px' }}
                  />
                ) : (
                  <NoteMath className="nb-body" src={note.exercise.a} />
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── 疑問 / 連絡。授業の中身ではなく自分の書き足しなので、版は張らない */}
      {note.doubt || note.notice || edit ? (
        <section
          style={{
            marginTop: '30px',
            paddingBottom: '40px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
            gap: '30px',
          }}
        >
          {(
            [
              {
                key: 'doubt' as const,
                label: '疑問',
                hint: '自分が分からなかった点',
                tone: 'warn' as const,
                value: note.doubt,
              },
              {
                key: 'notice' as const,
                label: '連絡',
                hint: '提出物・テスト範囲など',
                tone: 'quiet' as const,
                value: note.notice,
              },
            ]
          ).map((s) =>
            s.value || edit ? (
              <div key={s.key}>
                <SectionHead badge={s.label} hint={s.hint} tone={s.tone} />
                {edit ? (
                  <textarea
                    className="fc-acc"
                    value={s.value}
                    onChange={(e) => patch((d) => void (d[s.key] = e.target.value))}
                    placeholder={s.hint}
                    style={{ ...INPUT, minHeight: '68px' }}
                  />
                ) : (
                  <NoteMath className="nb-body nb-body--sm" src={s.value} />
                )}
              </div>
            ) : null,
          )}
        </section>
      ) : null}
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
    <div data-block-card={block.t === 'ex' ? (block.cardId ?? undefined) : undefined}>
      {edit ? (
        <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', marginBottom: '5px' }}>
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
              style={{ ...INPUT, width: 'auto', padding: '4px 8px', font: '400 11px var(--f-ui)' }}
            >
              <option value="">対象なし</option>
              {note.cards.map((c, i) => (
                <option key={c.cardId} value={c.cardId}>
                  {'問' + (i + 1)}
                </option>
              ))}
            </select>
          ) : null}
          <button className="hv-acc-outline" onClick={() => move(-1)} style={MINI_BTN} aria-label="上へ">
            ↑
          </button>
          <button className="hv-acc-outline" onClick={() => move(1)} style={MINI_BTN} aria-label="下へ">
            ↓
          </button>
          <button
            className="hv-pink-text"
            onClick={() => onPatch((d) => void d.blocks.splice(index, 1))}
            style={MINI_BTN}
          >
            削除
          </button>
        </div>
      ) : null}

      {block.t === 'def' ? (
        <div className="nb-row">
          <span className="nb-badge nb-badge--quiet">定義</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {edit ? (
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
                style={{ ...INPUT, font: '700 15px var(--f-disp)', marginBottom: '6px' }}
              />
            ) : (
              <div style={{ font: '700 16px var(--f-disp)', color: 'var(--tx0)', marginBottom: '5px' }}>
                {block.title || '定義'}
              </div>
            )}
            {edit ? (
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
              <NoteMath className="nb-body" src={block.body} />
            )}
          </div>
        </div>
      ) : (
        <div className="nb-row">
          <span className="nb-badge">{cardNo ? '問' + cardNo : '問?'}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: '10px' }}>
            {!edit ? (
              <NoteMath
                className="nb-body nb-body--dim"
                src={card ? card.q : '(対象の想起問題が設定されていません)'}
              />
            ) : null}
            {(
              [
                { key: 'guide', label: '方針', hair: false, warn: false },
                { key: 'solution', label: '解答', hair: true, warn: false },
                { key: 'caution', label: '注意', hair: false, warn: true },
              ] as const
            ).map((f) => {
              const value = block[f.key];
              if (!edit && !value) return null;
              return (
                <SubRow key={f.key} label={f.label} warn={f.warn}>
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
                    <NoteMath
                      className={'nb-body' + (f.warn ? ' nb-body--sm' : '') + (f.hair ? ' nb-hair' : '')}
                      src={value}
                    />
                  )}
                </SubRow>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
