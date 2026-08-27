'use client';

/**
 * Compass — ノート一覧の 1 行（docs/notebook/ux-refresh.md §3）
 *
 * 教科フォルダ・カレンダー・ゴミ箱・検索結果、どこから並べても同じ行が出る。
 * `NotebookSidebar` の中の無名コンポーネントだったものを、
 * 「一覧を見ただけでは何の教科か分からない」を直すために独立させた。
 *
 * 教科の手がかりは **2 段**にしてある（見た目は app/nb-row.css）:
 *
 *  1. 字のすぐ左に立てる**教科色の細い縦帯**。`showSubject` に関係なく必ず出す。
 *     教科フォルダの中でも、視線が行だけを縦に走るときは見出しまで戻らないので、
 *     色の柱が一本通っているほうが速い。教科名を出さない並びでは唯一の手がかりになる。
 *  2. `showSubject` のときだけ足す**教科名の小さな札**。色は覚えるまで当てにならないし、
 *     色覚や暗い画面では潰れることもあるので、教科が混ざる並びでは字も添える。
 *
 * 左端（x=0）は帯に使わず「いま指しているもの」の線に空けてある ――
 * 教科フォルダの見出し（nb-tree.css の `.nbt-head:hover`）も左端に線を出すので、
 * 「左端の縦線＝いま触れている / 開いている」という読み方をサイドバー全体で揃える。
 * 教科の帯はその内側に立つため、選択の線と喧嘩しない。
 */

import type { CSSProperties } from 'react';
import { dowOf, fmtMD } from '../../lib/logic/dates';
import { subjectColorFor, type SubjColors } from '../../lib/logic/subjects';
import type { Note } from '../../lib/model/notes';
import type { AppState, Plans } from '../../lib/model/types';
import { buildSubjColors } from './ShellSubjects';
import { useAppStore } from '../useStore';

/** CSS 変数を style に混ぜるための型合わせ（他の画面と同じ書き方） */
const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/**
 * 教科色表は `state` / `plans` が同じなら必ず同じ表になる。
 *
 * `useSubjColors()` は**行ごとに** `useMemo` を持つので、そのまま各行から呼ぶと、
 * 一覧に 30 行あるとき state が動くたびに 30 回 `buildSubjColors()`
 * （studyLog の全走査 + 円グラフの並べ替え）が回る。行は検索を 1 文字打つたびに
 * 描き直されるところなので、同じレンダーの行で 1 回だけ作って使い回す。
 * 参照が変わったときだけ作り直すので、表の中身は `useSubjColors()` と完全に同じ。
 */
let cacheState: AppState | null = null;
let cachePlans: Plans | null = null;
let cacheColors: SubjColors | null = null;
function subjColorsOf(state: AppState, plans: Plans): SubjColors {
  if (!cacheColors || cacheState !== state || cachePlans !== plans) {
    cacheState = state;
    cachePlans = plans;
    cacheColors = buildSubjColors(state, plans);
  }
  return cacheColors;
}

export interface NoteRowProps {
  note: Note;
  /** いま開いているノートか */
  on: boolean;
  onClick: (n: Note) => void;
  /** 右クリック（`NoteContextMenu` を開く） */
  onContextMenu?: (e: React.MouseEvent, n: Note) => void;
  /**
   * 教科名の**字**を行に出すか。教科フォルダの中では見出しに教科が出ているので不要、
   * カレンダー・検索結果・ゴミ箱のように教科が混ざる並びでは要る。
   * 教科色の帯は字ではないので、この指定に関わらず常に出る。
   */
  showSubject?: boolean;
}

export function NoteRow({ note, on, onClick, onContextMenu, showSubject }: NoteRowProps) {
  const { state: S, plans } = useAppStore();
  /**
   * 教科名が空のノートは `NotebookTree` が「その他」のフォルダにまとめる。
   * ここでも同じ既定にしないと、フォルダの見出しと行の帯で色が食い違う。
   */
  const subject = note.subject || 'その他';
  const color = subjectColorFor(subjColorsOf(S, plans), subject);
  /** 右クリックメニューが開いている行。どれに対する操作なのかを行側でも示す */
  const menuTarget = S.nbMenu?.noteId === note.id;
  /** ゴミ箱の一覧（#7）から並べられた行。生きているノートと同じ濃さで出さない */
  const trashed = !!note.trashedAt;
  const unit = note.unit || '(単元名なし)';
  const facts = note.date
    ? fmtMD(note.date) + '(' + dowOf(note.date) + ') · カード' + note.cards.length
    : 'カード' + note.cards.length;

  return (
    <div
      className={
        'nbr' + (on ? ' is-on' : '') + (menuTarget ? ' is-menu' : '') + (trashed ? ' is-trashed' : '')
      }
      style={cssVars({ '--nbr-c': color.c, '--nbr-bg': color.bg })}
      role="button"
      tabIndex={0}
      /** 開いているノートを支援技術にも伝える（見た目の地色・左線と同じ意味） */
      aria-current={on ? 'true' : undefined}
      /** 単元名が長いと途中で切れるので、教科ごと素の文字でも読めるようにしておく */
      title={subject + ' · ' + unit}
      onClick={() => onClick(note)}
      onKeyDown={(e) => {
        // role="button" にした以上、Enter と Space で開けないと嘘になる。
        // Space は既定でページが下にずれるので止める
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(note);
        }
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, note) : undefined}
    >
      {/* 教科色の帯。字ではないので読み上げには載せない */}
      <span className="nbr__spine" aria-hidden="true" />
      <div className="nbr__unit">{unit}</div>
      <div className="nbr__meta">
        {showSubject ? <span className="nbr__subj">{subject}</span> : null}
        <span className="nbr__facts">{facts}</span>
      </div>
    </div>
  );
}
