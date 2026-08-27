'use client';

/**
 * Compass — サイドバーの教科フォルダ（docs/notebook/ux-refresh.md §1・§2）
 *
 * `NotebookSidebar` の中にあった教科ツリーを独立させたもの。
 * 教科ごとにノートを畳んで並べ、見出しをクリックすると開閉する。
 *
 * 開閉は「一瞬で入れ替わる」のをやめ、高さ・中身・キャレットを同時に動かして
 * 「フォルダが開いた / 閉じた」が体で分かるようにしてある（見た目は app/nb-tree.css）。
 * そのため、閉じている中身も DOM には残す ―― 消してしまうと高さの補間相手が
 * いなくなって、結局ぱちんと畳まれるだけになる。
 *
 * 教科の見出しを**ダブルクリックすると、その教科の中へ潜る**（§2）。潜っている
 * あいだは見出しごと他の教科が消え、その教科のノートだけが平らに並ぶ ―― Finder で
 * フォルダをダブルクリックして中へ入るのと同じ。どこにいるかと戻り方は上に出る
 * `NotebookCrumbs` が受け持ち、潜り先の決めごとは `lib/logic/noteFolder.ts` に集めてある。
 */

import { useEffect, useId, useMemo, type CSSProperties } from 'react';
import {
  folderEnterPatch,
  folderGroups,
  resolveFolder,
} from '../../lib/logic/noteFolder';
import { subjectColorFor } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import { NoteRow } from './NoteRow';
import { NotebookCrumbs } from './NotebookCrumbs';
import { useSubjColors } from './ShellSubjects';
import { store, useAppStore } from '../useStore';

/** CSS 変数を style に混ぜるための型合わせ（他の画面と同じ書き方） */
const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/**
 * 出現をずらす行数の上限（0 起点なので先頭 6 行）。
 * これより下の行は 6 行目と同じ遅延で出す ―― 20 件ある教科で最後の行まで
 * 順番に待たせると、開くのが遅くなったようにしか感じられない。
 */
const STAGGER_LAST = 5;

export interface NotebookTreeProps {
  /** 絞り込み後のノート（親から渡す） */
  notes: readonly Note[];
  /** 一覧から 1 冊選んだとき */
  onSelect: (n: Note) => void;
  /** 行を右クリックしたとき（`NoteContextMenu`） */
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
}

export function NotebookTree({ notes, onSelect, onContextMenu }: NotebookTreeProps) {
  const { state: S, plans } = useAppStore();
  const subjColors = useSubjColors(S, plans);
  /** 見出しと中身を `aria-controls` で結ぶための id 種。
   *  教科名をそのまま id にすると空白や記号で壊れるので使わない */
  const uid = useId();
  /** 潜っている教科（`null` = すべての教科を並べる） */
  const folder = S.nbFolder;

  /** 並べる段。潜っていれば「その教科ひとつだけ」に化ける（`noteFolder.ts`） */
  const groups = useMemo(() => folderGroups(notes, folder), [notes, folder]);

  /**
   * 潜り先が消えたら自動で上がる（ノートを全部ゴミ箱へ入れた・取り込み直しで教科名が
   * 変わった、など）。見るのは**絞り込む前の全ノート** `S.notes` ―― 親から渡る `notes` は
   * 検索や教科チップで細ったあとなので、それで判定すると語を打っている途中の
   * 一時的な 0 件で階層から弾き出される。
   */
  useEffect(() => {
    const next = resolveFolder(S.notes, folder);
    if (next !== folder) store.setState({ nbFolder: next });
  }, [S.notes, folder]);

  /** 開閉。ダブルクリックの 1 回目だけがここへ来る（下の `onClick` を参照） */
  const toggle = (subject: string) =>
    store.setState((s) => ({
      nbTreeOpen: { ...s.nbTreeOpen, [subject]: s.nbTreeOpen[subject] === false },
    }));

  /**
   * その教科の中へ潜る。入口は 2 つ（この見出しのダブルクリックと、行の右クリック →
   * 「この教科だけ表示」）なので、立てる state は `folderEnterPatch()` に集めてある。
   *
   * ここで開き具合を**必ず開いた側にそろえる**のには 2 つ意味がある:
   *  - 潜る直前に入った単クリック 1 回ぶんの開閉を打ち消して、結果を毎回同じにする
   *  - 上がってきたとき、さっきまで中を見ていた教科が畳まれていない（探し直しにならない）
   */
  const enter = (subject: string) =>
    store.setState((s) => ({
      ...folderEnterPatch(subject),
      nbTreeOpen: { ...s.nbTreeOpen, [subject]: true },
    }));

  // 潜っているときは `folderGroups` が 0 件でも段を返すので、ここへ来るのは
  // 「一番上にいて、出せるノートが 1 冊も無い」ときだけ
  if (!groups.length) {
    return (
      <div style={{ flex: 'none' }}>
        <div style={{ font: '400 11.5px var(--f-ui)', color: 'var(--tx3)' }}>
          まだノートがありません
        </div>
      </div>
    );
  }

  /** 潜っているときの中身。段はちょうど 1 つなので先頭を取ればよい */
  const inFolder: Note[] | null = folder ? groups[0][1] : null;

  return (
    <div style={{ flex: 'none' }}>
      {/*
        潜る / 上がるたびに `key` ごと作り直して、横方向の入れ替わりを頭から流す。
        進むときは右から、戻るときは左から入る ―― Finder や iOS の階層移動と同じ向きで、
        「奥へ入った / 手前へ戻った」が向きだけで読める（見た目は app/nb-tree.css の .nbf-stage）。
        作り直しても行の出現アニメ（.nbt-row）は走らない ―― CSS の transition は
        最初の描画では動かないので、開閉のときだけ順番に降りてくる形は保たれる。
      */}
      <div className={'nbf-stage ' + (folder ? 'is-in' : 'is-out')} key={'f:' + (folder || '')}>
        {inFolder ? (
          <>
            {/* 他の教科が消えている以上、戻り道は常に画面の中に出しておく（0 件でも出す） */}
            <NotebookCrumbs notes={notes} />
            {inFolder.length ? (
              <div className="nbf-list">
                {inFolder.map((n) => (
                  // 潜っているあいだは教科が 1 つしか無いので、行に教科名は出さない
                  // （`showSubject` は既定の false のまま）。
                  // 行ごとの stagger も付けない ―― 面ごと横に入れ替わる動きと重なると、
                  // 「何が動いているのか」が読めなくなる
                  <NoteRow
                    key={n.id}
                    note={n}
                    colors={subjColors}
                    on={n.id === S.nbSelNoteId}
                    onClick={onSelect}
                    onContextMenu={onContextMenu}
                  />
                ))}
              </div>
            ) : (
              <div className="nbf-empty">この教科に出せるノートがありません</div>
            )}
          </>
        ) : (
          <div style={{ display: 'grid', gap: '3px' }}>
            {groups.map(([subject, list], gi) => {
              const open = S.nbTreeOpen[subject] !== false; // 既定で開く
              const color = subjectColorFor(subjColors, subject);
              const bodyId = uid + gi;
              return (
                <div key={subject} className="nbt-folder">
                  <button
                    type="button"
                    className="nbt-head"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    /* ダブルクリックで潜れることは見ただけでは分からないので、
                       素の文字でも辿れるところに書いておく */
                    title={subject + ' — ダブルクリックでこの教科だけ'}
                    onClick={(e) => {
                      /**
                       * ダブルクリックは click を 2 回連れてくる（`detail` が 1 → 2）。
                       * 2 回目を捨てておけば、潜るたびにフォルダが閉じて開いてと
                       * 往復するのを防げる。1 回目ぶんの開閉は `enter()` が
                       * 「必ず開く」で打ち消すので、結果はどちらから来ても同じになる。
                       *
                       * 単クリックをタイマーで待ってから開閉する手もあるが、それだと
                       * **潜る気の無い普通のクリックまで**ダブルクリック判定のぶん
                       * 鈍る。開閉はサイドバーで一番よく押すところなので、そちらを
                       * 遅らせるほうが損が大きい。
                       */
                      if (e.detail > 1) return;
                      toggle(subject);
                    }}
                    onDoubleClick={() => enter(subject)}
                    onKeyDown={(e) => {
                      // Finder に倣って ⌘↓ で中へ入る（⌘↑ で上がるの裏返し）。
                      // 見出しにフォーカスがあるときだけの話なので要素に直接付ける ――
                      // window に足すと、ノートの画面を離れても効いてしまう
                      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
                        e.preventDefault();
                        enter(subject);
                      }
                    }}
                    style={cssVars({ '--nbt-c': color.c })}
                  >
                    <span className={'nb-caret' + (open ? ' is-open' : '')} aria-hidden="true">
                      ▸
                    </span>
                    <span className="nbt-head__name">{subject}</span>
                    <span className="nbt-head__count">{list.length + '件'}</span>
                  </button>
                  {/* 閉じているあいだも中身は残る。見えなくする役目は CSS の
                      visibility（タブ順からも外れる）と aria-hidden で分担する */}
                  <div className={'nbt-wrap' + (open ? ' is-open' : '')}>
                    <div className="nbt-wrap__inner" id={bodyId} aria-hidden={!open}>
                      <div className="nbt-list">
                        {list.map((n, i) => (
                          // NoteRow は #3 の持ち物で className を受け取らないので、
                          // 出現の順番（--i）は外側の 1 枚で持たせる
                          <div
                            key={n.id}
                            className="nbt-row"
                            style={cssVars({ '--i': Math.min(i, STAGGER_LAST) })}
                          >
                            <NoteRow
                              note={n}
                              colors={subjColors}
                              on={n.id === S.nbSelNoteId}
                              onClick={onSelect}
                              onContextMenu={onContextMenu}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
