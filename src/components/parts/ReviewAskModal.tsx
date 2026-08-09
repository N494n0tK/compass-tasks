'use client';

/**
 * Compass — 理解度モーダル（Phase 2B / TASK S4）
 *
 * 移植元: HTML:1817-1852（テンプレート）、3139-3145（`askR` / `askGrades` / `askSizeCur`）、
 * 3146-3185（`confirmAsk`）、4282-4300（`renderVals`）。spec §6.3 / §6.2。
 *
 * **`.compass-shell` の外**（`.compass-theme-mode` 直下）に出す必要があるので
 * `ShellOverlay` で包んである。`state.revAsk` が null のときは何も描かない。
 *
 * ⚠ 開く経路は Review 表の「完了」だけではない（Cockpit カード / ToDo の `toggleItem` /
 * 復習詳細の「✓ 復習完了にする」/ 集中モードの `completeFocusTask`）。画面は 1 つしか
 * マウントされないので、最終的には `CompassApp` に **1 個だけ** 置くのが正しい（下の注記）。
 */

import { noteRefOf } from '../../lib/logic/noteCards';
import { subjectColorFor } from '../../lib/logic/subjects';
import { GRADE_REQUIRED_MESSAGE, askSizeOf } from '../../lib/logic/reviews';
import type { ReviewGrade, SizeKey } from '../../lib/model/types';
import { NoteMath } from './NoteMath';
import { ShellOverlay } from './ShellOverlay';
import { SIZE_MIN, completeReview } from './ReviewShared';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/** `askGrades`（HTML:3140-3144）。並び順・文言・色トークンまで 1:1 */
const ASK_GRADES: readonly {
  id: ReviewGrade;
  icon: string;
  label: string;
  desc: string;
  c: string;
  bg: string;
}[] = [
  { id: 'high', icon: '◎', label: 'ばっちり', desc: '次の間隔へ進む', c: 'var(--grn)', bg: 'var(--grnBg)' },
  { id: 'mid', icon: '○', label: 'まあまあ', desc: '同じ間隔でもう一度', c: 'var(--acc)', bg: 'var(--accBg)' },
  { id: 'low', icon: '△', label: '不安…', desc: '明日 追加の復習', c: 'var(--pink)', bg: 'var(--pinkBg)' },
];

const SIZE_KEYS: readonly SizeKey[] = ['XS', 'S', 'M', 'L'];

export function ReviewAskModal() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;

  // `askR = S.reviews.find(r => r.id === S.revAsk) || null`（HTML:3139）
  const askR = S.reviews.find((r) => r.id === S.revAsk) || null;
  // `askOpen: !!askR`（HTML:4282）
  if (!askR) return null;

  const askSubj = subjectColorFor(subjColors, askR.subj);
  // `askSizeCur = S.revAskSize || (askR ? sizeOfMin(askR.min) : 'S')`（HTML:3145）
  const askSizeCur = askSizeOf(S.revAskSize, askR);

  /**
   * ノート由来の復習なら、想起カードの問題文と解答を引く（docs/notebook/spec.md §8 / N-066）。
   * `seriesId` の命名規約だけが手がかりで、ノートが消えている・まだ読み込めていない・
   * `dataPatch` M3 に `seriesId` を書き換えられた場合は `null` になり、
   * **モーダルは従来どおりの見た目で開く**（N-067）。理解度の処理経路は一切変わらない。
   */
  const noteRef = noteRefOf(askR.seriesId);
  const note = noteRef ? S.notes.find((n) => n.id === noteRef.noteId) || null : null;
  const card = note && noteRef ? note.cards.find((c) => c.cardId === noteRef.cardId) || null : null;

  const closeAsk = () => store.setState({ revAsk: null, revAskReveal: false });

  /** `confirmAsk()`（HTML:3146-3185）— 完了 → studyLog 記録 → 次回復習の生成 */
  const confirmAsk = () => {
    if (!S.revAskGrade) {
      store.showToast(GRADE_REQUIRED_MESSAGE);
      return;
    }
    const message = completeReview(store, askR, S.revAskGrade, askSizeCur, ctx);
    store.setState({ revAsk: null, revAskReveal: false });
    store.showToast(message);
  };

  return (
    <ShellOverlay>
      <div
        onClick={closeAsk}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5,9,20,.66)',
          backdropFilter: 'blur(3px)',
          zIndex: 55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fadeIn .15s ease',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '460px',
            maxWidth: '92vw',
            background: 'var(--bg1)',
            border: '1px solid var(--line2)',
            borderRadius: 'var(--rad)',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            animation: 'popIn .18s ease',
            boxShadow: '0 24px 80px rgba(0,0,0,.5)',
          }}
        >
          <div>
            <div style={{ font: "700 15px var(--f-ui)", color: 'var(--tx0)' }}>
              復習おつかれさま！理解度はどうでしたか？
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                marginTop: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  font: "700 10px var(--f-ui)",
                  color: askSubj.c,
                  background: askSubj.bg,
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 9px',
                }}
              >
                {askR.subj}
              </span>
              <span style={{ font: "500 13px var(--f-ui)", color: 'var(--tx1)' }}>
                {askR.title}
              </span>
              <span style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>{askR.stage}の復習</span>
            </div>
          </div>
          {/* ノートのカード（あるときだけ）。理解度を選ぶ前に想起する面（spec §8 / N-066） */}
          {card ? (
            <div
              className="nb-ask-card"
              style={{
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad)',
                background: 'var(--bg2)',
                padding: '13px 15px',
                maxHeight: '38vh',
                overflow: 'auto',
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--tx3)', marginBottom: '6px' }}>
                {note ? note.unit : '想起問題'}
              </div>
              <NoteMath src={card.q} style={{ color: 'var(--tx0)', fontSize: '14px' }} />
              {S.revAskReveal ? (
                <div
                  style={{
                    borderTop: '1px dashed var(--line)',
                    marginTop: '10px',
                    paddingTop: '10px',
                    display: 'grid',
                    gap: '7px',
                  }}
                >
                  {card.guide ? (
                    <NoteMath src={card.guide} style={{ color: 'var(--tx2)', fontSize: '12.5px' }} />
                  ) : null}
                  <NoteMath src={card.a} style={{ color: 'var(--tx1)', fontSize: '13.5px' }} />
                </div>
              ) : (
                <button
                  onClick={() => store.setState({ revAskReveal: true })}
                  style={{
                    marginTop: '10px',
                    padding: '6px 14px',
                    border: '1px solid var(--line2)',
                    borderRadius: 'var(--rad-s)',
                    background: 'none',
                    color: 'var(--acc)',
                    font: "600 11.5px var(--f-ui)",
                    cursor: 'pointer',
                  }}
                >
                  答えを見る
                </button>
              )}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {ASK_GRADES.map((g) => {
              // 選択時 c:'var(--onAcc)' / bg:g.c、bd は常に g.c（HTML:4286-4292）
              const on = S.revAskGrade === g.id;
              const c = on ? 'var(--onAcc)' : g.c;
              return (
                <div
                  key={g.id}
                  onClick={() => store.setState({ revAskGrade: g.id })}
                  style={{
                    border: '1px solid ' + g.c,
                    borderRadius: 'var(--rad)',
                    background: on ? g.c : g.bg,
                    padding: '12px 8px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ font: "700 22px var(--f-ui)", color: c, lineHeight: 1 }}>
                    {g.icon}
                  </div>
                  <div style={{ font: "700 12px var(--f-ui)", color: c, marginTop: '5px' }}>
                    {g.label}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '3px' }}>
                    {g.desc}
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--tx3)', marginBottom: '7px' }}>
              次回復習の予想時間
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SIZE_KEYS.map((z) => {
                const on = askSizeCur === z;
                return (
                  <span
                    key={z}
                    onClick={() => store.setState({ revAskSize: z })}
                    style={{
                      font: "700 11.5px var(--f-num)",
                      color: on ? 'var(--onAcc)' : 'var(--tx2)',
                      background: on ? 'var(--acc)' : 'var(--bg2)',
                      border: '1px solid ' + (on ? 'var(--acc)' : 'var(--line2)'),
                      borderRadius: 'var(--rad-s)',
                      padding: '6px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    {z + '·' + SIZE_MIN[z] + '分'}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={closeAsk}
              style={{
                padding: '10px 18px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'none',
                color: 'var(--tx2)',
                font: "500 13px var(--f-ui)",
                cursor: 'pointer',
              }}
            >
              キャンセル
            </button>
            <button
              onClick={confirmAsk}
              style={{
                padding: '10px 22px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 13px var(--f-ui)",
                cursor: 'pointer',
                boxShadow: 'var(--gAcc)',
              }}
            >
              ✓ 復習を完了する
            </button>
          </div>
        </div>
      </div>
    </ShellOverlay>
  );
}
