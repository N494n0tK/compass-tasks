/**
 * Compass — 教科フォルダに「潜る」（docs/notebook/ux-refresh.md §2）
 *
 * サイドバーの教科をダブルクリックすると、その教科**の中へ入る**。
 * 入っているあいだ他の教科は並ばず、パンくずと ⌘↑ で上へ戻る ―― Finder の
 * フォルダを開く操作そのもの。潜っている教科は `state.nbFolder` が持つ。
 *
 * `nbSubjFilter`（サイドバー下の絞り込みチップ）と混同しないこと。あちらは
 * 「他の教科も見えている一覧を、いま見たい教科だけに細める」道具で、こちらは
 * **一段下の階層へ移動する**。見えるものは同じでも、戻し方（チップをもう一度押す /
 * パンくずで上がる）と、戻ったときに何が見えるかの期待が違う。
 *
 * この画面には 2 つの入口がある（教科の見出しのダブルクリック / 行の右クリック →
 * 「この教科だけ表示」）。どちらから潜っても同じ結果になるよう、
 * **潜るときに立てる state も含めて**この 1 ファイルに集める。
 *
 * 純ロジック。React / DOM / store を import しない。
 */

import { NOTE_SUBJECT_OTHER, type Note } from '../model/notes';

/**
 * 一覧・見出し・パンくずで使う教科名。
 *
 * 教科が空のノート（取り込み時に教科を書き忘れた JSON など）は「その他」へ寄せる。
 * `NoteRow` の帯の色も `NoteContextMenu` の潜り先も同じ既定なので、ここを通せば
 * 「見出しは “その他” なのに潜ると 0 件」のような食い違いが起きない。
 */
export function subjectKeyOf(note: Note): string {
  return note.subject || NOTE_SUBJECT_OTHER;
}

/** 教科ひとまとまり。`[教科名, その教科のノート]` */
export type SubjectGroup = [subject: string, notes: Note[]];

/**
 * 教科ごとにまとめる。並びは**最初に出てきた順**。
 *
 * あいうえお順に並べ替えない ―― 渡ってくる `notes` は既に「授業日の新しい順」に
 * 並んでいるので、そのまま畳めば「最近やった教科が上」になる。名前順にすると
 * 毎日開く教科が下に沈む。
 */
export function groupNotesBySubject(notes: readonly Note[]): SubjectGroup[] {
  const map = new Map<string, Note[]>();
  notes.forEach((n) => {
    const key = subjectKeyOf(n);
    const list = map.get(key);
    if (list) list.push(n);
    else map.set(key, [n]);
  });
  return Array.from(map.entries());
}

/** 潜っている教科でノートを絞る（`null` = 潜っていないので全部） */
export function notesInFolder(notes: readonly Note[], folder: string | null): Note[] {
  if (!folder) return notes.slice();
  return notes.filter((n) => subjectKeyOf(n) === folder);
}

/**
 * サイドバーに並べる段。潜っていなければ教科ごと、潜っていればその教科ひとつだけ。
 *
 * 潜っているときは**中身が 0 件でも段を返す**。ここで空配列を返すと、呼ぶ側の
 * 「段が無ければ『まだノートがありません』」に吸い込まれてパンくずごと消え、
 * 上へ戻る手立てが画面から無くなる（検索語を打った瞬間に閉じ込められる）。
 */
export function folderGroups(notes: readonly Note[], folder: string | null): SubjectGroup[] {
  if (folder) return [[folder, notesInFolder(notes, folder)]];
  return groupNotesBySubject(notes);
}

/** その教科に潜れるか（＝ノートが 1 冊でもあるか） */
export function folderExists(notes: readonly Note[], folder: string): boolean {
  return notes.some((n) => subjectKeyOf(n) === folder);
}

/**
 * いまの潜り先が実在するかを見て、無ければ上へ戻した値を返す。
 *
 * ノートを全部ゴミ箱へ入れた / 取り込み直しで教科名が変わった、といったときに
 * 「どこにも無い教科の中」に取り残されるのを防ぐ。渡す `notes` は**絞り込む前の
 * 全ノート**にすること ―― 検索語に当たらないだけの一時的な 0 件で追い出されると、
 * 打ち間違えるたびに階層が飛ぶ。
 */
export function resolveFolder(notes: readonly Note[], folder: string | null): string | null {
  if (!folder) return null;
  return folderExists(notes, folder) ? folder : null;
}

/**
 * 1 つ上の階層（`null` = すべての教科）。
 *
 * いまは「すべての教科 ＞ 教科」の 2 段しかないので、どこから上がっても行き先は
 * 必ず「すべての教科」＝ `null`。それでも引数を取る形にしておくのは、パンくずも
 * ⌘↑ もこの関数を通しておけば、後で「教科 ＞ 単元」まで潜れるようにしたときに
 * 直すのがここ 1 か所で済むから。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 上記のとおり形だけ残す
export function folderUp(folder: string | null): string | null {
  return null;
}

/** パンくずの 1 段 */
export interface NoteCrumb {
  /** 出す名前（根は「ノート」、その下は教科名） */
  label: string;
  /** 押したときの潜り先（`null` = すべての教科まで上がる） */
  folder: string | null;
  /** その段に入っているノートの数 */
  count: number;
  /** いまいる段か（末尾の 1 つ。押しても動かないのでボタンにしない） */
  current: boolean;
}

/**
 * パンくずに出す並び。潜っていなければ**空**を返す。
 *
 * 潜っていないときの「ノート」だけの 1 段は出さない ―― 常に出ていると、
 * 押しても何も起きない行がサイドバーの一番いい場所を毎回 1 行ぶん食う。
 * 「パンくずが見えている＝いま潜っている」で読めるほうが状態も分かりやすい。
 */
export function noteCrumbs(notes: readonly Note[], folder: string | null): NoteCrumb[] {
  if (!folder) return [];
  return [
    { label: 'ノート', folder: null, count: notes.length, current: false },
    { label: folder, folder, count: notesInFolder(notes, folder).length, current: true },
  ];
}

/**
 * 潜るときに立てる state。**教科フォルダの入口はすべてこれを通す**
 * （見出しのダブルクリック / 右クリックの「この教科だけ表示」）。
 *
 * `nbSubjFilter` を落とすのは、同じ「教科で絞る」を二重に持たないため。
 * 例えばチップで英語に絞ったまま数学へ潜ると、一覧は 0 件（英語 かつ 数学）になり、
 * 上がっても英語しか出てこないので「戻ったのに他の教科が消えた」に見える。
 * 潜るほうが強い操作なので、弱いほうを畳む。
 */
export function folderEnterPatch(subject: string): { nbFolder: string; nbSubjFilter: null } {
  return { nbFolder: subject, nbSubjFilter: null };
}
