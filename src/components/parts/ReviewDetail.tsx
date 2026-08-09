'use client';

/**
 * Compass — 復習詳細ドロワー（Phase 2B / TASK S4）
 *
 * 移植元: HTML:1647-1687（テンプレート）、3335-3374（`rSel` / `shiftDue` / `reviewToTest`）、
 * 4344-4369（`renderVals` の `rd*`）。spec §6.5 / §7.9。
 *
 * `.compass-shell` の外に出す必要があるので `ShellOverlay` で包む。
 * `state.revSel` が指す復習が無ければ何も描かない（`revDetailOpen: !!rSel`）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { fmtD } from '../../lib/logic/dates';
import { noteRefOf } from '../../lib/logic/noteCards';
import { reviewNoOf, shiftDue, sizeOfMin } from '../../lib/logic/reviews';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Plan, Seg } from '../../lib/model/types';
import { ShellOverlay } from './ShellOverlay';
import { SIZE_MIN, openAsk, statusOf, ttLabelOf } from './ReviewShared';
import { addToOrder, mutReview } from './ShellActions';
import { savePrefs } from './ShellPrefs';
import { makeResizer } from './ShellResizer';
import { useSubjColors } from './ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

/** 情報カード 5 枚の外枠（HTML:1662-1666。5 枚とも同じ） */
const INFO_CARD = {
  background: 'var(--bg2)',
  borderRadius: 'var(--rad-s)',
  padding: '10px 12px',
} as const;

/** カードの見出し行 */
const INFO_LABEL = { fontSize: '10px', color: 'var(--tx3)' } as const;

export function ReviewDetail() {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const ctx = dateCtx;
  const T = ctx.today;

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  /** `this._reviewTitleTap`（HTML:4352）— 420ms 以内の連続タップでダブルタップ判定 */
  const lastTapRef = useRef(0);

  const rdResize = useMemo(
    () => makeResizer(store, 'review', 'left', () => savePrefs(store)),
    [],
  );

  // `rSel = S.reviews.find(r => r.id === S.revSel) || null`（HTML:3335）
  const rSel = S.reviews.find((r) => r.id === S.revSel) || null;
  const editing = !!rSel && S.revEditName === rSel.id;

  // `focusEl('review-title-editor')`（HTML:2608 / 4351-4352）を effect に置き換えた
  useEffect(() => {
    if (!editing) return;
    const el = titleInputRef.current;
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  }, [editing]);

  if (!rSel) return null;

  const subj = subjectColorFor(subjColors, rSel.subj);
  /** ノート由来なら元のノート・カードを引ける（docs/notebook/spec.md §4） */
  const noteRef = noteRefOf(rSel.seriesId);
  const st = statusOf(ctx, rSel);
  const ttLabel = ttLabelOf(rSel);
  const roundLabel = '第' + reviewNoOf(rSel) + '回';
  const rdCanAdd = !rSel.added && !rSel.done && rSel.due <= T;
  const rdIsAdded = rSel.added && !rSel.done;
  const rdCanDone = !rSel.done && rSel.due <= T;

  const closeRevDetail = () => store.setState({ revSel: null });

  /** `rdShiftMinus` / `rdShiftPlus` → `shiftDue(delta)`（HTML:3340-3349、v0.9 の相対シフト） */
  const doShiftDue = (delta: number) => {
    const res = shiftDue(rSel.due, delta, ctx);
    if (!res.moved) {
      store.showToast(res.message);
      return;
    }
    mutReview(store, rSel.id, (x) => ((x.due = res.due), x));
    store.showToast(res.message);
  };

  /** `reviewToTest()`（HTML:3350-3374 / spec §7.9） */
  const reviewToTest = () => {
    const pid = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 999);
    const sid = 's' + Date.now().toString(36) + Math.floor(Math.random() * 999);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(rSel.due || '') ? rSel.due : T;
    const min = Math.max(5, Number(rSel.min) || 10);
    const size = sizeOfMin(min);
    const day = due > T ? T : '';
    // `this.subjOf(rSel.subj || 'その他')`（3358）は SUBJ 表の遅延登録だけなので移植しない
    // （architecture §6。plan.subj 経由で `buildSubjColors` が同じ順で採番する）
    const plan: Plan = {
      name: rSel.title || 'テスト',
      type: 'test',
      due,
      subj: rSel.subj || 'その他',
      range: rSel.src || '範囲は未設定',
      timetablePeriod: rSel.timetablePeriod,
      timetableDate: rSel.timetableDate,
    };
    const seg: Seg = {
      id: sid,
      plan: pid,
      title: rSel.title || 'テスト準備',
      size,
      min: SIZE_MIN[size],
      day,
      done: false,
    };
    store.update(
      {
        plans: (p) => ({ ...p, [pid]: plan }),
        state: (s) => ({
          reviews: s.reviews.filter((x) => x.id !== rSel.id),
          segs: s.segs.concat([seg]),
          order: s.order.filter((id) => id !== rSel.id).concat(day === T ? [sid] : []),
          revSel: null,
          selId: day === T ? sid : s.selId,
          view: 'tests' as const,
          editorPlan: pid,
          edPlanName: plan.name,
          edPlanSubj: plan.subj,
          edPlanDue: due,
          edPlanRange: plan.range,
          edPlanType: 'test' as const,
        }),
      },
    );
    store.showToast('復習をテスト計画に変更しました');
  };

  return (
    <ShellOverlay>
      <div
        onClick={closeRevDetail}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5,9,20,.45)',
          zIndex: 45,
          animation: 'fadeIn .15s ease',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: S.panelW.review + 'px',
            maxWidth: '94vw',
            background: 'var(--bg1)',
            borderLeft: '1px solid var(--line2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            padding: '18px',
            animation: 'slideInR .2s ease',
            boxShadow: '-12px 0 40px rgba(5,10,25,.45)',
          }}
        >
          <div
            onMouseDown={rdResize}
            style={{
              position: 'absolute',
              left: '-3px',
              top: 0,
              bottom: 0,
              width: '7px',
              cursor: 'ew-resize',
              zIndex: 5,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                font: "700 11px var(--f-ui)",
                color: subj.c,
                background: subj.bg,
                borderRadius: 'var(--rad-s)',
                padding: '3px 10px',
              }}
            >
              {rSel.subj}
            </span>
            <span
              style={{
                font: "700 10px var(--f-ui)",
                color: subj.c,
                background: subj.bg,
                border: '1px solid ' + subj.c,
                borderRadius: 'var(--rad-s)',
                padding: '3px 9px',
              }}
            >
              {roundLabel}
            </span>
            <span
              style={{
                font: "700 10px var(--f-ui)",
                color: 'var(--grn)',
                background: 'var(--grnBg)',
                borderRadius: 'var(--rad-s)',
                padding: '3px 9px',
              }}
            >
              {rSel.stage}の復習
            </span>
            {ttLabel ? (
              <span
                style={{
                  font: "700 9px var(--f-ui)",
                  color: 'var(--org)',
                  background: 'var(--orgBg)',
                  borderRadius: 'var(--rad-s)',
                  padding: '2px 7px',
                }}
              >
                {ttLabel}
              </span>
            ) : null}
            <button
              onClick={closeRevDetail}
              style={{
                marginLeft: 'auto',
                width: '26px',
                height: '26px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'none',
                color: 'var(--tx2)',
                cursor: 'pointer',
                fontSize: '12px',
                flex: 'none',
              }}
            >
              ✕
            </button>
          </div>
          {!editing ? (
            <div
              onDoubleClick={() => store.setState({ revEditName: rSel.id })}
              onTouchEnd={() => {
                const now = Date.now();
                if (lastTapRef.current && now - lastTapRef.current < 420) {
                  store.setState({ revEditName: rSel.id });
                }
                lastTapRef.current = now;
              }}
              title="ダブルタップで名称を変更"
              style={{
                font: "700 17px var(--f-ui)",
                color: 'var(--tx0)',
                cursor: 'text',
                paddingBottom: '4px',
                borderBottom: '1px dashed color-mix(in srgb,var(--acc) 42%,transparent)',
              }}
            >
              {rSel.title}
            </div>
          ) : null}
          {editing ? (
            <input
              id="review-title-editor"
              ref={titleInputRef}
              value={rSel.title}
              onChange={(e) => {
                const v = e.target.value;
                mutReview(store, rSel.id, (x) => ((x.title = v), x));
              }}
              onBlur={() => store.setState({ revEditName: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Escape') store.setState({ revEditName: null });
              }}
              style={{
                width: '100%',
                padding: '7px 2px',
                background: 'none',
                border: 'none',
                borderBottom: '1px dashed var(--acc)',
                outline: 'none',
                color: 'var(--tx0)',
                font: "700 17px var(--f-ui)",
              }}
            />
          ) : null}
          <div style={{ fontSize: '10.5px', color: 'var(--tx3)', marginTop: '-9px' }}>
            名称はダブルタップで編集できます
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
            <div style={INFO_CARD}>
              <div style={INFO_LABEL}>前回学習日</div>
              <div
                style={{
                  font: "700 14px var(--f-num)",
                  color: 'var(--tx0)',
                  marginTop: '2px',
                }}
              >
                {fmtD(ctx, rSel.last)}
              </div>
            </div>
            <div style={INFO_CARD}>
              <div style={INFO_LABEL}>次回復習日</div>
              <div
                style={{
                  font: "700 14px var(--f-ui)",
                  color: !rSel.done && rSel.due <= T ? 'var(--pink)' : 'var(--tx0)',
                  marginTop: '2px',
                }}
              >
                {fmtD(ctx, rSel.due)}
              </div>
            </div>
            <div style={INFO_CARD}>
              <div style={INFO_LABEL}>今回の復習</div>
              <div style={{ font: "700 14px var(--f-ui)", color: subj.c, marginTop: '2px' }}>
                {roundLabel}
              </div>
            </div>
            <div style={INFO_CARD}>
              <div style={INFO_LABEL}>復習タイミング</div>
              <div
                style={{
                  font: "700 13px var(--f-ui)",
                  color: 'var(--tx1)',
                  marginTop: '2px',
                }}
              >
                {rSel.stage}
              </div>
            </div>
            <div style={INFO_CARD}>
              <div style={INFO_LABEL}>目安時間</div>
              <div
                style={{
                  font: "700 14px var(--f-num)",
                  color: 'var(--tx1)',
                  marginTop: '2px',
                }}
              >
                {rSel.min}分
              </div>
            </div>
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--tx3)' }}>
            {rSel.src} · 状態: <b style={{ color: st.c }}>{st.label}</b>
          </div>
          <div
            style={{
              borderTop: '1px solid var(--line)',
              paddingTop: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {rdCanAdd ? (
              <button
                onClick={() => {
                  mutReview(store, rSel.id, (x) => ((x.added = true), x));
                  addToOrder(store, rSel.id);
                  store.showToast(
                    '「' + rSel.subj + ' ' + rSel.title + '」を今日のToDoに追加しました',
                  );
                }}
                style={{
                  padding: '11px',
                  border: 'none',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--grn)',
                  color: 'var(--onAcc)',
                  font: "700 13px var(--f-ui)",
                  cursor: 'pointer',
                  boxShadow: 'var(--gGrn)',
                }}
              >
                ＋ 今日のToDoに追加
              </button>
            ) : null}
            {rdIsAdded ? (
              <>
                <div
                  style={{
                    padding: '11px',
                    borderRadius: 'var(--rad-s)',
                    background: 'var(--grnBg)',
                    color: 'var(--grn)',
                    font: "700 12.5px var(--f-ui)",
                    textAlign: 'center',
                  }}
                >
                  ✓ 今日のToDoに追加済み
                </div>
                <button
                  className="hv-pink-border"
                  onClick={() => {
                    mutReview(store, rSel.id, (x) => ((x.added = false), x));
                    store.setState((s) => ({ order: s.order.filter((o) => o !== rSel.id) }));
                    store.showToast('今日のToDoから外しました');
                  }}
                  style={{
                    padding: '10px',
                    border: '1px solid var(--line2)',
                    borderRadius: 'var(--rad-s)',
                    background: 'var(--bg2)',
                    color: 'var(--tx1)',
                    font: "700 12.5px var(--f-ui)",
                    cursor: 'pointer',
                  }}
                >
                  今日のToDoから外す
                </button>
              </>
            ) : null}
            {rdCanDone ? (
              <button
                className="hv-grn-border"
                onClick={() => openAsk(store, rSel.id)}
                style={{
                  padding: '11px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'none',
                  color: 'var(--tx1)',
                  font: "700 13px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                ✓ 復習完了にする
              </button>
            ) : null}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--tx3)', flex: 1 }}>
                次回復習日を変更
              </span>
              <button
                onClick={() => doShiftDue(-1)}
                style={{
                  padding: '7px 14px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg2)',
                  color: 'var(--tx1)',
                  font: "700 12px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                − 1日
              </button>
              <button
                onClick={() => doShiftDue(1)}
                style={{
                  padding: '7px 14px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg2)',
                  color: 'var(--tx1)',
                  font: "700 12px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                ＋ 1日
              </button>
            </div>
            {/* ノート由来の復習だけ。元のノートへ飛ぶ（docs/notebook/spec.md §8） */}
            {noteRef && S.notes.some((n) => n.id === noteRef.noteId) ? (
              <button
                onClick={() => {
                  store.setState({
                    view: 'notebook',
                    nbMode: 'note',
                    nbSelNoteId: noteRef.noteId,
                    nbEdit: false,
                    revSel: null,
                  });
                  savePrefs(store);
                }}
                style={{
                  padding: '10px',
                  border: '1px solid var(--ink)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--inkBg)',
                  color: 'var(--ink)',
                  font: "700 12.5px var(--f-ui)",
                  cursor: 'pointer',
                }}
              >
                ノートを開く
              </button>
            ) : null}
            <button
              onClick={reviewToTest}
              style={{
                padding: '10px',
                border: '1px solid var(--vio)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--vioBg)',
                color: 'var(--vio)',
                font: "700 12.5px var(--f-ui)",
                cursor: 'pointer',
              }}
            >
              テスト計画に変更
            </button>
            <button
              className="hv-pink-text"
              onClick={() => {
                store.setState((s) => ({
                  reviews: s.reviews.filter((x) => x.id !== rSel.id),
                  revSel: null,
                  order: s.order.filter((o) => o !== rSel.id),
                }));
                store.showToast('復習アイテムを削除しました');
              }}
              style={{
                padding: '9px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'none',
                color: 'var(--tx3)',
                font: "500 12px var(--f-ui)",
                cursor: 'pointer',
              }}
            >
              Reviewから完全に削除
            </button>
          </div>
        </div>
      </div>
    </ShellOverlay>
  );
}
