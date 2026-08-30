import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildMissionExtra } from '../../../lib/logic/missionAutogen';
import type { Mission } from '../../../lib/model/types';
import { DailyTasks } from '../DailyTasks';
import { Todo } from '../Todo';
import { dateCtx, store } from '../../useStore';

function dailyMission(): Mission {
  return {
    id: 'dmrender1',
    title: '英単語を1セクション',
    subj: '英語',
    size: 'S',
    dows: [],
    active: true,
    createdAt: dateCtx.today,
  };
}

afterEach(() => {
  store.setState({
    missions: [],
    extras: [],
    missionGenLog: {},
    order: [],
    selId: null,
    recentSubjs: [],
    theme: 'note',
    view: 'cockpit',
  });
});

describe('DailyTasks screen', () => {
  it('shows the master task, estimated minutes, completion, and weekly forecast', () => {
    const mission = dailyMission();
    const extra = { ...buildMissionExtra(mission, dateCtx.today), done: true };
    store.setState({
      missions: [mission],
      extras: [extra],
      missionGenLog: { [dateCtx.today]: [mission.id] },
      order: [extra.id],
      view: 'daily',
    });

    const html = renderToStaticMarkup(createElement(DailyTasks));
    expect(html).toContain('data-screen-label="Daily"');
    expect(html).toContain('英単語を1セクション');
    expect(html).toContain('予想時間');
    expect(html).toContain('10分');
    expect(html).toContain('10分 · 1/1件 完了');
    expect(html).toContain('7日間の負荷予想');
    expect(html).toContain('今日の予定プレビュー');
  });

  it('renders the add form when the ledger is empty', () => {
    store.setState({ missions: [], extras: [], missionGenLog: {}, order: [], view: 'daily' });
    const html = renderToStaticMarkup(createElement(DailyTasks));
    expect(html).toContain('まだデイリータスクがありません');
    expect(html).toContain('デイリータスクを追加');
    expect(html).toContain('追加する');
  });
});

describe('Todo daily section', () => {
  it('separates generated daily tasks into their own visible section', () => {
    const mission = dailyMission();
    const extra = buildMissionExtra(mission, dateCtx.today);
    store.setState({
      missions: [mission],
      extras: [extra],
      missionGenLog: { [dateCtx.today]: [mission.id] },
      order: [extra.id],
      view: 'todo',
    });

    const html = renderToStaticMarkup(createElement(Todo));
    expect(html).toContain('デイリータスク · 1件 · 10分');
    expect(html).toContain('英単語を1セクション');
    expect(html).toContain('デイリータスク</div>');
    expect(html).toContain('復習・単発タスク · 0件');
  });
});
