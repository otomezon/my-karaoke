const DB_NAME = 'myKaraokeDB';
const DB_VERSION = 1;

let dbPromise;

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('このブラウザはIndexedDBに対応していません'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('songs')) {
          const songs = db.createObjectStore('songs', { keyPath: 'id' });
          songs.createIndex('createdAt', 'createdAt', { unique: false });
          songs.createIndex('title', 'title', { unique: false });
        }
        if (!db.objectStoreNames.contains('scoreRecords')) {
          const scores = db.createObjectStore('scoreRecords', { keyPath: 'id' });
          scores.createIndex('songId', 'songId', { unique: false });
          scores.createIndex('sungAt', 'sungAt', { unique: false });
          scores.createIndex('[songId+sungAt]', ['songId', 'sungAt'], { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('データベースを開けませんでした'));
      request.onblocked = () => reject(new Error('別のタブがデータベース更新を妨げています。ほかのタブを閉じて再読み込みしてください'));
    });
  }
  return dbPromise;
}

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const values = await requestValue(tx.objectStore(storeName).getAll());
  await transactionDone(tx);
  return values;
}

export async function getSong(id) {
  const db = await openDatabase();
  const tx = db.transaction('songs', 'readonly');
  const value = await requestValue(tx.objectStore('songs').get(id));
  await transactionDone(tx);
  return value;
}

export async function putSong(song) {
  const db = await openDatabase();
  const tx = db.transaction('songs', 'readwrite');
  tx.objectStore('songs').put(song);
  await transactionDone(tx);
  return song;
}

export async function addSong(song) {
  const db = await openDatabase();
  const tx = db.transaction('songs', 'readwrite');
  tx.objectStore('songs').add(song);
  await transactionDone(tx);
  return song;
}

export async function setFavorite(id, favorite) {
  const db = await openDatabase();
  const tx = db.transaction('songs', 'readwrite');
  const store = tx.objectStore('songs');
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) { tx.abort(); return; }
    store.put({ ...request.result, favorite, updatedAt: new Date().toISOString() });
  };
  await transactionDone(tx);
}

export async function deleteSongCascade(id) {
  const db = await openDatabase();
  const tx = db.transaction(['songs', 'scoreRecords'], 'readwrite');
  const songs = tx.objectStore('songs');
  const scores = tx.objectStore('scoreRecords');
  const request = scores.index('songId').getAll(id);
  request.onsuccess = () => {
    for (const record of request.result) scores.delete(record.id);
    songs.delete(id);
  };
  await transactionDone(tx);
}

export async function addScore(record) {
  const db = await openDatabase();
  const tx = db.transaction('scoreRecords', 'readwrite');
  tx.objectStore('scoreRecords').add(record);
  await transactionDone(tx);
  return record;
}

export async function updateScore(id, changes) {
  const db = await openDatabase();
  const tx = db.transaction('scoreRecords', 'readwrite');
  const store = tx.objectStore('scoreRecords');
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) { tx.abort(); return; }
    store.put({ ...request.result, ...changes });
  };
  await transactionDone(tx);
}

export async function deleteScore(id) {
  const db = await openDatabase();
  const tx = db.transaction('scoreRecords', 'readwrite');
  const store = tx.objectStore('scoreRecords');
  const request = store.get(id);
  let removed = null;
  request.onsuccess = () => {
    removed = request.result ?? null;
    if (removed) store.delete(id);
  };
  await transactionDone(tx);
  return removed;
}

export async function saveSetting(key, value) {
  const db = await openDatabase();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await transactionDone(tx);
}

export async function getSnapshot() {
  const db = await openDatabase();
  const tx = db.transaction(['songs', 'scoreRecords', 'settings'], 'readonly');
  const songsRequest = tx.objectStore('songs').getAll();
  const scoresRequest = tx.objectStore('scoreRecords').getAll();
  const settingsRequest = tx.objectStore('settings').getAll();
  const [songs, scoreRecords, settingsRows] = await Promise.all([
    requestValue(songsRequest), requestValue(scoresRequest), requestValue(settingsRequest),
  ]);
  await transactionDone(tx);
  const settings = Object.fromEntries(settingsRows.map(({ key, value }) => [key, value]));
  return { songs, scoreRecords, settings };
}

export async function replaceAllData(data) {
  const db = await openDatabase();
  const tx = db.transaction(['songs', 'scoreRecords', 'settings'], 'readwrite');
  const songs = tx.objectStore('songs');
  const scores = tx.objectStore('scoreRecords');
  const settings = tx.objectStore('settings');
  songs.clear();
  scores.clear();
  settings.clear();
  for (const song of data.songs) songs.put(song);
  for (const record of data.scoreRecords) scores.put(record);
  for (const [key, value] of Object.entries(data.settings ?? {})) settings.put({ key, value });
  await transactionDone(tx);
}

export async function mergeData(plan) {
  const db = await openDatabase();
  const tx = db.transaction(['songs', 'scoreRecords', 'settings'], 'readwrite');
  const songs = tx.objectStore('songs');
  const scores = tx.objectStore('scoreRecords');
  const settings = tx.objectStore('settings');
  for (const song of plan.newSongs) songs.add(song);
  for (const record of plan.newScores) scores.add(record);
  for (const [key, value] of Object.entries(plan.newSettings)) settings.add({ key, value });
  await transactionDone(tx);
}

export async function clearAllData() {
  const db = await openDatabase();
  const tx = db.transaction(['songs', 'scoreRecords', 'settings'], 'readwrite');
  tx.objectStore('songs').clear();
  tx.objectStore('scoreRecords').clear();
  tx.objectStore('settings').clear();
  await transactionDone(tx);
}
