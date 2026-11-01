export const APP_NAME = 'My Karaoke';
export const SCHEMA_VERSION = 1;
export const MAX_SCORE_MILLI = 99999;

const jaCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

export function formatScore(scoreMilli) {
  if (!Number.isInteger(scoreMilli) || scoreMilli < 0 || scoreMilli > MAX_SCORE_MILLI) return '—';
  return (scoreMilli / 1000).toFixed(3);
}

export function scoreInputToMilli(value) {
  const text = String(value ?? '');
  if (!/^\d{5}$/.test(text)) return null;
  const score = Number(text);
  return Number.isInteger(score) && score >= 0 && score <= MAX_SCORE_MILLI ? score : null;
}

export function calculateStats(records) {
  if (!records?.length) {
    return { count: 0, averageMilli: null, bestMilli: null, lastSungAt: null };
  }
  let sum = 0;
  let best = -1;
  let latest = null;
  for (const record of records) {
    sum += record.scoreMilli;
    if (record.scoreMilli > best) best = record.scoreMilli;
    if (!latest || Date.parse(record.sungAt) > Date.parse(latest)) latest = record.sungAt;
  }
  return {
    count: records.length,
    averageMilli: Math.floor(sum / records.length + 0.5),
    bestMilli: best,
    lastSungAt: latest,
  };
}

export function buildStatsMap(songs, records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.songId)) grouped.set(record.songId, []);
    grouped.get(record.songId).push(record);
  }
  const result = new Map();
  for (const song of songs) result.set(song.id, calculateStats(grouped.get(song.id) ?? []));
  return result;
}

function titleThenCreated(a, b) {
  const titleOrder = jaCollator.compare(a.title, b.title);
  if (titleOrder) return titleOrder;
  const dateOrder = String(a.createdAt).localeCompare(String(b.createdAt));
  return dateOrder || String(a.id).localeCompare(String(b.id));
}

export function sortSongs(songs, statsMap, sortKey = 'createdAt') {
  const items = [...songs];
  items.sort((a, b) => {
    const sa = statsMap.get(a.id) ?? calculateStats([]);
    const sb = statsMap.get(b.id) ?? calculateStats([]);
    let order = 0;
    switch (sortKey) {
      case 'newest':
        order = String(b.createdAt).localeCompare(String(a.createdAt));
        break;
      case 'title':
        order = jaCollator.compare(a.title, b.title);
        if (order) return order;
        return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
      case 'artist': {
        const aa = String(a.artist ?? '').trim();
        const ab = String(b.artist ?? '').trim();
        if (!aa && ab) return 1;
        if (aa && !ab) return -1;
        order = jaCollator.compare(aa, ab);
        break;
      }
      case 'average':
        if (sa.averageMilli == null && sb.averageMilli != null) return 1;
        if (sa.averageMilli != null && sb.averageMilli == null) return -1;
        order = (sb.averageMilli ?? 0) - (sa.averageMilli ?? 0);
        break;
      case 'best':
        if (sa.bestMilli == null && sb.bestMilli != null) return 1;
        if (sa.bestMilli != null && sb.bestMilli == null) return -1;
        order = (sb.bestMilli ?? 0) - (sa.bestMilli ?? 0);
        break;
      case 'count':
        order = sb.count - sa.count;
        break;
      case 'recent':
        if (sa.lastSungAt == null && sb.lastSungAt != null) return 1;
        if (sa.lastSungAt != null && sb.lastSungAt == null) return -1;
        order = String(sb.lastSungAt ?? '').localeCompare(String(sa.lastSungAt ?? ''));
        break;
      case 'createdAt':
      default:
        order = String(a.createdAt).localeCompare(String(b.createdAt));
        break;
    }
    return order || titleThenCreated(a, b);
  });
  return items;
}

export function filterAndSortSongs(songs, statsMap, options = {}) {
  const search = normalizeText(options.search ?? '');
  const filter = options.filter ?? 'all';
  const filtered = songs.filter((song) => {
    if (search) {
      const title = normalizeText(song.title);
      const artist = normalizeText(song.artist);
      if (!title.includes(search) && !artist.includes(search)) return false;
    }
    const stats = statsMap.get(song.id) ?? calculateStats([]);
    if (filter === 'favorite' && !song.favorite) return false;
    if (filter === 'scored' && stats.count === 0) return false;
    if (filter === 'unscored' && stats.count > 0) return false;
    return true;
  });
  return sortSongs(filtered, statsMap, options.sortKey ?? 'createdAt');
}

export function isValidISODate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateBackup(data) {
  const errors = [];
  if (!isPlainObject(data)) return ['JSONの最上位はオブジェクトである必要があります'];
  if (data.app !== APP_NAME) errors.push(`app は「${APP_NAME}」である必要があります`);
  if (data.schemaVersion !== SCHEMA_VERSION) errors.push(`未対応のスキーマバージョンです（対応: ${SCHEMA_VERSION}）`);
  if (!isValidISODate(data.exportedAt)) errors.push('exportedAt が有効なISO 8601日時ではありません');
  if (!Array.isArray(data.songs)) errors.push('songs は配列である必要があります');
  if (!Array.isArray(data.scoreRecords)) errors.push('scoreRecords は配列である必要があります');
  if (!isPlainObject(data.settings)) errors.push('settings はオブジェクトである必要があります');
  if (errors.length) return errors;

  const songIds = new Set();
  for (let i = 0; i < data.songs.length; i += 1) {
    const song = data.songs[i];
    const prefix = `songs[${i}]`;
    if (!isPlainObject(song)) { errors.push(`${prefix} がオブジェクトではありません`); continue; }
    if (typeof song.id !== 'string' || !song.id.trim()) errors.push(`${prefix}.id が不正です`);
    else if (songIds.has(song.id)) errors.push(`${prefix}.id が重複しています`);
    else songIds.add(song.id);
    if (typeof song.title !== 'string' || !song.title.trim() || song.title.length > 200) errors.push(`${prefix}.title が不正です`);
    if (typeof song.artist !== 'string' || song.artist.length > 200) errors.push(`${prefix}.artist が不正です`);
    if (typeof song.favorite !== 'boolean') errors.push(`${prefix}.favorite がbooleanではありません`);
    if (!isValidISODate(song.createdAt)) errors.push(`${prefix}.createdAt が不正です`);
    if (!isValidISODate(song.updatedAt)) errors.push(`${prefix}.updatedAt が不正です`);
  }

  const scoreIds = new Set();
  for (let i = 0; i < data.scoreRecords.length; i += 1) {
    const record = data.scoreRecords[i];
    const prefix = `scoreRecords[${i}]`;
    if (!isPlainObject(record)) { errors.push(`${prefix} がオブジェクトではありません`); continue; }
    if (typeof record.id !== 'string' || !record.id.trim()) errors.push(`${prefix}.id が不正です`);
    else if (scoreIds.has(record.id)) errors.push(`${prefix}.id が重複しています`);
    else scoreIds.add(record.id);
    if (typeof record.songId !== 'string' || !songIds.has(record.songId)) errors.push(`${prefix}.songId の参照先がありません`);
    if (!Number.isInteger(record.scoreMilli) || record.scoreMilli < 0 || record.scoreMilli > MAX_SCORE_MILLI) errors.push(`${prefix}.scoreMilli が不正です`);
    if (!isValidISODate(record.sungAt)) errors.push(`${prefix}.sungAt が不正です`);
    if (!isValidISODate(record.createdAt)) errors.push(`${prefix}.createdAt が不正です`);
  }

  for (const [key, value] of Object.entries(data.settings)) {
    if (!key.trim()) errors.push('settings に空のキーがあります');
    if (value === undefined) errors.push(`settings.${key} の値が不正です`);
  }
  return errors;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function planMerge(existing, incoming) {
  const currentSongs = new Map(existing.songs.map((song) => [song.id, song]));
  const currentScores = new Map(existing.scoreRecords.map((record) => [record.id, record]));
  const currentSettings = existing.settings ?? {};
  const blockedSongIds = new Set();
  const newSongs = [];
  let skippedSongs = 0;
  let songConflicts = 0;

  for (const song of incoming.songs) {
    const current = currentSongs.get(song.id);
    if (!current) newSongs.push(song);
    else if (stableStringify(current) === stableStringify(song)) skippedSongs += 1;
    else { songConflicts += 1; blockedSongIds.add(song.id); }
  }

  const newScores = [];
  let skippedScores = 0;
  let scoreConflicts = 0;
  let skippedDependentScores = 0;
  for (const record of incoming.scoreRecords) {
    if (blockedSongIds.has(record.songId)) { skippedDependentScores += 1; continue; }
    const current = currentScores.get(record.id);
    if (!current) newScores.push(record);
    else if (stableStringify(current) === stableStringify(record)) skippedScores += 1;
    else scoreConflicts += 1;
  }

  const newSettings = {};
  let skippedSettings = 0;
  for (const [key, value] of Object.entries(incoming.settings ?? {})) {
    if (Object.prototype.hasOwnProperty.call(currentSettings, key)) skippedSettings += 1;
    else newSettings[key] = value;
  }

  return {
    newSongs, newScores, newSettings,
    skippedSongs, songConflicts, skippedScores, scoreConflicts,
    skippedDependentScores, skippedSettings,
  };
}
