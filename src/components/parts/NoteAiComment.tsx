'use client';

/**
 * Compass — AI の添削を「JavaScript の行コメント」として出す（ux-refresh.md §8）
 *
 * ```tsx
 * <NoteAiComment src={section.ai} mark={markOptions} />
 * ```
 *
 * v0.16 まではここが `.nb-aiedit`（淡い紫地 + 左罫の引用ブロック）だった。
 * 面を持つぶん**主役の本文より強く**、紙面の順位が逆さまになっていたので、
 * 面をやめて `// …` の行コメントに置き換えた（比喩を変えた理由は
 * `lib/logic/noteAiComment.ts` の冒頭）。
 *
 * 紙面の約束（`NoteView.tsx` 冒頭の 3 つ）はそのまま守る:
 *  - **読む前に著者が分かる**。自分の手書きは `--f-hand`、ここは**等幅 + `//`**。
 *    書体が変わるだけで「地の文ではない」が伝わるので、`AI` の表札は小さく畳んだ。
 *  - **影は落とさない**。紙に書き込まれた赤入れであって、上に載った面ではない。
 *  - **色は 1 つだけ**。地は灰（`--tx2`）、重要な行・語にだけ `--nb-ai-ink` が乗る。
 *
 * `//` は `::before` ではなく**本物の文字**として置いてある。コードのメモらしさは
 * 「選んでコピーすると `//` も付いてくる」ところまで含めての比喩なので、
 * 疑似要素で描くと剥がれてしまう。読み上げには要らないので `aria-hidden` を付ける。
 */

import { useMemo, type CSSProperties } from 'react';
import { parseNoteAiComment, shouldUseNoteAiBlockComment } from '../../lib/logic/noteAiComment';
import { NoteMathInline, type NoteMarkOptions } from './NoteMath';

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/**
 * stagger の頭打ち。添削は 2〜3 行の想定だが、AI が長く返す回もある。
 * 全行に遅延を配ると最後の行が目に見えて遅れて「重い」に化けるし、
 * 人が順番として読めるのは先頭の数行だけなので、そこまでで打ち切る
 * （`NotebookTree` の行と同じ考え方）。
 */
const STAGGER_LAST = 5;

export interface NoteAiCommentProps {
  /** `NoteSection.ai`。空なら何も描かない（`null` を返す） */
  src: string | null | undefined;
  /** 重要語の色付け・確認モードの付箋。`NoteMath` にそのまま渡す */
  mark?: NoteMarkOptions;
  /** 呼ぶ側が足したいクラス（レンズで畳むときの目印など） */
  className?: string;
}

export function NoteAiComment({ src, mark, className }: NoteAiCommentProps) {
  // 割り方は `src` だけで決まる（確認モードの切り替えで組み直さない）
  const blocks = useMemo(() => parseNoteAiComment(src), [src]);
  if (!blocks.length) return null;
  const blockComment = shouldUseNoteAiBlockComment(src, blocks);

  return (
    <aside
      className={'nb-aic' + (blockComment ? ' nb-aic--block' : '') + (className ? ' ' + className : '')}
      aria-label="AI の添削"
    >
      <span className="nb-aic__chip" title="AI が足した添削・補足">
        AI
      </span>
      {blockComment ? (
        <p className="nb-aic__line nb-aic__fence" aria-hidden="true">
          /*
        </p>
      ) : null}
      {blocks.map((b, i) => {
        const style = cssVars({ '--i': Math.min(i, STAGGER_LAST) });
        // 空行は `//` だけの行。コードのコメント塊の中の空行と同じ見え方にする。
        // 読み上げには何も無いので、丸ごと隠す（「スラッシュ」を 1 回余計に読ませない）
        if (b.kind === 'gap') {
          return (
            <p key={i} className="nb-aic__line nb-aic__line--gap" style={style} aria-hidden="true">
              <span className="nb-aic__slash">{blockComment ? '' : '//'}</span>
            </p>
          );
        }
        return (
          <p key={i} className={'nb-aic__line nb-aic__line--' + b.tone} style={style}>
            <span className="nb-aic__slash" aria-hidden="true">
              {blockComment ? '' : '//'}
            </span>
            <span className="nb-aic__body">
              {b.spans.map((s, j) => (
                // 断片ごとに `NoteMathInline` を通す。数式も重要語も、行のどこに
                // あっても同じ規則で描かれる（`$…$` はパーサが素通しにしてある）。
                // 承知の上の割り切り: `**共有**結合` のように強調が語の途中で切れると、
                // 重要語「共有結合」は断片をまたぐので色が付かない。添削に語の途中で
                // `**` を打つことは無いので、これを直すために HTML を跨いだ照合はしない。
                <NoteMathInline
                  key={j}
                  className={'nb-aic__t nb-aic__t--' + s.tone}
                  src={s.text}
                  mark={mark}
                />
              ))}
            </span>
          </p>
        );
      })}
      {blockComment ? (
        <p className="nb-aic__line nb-aic__fence nb-aic__fence--end" aria-hidden="true">
          */
        </p>
      ) : null}
    </aside>
  );
}
