import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 純ロジック（src/lib/**）のユニットテストのみ。DOM は使わない。
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    // レガシーは「今日」を Asia/Tokyo で決める。CI のローカル TZ に依存しないよう固定する。
    env: { TZ: 'Asia/Tokyo' },
  },
});
