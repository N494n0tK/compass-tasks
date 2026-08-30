'use client';

/**
 * Compass — デイリータスク台帳。
 *
 * `missions` が繰り返し設定の正本で、今日の実体は既存どおり `Extra`。
 * 追加・編集・停止・削除のどの操作も `missionAutogen` の共通ロジックを通し、
 * 今日のToDoと台帳を食い違わせない。
 */

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { DOW, dowOf, fmtMD, isoShift } from '../../lib/logic/dates';
import {
  MISSION_SIZE_MIN,
  generateMissionTasks,
  isMissionDay,
  missionExtraId,
  missionRefOf,
  missionStreaks,
  newMissionId,
  reconcileMissionToday,
} from '../../lib/logic/missionAutogen';
import { buildMissionStats } from '../../lib/logic/missionStats';
import { orderedSubjectNames, subjectColorFor } from '../../lib/logic/subjects';
import type { Mission, SizeKey } from '../../lib/model/types';
import { useSubjColors } from '../parts/ShellSubjects';
import { dateCtx, store, useAppStore } from '../useStore';

const SIZE_KEYS: readonly SizeKey[] = ['XS', 'S', 'M', 'L'];
/** 月始まり。値は `DOW` の添字（日=0 … 土=6）。 */
const DOW_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

interface MissionDraft {
  title: string;
  subj: string;
  size: SizeKey;
  dows: number[];
  active: boolean;
}

const EMPTY_DRAFT: MissionDraft = {
  title: '',
  subj: '',
  size: 'S',
  dows: [],
  active: true,
};

function draftOf(mission: Mission | null | undefined): MissionDraft {
  return mission
    ? {
        title: mission.title,
        subj: mission.subj,
        size: mission.size,
        dows: mission.dows.slice(),
        active: mission.active,
      }
    : { ...EMPTY_DRAFT, dows: [] };
}

function dowsLabel(dows: readonly number[]): string {
  return dows.length ? dows.map((dow) => DOW[dow]).join('・') : '毎日';
}

export function DailyTasks() {
  const { state: S, plans: P } = useAppStore();
  const T = dateCtx.today;
  const subjColors = useSubjColors(S, P);
  const first = S.missions[0] || null;
  const [mode, setMode] = useState<'create' | 'edit'>(first ? 'edit' : 'create');
  const [selectedId, setSelectedId] = useState<string | null>(first?.id || null);
  const [draft, setDraft] = useState<MissionDraft>(() => draftOf(first));
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);

  const selected = selectedId ? S.missions.find((mission) => mission.id === selectedId) || null : null;
  const subjectNames = orderedSubjectNames(Object.keys(subjColors), S.recentSubjs);
  const stats = useMemo(
    () => buildMissionStats(S.missions, S.extras, T),
    [S.missions, S.extras, T],
  );
  const statsById = useMemo(
    () => new Map(stats.map((row) => [row.mission.id, row])),
    [stats],
  );
  const streaks = useMemo(
    () => missionStreaks(S.missions, S.extras, T),
    [S.missions, S.extras, T],
  );

  // 別画面の操作やクラウド再読込で選択中の台帳が消えた場合だけ、安全に新規入力へ戻す。
  useEffect(() => {
    if (mode !== 'edit' || !selectedId || selected) return;
    setMode('create');
    setSelectedId(null);
    setDraft(draftOf(null));
    setDeleteArmed(false);
  }, [mode, selected, selectedId]);

  const missionIds = useMemo(() => new Set(S.missions.map((mission) => mission.id)), [S.missions]);
  const todayExtras = useMemo(
    () =>
      S.extras.filter((extra) => {
        const ref = missionRefOf(extra.id);
        return !!ref && ref.day === T && missionIds.has(ref.missionId);
      }),
    [S.extras, T, missionIds],
  );
  const todayTotal = todayExtras.reduce((sum, extra) => sum + extra.min, 0);
  const todayDone = todayExtras.filter((extra) => extra.done).length;
  const longestStreak = Math.max(0, ...Object.values(streaks));

  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const iso = isoShift(T, index);
        const rows = S.missions.filter((mission) => mission.active && isMissionDay(mission, iso));
        return {
          iso,
          dow: dowOf(iso),
          minutes: rows.reduce((sum, mission) => sum + MISSION_SIZE_MIN[mission.size], 0),
          count: rows.length,
        };
      }),
    [S.missions, T],
  );
  const weekMax = Math.max(30, ...week.map((day) => day.minutes));

  const choose = (mission: Mission) => {
    setMode('edit');
    setSelectedId(mission.id);
    setDraft(draftOf(mission));
    setError('');
    setDeleteArmed(false);
  };

  const startCreate = () => {
    setMode('create');
    setSelectedId(null);
    setDraft(draftOf(null));
    setError('');
    setDeleteArmed(false);
  };

  const toggleDraftDow = (dow: number) => {
    setDraft((current) => ({
      ...current,
      dows:
        current.dows.indexOf(dow) >= 0
          ? current.dows.filter((item) => item !== dow)
          : current.dows.concat([dow]).sort((a, b) => a - b),
    }));
  };

  const save = () => {
    const title = draft.title.trim();
    const subj = draft.subj.trim();
    if (!title || !subj) {
      setError(!title ? 'タスク名を入力してください' : '教科を入力してください');
      return;
    }
    setError('');

    if (mode === 'create') {
      const mission: Mission = {
        id: newMissionId(),
        title,
        subj,
        size: draft.size,
        dows: draft.dows.slice().sort((a, b) => a - b),
        active: draft.active,
        createdAt: T,
      };
      let addedToday = false;
      store.setState((state) => {
        const generated = generateMissionTasks({
          today: T,
          missions: [mission],
          genLog: state.missionGenLog,
        });
        addedToday = generated.extras.length > 0;
        return {
          missions: state.missions.concat([mission]),
          extras: state.extras.concat(generated.extras),
          missionGenLog: generated.genLog,
          order: state.order.concat(
            generated.extras.filter((extra) => state.order.indexOf(extra.id) < 0).map((extra) => extra.id),
          ),
          recentSubjs: [subj].concat(state.recentSubjs.filter((name) => name !== subj)).slice(0, 4),
        };
      });
      choose(mission);
      store.showToast(
        '「' + title + '」をデイリータスクに追加しました' + (addedToday ? '(今日のToDoにも追加)' : ''),
      );
      return;
    }

    if (!selected) return;
    const next: Mission = {
      ...selected,
      title,
      subj,
      size: draft.size,
      dows: draft.dows.slice().sort((a, b) => a - b),
      active: draft.active,
    };
    store.setState((state) => {
      const sync = reconcileMissionToday({
        today: T,
        previous: selected,
        next,
        extras: state.extras,
        genLog: state.missionGenLog,
        order: state.order,
      });
      return {
        missions: state.missions.map((mission) => (mission.id === next.id ? next : mission)),
        extras: sync.extras,
        missionGenLog: sync.genLog,
        order: sync.order,
        recentSubjs: [subj].concat(state.recentSubjs.filter((name) => name !== subj)).slice(0, 4),
      };
    });
    setDraft(draftOf(next));
    store.showToast('「' + title + '」を更新しました');
  };

  const toggleActive = (mission: Mission) => {
    const next = { ...mission, active: !mission.active };
    store.setState((state) => {
      const sync = reconcileMissionToday({
        today: T,
        previous: mission,
        next,
        extras: state.extras,
        genLog: state.missionGenLog,
        order: state.order,
      });
      return {
        missions: state.missions.map((row) => (row.id === mission.id ? next : row)),
        extras: sync.extras,
        missionGenLog: sync.genLog,
        order: sync.order,
      };
    });
    if (selectedId === mission.id) setDraft((current) => ({ ...current, active: next.active }));
    store.showToast('「' + mission.title + '」を' + (next.active ? '再開しました' : '一時停止しました'));
  };

  const removeSelected = () => {
    if (!selected) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    store.setState((state) => {
      const sync = reconcileMissionToday({
        today: T,
        previous: selected,
        next: null,
        extras: state.extras,
        genLog: state.missionGenLog,
        order: state.order,
      });
      return {
        missions: state.missions.filter((mission) => mission.id !== selected.id),
        extras: sync.extras,
        missionGenLog: sync.genLog,
        order: sync.order,
      };
    });
    store.showToast('「' + selected.title + '」を削除しました(完了記録は残ります)');
    startCreate();
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, mission: Mission) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    choose(mission);
  };

  return (
    <div data-screen-label="Daily" className="daily-screen">
      <section className="daily-metrics" aria-label="デイリータスクの今日の概要">
        <div className="daily-metric daily-metric--today">
          <span>今日</span>
          <strong>{todayExtras.length}</strong>
          <small>件</small>
        </div>
        <div className="daily-metric daily-metric--minutes">
          <span>予想時間</span>
          <strong>{todayTotal}</strong>
          <small>分</small>
        </div>
        <div className="daily-metric daily-metric--done">
          <span>完了</span>
          <strong>{todayDone}</strong>
          <small>{' / ' + todayExtras.length}</small>
        </div>
        <div className="daily-metric daily-metric--streak">
          <span>最長連続</span>
          <strong>{longestStreak}</strong>
          <small>日</small>
        </div>
      </section>

      <div className="daily-layout">
        <div className="daily-column">
          <section className="daily-panel daily-list-panel">
            <header className="daily-panel-head">
              <div>
                <h2>デイリータスク一覧</h2>
                <p>繰り返しタスクのマスター</p>
              </div>
              <button type="button" className="daily-primary" onClick={startCreate}>
                ＋ 新しく追加
              </button>
            </header>

            {S.missions.length ? (
              <div className="daily-list">
                {S.missions.map((mission) => {
                  const sub = subjectColorFor(subjColors, mission.subj);
                  const stat = statsById.get(mission.id);
                  const active = mode === 'edit' && selectedId === mission.id;
                  return (
                    <div
                      key={mission.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      className={'daily-row' + (active ? ' is-selected' : '') + (!mission.active ? ' is-paused' : '')}
                      onClick={() => choose(mission)}
                      onKeyDown={(event) => onRowKey(event, mission)}
                      style={{ '--daily-subj': sub.c } as CSSProperties}
                    >
                      <span className="daily-row-mark" aria-hidden="true" />
                      <div className="daily-row-main">
                        <strong>{mission.title}</strong>
                        <div className="daily-row-meta">
                          <span style={{ color: sub.c, background: sub.bg }}>{mission.subj}</span>
                          <span>{MISSION_SIZE_MIN[mission.size] + '分'}</span>
                          <span>{dowsLabel(mission.dows)}</span>
                          {mission.kind === 'weak' ? <span>弱点ドリル</span> : null}
                        </div>
                      </div>
                      <div className="daily-row-stats">
                        <span>{'達成率 ' + (stat?.rateLabel || '–')}</span>
                        <b>{'🔥 ' + (stat?.streak || 0) + '日'}</b>
                      </div>
                      <button
                        type="button"
                        className={'daily-switch' + (mission.active ? ' is-on' : '')}
                        aria-pressed={mission.active}
                        aria-label={mission.title + (mission.active ? 'を一時停止' : 'を再開')}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleActive(mission);
                        }}
                      >
                        <span aria-hidden="true" />
                        {mission.active ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        className="daily-edit"
                        onClick={(event) => {
                          event.stopPropagation();
                          choose(mission);
                        }}
                      >
                        編集
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="daily-empty">
                <b>まだデイリータスクがありません</b>
                <span>英単語や計算練習など、毎日くり返したいことを登録してください。</span>
                <button type="button" className="daily-primary" onClick={startCreate}>
                  最初のタスクを追加
                </button>
              </div>
            )}
          </section>

          <section className="daily-panel daily-week-panel">
            <header className="daily-panel-head">
              <div>
                <h2>7日間の負荷予想</h2>
                <p>実施曜日と予想時間から自動計算</p>
              </div>
            </header>
            <div className="daily-week-chart">
              {week.map((day, index) => (
                <div key={day.iso} className={'daily-week-day' + (index === 0 ? ' is-today' : '')}>
                  <span className="daily-week-min">{day.minutes + '分'}</span>
                  <div className="daily-week-track">
                    <span style={{ height: Math.max(4, Math.round((day.minutes / weekMax) * 100)) + '%' }} />
                  </div>
                  <b>{day.dow}</b>
                  <small>{fmtMD(day.iso)}</small>
                  <em>{day.count + '件'}</em>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="daily-column">
          <section className="daily-panel daily-form-panel">
            <header className="daily-panel-head">
              <div>
                <h2>{mode === 'create' ? 'デイリータスクを追加' : 'デイリータスクを編集'}</h2>
                <p>{mode === 'create' ? '登録すると実施日のToDoへ自動で追加されます' : '変更は未完了の今日ぶんにも反映されます'}</p>
              </div>
              {mode === 'edit' ? (
                <button type="button" className="daily-quiet" onClick={startCreate}>
                  新規入力へ
                </button>
              ) : null}
            </header>

            <div className="daily-form">
              <label>
                <span>タスク名</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="例: 英単語を1セクション"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>教科</span>
                <input
                  value={draft.subj}
                  onChange={(event) => setDraft((current) => ({ ...current, subj: event.target.value }))}
                  placeholder="例: 英語"
                  list="daily-subject-options"
                  autoComplete="off"
                />
                <datalist id="daily-subject-options">
                  {subjectNames.map((name) => <option key={name} value={name} />)}
                </datalist>
              </label>

              <fieldset>
                <legend>予想時間</legend>
                <div className="daily-choice-row">
                  {SIZE_KEYS.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={draft.size === size ? 'is-selected' : ''}
                      aria-pressed={draft.size === size}
                      onClick={() => setDraft((current) => ({ ...current, size }))}
                    >
                      <b>{MISSION_SIZE_MIN[size]}</b>分
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>実施曜日</legend>
                <div className="daily-choice-row daily-dow-row">
                  <button
                    type="button"
                    className={!draft.dows.length ? 'is-selected' : ''}
                    aria-pressed={!draft.dows.length}
                    onClick={() => setDraft((current) => ({ ...current, dows: [] }))}
                  >
                    毎日
                  </button>
                  {DOW_ORDER.map((dow) => (
                    <button
                      key={dow}
                      type="button"
                      className={draft.dows.indexOf(dow) >= 0 ? 'is-selected' : ''}
                      aria-pressed={draft.dows.indexOf(dow) >= 0}
                      onClick={() => toggleDraftDow(dow)}
                    >
                      {DOW[dow]}
                    </button>
                  ))}
                </div>
                <small>{'現在の設定: ' + dowsLabel(draft.dows)}</small>
              </fieldset>

              <label className="daily-active-field">
                <span>
                  <b>今日から有効にする</b>
                  <small>OFFなら記録を残したまま自動追加を止めます</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
                />
              </label>

              {error ? <div className="daily-form-error" role="alert">{error}</div> : null}

              <div className="daily-form-actions">
                <button type="button" className="daily-save" onClick={save}>
                  {mode === 'create' ? '追加する' : '変更を保存'}
                </button>
                {mode === 'edit' ? (
                  <button
                    type="button"
                    className={'daily-delete' + (deleteArmed ? ' is-armed' : '')}
                    onClick={removeSelected}
                  >
                    {deleteArmed ? '本当に削除する' : '削除'}
                  </button>
                ) : null}
                {deleteArmed ? (
                  <button type="button" className="daily-quiet" onClick={() => setDeleteArmed(false)}>
                    やめる
                  </button>
                ) : null}
              </div>
              {deleteArmed ? (
                <p className="daily-delete-note">今日の未完了タスクは外れます。過去と今日の完了記録は残ります。</p>
              ) : null}
            </div>
          </section>

          <section className="daily-panel daily-preview-panel">
            <header className="daily-panel-head">
              <div>
                <h2>今日の予定プレビュー</h2>
                <p>{todayTotal + '分 · ' + todayDone + '/' + todayExtras.length + '件 完了'}</p>
              </div>
              <button
                type="button"
                className="daily-quiet"
                onClick={() => store.setState({ view: 'todo', selId: todayExtras[0]?.id || null })}
              >
                今日のToDoで見る →
              </button>
            </header>
            {todayExtras.length ? (
              <div className="daily-preview-list">
                {todayExtras.map((extra) => {
                  const ref = missionRefOf(extra.id);
                  const mission = ref ? S.missions.find((row) => row.id === ref.missionId) : null;
                  return (
                    <button
                      type="button"
                      key={extra.id}
                      onClick={() => store.setState({ view: 'todo', selId: extra.id })}
                      className={extra.done ? 'is-done' : ''}
                    >
                      <span>{extra.done ? '✓' : '○'}</span>
                      <strong>{extra.title}</strong>
                      <small>{extra.subj}</small>
                      <b>{extra.min + '分'}</b>
                      {mission && (streaks[mission.id] || 0) >= 2 ? <em>{'🔥' + streaks[mission.id]}</em> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="daily-preview-empty">今日予定されているデイリータスクはありません。</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
