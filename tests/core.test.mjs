import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatsMap, calculateStats, filterAndSortSongs, formatScore,
  normalizeText, planMerge, scoreInputToMilli, validateBackup,
} from '../src/core.js';

const song = (id, title, artist = '', createdAt = '2026-01-01T00:00:00.000Z', favorite = false) => ({
  id, title, artist, favorite, createdAt, updatedAt: createdAt,
});
const record = (id, songId, scoreMilli, sungAt = '2026-01-02T00:00:00.000Z') => ({
  id, songId, scoreMilli, sungAt, createdAt: sungAt,
});

test('5桁の点数入力だけを受け付ける', () => {
  assert.equal(scoreInputToMilli('93863'), 93863);
  assert.equal(scoreInputToMilli('00000'), 0);
  assert.equal(scoreInputToMilli('99999'), 99999);
  for (const value of ['', '1234', '123456', '12.34', '-1234', '１２３４５', 'abcde']) {
    assert.equal(scoreInputToMilli(value), null, `${value} should be rejected`);
  }
  assert.equal(formatScore(87500), '87.500');
});

test('平均点は整数単位で四捨五入される', () => {
  const stats = calculateStats([
    record('r1', 's1', 90123),
    record('r2', 's1', 93863),
    record('r3', 's1', 92514),
  ]);
  assert.deepEqual(stats, {
    count: 3,
    averageMilli: 92167,
    bestMilli: 93863,
    lastSungAt: '2026-01-02T00:00:00.000Z',
  });
  assert.deepEqual(calculateStats([]), { count: 0, averageMilli: null, bestMilli: null, lastSungAt: null });
});

test('検索はNFKC・大文字小文字を正規化する', () => {
  assert.equal(normalizeText(' ＡＢＣ　ＴＥＳＴ '), 'abc test');
  const songs = [song('1', 'Ｓｔａｒ', 'ＡＲＴＩＳＴ'), song('2', 'Moon', 'Singer')];
  const stats = buildStatsMap(songs, []);
  assert.deepEqual(filterAndSortSongs(songs, stats, { search: 'star', filter: 'all', sortKey: 'title' }).map((x) => x.id), ['1']);
  assert.deepEqual(filterAndSortSongs(songs, stats, { search: 'artist', filter: 'all', sortKey: 'title' }).map((x) => x.id), ['1']);
});

test('採点済み・未採点・お気に入りの絞り込みと並び替え', () => {
  const songs = [song('1', 'Beta', '', '2026-01-01T00:00:00.000Z', true), song('2', 'Alpha'), song('3', 'Gamma')];
  const records = [record('r1', '1', 90000), record('r2', '3', 99000)];
  const stats = buildStatsMap(songs, records);
  assert.deepEqual(filterAndSortSongs(songs, stats, { filter: 'scored', sortKey: 'average' }).map((x) => x.id), ['3', '1']);
  assert.deepEqual(filterAndSortSongs(songs, stats, { filter: 'unscored', sortKey: 'title' }).map((x) => x.id), ['2']);
  assert.deepEqual(filterAndSortSongs(songs, stats, { filter: 'favorite', sortKey: 'title' }).map((x) => x.id), ['1']);
});

test('バックアップを検証し、ID競合を上書きせずマージ計画を作る', () => {
  const s1 = song('s1', 'Song');
  const valid = {
    app: 'My Karaoke', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00.000Z',
    songs: [s1], scoreRecords: [record('r1', 's1', 90000)], settings: { sortKey: 'title' },
  };
  assert.deepEqual(validateBackup(valid), []);
  assert.ok(validateBackup({ ...valid, scoreRecords: [record('r2', 'missing', 90000)] }).length > 0);
  const current = {
    songs: [song('s1', 'Different'), song('s2', 'Existing')],
    scoreRecords: [record('r2', 's2', 80000)],
    settings: { sortKey: 'createdAt' },
  };
  const incoming = {
    ...valid,
    songs: [song('s1', 'Conflict'), song('s3', 'New')],
    scoreRecords: [record('r3', 's1', 90000), record('r4', 's3', 91000), record('r2', 's2', 80000)],
    settings: { sortKey: 'title', filterKey: 'favorite' },
  };
  const plan = planMerge(current, incoming);
  assert.equal(plan.newSongs.length, 1);
  assert.equal(plan.newSongs[0].id, 's3');
  assert.equal(plan.newScores.length, 1);
  assert.equal(plan.newScores[0].id, 'r4');
  assert.equal(plan.songConflicts, 1);
  assert.equal(plan.skippedDependentScores, 1);
  assert.equal(plan.skippedScores, 1);
  assert.equal(plan.newSettings.filterKey, 'favorite');
});
