'use client';

/**
 * Compass — 潜っている教科のパンくず（docs/notebook/ux-refresh.md §2）
 *
 * 教科をダブルクリックして中へ潜っているあいだだけ、一覧の上に 1 行出る。
 * 「‹ ノート ＞ 数学 · 12件」。押すと上（すべての教科）へ戻る。
 *
 * この行の役割は道案内より**出口**のほう。潜ると他の教科が画面から消えるので、
 * 戻り方が画面の中に見えていないと閉じ込められたように感じる ―― だから
 * `NotebookTree` は、その教科のノートが 0 件でもこの行だけは出し続ける。
 *
 * 戻る手は 3 つ用意してある。左の `‹`（Finder の戻る）、「ノート」の字、
 * そして ⌘↑（画面全体のキー処理が持つ。`CompassApp`）。どれも同じ 1 段上へ。
 *
 * 潜っているかどうかは `state.nbFolder` を自分で見るので、置くだけで動く。
 * 段の組み立ては `lib/logic/noteFolder.ts` の `noteCrumbs()`（潜っていなければ空）。
 */

import { useMemo, type CSSProperties } from 'react';
import { folderUp, noteCrumbs } from '../../lib/logic/noteFolder';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

/** CSS 変数を style に混ぜるための型合わせ（他の画面と同じ書き方） */
const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export interface NotebookCrumbsProps {
  /** いま一覧に出ているノート（検索・絞り込みのあと）。件数はここから数える */
  notes: readonly Note[];
}

export function NotebookCrumbs({ notes }: NotebookCrumbsProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  const folder = S.nbFolder;
  const crumbs = useMemo(() => noteCrumbs(notes, folder), [notes, folder]);

  // 潜っていなければ何も出さない（`noteCrumbs` が空を返す）
  if (!crumbs.length) return null;

  /** いまいる段。件数はここのぶんを出す（親の段の件数は出さない ―― 数字が 2 つ並ぶと読めない） */
  const here = crumbs[crumbs.length - 1];
  /** 見出し（`.nbt-head__name`）と同じ教科色を使い、潜る前後で名前の色を変えない */
  const color = subjectColorFor(subjColors, folder || '');
  const go = (next: string | null) => store.setState({ nbFolder: next });

  return (
    <nav
      className="nbf-crumbs"
      aria-label="ノートの階層"
      style={cssVars({ '--nbf-c': color.c })}
    >
      <button
        type="button"
        className="nbf-crumbs__up"
        onClick={() => go(folderUp(folder))}
        /* 字は「‹」だけなので、読み上げ用の名前を別に付ける */
        aria-label="1つ上へ戻る"
        title="1つ上へ (⌘↑)"
      >
        ‹
      </button>
      {/* パンくずは順序のある並び。ol にしておくと支援技術が「2 段のうち 2 つめ」と読める */}
      <ol className="nbf-crumbs__list">
        {crumbs.map((c, i) => (
          <li className="nbf-crumbs__item" key={c.folder || '*'}>
            {i ? (
              <span className="nbf-crumbs__sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            {c.current ? (
              /* いまいる段は押しても動かないのでボタンにしない（空振りする的を置かない） */
              <span className="nbf-crumbs__here" aria-current="page">
                {c.label}
              </span>
            ) : (
              <button
                type="button"
                className="nbf-crumbs__link"
                onClick={() => go(c.folder)}
                title="すべての教科を表示"
              >
                {c.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      <span className="nbf-crumbs__count">{here.count + '件'}</span>
    </nav>
  );
}
