'use client';

/**
 * Compass — 計画編集ドロワー（ミニタスクエディタ）（Phase 2B / TASK S2）
 *
 * 移植元:
 *  - テンプレート HTML:1564-1650（`sc-if editorOpen` 配下すべて）
 *  - 値・ハンドラ HTML:3844-4046（`// ── minitask editor` の `edVals`）
 *  - HTML:4123-4128（`edW` / `edResize` / `edCollapsed` / `edOverlayBg` / `collapseEditor` / `expandEditor`）
 *  - HTML:4185-4188（`closeEditor` / `onEdNewTitle` / `onEdNewKey` / `addMini`）
 *  - HTML:2434-2442（`addMiniTask`）、2405-2409 + 2417-2432（`snapFlip` と FLIP 適用）
 *  - HTML:3636-3642（`sizeChip`）、2608（`focusEl`）
 *
 * spec §7.6 / §10.13（C-387〜C-411）、§3.6（FLIP）。css-notes §6（`.hv-pink-text` /
 * `.fc-acc` / `.fc-acc-underline`。**削除ボタンには hover ユーティリティを付けない** = C-410）。
 *
 * DOM 位置は `.compass-theme-mode` 直下（`<ShellOverlay>` で包んで呼ぶこと）。
 */

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { dayLabel, isoShift, type DateContext } from '../../lib/logic/dates';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import type { AppState, Plans, Seg, SizeKey } from '../../lib/model/types';
import type { CompassStore } from '../../lib/store';
import { mutSeg, addToOrder } from './ShellActions';
import { savePrefs } from './ShellPrefs';
import { makeResizer } from './ShellResizer';

/**
 * `this.SIZE_MIN`（HTML:2037）。`lib/logic/reviews.ts` では非公開なのでローカルに置く
 * （`parts/ShellTodayItems.ts` と同じ扱い。値は同一）。
 */
const SIZE_MIN: Readonly<Record<SizeKey, number>> = { XS: 5, S: 10, M: 20, L: 30 };

/** `nextSize`（HTML:3912） */
const NEXT_SIZE: Readonly<Record<SizeKey, SizeKey>> = { XS: 'S', S: 'M', M: 'L', L: 'XS' };

const SIZE_KEYS: readonly SizeKey[] = ['XS', 'S', 'M', 'L'];

/** `focusEl(id)`（HTML:2608） */
function focusEl(id: string): void {
  setTimeout(() => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  }, 0);
}

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export interface TestsEditorDrawerProps {
  state: AppState;
  plans: Plans;
  store: CompassStore;
  ctx: DateContext;
  subjColors: SubjColors;
}

export function TestsEditorDrawer({ state, plans, store, ctx, subjColors }: TestsEditorDrawerProps) {
  const S = state;
  const T = ctx.today;
  const edPid = S.editorPlan;

  // ── FLIP（HTML:2405-2409 / 2417-2432）
  // レガシーは `document.querySelectorAll('[data-flipid]')` で全画面を対象にするが、
  // `data-flipid` を出すのはこのドロワーと ToDo 画面だけで、両者が同時に見えることは無い。
  // ここではドロワー内に限定して同じ計算を行う（skip 判定・3px 未満スキップ・220ms は同一）。
  const flipRoot = useRef<HTMLDivElement | null>(null);
  const flipSnap = useRef<Record<string, number> | null>(null);
  /** `this._miniTap`（HTML:3955-3959）— ダブルタップ判定（360ms） */
  const miniTap = useRef<{ id: string; t: number } | null>(null);

  const snapFlip = () => {
    const root = flipRoot.current;
    if (!root) return;
    const m: Record<string, number> = {};
    root.querySelectorAll('[data-flipid]').forEach((el) => {
      const id = el.getAttribute('data-flipid');
      if (id != null) m[id] = el.getBoundingClientRect().top;
    });
    flipSnap.current = m;
  };

  useLayoutEffect(() => {
    const prev = flipSnap.current;
    if (!prev) return;
    flipSnap.current = null;
    const root = flipRoot.current;
    if (!root) return;
    const st = store.getState();
    const skip = st.dragId || st.dragMini;
    root.querySelectorAll('[data-flipid]').forEach((node) => {
      const el = node as HTMLElement;
      const id = el.getAttribute('data-flipid');
      if (id == null || prev[id] == null || id === skip || id === 'ed-' + skip) return;
      const dy = prev[id] - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 3) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      void el.offsetHeight;
      el.style.transition = 'transform .18s ease';
      el.style.transform = '';
      setTimeout(() => {
        el.style.transition = '';
      }, 220);
    });
  });

  if (!edPid) return null;
  const pl = plans[edPid];
  // レガシーは `P[edPid]` が無いと TypeError で落ちるが、`editorPlan` は削除時に必ず null に
  // されるため到達しない。ここでは描画しないだけにする。
  if (!pl) return null;

  const subE = subjectColorFor(subjColors, pl.subj);
  const list = S.segs.filter((s) => s.plan === edPid);
  const doneN = list.filter((s) => s.done).length;
  const remain = list.filter((s) => !s.done).reduce((a, b) => a + b.min, 0);

  const light = S.theme === 'light';
  const edC = subE.c;
  const edName = pl.name;
  const edMeta =
    (pl.type === 'test' ? 'テスト' : '予習') + ' · 期限 ' + dayLabel(ctx, pl.due) + ' · ' + pl.range;
  const edPct = list.length ? Math.round((doneN / list.length) * 100) : 0;
  const edDash = list.length ? Math.round((doneN / list.length) * 182) : 0;
  const edW = Math.min(520, Math.max(320, S.panelW.editor || 410)) + 'px';
  const edCollapsed = !!S.editorCollapsed;
  const edOverlayBg = S.editorCollapsed ? 'transparent' : 'rgba(5,9,20,.45)';
  const edOverlayPointer = S.editorCollapsed ? 'none' : 'auto';

  const stopProp = (e: ReactMouseEvent) => e.stopPropagation();
  const closeEditor = () =>
    store.setState({ editorPlan: null, editorCollapsed: false, dragMini: null, dragMiniOver: null });
  const collapseEditor = () =>
    store.setState({ editorCollapsed: true, dragMini: null, dragMiniOver: null });
  const expandEditor = () => store.setState({ editorCollapsed: false });
  const edResize = makeResizer(store, 'editor', 'left', () => savePrefs(store));

  // ── 計画を編集（HTML:3850-3869）
  const savePlanEdit = () => {
    const name = (store.getState().edPlanName || '').trim();
    const subj = (store.getState().edPlanSubj || '').trim();
    const due = store.getState().edPlanDue || '';
    if (!name || !subj || !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      store.showToast('名前・教科・日付を入力してください');
      return;
    }
    // `this.subjOf(subj)` は色表への副作用のみ（architecture §6 で useMemo 側に集約済み）
    store.update({
      plans: (p) => ({
        ...p,
        [edPid]: {
          ...p[edPid],
          name,
          subj,
          due,
          range: (store.getState().edPlanRange || '').trim() || '範囲は未設定',
          type: store.getState().edPlanType === 'prep' ? 'prep' : 'test',
        },
      }),
      state: (s) => ({
        segs: s.segs.map((seg) =>
          seg.plan === edPid && seg.day && seg.day >= due
            ? Object.assign({}, seg, { day: isoShift(due, -1) })
            : seg
        ),
      }),
    });
    store.showToast('計画を更新しました');
  };

  // ── 削除 / 完了非表示（HTML:3870-3910）
  const completedPlan = list.length > 0 && list.every((seg) => seg.done);
  const deletePlan = () => {
    const current = store.getPlans()[edPid];
    if (!current) return;
    if (completedPlan) {
      const completedSegs = store.getState().segs.filter((x) => x.plan === edPid && x.done);
      const ids = completedSegs.map((x) => x.id);
      store.update({
        plans: (p) => {
          const next = { ...p };
          delete next[edPid];
          return next;
        },
        state: (s) => ({
          // 完了ミニタスクを消す前に学習履歴へ移し、集計済みの勉強時間を保持する。
          studyLog: s.studyLog.concat(
            completedSegs.map((seg) => ({ day: seg.day || T, subj: current.subj, min: seg.min }))
          ),
          segs: s.segs.filter((x) => x.plan !== edPid),
          order: s.order.filter((id) => ids.indexOf(id) < 0),
          selId: s.selId != null && ids.indexOf(s.selId) >= 0 ? null : s.selId,
          editorPlan: null,
          dragMini: null,
          editMiniName: null,
        }),
      });
      store.showToast('「' + current.name + '」を完了として非表示にしました（勉強時間は保持）');
      return;
    }
    if (
      window.confirm &&
      !window.confirm(
        '「' +
          current.name +
          '」と、そのミニタスクをすべて削除しますか？\n完了済みミニタスクの勉強時間は、データ画面の記録に残ります。'
      )
    )
      return;
    const mineSegs = store.getState().segs.filter((x) => x.plan === edPid);
    const ids = mineSegs.map((x) => x.id);
    const doneSegs = mineSegs.filter((x) => x.done);
    store.update({
      plans: (p) => {
        const next = { ...p };
        delete next[edPid];
        return next;
      },
      state: (s) => ({
        // (v0.9) 通常削除でも完了ぶんの勉強時間を studyLog へ転記する（C-520）
        studyLog: s.studyLog.concat(
          doneSegs.map((seg) => ({ day: seg.day || T, subj: current.subj, min: seg.min }))
        ),
        segs: s.segs.filter((x) => x.plan !== edPid),
        order: s.order.filter((id) => ids.indexOf(id) < 0),
        selId: s.selId != null && ids.indexOf(s.selId) >= 0 ? null : s.selId,
        editorPlan: null,
        dragMini: null,
        editMiniName: null,
      }),
    });
    store.showToast('計画を削除しました');
  };

  // ── ミニタスク追加（HTML:2434-2442）
  const addMiniTask = () => {
    const t = (store.getState().edNewTitle || '').trim();
    const pid = store.getState().editorPlan;
    if (!t || !pid) return;
    const z = store.getState().edNewSize || 'M';
    const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 999);
    // 選択中のサイズはリセットしない=同じサイズのまま連続追加できる
    store.setState((s) => ({
      segs: s.segs.concat([
        { id, plan: pid, title: t, size: z, min: SIZE_MIN[z], day: '', done: false },
      ]),
      edNewTitle: '',
    }));
    store.showToast('ミニタスクを追加しました(' + z + '·' + SIZE_MIN[z] + '分 · 未配分)');
    setTimeout(() => {
      const el = document.getElementById('ed-new');
      if (el) el.focus();
    }, 0);
  };

  // ── ミニタスクの ↑↓（HTML:3915-3936）。日付の枠は保持したまま中身だけ入れ替える
  const moveMiniBy = (segId: string, step: number) => {
    const mine0 = store.getState().segs.filter((x) => x.plan === edPid);
    const fromIndex = mine0.findIndex((x) => x.id === segId);
    const toIndex = fromIndex + step;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= mine0.length) return;
    const idsNew = mine0.map((x) => x.id);
    const movedId = idsNew.splice(fromIndex, 1)[0];
    idsNew.splice(toIndex, 0, movedId);
    const daysList = mine0.map((x) => x.day);
    snapFlip();
    store.setState((s) => {
      const mine = s.segs.filter((x) => x.plan === edPid);
      const others = s.segs.filter((x) => x.plan !== edPid);
      const byId: Record<string, Seg> = {};
      mine.forEach((x) => {
        byId[x.id] = x;
      });
      return {
        segs: others.concat(
          idsNew.map((id2, i) => Object.assign({}, byId[id2], { day: daysList[i] }))
        ),
      };
    });
  };

  const edSubjectOptions = Object.keys(subjColors);

  return (
    <div
      onClick={closeEditor}
      style={{
        position: 'fixed',
        inset: 0,
        background: edOverlayBg,
        zIndex: 45,
        animation: 'fadeIn .15s ease',
        pointerEvents: edOverlayPointer,
      }}
    >
      {edCollapsed ? (
        <div
          onClick={stopProp}
          style={{
            pointerEvents: 'auto',
            position: 'absolute',
            right: 0,
            top: '88px',
            width: '54px',
            padding: '10px 7px',
            background: 'var(--bg1)',
            border: '1px solid var(--line2)',
            borderRight: 0,
            borderRadius: 'var(--rad) 0 0 var(--rad)',
            boxShadow: '-8px 8px 28px rgba(0,0,0,.28)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '9px',
          }}
        >
          <span
            style={{ width: '8px', height: '8px', borderRadius: 'var(--rad-s)', background: edC }}
          ></span>
          <button
            onClick={expandEditor}
            aria-label="計画編集パネルを開く"
            title="計画編集パネルを開く"
            style={{
              width: '36px',
              height: '36px',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--rad-s)',
              background: 'var(--bg2)',
              color: 'var(--tx0)',
              cursor: 'pointer',
              fontSize: '16px',
            }}
          >
            ‹
          </button>
          <span
            style={{
              writingMode: 'vertical-rl',
              font: "700 10px var(--f-ui)",
              color: 'var(--tx2)',
              maxHeight: '150px',
              overflow: 'hidden',
            }}
          >
            {edName}
          </span>
        </div>
      ) : null}
      {!edCollapsed ? (
        <div
          onClick={stopProp}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: edW,
            maxWidth: '94vw',
            background: 'var(--bg1)',
            borderLeft: '1px solid var(--line2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '18px',
            animation: 'slideInR .2s ease',
            boxShadow: '-12px 0 40px rgba(5,10,25,.45)',
          }}
        >
          <div
            onMouseDown={edResize}
            style={{
              position: 'absolute',
              left: '-3px',
              top: 0,
              bottom: 0,
              width: '7px',
              cursor: 'ew-resize',
              zIndex: 5,
            }}
          ></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: 'var(--rad-s)',
                background: edC,
                flex: 'none',
                boxShadow: '0 0 8px ' + edC,
              }}
            ></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "700 14px var(--f-ui)", color: 'var(--tx0)' }}>{edName}</div>
              <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>{edMeta}</div>
            </div>
            <button
              onClick={collapseEditor}
              title="横にしまう"
              style={{
                padding: '5px 9px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg2)',
                color: 'var(--tx2)',
                cursor: 'pointer',
                font: "700 10px var(--f-ui)",
                flex: 'none',
              }}
            >
              しまう ›
            </button>
            <button
              onClick={closeEditor}
              style={{
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              background: 'var(--bg2)',
              borderRadius: 'var(--rad)',
              padding: '12px 14px',
            }}
          >
            <div style={{ position: 'relative', width: '64px', height: '64px', flex: 'none' }}>
              <svg width="64" height="64" viewBox="0 0 68 68">
                <circle
                  cx="34"
                  cy="34"
                  r="29"
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="6"
                ></circle>
                <circle
                  cx="34"
                  cy="34"
                  r="29"
                  fill="none"
                  stroke={edC}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={edDash + ' 182'}
                  transform="rotate(-90 34 34)"
                  style={{ transition: 'stroke-dasharray .5s ease' }}
                ></circle>
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ font: "700 16px var(--f-num)", color: 'var(--tx0)' }}>
                  {edPct}
                  <span style={{ fontSize: '10px' }}>%</span>
                </span>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--tx2)', lineHeight: 1.6 }}>
              ミニタスク <b style={{ color: 'var(--tx0)' }}>{doneN}</b> / {list.length} 完了
              <br />
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
                未完了ぶん 約{remain}分
              </span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '9px',
              background: 'var(--bg2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--rad)',
              padding: '12px',
            }}
          >
            <div style={{ fontSize: '10px', color: 'var(--tx3)' }}>計画を編集</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['test', 'prep'] as const).map((id) => {
                const active = S.edPlanType === id;
                return (
                  <button
                    key={id}
                    onClick={() => store.setState({ edPlanType: id })}
                    style={{
                      flex: 1,
                      padding: '7px',
                      border: '1px solid ' + (active ? 'var(--vio)' : 'var(--line2)'),
                      borderRadius: 'var(--rad-s)',
                      background: active ? 'var(--vio)' : 'var(--bg1)',
                      color: active ? 'var(--onAcc)' : 'var(--tx2)',
                      font: "700 11.5px var(--f-ui)",
                      cursor: 'pointer',
                    }}
                  >
                    {id === 'test' ? 'テスト' : '予習'}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) minmax(138px,.75fr)',
                gap: '8px',
              }}
            >
              <input
                className="fc-acc"
                value={S.edPlanName}
                onChange={(e) => store.setState({ edPlanName: e.target.value })}
                placeholder="テスト・予習名"
                style={{
                  minWidth: 0,
                  padding: '8px 10px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg1)',
                  color: 'var(--tx0)',
                  font: "500 12px var(--f-ui)",
                  outline: 'none',
                }}
              />
              <input
                className="fc-acc"
                type="date"
                value={S.edPlanDue}
                onChange={(e) => store.setState({ edPlanDue: e.target.value })}
                style={{
                  minWidth: 0,
                  padding: '8px 10px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg1)',
                  color: 'var(--tx0)',
                  font: "500 12px var(--f-num)",
                  outline: 'none',
                  colorScheme: light ? 'light' : 'dark',
                }}
              />
            </div>
            <input
              className="fc-acc"
              list="ed-subjects"
              value={S.edPlanSubj}
              onChange={(e) => store.setState({ edPlanSubj: e.target.value })}
              placeholder="教科"
              style={{
                padding: '8px 10px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg1)',
                color: 'var(--tx0)',
                font: "500 12px var(--f-ui)",
                outline: 'none',
              }}
            />
            <datalist id="ed-subjects">
              {edSubjectOptions.map((name) => (
                <option key={name} value={name}></option>
              ))}
            </datalist>
            <input
              className="fc-acc"
              value={S.edPlanRange}
              onChange={(e) => store.setState({ edPlanRange: e.target.value })}
              placeholder="範囲・メモ"
              style={{
                padding: '8px 10px',
                border: '1px solid var(--line2)',
                borderRadius: 'var(--rad-s)',
                background: 'var(--bg1)',
                color: 'var(--tx0)',
                font: "500 12px var(--f-ui)",
                outline: 'none',
              }}
            />
            <button
              onClick={savePlanEdit}
              style={{
                padding: '9px',
                border: 'none',
                borderRadius: 'var(--rad-s)',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 12px var(--f-ui)",
                cursor: 'pointer',
              }}
            >
              変更を保存
            </button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>
            ≡
            ハンドルを持って移動し、挿入線でドロップ位置を確認できます(日付の枠は保持) ·
            サイズはクリックで切替 · 名前はダブルタップで編集
          </div>
          <div
            ref={flipRoot}
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {list.map((m) => {
              const dragging = S.dragMini === m.id;
              const dragOver = S.dragMiniOver === m.id;
              const editing = S.editMiniName === m.id;
              const onDragEnd = () => store.setState({ dragMini: null, dragMiniOver: null });
              return (
                <div
                  key={m.id}
                  className="mini-editor-row"
                  data-flipid={'ed-' + m.id}
                  onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    const from = store.getState().dragMini;
                    if (!from || from === m.id) return;
                    const rect = e.currentTarget.getBoundingClientRect
                      ? e.currentTarget.getBoundingClientRect()
                      : null;
                    const pos = rect && e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                    if (
                      store.getState().dragMiniOver !== m.id ||
                      store.getState().dragMiniPos !== pos
                    )
                      store.setState({ dragMiniOver: m.id, dragMiniPos: pos });
                    try {
                      e.dataTransfer.dropEffect = 'move';
                    } catch {
                      /* レガシーも握りつぶす */
                    }
                  }}
                  onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    const from = store.getState().dragMini;
                    if (!from || from === m.id) {
                      store.setState({ dragMini: null, dragMiniOver: null });
                      return;
                    }
                    const mine0 = store.getState().segs.filter((x) => x.plan === edPid);
                    const idsNew = mine0.map((x) => x.id);
                    const fi = idsNew.indexOf(from);
                    const targetIndex = idsNew.indexOf(m.id);
                    if (fi < 0 || targetIndex < 0) {
                      store.setState({ dragMini: null, dragMiniOver: null });
                      return;
                    }
                    idsNew.splice(fi, 1);
                    let insertIndex =
                      idsNew.indexOf(m.id) + (store.getState().dragMiniPos === 'after' ? 1 : 0);
                    insertIndex = Math.max(0, Math.min(idsNew.length, insertIndex));
                    idsNew.splice(insertIndex, 0, from);
                    const daysList = mine0.map((x) => x.day);
                    store.setState((s) => {
                      const mine = s.segs.filter((x) => x.plan === edPid);
                      const others = s.segs.filter((x) => x.plan !== edPid);
                      const byId: Record<string, Seg> = {};
                      mine.forEach((x) => {
                        byId[x.id] = x;
                      });
                      const re = idsNew.map((id2, i) =>
                        Object.assign({}, byId[id2], { day: daysList[i] })
                      );
                      return { segs: others.concat(re), dragMini: null, dragMiniOver: null };
                    });
                    store.showToast('ミニタスクの順番を変更しました');
                  }}
                  onDragLeave={(e: ReactDragEvent<HTMLDivElement>) => {
                    if (
                      e.currentTarget &&
                      e.relatedTarget &&
                      e.currentTarget.contains(e.relatedTarget as Node)
                    )
                      return;
                    if (store.getState().dragMiniOver === m.id)
                      store.setState({ dragMiniOver: null });
                  }}
                  onDragEnd={onDragEnd}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    background: dragging ? 'var(--bg3)' : 'var(--bg2)',
                    // shorthand + longhand の混在を避けて辺ごとに書く（計算値は同一）
                    borderTop: '1px solid ' + (dragging ? 'var(--acc)' : 'var(--line)'),
                    borderRight: '1px solid ' + (dragging ? 'var(--acc)' : 'var(--line)'),
                    borderBottom: '1px solid ' + (dragging ? 'var(--acc)' : 'var(--line)'),
                    borderLeft: '3px solid ' + edC,
                    borderRadius: 'var(--rad-s)',
                    transform: dragging ? 'scale(1.02)' : 'none',
                    boxShadow: dragging
                      ? '0 10px 26px rgba(0,0,0,.45)'
                      : dragOver
                        ? S.dragMiniPos === 'after'
                          ? 'inset 0 -3px 0 var(--acc)'
                          : 'inset 0 3px 0 var(--acc)'
                        : 'none',
                    opacity: dragging ? 0.85 : m.done ? 0.6 : 1,
                    transition: 'box-shadow .12s ease,opacity .12s ease',
                  }}
                >
                  <span
                    className="mini-drag-handle"
                    draggable
                    onDragStart={(e: ReactDragEvent<HTMLSpanElement>) => {
                      store.setState({ dragMini: m.id, dragMiniOver: null, dragMiniPos: 'before' });
                      try {
                        e.dataTransfer.setData('text/plain', m.id);
                        e.dataTransfer.effectAllowed = 'move';
                      } catch {
                        /* レガシーも握りつぶす */
                      }
                    }}
                    onDragEnd={onDragEnd}
                    title="ドラッグして並び替え"
                    style={{
                      padding: '4px',
                      color: 'var(--tx3)',
                      fontSize: '13px',
                      cursor: 'grab',
                      flex: 'none',
                      touchAction: 'none',
                    }}
                  >
                    ≡
                  </span>
                  <div
                    data-nodrag="1"
                    onClick={() => mutSeg(store, m.id, (x) => ((x.done = !x.done), x))}
                    style={{
                      width: '16px',
                      height: '16px',
                      flex: 'none',
                      border: '1.5px solid ' + (m.done ? 'var(--acc)' : 'var(--line2)'),
                      borderRadius: 'var(--rad-s)',
                      background: m.done ? 'var(--acc)' : 'transparent',
                      color: 'var(--onAcc)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {m.done ? '✓' : ''}
                  </div>
                  {!editing ? (
                    <div
                      className="mini-title"
                      data-nodrag="1"
                      onDoubleClick={() => {
                        store.setState({ editMiniName: m.id });
                        focusEl('mini-name-' + m.id);
                      }}
                      onTouchEnd={(e: ReactTouchEvent<HTMLDivElement>) => {
                        const now2 = Date.now();
                        const last = miniTap.current && miniTap.current.id === m.id ? miniTap.current.t : 0;
                        miniTap.current = { id: m.id, t: now2 };
                        if (now2 - last < 360) {
                          if (e && e.preventDefault) e.preventDefault();
                          store.setState({ editMiniName: m.id });
                          focusEl('mini-name-' + m.id);
                        }
                      }}
                      title="ダブルタップで編集"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: 'var(--tx0)',
                        font: "500 12.5px var(--f-ui)",
                        textDecoration: m.done ? 'line-through' : 'none',
                        padding: '2px 0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'text',
                      }}
                    >
                      {m.title}
                    </div>
                  ) : null}
                  {editing ? (
                    <input
                      className="mini-title fc-acc-underline"
                      id={'mini-name-' + m.id}
                      data-nodrag="1"
                      value={m.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        mutSeg(store, m.id, (x) => ((x.title = v), x));
                      }}
                      onBlur={() =>
                        store.setState((s) => (s.editMiniName === m.id ? { editMiniName: null } : null))
                      }
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          if (e.preventDefault) e.preventDefault();
                          store.setState({ editMiniName: null });
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--tx0)',
                        font: "500 12.5px var(--f-ui)",
                        textDecoration: m.done ? 'line-through' : 'none',
                        padding: '2px 0',
                        borderBottom: '1px dashed var(--acc)',
                      }}
                    />
                  ) : null}
                  <span
                    className="mini-day-label"
                    style={{
                      fontSize: '10px',
                      color: 'var(--tx3)',
                      flex: 'none',
                      fontFamily: "var(--f-num)",
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {dayLabel(ctx, m.day)}
                  </span>
                  <input
                    className="mini-day-mobile"
                    data-nodrag="1"
                    type="date"
                    value={m.day || ''}
                    min={T}
                    max={isoShift(pl.due, -1)}
                    onChange={(e) => {
                      const nextDay = e.target.value;
                      if (!nextDay || nextDay >= pl.due) {
                        store.showToast('タスクはGOALの前日までに設定してください');
                        return;
                      }
                      const oldDay = m.day;
                      mutSeg(store, m.id, (x) => ((x.day = nextDay), (x.manualDay = true), x));
                      if (oldDay === T && nextDay !== T)
                        store.setState((s) => ({ order: s.order.filter((id) => id !== m.id) }));
                      if (nextDay === T) addToOrder(store, m.id);
                      store.showToast(
                        '「' + m.title + '」を' + dayLabel(ctx, nextDay) + 'へ移動しました'
                      );
                    }}
                    aria-label={m.title + 'の日付'}
                  />
                  <button
                    className="mini-size"
                    data-nodrag="1"
                    onClick={() =>
                      mutSeg(
                        store,
                        m.id,
                        (x) => ((x.size = NEXT_SIZE[x.size] || 'M'), (x.min = SIZE_MIN[x.size]), x)
                      )
                    }
                    style={{
                      font: "700 10px var(--f-num)",
                      color: edC,
                      background: 'var(--bg3)',
                      border: '1px solid var(--line2)',
                      borderRadius: 'var(--rad-s)',
                      padding: '2px 7px',
                      cursor: 'pointer',
                      flex: 'none',
                    }}
                  >
                    {m.size + '·' + m.min + '分'}
                  </button>
                  <button
                    className="mini-delete hv-pink-text"
                    data-nodrag="1"
                    onClick={() => {
                      store.setState((s) => ({
                        segs: s.segs.filter((x) => x.id !== m.id),
                        order: s.order.filter((o) => o !== m.id),
                      }));
                      store.showToast('「' + m.title + '」を削除しました');
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      border: 'none',
                      borderRadius: 'var(--rad-s)',
                      background: 'none',
                      color: 'var(--tx3)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      flex: 'none',
                    }}
                  >
                    ✕
                  </button>
                  <span className="mini-mobile-actions" data-nodrag="1">
                    <button onClick={() => moveMiniBy(m.id, -1)} aria-label="上へ移動">
                      ↑
                    </button>
                    <button onClick={() => moveMiniBy(m.id, 1)} aria-label="下へ移動">
                      ↓
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SIZE_KEYS.map((z) => {
                const active = S.edNewSize === z;
                return (
                  <span
                    key={z}
                    onClick={() => {
                      store.setState({ edNewSize: z });
                      focusEl('ed-new');
                    }}
                    style={{
                      font: "700 11px var(--f-num)",
                      color: active ? 'var(--onAcc)' : 'var(--tx2)',
                      background: active ? 'var(--acc)' : 'var(--bg2)',
                      border: '1px solid ' + (active ? 'var(--acc)' : 'var(--line2)'),
                      borderRadius: 'var(--rad-s)',
                      padding: '5px 11px',
                      cursor: 'pointer',
                    }}
                  >
                    {z + '·' + SIZE_MIN[z] + '分'}
                  </span>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="fc-acc"
                id="ed-new"
                value={S.edNewTitle}
                onChange={(e) => store.setState({ edNewTitle: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMiniTask();
                }}
                placeholder="ミニタスクを追加… (Enterで連続追加)"
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  border: '1px solid var(--line2)',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--bg2)',
                  color: 'var(--tx0)',
                  font: "500 12.5px var(--f-ui)",
                  outline: 'none',
                }}
              />
              <button
                onClick={addMiniTask}
                style={{
                  padding: '9px 16px',
                  border: 'none',
                  borderRadius: 'var(--rad-s)',
                  background: 'var(--grad)',
                  color: 'var(--onAcc)',
                  font: "700 12px var(--f-ui)",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flex: 'none',
                }}
              >
                ＋ 追加
              </button>
            </div>
          </div>
          <div style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>
            選んだサイズ(XS/S/M/L)のまま連続で追加できます。新しいミニタスクは「未配分」になります。日付の割り振りは再配分でできます。
          </div>
          {/* C-410: `style-hover` の値に `{{ }}` が入り CSS として無効だったので hover 効果は付けない */}
          <button
            onClick={deletePlan}
            style={cssVars({
              padding: '9px',
              border:
                '1px solid ' +
                (completedPlan ? 'color-mix(in srgb,var(--grn) 55%,var(--line2))' : 'var(--line2)'),
              borderRadius: 'var(--rad-s)',
              background: 'none',
              color: completedPlan ? 'var(--grn)' : 'var(--tx3)',
              font: "600 11.5px var(--f-ui)",
              cursor: 'pointer',
            })}
          >
            {completedPlan ? '完了として非表示にする' : 'この計画を削除'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
