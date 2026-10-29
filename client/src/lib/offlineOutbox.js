const DB_NAME = "nexuschat-offline";
const STORE_NAME = "outbox";
const DB_VERSION = 1;

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is unavailable in this browser"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "clientMessageId" });
        store.createIndex("ownerId", "ownerId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline message storage"));
  });
}

async function withStore(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Offline message storage failed"));
      tx.onabort = () => reject(tx.error || new Error("Offline message transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export const saveOutboxMessage = (message) => withStore("readwrite", (store) => store.put(message));
export const removeOutboxMessage = (clientMessageId) => withStore("readwrite", (store) => store.delete(clientMessageId));
export const listOutboxMessages = async (ownerId) => {
  const all = await withStore("readonly", (store) => store.getAll());
  return (all || []).filter((item) => String(item.ownerId) === String(ownerId)).sort((a, b) => a.createdAt - b.createdAt);
};
