'use client';

/**
 * Compass — ノート取り込みモーダル（docs/notebook/spec.md §8 / ワークフロー手順 2〜4）
 *
 * 「プロンプトAをコピー → プロンプトBをコピー → 出てきた JSON を貼る」の 3 ステップ。
 * 貼るだけで、検証が通れば保存し、カードぶんの復習が自動で作られる。
 *
 * `.compass-shell` の外へ出す必要があるので `ShellOverlay` で包む（spec §2.1）。
 * 検証結果はモーダル内で完結する一時値なので `useState`（`AppState` に置くほどの寿命が無い）。
 */

import { useState } from 'react';
import { parseNoteJson, type NoteImportIssue } from '../../lib/logic/noteImport';
import { commitNote } from './NotebookPersistence';
import { NOTE_PROMPTS, copyText } from './NotePrompts';
import { ShellOverlay } from './ShellOverlay';
import { dateCtx, store, useAppStore } from '../useStore';

const PANEL_LABEL = { fontSize: '11px', color: 'var(--tx3)', marginBottom: '6px' } as const;

const STEP_BADGE = {
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: 'var(--viewBg)',
  color: 'var(--view)',
  font: "700 11px 'Space Grotesk'",
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
} as const;

export function NoteImportModal() {
  const { state: S } = useAppStore();
  const [issues, setIssues] = useState<NoteImportIssue[]>([]);
  const T = dateCtx.today;

  if (!S.nbImportOpen) return null;

  const target = S.nbImportTarget ? S.notes.find((n) => n.id === S.nbImportTarget) || null : null;

  const close = () => {
    setIssues([]);
    store.setState({ nbImportOpen: false, nbImportText: '', nbImportTarget: null });
  };

  const copy = async (label: string, text: string) => {
    const ok = await copyText(text);
    store.showToast(ok ? label + 'をコピーしました' : 'コピーできませんでした(手動で選択してください)');
  };

  /** 検証 → 保存 → 復習生成。エラーが 1 件でもあれば何も保存しない（N-016 / N-063） */
  const submit = () => {
    const text = (S.nbImportText || '').trim();
    if (!text) {
      setIssues([{ path: '$', message: 'JSONを貼り付けてください' }]);
      return;
    }
    const res = parseNoteJson(text, { today: T, existing: target });
    if (!res.ok) {
      setIssues(res.errors);
      return;
    }
    setIssues([]);
    const { created, removed } = commitNote(store, res.note, T, {
      removedCardIds: res.diff?.removedCardIds,
    });
    store.setState({
      nbImportOpen: false,
      nbImportText: '',
      nbImportTarget: null,
      nbSelNoteId: res.note.id,
      nbMode: 'note',
      nbEdit: false,
      nbSubjFilter: null,
    });
    const parts = [
      '「' + res.note.unit + '」を取り込みました',
      '復習カード' + created + '件',
    ];
    if (removed) parts.push('削除' + removed + '件');
    if (res.warnings.length) parts.push('注意' + res.warnings.length + '件');
    store.showToast(parts.join(' · '));
  };

  return (
    <ShellOverlay>
      <div
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5,9,20,.66)',
          backdropFilter: 'blur(3px)',
          zIndex: 55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          animation: 'fadeIn .15s ease',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '620px',
            maxWidth: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            background: 'var(--bg1)',
            border: '1px solid var(--line2)',
            borderRadius: '16px',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'popIn .18s ease',
            boxShadow: '0 24px 80px rgba(0,0,0,.5)',
          }}
        >
          <div>
            <div style={{ font: "700 15px 'Noto Sans JP'", color: 'var(--tx0)' }}>
              {target ? 'ノートを上書き取り込み' : 'ノートを取り込む'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--tx3)', marginTop: '5px' }}>
              {target
                ? '「' + target.unit + '」を新しいJSONで置き換えます。想起問題の順番が同じなら復習の履歴は引き継がれます'
                : '授業の文字起こしとノート写真を外部AIに渡し、出てきたJSONを貼り付けてください'}
            </div>
          </div>

          {/* ステップ 1・2 — プロンプトのコピー */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {NOTE_PROMPTS.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}
              >
                <span style={STEP_BADGE}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "500 12.5px 'Noto Sans JP'", color: 'var(--tx1)' }}>
                    {p.label.replace(' をコピー', '')}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--tx3)' }}>{p.hint}</div>
                </div>
                <button
                  className="hv-acc-outline"
                  onClick={() => void copy(p.label.replace(' をコピー', ''), p.text)}
                  style={{
                    padding: '7px 12px',
                    border: '1px solid var(--line2)',
                    borderRadius: '8px',
                    background: 'none',
                    color: 'var(--tx2)',
                    font: "500 11.5px 'Noto Sans JP'",
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  コピー
                </button>
              </div>
            ))}
          </div>

          {/* ステップ 3 — JSON を貼る */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '7px' }}>
              <span style={STEP_BADGE}>3</span>
              <div style={{ font: "500 12.5px 'Noto Sans JP'", color: 'var(--tx1)' }}>
                出てきたJSONを貼り付ける
              </div>
            </div>
            <textarea
              className="fc-acc"
              value={S.nbImportText}
              onChange={(e) => {
                setIssues([]);
                store.setState({ nbImportText: e.target.value });
              }}
              placeholder={'{\n  "schema": "compass-note@1",\n  "date": "…",\n  …\n}'}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: '190px',
                resize: 'vertical',
                background: 'var(--bg2)',
                border: '1px solid var(--line2)',
                borderRadius: '10px',
                padding: '11px 12px',
                color: 'var(--tx1)',
                font: "400 12px 'Space Grotesk',ui-monospace,monospace",
                lineHeight: 1.6,
                outline: 'none',
              }}
            />
          </div>

          {/* 検証エラー（N-063） */}
          {issues.length ? (
            <div
              style={{
                background: 'var(--pinkBg)',
                border: '1px solid var(--pink)',
                borderRadius: '10px',
                padding: '11px 13px',
              }}
            >
              <div style={{ ...PANEL_LABEL, color: 'var(--pink)', fontWeight: 700 }}>
                {issues.length}件の問題があるため取り込めません
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '3px' }}>
                {issues.map((issue, i) => (
                  <li key={i} style={{ fontSize: '11.5px', color: 'var(--tx1)' }}>
                    <code style={{ color: 'var(--pink)', fontFamily: "'Space Grotesk',monospace" }}>
                      {issue.path}
                    </code>
                    {' — ' + issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={close}
              style={{
                padding: '10px 18px',
                border: '1px solid var(--line2)',
                borderRadius: '10px',
                background: 'none',
                color: 'var(--tx2)',
                font: "500 13px 'Noto Sans JP'",
                cursor: 'pointer',
              }}
            >
              キャンセル
            </button>
            <button
              onClick={submit}
              style={{
                padding: '10px 22px',
                border: 'none',
                borderRadius: '10px',
                background: 'var(--grad)',
                color: 'var(--onAcc)',
                font: "700 13px 'Noto Sans JP'",
                cursor: 'pointer',
              }}
            >
              {target ? '上書きして取り込む' : '検証して取り込む'}
            </button>
          </div>
        </div>
      </div>
    </ShellOverlay>
  );
}
