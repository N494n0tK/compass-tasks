'use client';

/**
 * Compass — 元のノートの写真（docs/notebook/spec.md §8.3）
 *
 * 1 授業ぶんの見開きを 1 枚ずつ、机の上に置いた紙として見せる。
 *
 * **紙面での立ち位置が変わった**: 以前はこの写真が主役だったが、いまは
 * 本文（`Note.sections` = 手書きノートの書き起こし）が主役で、写真はその**原本**。
 * NoteView 側で `<details>`（`.nb-scanfold`）に畳まれ、既定では閉じている。
 * ここは開かれたときの中身だけを受け持つ ―― 見せ方は変わっても、
 * 「1 枚ずつ大きく / 影を落とす / 拡大は同じ画面に重ねる」は据え置き。
 *
 * 決めたこと:
 *  - **1 枚ずつ大きく**。サムネイルを並べると「資料」になってしまい、読むものにならない。
 *    枚数は下のページ送りで示す（`p.1 / 3`）。
 *  - 紙には影を落とし、AI の文章には落とさない。**紙が上に載っている**ことを影の有無で示す。
 *  - 読み込み前も `w / h` から縦横比を確保しておく（紙面が飛び跳ねない）。
 *  - 拡大は同じ画面の上に重ねる（別画面に飛ばさない）。復習の途中で紙を持ち上げる感覚。
 *
 * 画像の実体は IndexedDB（`NoteScanStore`）。ここは URL を引いて描くだけ。
 */

import { useEffect, useRef, useState } from 'react';
import {
  NOTE_SCAN_MAX,
  type Note,
  type NoteScan,
} from '../../lib/model/notes';
import {
  deleteScanBlob,
  newScanId,
  objectUrl,
  prepareScan,
  putScanBlob,
} from './NoteScanStore';
import { store } from '../useStore';

export interface NoteScanStripProps {
  note: Note;
  edit: boolean;
  /** 何枚目を開いているか（`state.nbScanIx`） */
  index: number;
  onIndex: (i: number) => void;
  /** 拡大表示中の scanId（`state.nbScanZoom`） */
  zoom: string | null;
  onZoom: (scanId: string | null) => void;
  onPatch: (fn: (draft: Note) => void) => void;
}

export function NoteScanStrip({
  note,
  edit,
  index,
  onIndex,
  zoom,
  onZoom,
  onPatch,
}: NoteScanStripProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const total = note.scans.length;
  const at = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const scan = note.scans[at] || null;

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const room = NOTE_SCAN_MAX - note.scans.length;
    if (room <= 0) {
      store.showToast('写真は' + NOTE_SCAN_MAX + '枚までです');
      return;
    }
    const picked = Array.from(files).slice(0, room);
    setBusy(true);
    const added: NoteScan[] = [];
    for (let i = 0; i < picked.length; i += 1) {
      try {
        const prepared = await prepareScan(picked[i]);
        const scanId = newScanId(note.scans.length + i);
        await putScanBlob(note.id, scanId, prepared.blob);
        added.push({
          scanId,
          mime: prepared.mime,
          w: prepared.w,
          h: prepared.h,
          bytes: prepared.blob.size,
          caption: '',
        });
      } catch (e) {
        store.showToast(e instanceof Error ? e.message : '写真を追加できませんでした');
      }
    }
    setBusy(false);
    if (!added.length) return;
    onPatch((d) => void d.scans.push(...added));
    onIndex(note.scans.length); // 追加した最初の 1 枚を開く
    store.showToast(added.length + '枚のノートを追加しました');
    if (files.length > picked.length) {
      store.showToast('写真は' + NOTE_SCAN_MAX + '枚までなので' + picked.length + '枚だけ入れました');
    }
  };

  const removeAt = (i: number) => {
    const target = note.scans[i];
    if (!target) return;
    if (!window.confirm('この写真を削除しますか？（元に戻せません）')) return;
    void deleteScanBlob(note.id, target.scanId).catch(() => {
      /* メタデータは消す。実体が残っても参照されない */
    });
    onPatch((d) => void d.scans.splice(i, 1));
    onIndex(Math.max(0, i - 1));
  };

  // ── まだ 1 枚も無いとき。ここが「このノートは何か」を最初に言う場所
  if (!total) {
    return (
      <section className="nb-scan-empty">
        <div className="nb-scan-empty__title">元のノートを貼る</div>
        <div className="nb-scan-empty__text">
          授業で書いたノートを撮って、ここに置きます。
          <br />
          上の本文はこの写真を書き起こしたもの。見比べたいときのための原本です。
        </div>
        <button className="nb-btn nb-btn--solid" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? '取り込み中…' : '写真を選ぶ'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </section>
    );
  }

  return (
    <section className="nb-scan">
      <div className="nb-scan__head">
        <span className="nb-scan__label">自分のノート</span>
        {edit ? (
          <input
            className="nb-scan__caption-input"
            value={scan ? scan.caption : ''}
            onChange={(e) => onPatch((d) => void (d.scans[at].caption = e.target.value))}
            placeholder="見出し（任意）"
          />
        ) : scan && scan.caption ? (
          <span className="nb-scan__caption">{scan.caption}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {edit ? (
          <>
            <button className="nb-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? '取り込み中…' : '＋ 写真'}
            </button>
            <button className="nb-btn nb-btn--danger" onClick={() => removeAt(at)}>
              この写真を削除
            </button>
          </>
        ) : null}
      </div>

      {scan ? (
        <>
          <ScanImage noteId={note.id} scan={scan} onOpen={() => onZoom(scan.scanId)} />
          <span className="nb-scan__hint">クリックで全体を拡大</span>
        </>
      ) : null}

      {total > 1 ? (
        <div className="nb-scan__pager">
          <button
            className="nb-btn"
            onClick={() => onIndex(at - 1)}
            disabled={at <= 0}
            aria-label="前の写真"
          >
            ←
          </button>
          <div className="nb-scan__dots" role="tablist" aria-label="ノートの写真">
            {note.scans.map((s, i) => (
              <button
                key={s.scanId}
                className={'nb-scan__dot' + (i === at ? ' is-on' : '')}
                onClick={() => onIndex(i)}
                role="tab"
                aria-selected={i === at}
                aria-label={i + 1 + '枚目'}
              />
            ))}
          </div>
          <span className="nb-scan__count">{at + 1 + ' / ' + total}</span>
          <button
            className="nb-btn"
            onClick={() => onIndex(at + 1)}
            disabled={at >= total - 1}
            aria-label="次の写真"
          >
            →
          </button>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {zoom ? (
        <ScanZoom
          noteId={note.id}
          scan={note.scans.find((s) => s.scanId === zoom) || null}
          onClose={() => onZoom(null)}
        />
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 1 枚
// ─────────────────────────────────────────────────────────────

function useScanUrl(noteId: string, scanId: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setMissing(false);
    objectUrl(noteId, scanId)
      .then((u) => {
        if (!live) return;
        if (u) setUrl(u);
        else setMissing(true);
      })
      .catch(() => {
        if (live) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [noteId, scanId]);
  return { url, missing };
}

function ScanImage({
  noteId,
  scan,
  onOpen,
}: {
  noteId: string;
  scan: NoteScan;
  onOpen: () => void;
}) {
  const { url, missing } = useScanUrl(noteId, scan.scanId);
  // 読み込み前から縦横比を確保しておく（紙面が飛び跳ねない）
  const ratio = scan.w && scan.h ? scan.w + ' / ' + scan.h : '4 / 3';

  if (missing) {
    return (
      <div className="nb-scan__paper nb-scan__paper--missing" style={{ aspectRatio: ratio }}>
        <div className="nb-scan__missing-title">この端末に写真がありません</div>
        <div className="nb-scan__missing-text">
          写真は撮った端末の中だけに保存されます。撮った端末で開くか、もう一度貼り直してください。
        </div>
      </div>
    );
  }

  return (
    <button
      className="nb-scan__paper"
      style={{ aspectRatio: ratio }}
      onClick={onOpen}
      title="クリックで拡大"
    >
      {url ? (
        // 端末内の blob URL。next/image は使えない（外部最適化に載せられない）
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={scan.caption || '自分のノートの写真'} className="nb-scan__img" />
      ) : (
        <span className="nb-scan__loading">読み込み中…</span>
      )}
    </button>
  );
}

function ScanZoom({
  noteId,
  scan,
  onClose,
}: {
  noteId: string;
  scan: NoteScan | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { url } = useScanUrl(noteId, scan ? scan.scanId : '');
  if (!scan) return null;

  return (
    <div className="nb-zoom" onClick={onClose} role="dialog" aria-label="ノートの写真を拡大">
      <div className="nb-zoom__bar">
        <span className="nb-scan__label">自分のノート</span>
        {scan.caption ? <span className="nb-scan__caption">{scan.caption}</span> : null}
        <span style={{ flex: 1 }} />
        <button className="nb-btn" onClick={onClose}>
          閉じる（Esc）
        </button>
      </div>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={scan.caption || '自分のノートの写真'}
          className="nb-zoom__img"
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </div>
  );
}
