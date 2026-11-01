import {
  APP_NAME, SCHEMA_VERSION, buildStatsMap, filterAndSortSongs, formatScore,
  planMerge, scoreInputToMilli, validateBackup,
} from './src/core.js';
import {
  addScore, addSong, clearAllData, deleteScore, deleteSongCascade, getSnapshot,
  mergeData, putSong, replaceAllData, saveSetting, setFavorite, updateScore,
} from './src/db.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const makeId = () => globalThis.crypto?.randomUUID?.()
  ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const SORT_OPTIONS = [
  { key: 'createdAt', label: '登録順', detail: '古い順' },
  { key: 'newest', label: '新着順', detail: '新しい順' },
  { key: 'title', label: '曲名順', detail: '日本語ロケール' },
  { key: 'artist', label: 'アーティスト名順', detail: '空欄は最後' },
  { key: 'average', label: '平均点順', detail: '高い順' },
  { key: 'best', label: '最高点順', detail: '高い順' },
  { key: 'count', label: '歌唱回数順', detail: '多い順' },
  { key: 'recent', label: '最近歌った順', detail: '新しい順' },
];
const FILTER_OPTIONS = [
  { key: 'all', label: 'すべて' },
  { key: 'favorite', label: 'お気に入り' },
  { key: 'scored', label: '採点済み' },
  { key: 'unscored', label: '未採点' },
];

const state = {
  songs: [],
  scoreRecords: [],
  settings: { sortKey: 'createdAt', filterKey: 'all' },
  stats: new Map(),
  activeTab: 'songs',
  view: { type: 'list' },
  search: '',
  overlay: null,
  toastTimer: null,
  undo: null,
  formOriginal: null,
  allowDuplicate: false,
  pendingBackup: null,
  listScrollY: 0,
  previousFocus: null,
};

const appView = $('#app-view');
const overlayRoot = $('#overlay-root');
const toastRoot = $('#toast-root');
const navRoot = $('#bottom-nav');

function nowISO() { return new Date().toISOString(); }
function sortLabel(key) { return SORT_OPTIONS.find((item) => item.key === key)?.label ?? '登録順'; }
function getSong(id) { return state.songs.find((song) => song.id === id); }
function getStats(id) { return state.stats.get(id) ?? { count: 0, averageMilli: null, bestMilli: null, lastSungAt: null }; }
function formatDate(value, includeTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未記録';
  const options = includeTime
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('ja-JP', options).format(new Date(value));
}
function toLocalDateTimeValue(iso) {
  const date = iso ? new Date(iso) : new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fromLocalDateTimeValue(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function announce(message, actionLabel = '', action = null) {
  clearTimeout(state.toastTimer);
  toastRoot.innerHTML = `<div class="toast" role="status"><span>${escapeHTML(message)}</span>${actionLabel ? `<button class="toast-action" type="button" data-action="undo">${escapeHTML(actionLabel)}</button>` : ''}</div>`;
  state.undo = action;
  state.toastTimer = setTimeout(() => {
    toastRoot.innerHTML = '';
    state.undo = null;
  }, 5000);
}
function showError(error, fallback = '処理に失敗しました') {
  console.error(error);
  const message = error instanceof Error ? error.message : fallback;
  announce(message || fallback);
}

async function refreshData() {
  const snapshot = await getSnapshot();
  state.songs = snapshot.songs;
  state.scoreRecords = snapshot.scoreRecords;
  state.settings = { sortKey: 'createdAt', filterKey: 'all', ...snapshot.settings };
  if (!SORT_OPTIONS.some((item) => item.key === state.settings.sortKey)) state.settings.sortKey = 'createdAt';
  if (!FILTER_OPTIONS.some((item) => item.key === state.settings.filterKey)) state.settings.filterKey = 'all';
  state.stats = buildStatsMap(state.songs, state.scoreRecords);
}

function renderNav() {
  const visible = ['list', 'settings'].includes(state.view.type);
  navRoot.hidden = !visible;
  if (!visible) return;
  const active = state.view.type === 'settings' ? 'settings' : state.activeTab;
  navRoot.innerHTML = `
    <button class="nav-item ${active === 'songs' ? 'active' : ''}" type="button" data-action="nav-songs" aria-current="${active === 'songs' ? 'page' : 'false'}">
      <span class="nav-icon" aria-hidden="true">♫</span><span>曲一覧</span>
    </button>
    <button class="nav-item ${active === 'favorites' ? 'active' : ''}" type="button" data-action="nav-favorites" aria-current="${active === 'favorites' ? 'page' : 'false'}">
      <span class="nav-icon" aria-hidden="true">♥</span><span>お気に入り</span>
    </button>
    <button class="nav-item ${active === 'settings' ? 'active' : ''}" type="button" data-action="nav-settings" aria-current="${active === 'settings' ? 'page' : 'false'}">
      <span class="nav-icon" aria-hidden="true">⚙</span><span>設定</span>
    </button>`;
}

function pageHeader(title, subtitle = '') {
  return `<header class="page-header"><div><p class="eyebrow">MY KARAOKE</p><h1>${escapeHTML(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHTML(subtitle)}</p>` : ''}</div></header>`;
}

function renderSongCard(song) {
  const stats = getStats(song.id);
  return `
    <article class="song-card" data-song-card="${escapeHTML(song.id)}">
      <button class="song-card-main" type="button" data-action="open-song" data-id="${escapeHTML(song.id)}" aria-label="${escapeHTML(song.title)} の詳細">
        <span class="song-copy"><strong class="song-title">${escapeHTML(song.title)}</strong>${song.artist ? `<span class="song-artist">${escapeHTML(song.artist)}</span>` : ''}</span>
        <span class="song-stats"><strong class="song-average">${stats.averageMilli == null ? '未採点' : formatScore(stats.averageMilli)}</strong><small>${stats.count}回</small></span>
      </button>
      <button class="heart-button ${song.favorite ? 'is-favorite' : ''}" type="button" data-action="favorite-toggle" data-id="${escapeHTML(song.id)}" aria-label="${song.favorite ? 'お気に入り解除' : 'お気に入りに追加'}" aria-pressed="${song.favorite}">
        <span aria-hidden="true">${song.favorite ? '♥' : '♡'}</span>
      </button>
    </article>`;
}

function renderListResults() {
  const isFavorites = state.activeTab === 'favorites';
  const filter = isFavorites ? 'favorite' : state.settings.filterKey;
  const visibleSongs = filterAndSortSongs(state.songs, state.stats, {
    search: state.search,
    filter,
    sortKey: state.settings.sortKey,
  });
  const results = $('#song-results');
  if (!results) return;
  $('#result-count').textContent = `${visibleSongs.length}曲表示中`;
  $('#sort-current').textContent = sortLabel(state.settings.sortKey);
  if (!visibleSongs.length) {
    const hasSongs = state.songs.length > 0;
    const message = !hasSongs
      ? '曲がまだ登録されていません'
      : isFavorites && !state.search
        ? 'お気に入りはまだありません'
        : state.search
          ? '該当する曲がありません'
          : '条件に一致する曲がありません';
    const hint = !hasSongs
      ? 'お気に入りや採点履歴も、曲を登録するとここで管理できます。'
      : isFavorites && !state.search
        ? '曲のハートをタップすると、ここに表示されます。'
        : state.search
          ? '曲名・アーティスト名を変えるか、検索語をクリアしてください。'
          : '絞り込み条件を解除して、もう一度確認してください。';
    results.innerHTML = `<div class="empty-state"><span class="empty-icon">♫</span><h2>${message}</h2><p>${hint}</p>${!hasSongs ? '<button class="primary-button" type="button" data-action="add-song">曲を追加</button>' : state.search ? '<button class="text-button" type="button" data-action="clear-search">検索を解除</button>' : '<button class="text-button" type="button" data-action="clear-filter">絞り込みを解除</button>'}</div>`;
    return;
  }
  results.innerHTML = `<div class="song-list">${visibleSongs.map(renderSongCard).join('')}</div>`;
}

function renderListPage() {
  const favorites = state.activeTab === 'favorites';
  appView.innerHTML = `
    <div class="page list-page">
      ${pageHeader(favorites ? 'お気に入り' : '曲一覧', favorites ? 'お気に入りに登録した曲' : '歌える曲をすばやく見つけよう')}
      <label class="search-box"><span class="search-symbol" aria-hidden="true">⌕</span><input id="song-search" type="search" placeholder="曲名・アーティスト名で検索" value="${escapeHTML(state.search)}" autocomplete="off" aria-label="曲名・アーティスト名で検索" />${state.search ? '<button class="search-clear" type="button" data-action="clear-search" aria-label="検索をクリア">×</button>' : ''}</label>
      ${!favorites ? `<div class="filter-row" role="group" aria-label="絞り込み">${FILTER_OPTIONS.map((item) => `<button class="filter-chip ${state.settings.filterKey === item.key ? 'selected' : ''}" type="button" data-action="set-filter" data-key="${item.key}" aria-pressed="${state.settings.filterKey === item.key}">${item.label}</button>`).join('')}</div>` : ''}
      <div class="list-toolbar"><span id="result-count" class="result-count">0曲表示中</span><button class="sort-button" type="button" data-action="open-sort"><span class="sort-glyph" aria-hidden="true">↕</span><span id="sort-current">${escapeHTML(sortLabel(state.settings.sortKey))}</span></button></div>
      <section id="song-results" aria-live="polite"></section>
      <button class="fab" type="button" data-action="add-song" aria-label="曲を追加"><span aria-hidden="true">＋</span><span>曲を追加</span></button>
    </div>`;
  renderListResults();
}

function renderStatsCard(stats) {
  return `
    <section class="stats-grid" aria-label="採点統計">
      <div class="stat-card stat-featured"><span>平均点</span><strong>${stats.averageMilli == null ? '—' : formatScore(stats.averageMilli)}</strong><small>${stats.count ? 'これまでの平均' : '未採点'}</small></div>
      <div class="stat-card"><span>最高点</span><strong>${stats.bestMilli == null ? '—' : formatScore(stats.bestMilli)}</strong><small>BEST</small></div>
      <div class="stat-card"><span>歌唱回数</span><strong>${stats.count}<small class="unit">回</small></strong><small>採点記録数</small></div>
      <div class="stat-card"><span>最終歌唱</span><strong class="date-stat">${stats.lastSungAt ? escapeHTML(formatDate(stats.lastSungAt)) : '—'}</strong><small>${stats.lastSungAt ? escapeHTML(formatDate(stats.lastSungAt, true).split(' ')[1] ?? '') : '未記録'}</small></div>
    </section>`;
}

function renderHistory(song) {
  const records = state.scoreRecords
    .filter((record) => record.songId === song.id)
    .sort((a, b) => String(b.sungAt).localeCompare(String(a.sungAt)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!records.length) {
    return `<div class="history-empty"><span aria-hidden="true">◷</span><p>採点記録はまだありません</p><span>歌唱後に点数を記録してみましょう。</span><button class="secondary-button" type="button" data-action="open-score-add">採点を記録</button></div>`;
  }
  return `<div class="history-list">${records.map((record) => `
    <article class="history-row">
      <div class="history-date"><strong>${escapeHTML(formatDate(record.sungAt))}</strong><span>${escapeHTML(new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(new Date(record.sungAt)))}</span></div>
      <strong class="history-score">${formatScore(record.scoreMilli)}<small>点</small></strong>
      <button class="icon-button history-menu" type="button" data-action="open-score-menu" data-id="${escapeHTML(record.id)}" aria-label="${formatScore(record.scoreMilli)}点の履歴メニュー">•••</button>
    </article>`).join('')}</div>`;
}

function renderDetailPage() {
  const song = getSong(state.view.id);
  if (!song) { state.view = { type: 'list' }; render(); return; }
  const stats = getStats(song.id);
  appView.innerHTML = `
    <div class="page detail-page">
      <div class="detail-topbar"><button class="back-button" type="button" data-action="back">‹ <span>戻る</span></button><button class="icon-button more-button" type="button" data-action="song-menu" aria-label="曲の操作">•••</button></div>
      <section class="detail-hero"><div class="music-badge" aria-hidden="true">♫</div><div class="detail-title-wrap"><h1>${escapeHTML(song.title)}</h1>${song.artist ? `<p>${escapeHTML(song.artist)}</p>` : ''}</div><button class="heart-button detail-heart ${song.favorite ? 'is-favorite' : ''}" type="button" data-action="favorite-toggle" data-id="${escapeHTML(song.id)}" aria-label="お気に入り切り替え" aria-pressed="${song.favorite}">${song.favorite ? '♥' : '♡'}</button></section>
      <div class="section-heading"><h2>歌唱データ</h2><span>YOUR RECORD</span></div>
      ${renderStatsCard(stats)}
      <button class="primary-button record-button" type="button" data-action="open-score-add"><span aria-hidden="true">＋</span> 採点を記録</button>
      <div class="section-heading history-heading"><h2>採点履歴</h2><span>${stats.count} RECORD${stats.count === 1 ? '' : 'S'}</span></div>
      ${renderHistory(song)}
      <p class="detail-created">登録日：${escapeHTML(formatDate(song.createdAt))}</p>
    </div>`;
}

function renderSongForm() {
  const editing = Boolean(state.view.id);
  const song = editing ? getSong(state.view.id) : null;
  if (editing && !song) { state.view = { type: 'list' }; render(); return; }
  const original = song ? { title: song.title, artist: song.artist, favorite: song.favorite } : { title: '', artist: '', favorite: false };
  state.formOriginal = original;
  state.allowDuplicate = false;
  appView.innerHTML = `
    <div class="page form-page">
      <div class="detail-topbar"><button class="back-button" type="button" data-action="cancel-song-form">‹ <span>戻る</span></button></div>
      ${pageHeader(editing ? '曲情報を編集' : '曲を追加', editing ? '曲の情報を変更します' : '曲名だけでも登録できます')}
      <form id="song-form" data-form="song" novalidate>
        <label class="field-label" for="song-title">曲名 <span class="required">必須</span></label>
        <input class="text-input" id="song-title" name="title" type="text" maxlength="200" required placeholder="曲名を入力" value="${escapeHTML(song?.title ?? '')}" autocomplete="off" />
        <p class="field-error" id="title-error" aria-live="polite"></p>
        <label class="field-label" for="song-artist">アーティスト名 <span class="optional">任意</span></label>
        <input class="text-input" id="song-artist" name="artist" type="text" maxlength="200" placeholder="アーティスト名を入力" value="${escapeHTML(song?.artist ?? '')}" autocomplete="off" />
        <label class="favorite-setting"><span><strong>お気に入り</strong><small>お気に入り一覧に表示します</small></span><input name="favorite" type="checkbox" ${song?.favorite ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label>
        <div class="form-actions"><button class="primary-button" type="submit">${editing ? '変更を保存' : '登録する'}</button><button class="secondary-button" type="button" data-action="cancel-song-form">キャンセル</button></div>
        <div id="duplicate-warning" class="inline-warning" hidden></div>
      </form>
    </div>`;
    $('#song-title')?.focus({ preventScroll: true });
}

function renderSettingsPage() {
  const totalRecords = state.scoreRecords.length;
  appView.innerHTML = `
    <div class="page settings-page">
      ${pageHeader('設定', 'データの保存と管理')}
      <section class="settings-summary"><div class="summary-icon">♫</div><div><strong>My Karaoke</strong><span>この端末に保存しています</span></div><div class="summary-count"><strong>${state.songs.length}</strong><small>曲</small><strong>${totalRecords}</strong><small>記録</small></div></section>
      <div class="settings-section"><h2>データ管理</h2>
        <button class="setting-row" type="button" data-action="backup"><span class="setting-icon">⇩</span><span><strong>データをバックアップ</strong><small>曲・採点履歴・設定をJSONで保存</small></span><span class="row-chevron">›</span></button>
        <button class="setting-row" type="button" data-action="restore-select"><span class="setting-icon">⇧</span><span><strong>データを復元</strong><small>バックアップJSONから復元・追加</small></span><span class="row-chevron">›</span></button>
        <input id="restore-file" type="file" accept=".json,application/json" hidden />
      </div>
      <p class="backup-privacy-note">バックアップJSONには曲名・アーティスト名・採点履歴が含まれます。第三者と共有せず、安全な場所に保管してください。</p>
      <div class="settings-section"><h2>このアプリについて</h2>
        <div class="setting-row static-row"><span class="setting-icon">◈</span><span><strong>バージョン</strong><small>My Karaoke 1.3.0</small></span></div>
        <div class="setting-row static-row"><span class="setting-icon">⌁</span><span><strong>保存方式</strong><small>IndexedDB（端末内）・オフライン対応</small></span></div>
      </div>
      <div class="danger-zone"><button class="danger-button" type="button" data-action="delete-all-confirm">すべてのデータを削除</button><p>削除すると、この端末に保存された曲と採点履歴を元に戻せません。事前にバックアップしてください。</p></div>
      <p class="privacy-note">データは外部サーバーへ送信されません。ブラウザのデータ削除や端末変更に備えて、定期的にバックアップしてください。</p>
    </div>`;
}

function render() {
  if (state.view.type === 'list') renderListPage();
  else if (state.view.type === 'detail') renderDetailPage();
  else if (state.view.type === 'song-form') renderSongForm();
  else if (state.view.type === 'settings') renderSettingsPage();
  renderNav();
  renderOverlay();
}

function renderOverlay() {
  if (!state.overlay) { overlayRoot.innerHTML = ''; return; }
  overlayRoot.innerHTML = state.overlay;
}

function openModal(content, className = 'dialog') {
  if (!state.overlay) state.previousFocus = document.activeElement;
  state.overlay = `<div class="modal-backdrop" data-action="backdrop-close"><section class="${className}" role="dialog" aria-modal="true">${content}</section></div>`;
  renderOverlay();
}

function closeModal() {
  state.overlay = null;
  renderOverlay();
  const focusTarget = state.previousFocus;
  state.previousFocus = null;
  if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
    focusTarget.focus({ preventScroll: true });
  }
}

function openSortSheet() {
  openModal(`
    <div class="sheet-grabber"></div><div class="sheet-heading"><div><p class="eyebrow">DISPLAY</p><h2>並び替え</h2></div><button class="icon-button" type="button" data-action="modal-close" aria-label="閉じる">×</button></div>
    <div class="sort-options">${SORT_OPTIONS.map((item) => `<button class="sort-option ${state.settings.sortKey === item.key ? 'chosen' : ''}" type="button" data-action="set-sort" data-key="${item.key}"><span><strong>${item.label}</strong><small>${item.detail}</small></span><span class="radio-mark">${state.settings.sortKey === item.key ? '●' : '○'}</span></button>`).join('')}</div>`, 'bottom-sheet');
}

function openScoreAdd() {
  const song = getSong(state.view.id);
  if (!song) return;
  openModal(`
    <div class="sheet-grabber"></div><div class="sheet-heading"><div><p class="eyebrow">NEW RECORD</p><h2>採点を記録</h2></div><button class="icon-button" type="button" data-action="modal-close" aria-label="閉じる">×</button></div>
    <p class="sheet-song-title">${escapeHTML(song.title)}</p>${song.artist ? `<p class="sheet-song-artist">${escapeHTML(song.artist)}</p>` : ''}
    <form data-form="score-add" class="score-form" novalidate>
      <label class="field-label" for="score-input">採点結果 <span class="optional">5桁の数字</span></label>
      <div class="score-input-wrap"><input id="score-input" name="score" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" placeholder="00000" aria-describedby="score-help" /><span class="score-unit">点</span></div>
      <p class="score-preview-label">点数プレビュー</p><div id="score-preview" class="score-preview">—.———<small>点</small></div>
      <p id="score-help" class="field-hint">例：93863 → 93.863点</p><p id="score-error" class="field-error" aria-live="polite"></p>
      <button class="primary-button" type="submit" disabled>記録する</button><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button>
    </form>`, 'bottom-sheet');
  $('#score-input')?.focus({ preventScroll: true });
}

function openScoreEdit(recordId) {
  const record = state.scoreRecords.find((item) => item.id === recordId);
  if (!record) return;
  openModal(`
    <div class="sheet-grabber"></div><div class="sheet-heading"><div><p class="eyebrow">EDIT RECORD</p><h2>採点履歴を編集</h2></div><button class="icon-button" type="button" data-action="modal-close" aria-label="閉じる">×</button></div>
    <form data-form="score-edit" data-id="${escapeHTML(record.id)}" class="score-form" novalidate>
      <label class="field-label" for="edit-score-input">点数</label><div class="score-input-wrap"><input id="edit-score-input" name="score" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" value="${String(record.scoreMilli).padStart(5, '0')}" autocomplete="off" /><span class="score-unit">点</span></div>
      <label class="field-label" for="edit-sung-at">歌唱日時</label><input id="edit-sung-at" class="text-input" name="sungAt" type="datetime-local" value="${toLocalDateTimeValue(record.sungAt)}" required />
      <p id="edit-score-error" class="field-error" aria-live="polite"></p><button class="primary-button" type="submit">変更を保存</button><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button>
    </form>`, 'bottom-sheet');
  $('#edit-score-input')?.focus({ preventScroll: true });
}

function openSongMenu() {
  openModal(`<div class="menu-dialog"><h2>曲の操作</h2><button class="menu-row" type="button" data-action="edit-song">✎ <span>曲情報を編集</span></button><button class="menu-row danger-text" type="button" data-action="song-delete-confirm">⌫ <span>曲を削除</span></button><button class="secondary-button" type="button" data-action="modal-close">閉じる</button></div>`);
}

function openScoreMenu(recordId) {
  openModal(`<div class="menu-dialog"><h2>採点履歴の操作</h2><button class="menu-row" type="button" data-action="edit-score" data-id="${escapeHTML(recordId)}">✎ <span>点数・日時を編集</span></button><button class="menu-row danger-text" type="button" data-action="score-delete-confirm" data-id="${escapeHTML(recordId)}">⌫ <span>この履歴を削除</span></button><button class="secondary-button" type="button" data-action="modal-close">閉じる</button></div>`);
}

function openSongDeleteConfirm() {
  const song = getSong(state.view.id);
  if (!song) return;
  openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>曲を削除しますか？</h2><p>「${escapeHTML(song.title)}」と、この曲に紐づく採点履歴をすべて削除します。この操作は取り消せません。</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button><button class="danger-button" type="button" data-action="song-delete-final">削除する</button></div></div>`);
}

function openScoreDeleteConfirm(recordId) {
  const record = state.scoreRecords.find((item) => item.id === recordId);
  if (!record) return;
  openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>採点履歴を削除しますか？</h2><p>${formatScore(record.scoreMilli)}点・${escapeHTML(formatDate(record.sungAt, true))} の記録を削除します。</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button><button class="danger-button" type="button" data-action="score-delete-final" data-id="${escapeHTML(recordId)}">削除する</button></div></div>`);
}

function openDeleteAllConfirm() {
  openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>すべてのデータを削除</h2><p>登録したすべての曲・採点履歴・設定が削除されます。元に戻すことはできません。必要な場合は先にバックアップしてください。</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button><button class="danger-button" type="button" data-action="delete-all-final">次へ</button></div></div>`);
}

function openDeleteAllFinalConfirm() {
  openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>本当に削除しますか？</h2><p>最後の確認です。すべてのデータを完全に削除します。</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="modal-close">戻る</button><button class="danger-button" type="button" data-action="delete-all-commit">すべて削除する</button></div></div>`);
}

function openDiscardConfirm() {
  openModal(`<div class="confirm-dialog"><h2>変更を破棄しますか？</h2><p>入力中の内容は保存されません。</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="modal-close">入力を続ける</button><button class="danger-button" type="button" data-action="discard-song-form">破棄する</button></div></div>`);
}

function openRestoreChoice() {
  const backup = state.pendingBackup;
  if (!backup) return;
  openModal(`<div class="confirm-dialog restore-dialog"><div class="confirm-icon">⇧</div><h2>復元方法を選択</h2><p>バックアップ：${backup.songs.length}曲・${backup.scoreRecords.length}件の採点記録</p><p class="warning-copy">復元前に、現在のデータもバックアップしておくことをおすすめします。</p><button class="restore-choice" type="button" data-action="restore-replace"><strong>置き換え</strong><small>現在の曲・履歴・設定をバックアップ内容に置き換えます。</small></button><button class="restore-choice" type="button" data-action="restore-merge"><strong>追加（マージ）</strong><small>現在のデータを残し、新しいIDのデータを追加します。既存データは上書きしません。</small></button><button class="secondary-button" type="button" data-action="modal-close">キャンセル</button></div>`);
}

function openRestoreConfirm(mode, plan = null) {
  const backup = state.pendingBackup;
  if (!backup) return;
  const replace = mode === 'replace';
  let details = `${backup.songs.length}曲・${backup.scoreRecords.length}件の採点記録・${Object.keys(backup.settings ?? {}).length}件の設定`;
  if (plan) details = `${plan.newSongs.length}曲を追加、${plan.newScores.length}件の採点記録を追加<br>スキップ ${plan.skippedSongs + plan.skippedScores + plan.skippedSettings + plan.skippedDependentScores}件・競合 ${plan.songConflicts + plan.scoreConflicts}件`;
  openModal(`<div class="confirm-dialog"><div class="confirm-icon">⇧</div><h2>${replace ? 'データを置き換えますか？' : 'データを追加しますか？'}</h2><p>${details}</p><p class="warning-copy">${replace ? '現在のデータはすべて置き換わります。' : '競合するIDのデータは上書きせずスキップします。'}</p><div class="dialog-actions"><button class="secondary-button" type="button" data-action="restore-back">戻る</button><button class="primary-button" type="button" data-action="restore-commit" data-mode="${mode}">確定して復元</button></div></div>`);
}

function navigateToList(tab = 'songs') {
  state.activeTab = tab;
  state.view = { type: 'list' };
  state.search = '';
  render();
}

function startSongForm(id = null) {
  if (!id && state.view.type === 'list') state.listScrollY = window.scrollY;
  state.view = { type: 'song-form', id };
  render();
}

function cancelSongForm() {
  const form = $('#song-form');
  if (form) {
    const values = new FormData(form);
    const current = {
      title: String(values.get('title') ?? '').trim(),
      artist: String(values.get('artist') ?? '').trim(),
      favorite: values.get('favorite') === 'on',
    };
    const original = state.formOriginal ?? { title: '', artist: '', favorite: false };
    if (JSON.stringify(current) !== JSON.stringify(original)) { openDiscardConfirm(); return; }
  }
  returnFromSongForm();
}

function returnFromSongForm() {
  const fromList = !state.view.id;
  if (!fromList) state.view = { type: 'detail', id: state.view.id };
  else state.view = { type: 'list' };
  render();
  if (fromList) requestAnimationFrame(() => window.scrollTo(0, state.listScrollY));
}

async function saveSongForm(form) {
  const values = new FormData(form);
  const title = String(values.get('title') ?? '').trim();
  const artist = String(values.get('artist') ?? '').trim();
  const favorite = values.get('favorite') === 'on';
  const titleError = $('#title-error');
  titleError.textContent = '';
  if (!title) { titleError.textContent = '曲名を入力してください。'; $('#song-title').focus(); return; }
  if (title.length > 200 || artist.length > 200) { titleError.textContent = '曲名・アーティスト名は200文字以内で入力してください。'; return; }
  const editingId = state.view.id;
  const duplicates = state.songs.filter((song) => song.id !== editingId
    && song.title.normalize('NFKC').trim().toLocaleLowerCase('ja-JP') === title.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')
    && String(song.artist ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP') === artist.normalize('NFKC').trim().toLocaleLowerCase('ja-JP'));
  const warning = $('#duplicate-warning');
  if (duplicates.length && !state.allowDuplicate) {
    warning.hidden = false;
    warning.innerHTML = `<strong>同じ曲名・アーティスト名の曲があります。</strong><ul>${duplicates.slice(0, 3).map((song) => `<li>${escapeHTML(song.title)}${song.artist ? ` — ${escapeHTML(song.artist)}` : ''}</li>`).join('')}</ul><p>別バージョンなどとして登録する場合は、もう一度「登録を続ける」を押してください。</p><button class="primary-button" type="button" data-action="confirm-duplicate">登録を続ける</button>`;
    state.allowDuplicate = true;
    return;
  }
  const timestamp = nowISO();
  const song = editingId
    ? { ...getSong(editingId), title, artist, favorite, updatedAt: timestamp }
    : { id: makeId(), title, artist, favorite, createdAt: timestamp, updatedAt: timestamp };
  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  try {
    if (editingId) {
      await putSong(song);
      await refreshData();
      state.view = { type: 'detail', id: editingId };
      render();
      announce('曲情報を更新しました');
    } else {
      await addSong(song);
      await refreshData();
      state.view = { type: 'detail', id: song.id };
      render();
      announce('曲を登録しました');
    }
  } catch (error) {
    submit.disabled = false;
    showError(error, '曲を保存できませんでした。入力内容を確認して再試行してください。');
  }
}

async function saveScoreAdd(form) {
  const input = $('#score-input');
  const value = input.value;
  const scoreMilli = scoreInputToMilli(value);
  if (scoreMilli == null) { $('#score-error').textContent = '半角数字5桁で入力してください。'; return; }
  const songId = state.view.id;
  const record = { id: makeId(), songId, scoreMilli, sungAt: nowISO(), createdAt: nowISO() };
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    await addScore(record);
    closeModal();
    await refreshData();
    render();
    announce(`${formatScore(scoreMilli)}点を記録しました`, '取り消す', { type: 'delete-added-score', id: record.id });
  } catch (error) {
    button.disabled = false;
    $('#score-error').textContent = '保存できませんでした。もう一度お試しください。';
    showError(error, '採点を保存できませんでした');
  }
}

async function saveScoreEdit(form) {
  const id = form.dataset.id;
  const scoreMilli = scoreInputToMilli($('#edit-score-input').value);
  const sungAt = fromLocalDateTimeValue($('#edit-sung-at').value);
  const errorEl = $('#edit-score-error');
  if (scoreMilli == null) { errorEl.textContent = '点数は半角数字5桁で入力してください。'; return; }
  if (!sungAt) { errorEl.textContent = '有効な歌唱日時を入力してください。'; return; }
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    await updateScore(id, { scoreMilli, sungAt });
    closeModal();
    await refreshData();
    render();
    announce('採点履歴を更新しました');
  } catch (error) {
    button.disabled = false;
    errorEl.textContent = '保存できませんでした。もう一度お試しください。';
    showError(error);
  }
}

async function deleteCurrentSong() {
  const song = getSong(state.view.id);
  if (!song) return;
  closeModal();
  try {
    await deleteSongCascade(song.id);
    await refreshData();
    state.view = { type: 'list' };
    render();
    announce('曲と関連する採点履歴を削除しました');
  } catch (error) { showError(error, '曲を削除できませんでした。データは変更されていません。'); }
}

async function deleteCurrentScore(id) {
  closeModal();
  try {
    const record = await deleteScore(id);
    await refreshData();
    render();
    if (record) announce('採点履歴を削除しました', '取り消す', { type: 'restore-score', record });
  } catch (error) { showError(error, '採点履歴を削除できませんでした'); }
}

async function handleUndo() {
  const undo = state.undo;
  clearTimeout(state.toastTimer);
  toastRoot.innerHTML = '';
  state.undo = null;
  if (!undo) return;
  try {
    if (undo.type === 'delete-added-score') await deleteScore(undo.id);
    else if (undo.type === 'restore-score') await addScore(undo.record);
    await refreshData();
    render();
    announce('操作を取り消しました');
  } catch (error) { showError(error, '取り消しに失敗しました'); }
}

async function toggleFavorite(id) {
  const song = getSong(id);
  if (!song) return;
  try {
    await setFavorite(id, !song.favorite);
    await refreshData();
    render();
    announce(!song.favorite ? 'お気に入りに追加しました' : 'お気に入りを解除しました');
  } catch (error) { showError(error, 'お気に入りを更新できませんでした'); }
}

async function downloadBackup() {
  try {
    const snapshot = await getSnapshot();
    const backup = { app: APP_NAME, schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), ...snapshot };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `my-karaoke-backup-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('バックアップファイルを作成しました');
  } catch (error) { showError(error, 'バックアップを作成できませんでした'); }
}

async function loadBackupFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    const errors = validateBackup(backup);
    if (errors.length) {
      openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>バックアップを読み込めません</h2><p>ファイルの形式またはデータに問題があります。</p><ul class="error-list">${errors.slice(0, 10).map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul><button class="primary-button" type="button" data-action="modal-close">閉じる</button></div>`);
      return;
    }
    state.pendingBackup = backup;
    openRestoreChoice();
  } catch (error) {
    openModal(`<div class="confirm-dialog"><div class="confirm-icon danger">!</div><h2>ファイルを読み込めません</h2><p>JSONファイルを選択してください。ファイルが破損している可能性があります。</p><button class="primary-button" type="button" data-action="modal-close">閉じる</button></div>`);
  }
}

async function commitRestore(mode) {
  const backup = state.pendingBackup;
  if (!backup) return;
  closeModal();
  try {
    if (mode === 'replace') {
      await replaceAllData(backup);
      await refreshData();
      state.pendingBackup = null;
      state.view = { type: 'settings' };
      render();
      announce(`復元しました（${backup.songs.length}曲・${backup.scoreRecords.length}件）`);
    } else {
      const existing = await getSnapshot();
      const plan = planMerge(existing, backup);
      await mergeData(plan);
      await refreshData();
      state.pendingBackup = null;
      state.view = { type: 'settings' };
      render();
      announce(`追加しました（曲${plan.newSongs.length}・採点${plan.newScores.length}件）`);
      openModal(`<div class="confirm-dialog"><h2>追加インポート完了</h2><p>曲 ${plan.newSongs.length}件、採点記録 ${plan.newScores.length}件を追加しました。</p><ul class="import-result"><li>曲の重複スキップ：${plan.skippedSongs}件</li><li>曲ID競合：${plan.songConflicts}件</li><li>採点記録の重複スキップ：${plan.skippedScores}件</li><li>採点記録ID競合：${plan.scoreConflicts}件</li><li>競合曲に紐づくためスキップ：${plan.skippedDependentScores}件</li><li>設定スキップ：${plan.skippedSettings}件</li></ul><button class="primary-button" type="button" data-action="modal-close">閉じる</button></div>`);
    }
  } catch (error) {
    await refreshData().catch(() => {});
    render();
    showError(error, '復元に失敗しました。既存データは変更されていません。');
  }
}

async function clearAll() {
  closeModal();
  try {
    await clearAllData();
    await refreshData();
    state.search = '';
    state.activeTab = 'songs';
    state.view = { type: 'list' };
    render();
    announce('すべてのデータを削除しました');
  } catch (error) { showError(error, 'データを削除できませんでした'); }
}

async function setSort(key) {
  if (!SORT_OPTIONS.some((item) => item.key === key)) return;
  state.settings.sortKey = key;
  try { await saveSetting('sortKey', key); }
  catch (error) { showError(error, '並び替え設定を保存できませんでした'); }
  closeModal();
  renderListResults();
}

async function setFilter(key) {
  if (!FILTER_OPTIONS.some((item) => item.key === key)) return;
  state.settings.filterKey = key;
  try { await saveSetting('filterKey', key); }
  catch (error) { showError(error, '絞り込み設定を保存できませんでした'); }
  renderListPage();
  renderNav();
}

// Click actions are delegated so newly rendered controls need no individual listeners.
document.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  const id = control.dataset.id;
  try {
    switch (action) {
      case 'reload': location.reload(); break;
      case 'nav-songs': navigateToList('songs'); break;
      case 'nav-favorites': navigateToList('favorites'); break;
      case 'nav-settings': state.view = { type: 'settings' }; render(); break;
      case 'add-song': startSongForm(); break;
      case 'open-song': state.listScrollY = window.scrollY; state.view = { type: 'detail', id }; render(); break;
      case 'favorite-toggle': event.stopPropagation(); await toggleFavorite(id); break;
      case 'back': state.view = { type: 'list' }; render(); requestAnimationFrame(() => window.scrollTo(0, state.listScrollY)); break;
      case 'open-sort': openSortSheet(); break;
      case 'set-sort': await setSort(control.dataset.key); break;
      case 'set-filter': await setFilter(control.dataset.key); break;
      case 'clear-search': state.search = ''; renderListPage(); break;
      case 'clear-filter': await setFilter('all'); break;
      case 'edit-song': closeModal(); startSongForm(state.view.id); break;
      case 'cancel-song-form': cancelSongForm(); break;
      case 'discard-song-form': closeModal(); returnFromSongForm(); break;
      case 'confirm-duplicate': state.allowDuplicate = true; $('#duplicate-warning')?.setAttribute('hidden', ''); $('#song-form')?.requestSubmit(); break;
      case 'song-menu': openSongMenu(); break;
      case 'song-delete-confirm': openSongDeleteConfirm(); break;
      case 'song-delete-final': await deleteCurrentSong(); break;
      case 'open-score-add': openScoreAdd(); break;
      case 'open-score-menu': openScoreMenu(id); break;
      case 'edit-score': closeModal(); openScoreEdit(id); break;
      case 'score-delete-confirm': openScoreDeleteConfirm(id); break;
      case 'score-delete-final': await deleteCurrentScore(id); break;
      case 'modal-close': closeModal(); break;
      case 'backdrop-close': if (event.target === control) closeModal(); break;
      case 'undo': await handleUndo(); break;
      case 'backup': await downloadBackup(); break;
      case 'restore-select': $('#restore-file')?.click(); break;
      case 'restore-replace': openRestoreConfirm('replace'); break;
      case 'restore-merge': {
        const existing = await getSnapshot();
        const plan = planMerge(existing, state.pendingBackup);
        openRestoreConfirm('merge', plan);
        break;
      }
      case 'restore-back': openRestoreChoice(); break;
      case 'restore-commit': await commitRestore(control.dataset.mode); break;
      case 'delete-all-confirm': openDeleteAllConfirm(); break;
      case 'delete-all-final': openDeleteAllFinalConfirm(); break;
      case 'delete-all-commit': await clearAll(); break;
      default: break;
    }
  } catch (error) { showError(error); }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'song') await saveSongForm(form);
  else if (form.dataset.form === 'score-add') await saveScoreAdd(form);
  else if (form.dataset.form === 'score-edit') await saveScoreEdit(form);
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'song-search') {
    state.search = event.target.value;
    renderListResults();
    let clear = $('.search-clear');
    if (state.search && !clear) {
      $('.search-box')?.insertAdjacentHTML('beforeend', '<button class="search-clear" type="button" data-action="clear-search" aria-label="検索をクリア">×</button>');
      clear = $('.search-clear');
    } else if (!state.search && clear) {
      clear.remove();
    }
    if (clear) clear.setAttribute('aria-label', '検索をクリア');
    return;
  }
  if (event.target.id === 'score-input' || event.target.id === 'edit-score-input') {
    const cleaned = event.target.value.replace(/[^0-9]/g, '').slice(0, 5);
    if (event.target.value !== cleaned) event.target.value = cleaned;
    if (event.target.id === 'score-input') {
      const score = scoreInputToMilli(cleaned);
      $('#score-preview').innerHTML = `${score == null ? '—.———' : formatScore(score)}<small>点</small>`;
      $('button[type="submit"]', event.target.closest('form')).disabled = score == null;
      $('#score-error').textContent = '';
    }
    return;
  }
  if (event.target.closest('#song-form')) {
    state.allowDuplicate = false;
    const warning = $('#duplicate-warning');
    if (warning) warning.hidden = true;
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id !== 'restore-file') return;
  await loadBackupFile(event.target.files?.[0]);
  event.target.value = '';
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.overlay) {
    event.preventDefault();
    closeModal();
  }
});

// Keep the overlay inside the visible viewport when the on-screen keyboard opens.
function updateVisibleViewport() {
  if (!window.visualViewport) return;
  document.documentElement.style.setProperty('--visual-height', `${window.visualViewport.height}px`);
  document.documentElement.style.setProperty('--visual-offset', `${window.visualViewport.offsetTop}px`);
}
window.visualViewport?.addEventListener('resize', updateVisibleViewport);
window.visualViewport?.addEventListener('scroll', updateVisibleViewport);
updateVisibleViewport();

async function initialize() {
  try {
    await refreshData();
    render();
    try { await navigator.storage?.persist?.(); } catch { /* Best-effort storage persistence only. */ }
  } catch (error) {
    appView.innerHTML = `<div class="fatal-error"><h1>データを読み込めません</h1><p>${escapeHTML(error.message ?? 'IndexedDBを利用できません')}</p><button class="primary-button" type="button" data-action="reload">再読み込み</button></div>`;
    navRoot.hidden = true;
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service Worker registration failed:', error));
  });
}

initialize();
