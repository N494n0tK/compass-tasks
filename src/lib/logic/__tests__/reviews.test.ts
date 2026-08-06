import { describe, expect, it } from 'vitest';

import type { Review, ReviewGrade, ReviewStageValue, SizeKey } from '../../model/types';
import {
  GRADE_REQUIRED_MESSAGE,
  LEGACY_REVIEW_NO,
  SHIFT_DUE_BLOCKED_MESSAGE,
  STAGE_DAYS,
  STAGE_NEXT,
  applyReviewCompletion,
  askSizeOf,
  bulkAddTargets,
  bulkAddToToday,
  canAddToToday,
  canComplete,
  isAddedToToday,
  nextReviewOf,
  orderAfterCompletion,
  reviewNoOf,
  selIdAfterCompletion,
  shiftDue,
  sizeOfMin,
} from '../reviews';

/**
 * 基準日 2026-08-05（水）。DIDX の窓は 08-05..08-17（13日）なので
 * `+14 = 08-19` は窓の外＝`dayLabel` が曜日なしの `8/19` になる、という境界も踏む。
 */
const T = '2026-08-05';

/** 決定的な id 生成（レガシーは `Date.now()` + 乱数） */
const NEW_ID = () => 'NEW';

function mkReview(over: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    seriesId: 'r1',
    reviewNo: 1,
    title: '英単語 Unit3',
    subj: '英語',
    stage: '翌日',
    last: '2026-08-04',
    due: T,
    min: 30,
    src: '手動追加',
    timetablePeriod: 2,
    timetableDate: '2026-08-04',
    added: false,
    done: false,
    ...over,
  };
}

function transition(stage: ReviewStageValue, grade: ReviewGrade, size: SizeKey = 'S', over: Partial<Review> = {}) {
  return nextReviewOf(mkReview({ stage, ...over }), grade, size, T, { newId: NEW_ID });
}

// ─────────────────────────────────────────────────────────────

describe('定数テーブル（HTML:3130-3132）', () => {
  it('stageNext / stageDays / legacyReviewNo', () => {
    expect(STAGE_NEXT['翌日']).toBe('3日後');
    expect(STAGE_NEXT['3日後']).toBe('1週間後');
    expect(STAGE_NEXT['1週間後']).toBe('2週間後');
    expect(STAGE_NEXT['2週間後']).toBe('定着 🎉');
    // '定着 🎉' の次は無い = 系列終了のシグナル
    expect(STAGE_NEXT['定着 🎉']).toBeUndefined();

    expect(STAGE_DAYS['翌日']).toBe(1);
    expect(STAGE_DAYS['3日後']).toBe(3);
    expect(STAGE_DAYS['1週間後']).toBe(7);
    expect(STAGE_DAYS['2週間後']).toBe(14);
    expect(STAGE_DAYS['定着 🎉']).toBeUndefined();

    expect(LEGACY_REVIEW_NO).toEqual({ 翌日: 1, '3日後': 2, '1週間後': 3, '2週間後': 4, '定着 🎉': 5 });
  });

  it('トースト文言', () => {
    expect(GRADE_REQUIRED_MESSAGE).toBe('理解度を選んでください');
    expect(SHIFT_DUE_BLOCKED_MESSAGE).toBe('次回復習日はこれ以上前にできません');
  });

  /**
   * v0.10 で `'当日'` を足した（ノート取り込みの初回）。
   * **既存の 4 段は上のテストで固定済み**。ここでは追加分が既存を壊していないことを見る。
   */
  it('v0.10: 当日 → 翌日 のはしごが増えただけで、既存の段は不変', () => {
    expect(STAGE_NEXT['当日']).toBe('翌日');
    // `'当日'` は stageDays を持たない（0 を入れると `!nsDays` の系列終了判定を壊すため）。
    // ns として現れる経路が無いので実害は無い
    expect(STAGE_DAYS['当日']).toBeUndefined();
    // 既存データにしか使われない表なので `'当日'` は載せない
    expect(LEGACY_REVIEW_NO['当日']).toBeUndefined();
  });
});

describe('nextReviewOf — 当日ステージ（v0.10 / ノート取り込みの初回）', () => {
  const sameDay = mkReview({ stage: '当日', due: T, last: T, min: 5 });

  it('ばっちり / まあまあ / 不安 のいずれでも翌日へ送られる', () => {
    (['high', 'mid', 'low'] as ReviewGrade[]).forEach((grade) => {
      const t = nextReviewOf(sameDay, grade, 'XS', T, { newId: NEW_ID });
      expect(t.next).not.toBeNull();
      expect(t.next?.stage).toBe('翌日');
      expect(t.next?.due).toBe('2026-08-06'); // T + 1
      expect(t.next?.reviewNo).toBe(2);
    });
  });

  it('据え置き（まあまあ）でも「今日もう一度」にはしない', () => {
    const t = nextReviewOf(sameDay, 'mid', 'XS', T, { newId: NEW_ID });
    expect(t.next?.due).not.toBe(T);
  });

  it('当日ぶんは遅れ扱いにならない（due === 今日なので ToDo から外れない）', () => {
    expect(nextReviewOf(sameDay, 'high', 'XS', T).mutations.removeFromTodo).toBe(false);
  });

  it('既存の「翌日」始まりは従来どおり 3日後 へ進む（回帰）', () => {
    const legacy = mkReview({ stage: '翌日', due: T });
    expect(nextReviewOf(legacy, 'high', 'S', T, { newId: NEW_ID }).next?.stage).toBe('3日後');
    expect(nextReviewOf(legacy, 'mid', 'S', T, { newId: NEW_ID }).next?.stage).toBe('翌日');
  });
});

describe('reviewNoOf（HTML:3133-3136）', () => {
  it('保存済みの reviewNo(>=1) をそのまま使う', () => {
    expect(reviewNoOf({ reviewNo: 3, stage: '翌日' })).toBe(3);
    // 文字列で保存された旧データ
    expect(reviewNoOf({ reviewNo: '4', stage: '翌日' })).toBe(4);
    // Math.floor される
    expect(reviewNoOf({ reviewNo: 2.7, stage: '翌日' })).toBe(2);
  });

  it('reviewNo が無い / 0 / 負 / 非数なら stage の表で補完する', () => {
    expect(reviewNoOf({ stage: '1週間後' })).toBe(3);
    expect(reviewNoOf({ reviewNo: 0, stage: '2週間後' })).toBe(4);
    expect(reviewNoOf({ reviewNo: -5, stage: '定着 🎉' })).toBe(5);
    expect(reviewNoOf({ reviewNo: 'abc', stage: '3日後' })).toBe(2);
  });

  it('未知 stage / null は 1', () => {
    expect(reviewNoOf({ stage: '1ヶ月後' })).toBe(1);
    expect(reviewNoOf({})).toBe(1);
    expect(reviewNoOf(null)).toBe(1);
    expect(reviewNoOf(undefined)).toBe(1);
  });
});

describe('sizeOfMin / askSizeOf（HTML:3137, 3145）', () => {
  it('境界値', () => {
    expect(sizeOfMin(5)).toBe('XS');
    expect(sizeOfMin(6)).toBe('S');
    expect(sizeOfMin(10)).toBe('S');
    expect(sizeOfMin(11)).toBe('M');
    expect(sizeOfMin(20)).toBe('M');
    expect(sizeOfMin(21)).toBe('L');
    expect(sizeOfMin(30)).toBe('L');
  });

  it('モーダルの既定選択', () => {
    expect(askSizeOf(null, mkReview({ min: 20 }))).toBe('M');
    expect(askSizeOf('XS', mkReview({ min: 20 }))).toBe('XS');
    expect(askSizeOf(null, null)).toBe('S');
  });
});

// ─────────────────────────────────────────────────────────────
// 遷移表（stage × grade の全組み合わせ）
// ─────────────────────────────────────────────────────────────

describe('nextReviewOf — 遷移表', () => {
  const advance: Array<[ReviewStageValue, ReviewStageValue, string]> = [
    ['翌日', '3日後', '2026-08-08'],
    ['3日後', '1週間後', '2026-08-12'],
    ['1週間後', '2週間後', '2026-08-19'],
  ];

  it.each(advance)('high: %s → %s (due %s)', (stage, nextStage, due) => {
    const t = transition(stage, 'high');
    expect(t.next).not.toBeNull();
    expect(t.next!.stage).toBe(nextStage);
    expect(t.next!.due).toBe(due);
  });

  const hold: Array<[ReviewStageValue, string]> = [
    ['翌日', '2026-08-06'],
    ['3日後', '2026-08-08'],
    ['1週間後', '2026-08-12'],
    ['2週間後', '2026-08-19'],
  ];

  it.each(hold)('mid: %s は据え置き (due %s)', (stage, due) => {
    const t = transition(stage, 'mid');
    expect(t.next).not.toBeNull();
    expect(t.next!.stage).toBe(stage);
    expect(t.next!.due).toBe(due);
  });

  const allStages: ReviewStageValue[] = ['翌日', '3日後', '1週間後', '2週間後', '定着 🎉', '1ヶ月後'];

  it.each(allStages)('low: %s → 翌日 に巻き戻して翌日再開', (stage) => {
    const t = transition(stage, 'low');
    expect(t.next).not.toBeNull();
    expect(t.next!.stage).toBe('翌日');
    expect(t.next!.due).toBe('2026-08-06');
    expect(t.message).toBe('明日、追加の復習を入れました(明日 · S)');
  });

  it('high: 2週間後 → 定着 🎉 で系列終了（次回を作らない）', () => {
    const t = transition('2週間後', 'high');
    expect(t.next).toBeNull();
    expect(t.message).toBe('定着！「英単語 Unit3」の復習は完了です 🎉');
  });

  it('high: 定着 🎉 の行も系列終了', () => {
    expect(transition('定着 🎉', 'high').next).toBeNull();
  });

  it('(v0.9 A3) mid: レガシー移行分の 定着 🎉 行も系列終了する（翌日を作り続けない）', () => {
    const t = transition('定着 🎉', 'mid');
    expect(t.next).toBeNull();
    expect(t.message).toBe('定着！「英単語 Unit3」の復習は完了です 🎉');
  });

  it('stageDays に無い未知 stage も high / mid で系列終了', () => {
    expect(transition('1ヶ月後', 'high').next).toBeNull();
    expect(transition('1ヶ月後', 'mid').next).toBeNull();
  });

  it('メッセージ（高/中は次の stage 名 + dayLabel + サイズキー）', () => {
    expect(transition('翌日', 'high', 'M').message).toBe('次は3日後に復習します(8/8(土) · M)');
    expect(transition('翌日', 'mid', 'S').message).toBe('次は翌日に復習します(明日 · S)');
    // +14 は 13 日ウィンドウの外なので曜日が付かない
    expect(transition('2週間後', 'mid', 'L').message).toBe('次は2週間後に復習します(8/19 · L)');
  });
});

describe('nextReviewOf — 生成される次回復習のフィールド', () => {
  it('継承・採番・上書き', () => {
    const askR = mkReview({
      id: 'r7',
      seriesId: 'root1',
      reviewNo: 2,
      stage: '3日後',
      min: 30,
      src: '8/2に学習',
      added: true,
    });
    const t = nextReviewOf(askR, 'high', 'M', T, { newId: NEW_ID });
    expect(t.next).toEqual({
      id: 'NEW',
      seriesId: 'root1',
      reviewNo: 3,
      title: '英単語 Unit3',
      subj: '英語',
      stage: '1週間後',
      last: T,
      due: '2026-08-12',
      min: 20, // SIZE_MIN['M'] — モーダルで選び直したサイズで上書き
      src: '8/5に学習',
      timetablePeriod: 2,
      timetableDate: '2026-08-04',
      added: false,
      done: false,
    });
  });

  it('seriesId が無い行は自分の id が系列ルートになる', () => {
    const askR = { ...mkReview({ id: 'r9' }), seriesId: '' } as Review;
    expect(nextReviewOf(askR, 'mid', 'S', T, { newId: NEW_ID }).next!.seriesId).toBe('r9');
  });

  it('reviewNo は据え置き/巻き戻しでも +1（legacy 補完も経由する）', () => {
    const legacy = { ...mkReview({ stage: '1週間後' }) } as Partial<Review>;
    delete legacy.reviewNo;
    const t = nextReviewOf(legacy as Review, 'low', 'S', T, { newId: NEW_ID });
    expect(t.next!.reviewNo).toBe(4); // legacyReviewNo['1週間後'] = 3 → +1
    expect(t.mutations.currentNo).toBe(3);
  });

  it('due の起点は常に今日（遅れて消化しても過去に戻らない）', () => {
    const late = mkReview({ due: '2026-07-20', stage: '3日後' });
    const t = nextReviewOf(late, 'high', 'S', T, { newId: NEW_ID });
    expect(t.next!.due).toBe('2026-08-12'); // T + 7。due(7/20) からではない
    expect(t.next!.last).toBe(T);
  });
});

describe('nextReviewOf — mutations', () => {
  it('studyLog には完了した回の min が入る（モーダルで選び直した分数ではない）', () => {
    const t = nextReviewOf(mkReview({ min: 30, subj: '数学' }), 'high', 'XS', T, { newId: NEW_ID });
    expect(t.mutations.studyLog).toEqual({ day: T, subj: '数学', min: 30 });
    expect(t.next!.min).toBe(5); // 次回だけが XS(5分)
  });

  it('due < today のときだけ removeFromTodo', () => {
    expect(nextReviewOf(mkReview({ due: '2026-08-01' }), 'mid', 'S', T).mutations.removeFromTodo).toBe(true);
    expect(nextReviewOf(mkReview({ due: T }), 'mid', 'S', T).mutations.removeFromTodo).toBe(false);
    expect(nextReviewOf(mkReview({ due: '2026-08-09' }), 'mid', 'S', T).mutations.removeFromTodo).toBe(false);
  });

  it('completedAt / reviewId / seriesId', () => {
    const t = nextReviewOf(mkReview({ id: 'r7', seriesId: 'root1', reviewNo: 2 }), 'mid', 'S', T);
    expect(t.mutations.completedAt).toBe(T);
    expect(t.mutations.reviewId).toBe('r7');
    expect(t.mutations.seriesId).toBe('root1');
    expect(t.mutations.currentNo).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────

describe('applyReviewCompletion — 系列の掃除（HTML:3172-3175）', () => {
  const askR = mkReview({ id: 'r2', seriesId: 'root1', reviewNo: 2, stage: '3日後', added: true });

  function list(): Review[] {
    return [
      mkReview({ id: 'r1', seriesId: 'root1', reviewNo: 1, done: true, due: '2026-08-01' }),
      askR,
      // 同系列の先行して残っている将来回 → 削除される
      mkReview({ id: 'r3', seriesId: 'root1', reviewNo: 3, due: '2026-08-20' }),
      mkReview({ id: 'r4', seriesId: 'root1', reviewNo: 9, due: '2026-09-01' }),
      // 別系列 → 残る
      mkReview({ id: 'x1', seriesId: 'other', reviewNo: 5, due: '2026-08-20' }),
    ];
  }

  it('reviewNo > currentNo の同系列行を消してから次の1回だけを末尾に足す', () => {
    const t = nextReviewOf(askR, 'high', 'S', T, { newId: NEW_ID });
    const out = applyReviewCompletion(list(), t);
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'x1', 'NEW']);
  });

  it('系列終了のときは追加しない（掃除だけ走る）', () => {
    const t = nextReviewOf(mkReview({ id: 'r2', seriesId: 'root1', reviewNo: 2, stage: '定着 🎉' }), 'mid', 'S', T);
    const out = applyReviewCompletion(list(), t);
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'x1']);
  });

  it('完了行に done/completedAt が付く。due が今日なら added は維持', () => {
    const t = nextReviewOf(askR, 'high', 'S', T, { newId: NEW_ID });
    const done = applyReviewCompletion(list(), t).find((r) => r.id === 'r2')!;
    expect(done.done).toBe(true);
    expect(done.completedAt).toBe(T);
    expect(done.added).toBe(true);
  });

  it('遅れて消化した行は added が false に落ちる', () => {
    const late = mkReview({ id: 'r2', seriesId: 'root1', reviewNo: 2, due: '2026-08-01', added: true });
    const t = nextReviewOf(late, 'high', 'S', T, { newId: NEW_ID });
    const out = applyReviewCompletion([late], t);
    expect(out[0].added).toBe(false);
    expect(out[0].done).toBe(true);
  });

  it('reviewNo 未保存の同系列行は 1 とみなされるので消えない（掃除は Number(reviewNo)||1）', () => {
    const legacyRow = { ...mkReview({ id: 'old', seriesId: 'root1', due: '2026-08-20' }) } as Partial<Review>;
    delete legacyRow.reviewNo;
    const t = nextReviewOf(askR, 'mid', 'S', T, { newId: NEW_ID });
    const out = applyReviewCompletion([askR, legacyRow as Review], t);
    expect(out.map((r) => r.id)).toEqual(['r2', 'old', 'NEW']);
  });

  it('seriesId が空の行は自分の id が系列キーになる', () => {
    const solo = { ...mkReview({ id: 'r5', reviewNo: 1 }), seriesId: '' } as Review;
    const other = { ...mkReview({ id: 'r6', reviewNo: 4, due: '2026-08-20' }), seriesId: 'r5' } as Review;
    const t = nextReviewOf(solo, 'high', 'S', T, { newId: NEW_ID });
    const out = applyReviewCompletion([solo, other], t);
    expect(out.map((r) => r.id)).toEqual(['r5', 'NEW']);
  });

  it('入力配列を破壊しない', () => {
    const src = list();
    const snapshot = JSON.parse(JSON.stringify(src));
    applyReviewCompletion(src, nextReviewOf(askR, 'high', 'S', T, { newId: NEW_ID }));
    expect(src).toEqual(snapshot);
  });
});

describe('order / selId の後始末（HTML:3179-3180）', () => {
  it('遅れて消化したときだけ order から外す', () => {
    const late = nextReviewOf(mkReview({ id: 'r2', due: '2026-08-01' }), 'mid', 'S', T).mutations;
    expect(orderAfterCompletion(['a', 'r2', 'b'], late)).toEqual(['a', 'b']);
    expect(selIdAfterCompletion('r2', late)).toBeNull();
    expect(selIdAfterCompletion('other', late)).toBe('other');
  });

  it('今日の復習を消化したときは order も selId も触らない', () => {
    const today = nextReviewOf(mkReview({ id: 'r2', due: T }), 'mid', 'S', T).mutations;
    const order = ['a', 'r2'];
    expect(orderAfterCompletion(order, today)).toBe(order);
    expect(selIdAfterCompletion('r2', today)).toBe('r2');
  });
});

// ─────────────────────────────────────────────────────────────

describe('行アクションの述語 / 一括ToDo追加（v0.9）', () => {
  const rows: Review[] = [
    mkReview({ id: 'late', due: '2026-08-01' }),
    mkReview({ id: 'today', due: T }),
    mkReview({ id: 'future', due: '2026-08-09' }),
    mkReview({ id: 'added', due: T, added: true }),
    mkReview({ id: 'done', due: T, done: true }),
    mkReview({ id: 'doneAdded', due: '2026-08-01', added: true, done: true }),
  ];

  it('canAdd = !added && !done && due <= today（遅れも含む）', () => {
    expect(rows.filter((r) => canAddToToday(r, T)).map((r) => r.id)).toEqual(['late', 'today']);
  });

  it('isAdded / canDone', () => {
    expect(rows.filter((r) => isAddedToToday(r)).map((r) => r.id)).toEqual(['added']);
    expect(rows.filter((r) => canComplete(r, T)).map((r) => r.id)).toEqual(['late', 'today', 'added']);
  });

  it('bulkAddTargets は行の canAdd と完全同条件', () => {
    expect(bulkAddTargets(rows, T).map((r) => r.id)).toEqual(['late', 'today']);
  });

  it('bulkAddToToday: 対象に added を立て、order 末尾に重複ガード付きで積む', () => {
    const res = bulkAddToToday(rows, ['seg1', 'late'], T);
    expect(res.ids).toEqual(['late', 'today']);
    expect(res.order).toEqual(['seg1', 'late', 'today']); // 既に order にある late は積み直さない
    expect(res.reviews.filter((r) => r.added).map((r) => r.id)).toEqual([
      'late',
      'today',
      'added',
      'doneAdded', // 元から added の行はそのまま
    ]);
    expect(res.message).toBe('2件の復習を今日のToDoに追加しました');
    // 元配列は破壊しない
    expect(rows.find((r) => r.id === 'late')!.added).toBe(false);
  });

  it('対象0件なら何も起きない（トーストも出さない）', () => {
    const only = [mkReview({ id: 'future', due: '2026-08-09' })];
    const order = ['seg1'];
    const res = bulkAddToToday(only, order, T);
    expect(res.ids).toEqual([]);
    expect(res.message).toBeNull();
    expect(res.reviews).toBe(only);
    expect(res.order).toBe(order);
  });
});

// ─────────────────────────────────────────────────────────────

describe('shiftDue（v0.9 の相対シフト。HTML:3340-3349）', () => {
  it('期限切れの行は 1 日ずつ動く（今日へ飛ばない）', () => {
    const r = shiftDue('2026-08-01', 1, T);
    expect(r).toEqual({
      moved: true,
      due: '2026-08-02',
      message: '次回復習日を 8/2(期限切れ) に変更しました',
    });
  });

  it('期限切れの行の「− 1日」は下限（その日自身）に張り付いて動かない', () => {
    expect(shiftDue('2026-08-01', -1, T)).toEqual({
      moved: false,
      due: '2026-08-01',
      message: SHIFT_DUE_BLOCKED_MESSAGE,
    });
  });

  it('13 日ウィンドウより先の行も 1 日ずつ動く', () => {
    expect(shiftDue('2026-08-25', 1, T).due).toBe('2026-08-26');
    expect(shiftDue('2026-08-25', -1, T).due).toBe('2026-08-24');
    expect(shiftDue('2026-08-25', 1, T).message).toBe('次回復習日を 8/26 に変更しました');
  });

  it('今日の行: ＋1日 は明日、−1日 は下限（今日）で止まる', () => {
    expect(shiftDue(T, 1, T)).toEqual({
      moved: true,
      due: '2026-08-06',
      message: '次回復習日を 明日 に変更しました',
    });
    expect(shiftDue(T, -1, T)).toEqual({ moved: false, due: T, message: SHIFT_DUE_BLOCKED_MESSAGE });
  });

  it('明日の行の「− 1日」は今日まで下がる', () => {
    expect(shiftDue('2026-08-06', -1, T)).toEqual({
      moved: true,
      due: T,
      message: '次回復習日を 今日 に変更しました',
    });
  });

  it('ウィンドウ内の未来日は曜日つきラベルになる', () => {
    expect(shiftDue('2026-08-11', 1, T).message).toBe('次回復習日を 8/12(水) に変更しました');
  });

  it('due が壊れている / 空なら今日を起点にする', () => {
    expect(shiftDue('', 1, T)).toEqual({
      moved: true,
      due: '2026-08-06',
      message: '次回復習日を 明日 に変更しました',
    });
    expect(shiftDue(null, -1, T)).toEqual({ moved: true, due: T, message: '次回復習日を 今日 に変更しました' });
    expect(shiftDue('2026/08/09', 1, T).due).toBe('2026-08-06');
  });
});
