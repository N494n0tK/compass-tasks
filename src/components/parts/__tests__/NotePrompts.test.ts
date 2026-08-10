import { describe, expect, it } from 'vitest';

import { timetableSubjects } from '../../../lib/logic/timetable';
import { NOTE_SUBJECT_OTHER } from '../../../lib/model/notes';
import { noteMainPrompt, notePrompts } from '../NotePrompts';

/**
 * プロンプトの長さの上限（docs/notebook/spec.md §7.2 / N-133）。
 *
 * **ChatGPT の GPT ビルダーの「指示」欄は 8000 文字が上限で、超えると保存がブロックされる。**
 * このプロンプトは丸ごとそこに貼って使うので、長さを超えた時点で GPT に貼れなくなる
 * （実際に 8539 文字で弾かれた）。
 *
 * 測るのは**教科名を埋め込んだ後**の長さ。教科は時間割（`timetableSubjects()`）から
 * 展開されるので、プロンプト本文をいじらなくても時間割が増えれば伸びる。
 *
 * 落ちたときに縮めてよいのは「# 記入例」だけ（形式の見本なので、規則を 1 つも失わずに
 * 縮められる唯一の場所）。「# 各項目の作り方」以下の規則文と自己チェックは削らないこと。
 */
const GPT_BUILDER_LIMIT = 8000;

/** 再発防止の余白込みの予算。教科が数個増えても上限に触れない */
const BUDGET = 7900;

describe('noteMainPrompt の長さ（GPT ビルダーの上限）', () => {
  // `NoteImportModal` と同じ渡し方（時間割の教科 ＋ その他）
  const subjects = timetableSubjects().concat([NOTE_SUBJECT_OTHER]);
  const prompt = noteMainPrompt(subjects);

  it('実際の時間割で展開しても 8000 文字を超えない', () => {
    expect(prompt.length).toBeLessThanOrEqual(GPT_BUILDER_LIMIT);
  });

  it('余白込みの予算 7900 文字にも収まる', () => {
    expect(prompt.length).toBeLessThanOrEqual(BUDGET);
  });

  it('教科の一覧を埋め込み、プレースホルダを残さない', () => {
    expect(prompt).toContain(subjects.join('|'));
    expect(prompt).not.toContain('__SUBJECTS__');
  });

  it('取り込みモーダルへ渡すのも同じ本文（二重管理しない）', () => {
    const list = notePrompts(subjects);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe(prompt);
  });

  it('要求するスキーマは compass-note@2', () => {
    expect(prompt).toContain('compass-note@2');
    expect(prompt).not.toContain('compass-note@1');
  });
});
