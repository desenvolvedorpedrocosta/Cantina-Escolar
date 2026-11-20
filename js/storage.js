const DB_NAME = 'cantina-gremio-local';
const DB_VERSION = 1;
const QUEUE_STORE = 'fila';

let dbPromise;

function abrirBanco() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'idRequisicao' });
        store.createIndex('criadoEm', 'criadoEm', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });

  return dbPromise;
}

export async function salvarNaFila(item) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error || new Error('Não foi possível guardar a movimentação no aparelho.'));
  });
}

export async function listarFila() {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const request = tx.objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => {
      const items = request.result || [];
      items.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
      resolve(items);
    };
    request.onerror = () => reject(request.error || new Error('Não foi possível consultar a fila local.'));
  });
}

export async function atualizarFila(item) {
  return salvarNaFila(item);
}

export async function removerDaFila(idRequisicao) {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).delete(idRequisicao);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Não foi possível atualizar a fila local.'));
  });
}

export function obterSessao() {
  try {
    return JSON.parse(localStorage.getItem('cantina_sessao') || 'null');
  } catch {
    return null;
  }
}

export function salvarSessao(sessao) {
  localStorage.setItem('cantina_sessao', JSON.stringify(sessao));
}

export function limparSessao() {
  localStorage.removeItem('cantina_sessao');
}
