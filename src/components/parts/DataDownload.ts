'use client';

/**
 * Compass — ファイル書き出しの DOM 部分（Phase 2B / TASK S5）
 *
 * 出典: HTML:2486-2499（`downloadText(filename, mime, text)`）。spec §8.7.1 / C-561。
 *
 * 「何を書き出すか」は `lib/logic/export.ts`（純関数）の担当で、ここは
 * **Blob + `a[download]` のクリック + 4 秒後の `revokeObjectURL`** だけを持つ。
 * レガシー同様 **throw せず boolean を返す**（呼び出し側がトーストを出し分ける）。
 */

export function downloadText(filename: string, mime: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}
