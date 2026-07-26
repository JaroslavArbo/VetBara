// Local, offline-first media store for exam recordings and report photos.
//
// Blobs (voice recordings, photos) are persisted in IndexedDB on the capturing
// tablet so they survive reloads and remain downloadable even with no backend.
// When Supabase Storage is configured the same blob is also uploaded; the local
// copy stays as a backup and marks its upload state here.

const DB_NAME = "vetbara-media";
const DB_VERSION = 1;
const STORE = "media";

let dbPromise = null;

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  if (!hasIndexedDb()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientMediaId" });
        store.createIndex("mediaType", "mediaType", { unique: false });
        store.createIndex("candidateId", "candidateId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// Save (or update) one media record with its blob and metadata.
export async function saveLocalMedia(record) {
  if (!hasIndexedDb() || !record?.clientMediaId) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const request = tx(db, "readwrite").put({
        uploadState: "local",
        createdAt: new Date().toISOString(),
        ...record,
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch (error) {
    console.warn("Local media save failed", error);
    return false;
  }
}

// Patch metadata fields (e.g. mark uploadState after a successful upload).
export async function updateLocalMedia(clientMediaId, updates) {
  if (!hasIndexedDb() || !clientMediaId) return false;
  try {
    const db = await openDb();
    const existing = await new Promise((resolve, reject) => {
      const request = tx(db, "readonly").get(clientMediaId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (!existing) return false;
    await new Promise((resolve, reject) => {
      const request = tx(db, "readwrite").put({ ...existing, ...updates });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch (error) {
    console.warn("Local media update failed", error);
    return false;
  }
}

// Return all locally stored media (metadata + blob), newest first.
export async function listLocalMedia() {
  if (!hasIndexedDb()) return [];
  try {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const request = tx(db, "readonly").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (error) {
    console.warn("Local media list failed", error);
    return [];
  }
}

export async function getLocalMedia(clientMediaId) {
  if (!hasIndexedDb() || !clientMediaId) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = tx(db, "readonly").get(clientMediaId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Local media get failed", error);
    return null;
  }
}

export async function deleteLocalMedia(clientMediaId) {
  if (!hasIndexedDb() || !clientMediaId) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const request = tx(db, "readwrite").delete(clientMediaId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch (error) {
    console.warn("Local media delete failed", error);
    return false;
  }
}

// Trigger a browser download for a stored blob.
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "vetbara-media";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
