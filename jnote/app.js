const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'Notes';
let currentNoteId = null;
let folderModalCallback = null;
let selectedFolderInModal = '';
let currentNoteState = { title: '', content: '' };
const DRAFTS_STORAGE_KEY = 'jnote.unsavedDrafts.v1';
const LOCAL_NOTES_STORAGE_KEY = 'jnote.localNotes.v1';
const PENDING_PUSHES_STORAGE_KEY = 'jnote.pendingPushes.v1';
const CUSTOM_CSS_STORAGE_KEY = 'jnote.customCss.v1';
const ENCRYPTION_METADATA_STORAGE_KEY = 'jnote.encryptionMetadata.v1';
const ENCRYPTION_PASSPHRASE_STORAGE_KEY = 'jnote.encryptionPassphrase.v1';
const PUSH_RETRY_DELAY = 5000;
const ENCRYPTED_VALUE_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KDF_ALGORITHM = 'PBKDF2';
const KDF_HASH = 'SHA-256';
const KDF_ITERATIONS = 310000;
const AES_KEY_LENGTH = 256;
const ENCRYPTION_SALT_BYTES = 16;
const ENCRYPTION_IV_BYTES = 12;
let drafts = {};
let localNotes = {};
let pendingPushes = {};
let activePushes = new Set();
let pushRetryTimers = new Map();
let hasPushError = false;
let syncStatusAnimationTimer = null;
let activeNoteContextMenuId = null;
let encryptionState = null;
let encryptedStorePersistVersions = {};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

applyCustomCss();

// ─── Client-Side Encryption ──────────────────────────────────────────────────

function assertWebCryptoAvailable() {
  if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
    throw new Error('Web Crypto is unavailable. Open this app over HTTPS or localhost.');
  }
}

function createEncryptionMetadata(salt = randomBase64(ENCRYPTION_SALT_BYTES)) {
  return {
    v: ENCRYPTED_VALUE_VERSION,
    alg: ENCRYPTION_ALGORITHM,
    kdf: {
      alg: KDF_ALGORITHM,
      hash: KDF_HASH,
      iterations: KDF_ITERATIONS,
      salt
    }
  };
}

function normalizeEncryptionMetadata(metadata) {
  if (!metadata || metadata.v !== ENCRYPTED_VALUE_VERSION || metadata.alg !== ENCRYPTION_ALGORITHM) return null;
  if (metadata.kdf?.alg !== KDF_ALGORITHM || metadata.kdf?.hash !== KDF_HASH) return null;
  if (!Number.isInteger(metadata.kdf?.iterations) || metadata.kdf.iterations <= 0) return null;
  if (typeof metadata.kdf?.salt !== 'string' || !metadata.kdf.salt) return null;
  return {
    v: metadata.v,
    alg: metadata.alg,
    kdf: {
      alg: metadata.kdf.alg,
      hash: metadata.kdf.hash,
      iterations: metadata.kdf.iterations,
      salt: metadata.kdf.salt
    }
  };
}

function getStoredEncryptionMetadata() {
  try {
    return normalizeEncryptionMetadata(JSON.parse(localStorage.getItem(ENCRYPTION_METADATA_STORAGE_KEY) || 'null'));
  } catch (err) {
    console.warn('Could not read encryption metadata:', err);
    return null;
  }
}

function saveEncryptionMetadata(metadata) {
  try {
    localStorage.setItem(ENCRYPTION_METADATA_STORAGE_KEY, JSON.stringify(metadata));
  } catch (err) {
    console.warn('Could not save encryption metadata:', err);
  }
}

function getStoredEncryptionPassphrase() {
  try {
    return localStorage.getItem(ENCRYPTION_PASSPHRASE_STORAGE_KEY) || '';
  } catch (err) {
    console.warn('Could not read saved encryption passphrase:', err);
    return '';
  }
}

function saveEncryptionPassphrase(passphrase) {
  try {
    localStorage.setItem(ENCRYPTION_PASSPHRASE_STORAGE_KEY, passphrase);
  } catch (err) {
    console.warn('Could not save encryption passphrase:', err);
  }
}

function clearStoredEncryptionPassphrase() {
  try {
    localStorage.removeItem(ENCRYPTION_PASSPHRASE_STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear saved encryption passphrase:', err);
  }
}

async function getRemoteEncryptionMetadata() {
  const result = await pb.collection('jnote').getList(1, 1, {
    sort: '-updated',
    filter: 'deleted=false'
  });
  const record = result.items[0];
  if (!record) return null;

  return extractEncryptionMetadata(record.title) || extractEncryptionMetadata(record.folder);
}

async function resolveEncryptionMetadata() {
  const storedMetadata = getStoredEncryptionMetadata();
  let remoteMetadata = null;

  try {
    remoteMetadata = await getRemoteEncryptionMetadata();
  } catch (err) {
    if (!storedMetadata) console.warn('Could not read remote encryption metadata:', err);
  }

  if (remoteMetadata) return remoteMetadata;

  if (storedMetadata) return storedMetadata;

  return createEncryptionMetadata();
}

async function unlockEncryption(passphrase) {
  assertWebCryptoAvailable();

  const metadata = await resolveEncryptionMetadata();
  const key = await deriveEncryptionKey(passphrase, metadata);
  encryptionState = { key, metadata };

  await validateEncryptionKey();
  saveEncryptionMetadata(metadata);
}

async function deriveEncryptionKey(passphrase, metadata) {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    KDF_ALGORITHM,
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: KDF_ALGORITHM,
      salt: base64ToBytes(metadata.kdf.salt),
      iterations: metadata.kdf.iterations,
      hash: metadata.kdf.hash
    },
    baseKey,
    { name: ENCRYPTION_ALGORITHM, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function validateEncryptionKey() {
  let remoteSample = null;

  try {
    const result = await pb.collection('jnote').getList(1, 1, {
      sort: '-updated',
      filter: 'deleted=false'
    });
    remoteSample = result.items[0]?.title || result.items[0]?.folder;
  } catch (err) {
    console.warn('Could not validate passphrase against remote notes:', err);
  }

  if (remoteSample) {
    await decryptString(remoteSample);
    return;
  }

  const localSample = findEncryptedLocalStoreSample();
  if (localSample) await decryptString(localSample);
}

function findEncryptedLocalStoreSample() {
  for (const key of [DRAFTS_STORAGE_KEY, LOCAL_NOTES_STORAGE_KEY, PENDING_PUSHES_STORAGE_KEY]) {
    const value = localStorage.getItem(key);
    if (isEncryptedEnvelopeString(value)) return value;
  }
  return null;
}

async function encryptString(plaintext) {
  if (!encryptionState) throw new Error('Notes are locked.');

  const iv = window.crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    encryptionState.key,
    textEncoder.encode(String(plaintext ?? ''))
  );

  return JSON.stringify({
    ...encryptionState.metadata,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext))
  });
}

async function decryptString(encryptedValue) {
  if (!encryptionState) throw new Error('Notes are locked.');

  const envelope = parseEncryptedEnvelope(encryptedValue);
  if (envelope.kdf.salt !== encryptionState.metadata.kdf.salt) {
    throw new Error('Encrypted data was created with a different key salt.');
  }

  const plaintext = await window.crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: base64ToBytes(envelope.iv) },
    encryptionState.key,
    base64ToBytes(envelope.ct)
  );

  return textDecoder.decode(plaintext);
}

function parseEncryptedEnvelope(value) {
  let envelope;
  try {
    envelope = JSON.parse(value);
  } catch (err) {
    throw new Error('Encrypted value is not a valid encryption envelope.');
  }

  const metadata = normalizeEncryptionMetadata(envelope);
  if (!metadata || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
    throw new Error('Encrypted value is missing required encryption metadata.');
  }

  return { ...metadata, iv: envelope.iv, ct: envelope.ct };
}

function extractEncryptionMetadata(value) {
  if (!isEncryptedEnvelopeString(value)) return null;

  try {
    return normalizeEncryptionMetadata(JSON.parse(value));
  } catch (err) {
    return null;
  }
}

function isEncryptedEnvelopeString(value) {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return false;

  try {
    const parsed = JSON.parse(value);
    return Boolean(normalizeEncryptionMetadata(parsed) && typeof parsed.iv === 'string' && typeof parsed.ct === 'string');
  } catch (err) {
    return false;
  }
}

function randomBase64(byteLength) {
  const bytes = window.crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function loadEncryptedClientStores() {
  drafts = await getEncryptedObjectStore(DRAFTS_STORAGE_KEY);
  localNotes = await getEncryptedObjectStore(LOCAL_NOTES_STORAGE_KEY);
  pendingPushes = await getEncryptedObjectStore(PENDING_PUSHES_STORAGE_KEY);
}

async function getEncryptedObjectStore(storageKey) {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return {};

  if (!isEncryptedEnvelopeString(stored)) {
    localStorage.removeItem(storageKey);
    return {};
  }

  const decrypted = await decryptString(stored);
  const parsed = JSON.parse(decrypted);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function persistEncryptedObjectStore(storageKey, value) {
  if (!encryptionState) return;

  const snapshot = JSON.parse(JSON.stringify(value || {}));
  const sequence = (encryptedStorePersistVersions[storageKey] || 0) + 1;
  encryptedStorePersistVersions[storageKey] = sequence;

  if (Object.keys(snapshot).length === 0) {
    localStorage.removeItem(storageKey);
    return;
  }

  encryptString(JSON.stringify(snapshot))
    .then(encrypted => {
      if (encryptedStorePersistVersions[storageKey] !== sequence) return;
      localStorage.setItem(storageKey, encrypted);
    })
    .catch(err => console.warn('Could not persist encrypted local store:', err));
}

async function encryptNoteRecordPayload(title, folder = 'Notes') {
  return {
    title: await encryptString(title),
    folder: await encryptString(folder || 'Notes')
  };
}

async function encryptNoteContentPayload(title, content) {
  return {
    title: await encryptString(title),
    content: await encryptString(content)
  };
}

function getCustomCss() {
  try {
    return localStorage.getItem(CUSTOM_CSS_STORAGE_KEY) || '';
  } catch (err) {
    console.warn('Could not read custom CSS:', err);
    return '';
  }
}

function saveCustomCss(css) {
  try {
    if (css) {
      localStorage.setItem(CUSTOM_CSS_STORAGE_KEY, css);
    } else {
      localStorage.removeItem(CUSTOM_CSS_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Could not save custom CSS:', err);
  }

  applyCustomCss(css);
}

function applyCustomCss(css = getCustomCss()) {
  let customCssEl = document.getElementById('custom-css');
  if (!customCssEl) {
    customCssEl = document.createElement('style');
    customCssEl.id = 'custom-css';
    document.head.appendChild(customCssEl);
  }

  customCssEl.textContent = css;
}

function getDrafts() {
  return drafts;
}

function getDraft(noteId) {
  return getDrafts()[noteId] || null;
}

function hasDraft(noteId) {
  return Boolean(getDraft(noteId));
}

function saveDraft(noteId, title, content, folder = 'Notes') {
  getDrafts()[noteId] = {
    title,
    content,
    folder,
    updatedAt: new Date().toISOString()
  };
  persistDrafts();
}

function clearDraft(noteId) {
  if (!drafts[noteId]) return;
  delete drafts[noteId];
  persistDrafts();
}

function moveDraft(fromNoteId, toNoteId) {
  if (!drafts[fromNoteId]) return;
  drafts[toNoteId] = drafts[fromNoteId];
  delete drafts[fromNoteId];
  persistDrafts();
}

function persistDrafts() {
  persistEncryptedObjectStore(DRAFTS_STORAGE_KEY, drafts);
}

function getLocalNotes() {
  return localNotes;
}

function persistLocalNotes(nextLocalNotes = localNotes) {
  localNotes = nextLocalNotes;
  persistEncryptedObjectStore(LOCAL_NOTES_STORAGE_KEY, localNotes);
}

function upsertLocalNote(note) {
  if (!note?.isLocalOnly) return;
  const localNotes = getLocalNotes();
  localNotes[note.id] = {
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    folder: note.folder || 'Notes',
    updated: note.updated || new Date().toISOString(),
    hasContent: true,
    isLocalOnly: true
  };
  persistLocalNotes(localNotes);
}

function removeLocalNote(noteId) {
  const localNotes = getLocalNotes();
  if (!localNotes[noteId]) return;
  delete localNotes[noteId];
  persistLocalNotes(localNotes);
}

function getPendingPush(noteId) {
  return pendingPushes[noteId] || null;
}

function getPendingPushes() {
  return pendingPushes;
}

function persistPendingPushes() {
  persistEncryptedObjectStore(PENDING_PUSHES_STORAGE_KEY, pendingPushes);
}

function makeQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeLocalNoteId() {
  return `local-${makeQueueId()}`;
}

function queuePush(noteId, title, content) {
  const note = allNotes.find(n => n.id === noteId);
  const pending = getPendingPush(noteId);

  pendingPushes[noteId] = {
    id: makeQueueId(),
    action: note?.isLocalOnly || pending?.action === 'create' ? 'create' : 'update',
    noteId,
    title,
    content,
    folder: note?.folder || 'Notes',
    queuedAt: new Date().toISOString()
  };
  persistPendingPushes();
  updateSyncStatus();
  flushNotePush(noteId);
}

function queueDelete(noteId) {
  pendingPushes[noteId] = {
    id: makeQueueId(),
    action: 'delete',
    noteId,
    queuedAt: new Date().toISOString()
  };
  persistPendingPushes();
  updateSyncStatus();
  flushNotePush(noteId);
}

function hasUnfinishedPushes() {
  return Object.keys(pendingPushes).length > 0 || activePushes.size > 0;
}

function schedulePushRetry(noteId) {
  if (pushRetryTimers.has(noteId)) return;
  const timer = setTimeout(() => {
    pushRetryTimers.delete(noteId);
    flushNotePush(noteId);
  }, PUSH_RETRY_DELAY);
  pushRetryTimers.set(noteId, timer);
}

function updateSyncStatus() {
  const syncBar = document.getElementById('sync-app-bar');
  const syncText = document.getElementById('sync-status-text');
  if (!syncBar || !syncText) return;

  const pendingCount = Object.keys(pendingPushes).length;
  const isSyncing = activePushes.size > 0;
  const hasWork = pendingCount > 0 || isSyncing;

  syncBar.classList.toggle('is-idle', !hasWork);
  syncBar.classList.toggle('has-error', hasPushError && hasWork);

  let nextStatusText;
  if (!hasWork) {
    nextStatusText = 'All changes pushed';
  } else if (hasPushError && !isSyncing) {
    nextStatusText = 'Push failed. Retrying...';
  } else {
    nextStatusText = pendingCount > 1 ? `Pushing ${pendingCount} commits to cloud...` : 'Pushing commit to cloud...';
  }

  setSyncStatusText(syncText, nextStatusText);
}

function setSyncStatusText(syncText, nextText) {
  if (syncText.textContent === nextText && !syncText.classList.contains('sync-text-out')) return;

  clearTimeout(syncStatusAnimationTimer);
  syncText.classList.remove('sync-text-in');
  syncText.classList.add('sync-text-out');

  syncStatusAnimationTimer = setTimeout(() => {
    syncText.textContent = nextText;
    syncText.classList.remove('sync-text-out');
    void syncText.offsetWidth;
    syncText.classList.add('sync-text-in');

    syncStatusAnimationTimer = setTimeout(() => {
      syncText.classList.remove('sync-text-in');
      syncStatusAnimationTimer = null;
    }, 250);
  }, 150);
}

async function flushNotePush(noteId) {
  if (activePushes.has(noteId) || !pendingPushes[noteId]) return;

  activePushes.add(noteId);
  hasPushError = false;
  updateSyncStatus();

  try {
    while (pendingPushes[noteId]) {
      const push = pendingPushes[noteId];

      if (push.action === 'delete') {
        await pb.collection('jnote').update(noteId, { deleted: true });
        if (pendingPushes[noteId]?.id === push.id) {
          delete pendingPushes[noteId];
          persistPendingPushes();
        }
      } else if (push.action === 'create') {
        const newNoteRecord = await pb.collection('jnote').create(
          await encryptNoteRecordPayload(push.title, push.folder || 'Notes')
        );
        const newVersion = await pb.collection('jnote_content').create({
          note: newNoteRecord.id,
          ...(await encryptNoteContentPayload(push.title, push.content))
        });

        const latestPending = pendingPushes[noteId];
        delete pendingPushes[noteId];
        persistPendingPushes();
        applyCreatePushResult(noteId, push, newNoteRecord, newVersion, latestPending);
      } else {
        const updatedNote = await pb.collection('jnote').update(noteId, {
          title: await encryptString(push.title)
        });
        const newVersion = await pb.collection('jnote_content').create({
          note: noteId,
          ...(await encryptNoteContentPayload(push.title, push.content))
        });

        if (pendingPushes[noteId]?.id === push.id) {
          delete pendingPushes[noteId];
          persistPendingPushes();
          applyCloudPushResult(noteId, push, updatedNote, newVersion);
        }
      }
    }
  } catch (err) {
    console.error('Error pushing note:', err);
    hasPushError = true;
    schedulePushRetry(noteId);
  } finally {
    activePushes.delete(noteId);
    updateSyncStatus();
  }
}

function flushPendingPushes() {
  Object.keys(pendingPushes).forEach(noteId => flushNotePush(noteId));
}

function applyCloudPushResult(noteId, push, updatedNote, newVersion) {
  const idx = allNotes.findIndex(n => n.id === noteId);
  if (idx !== -1 && !pendingPushes[noteId]) {
    allNotes[idx].title = push.title;
    allNotes[idx].updated = updatedNote.updated;
    allNotes[idx].content = push.content;
    allNotes[idx].versionId = newVersion.id;
    allNotes[idx].hasContent = true;
  }

  if (currentNoteId === noteId && !hasDraft(noteId) && !pendingPushes[noteId]) {
    currentNoteState = { title: push.title, content: push.content };
  }

  renderNoteList();
}

function applyCreatePushResult(localNoteId, push, newNoteRecord, newVersion, latestPending) {
  const newNoteId = newNoteRecord.id;
  const idx = allNotes.findIndex(n => n.id === localNoteId);
  const latestChange = latestPending && latestPending.id !== push.id ? latestPending : null;

  if (idx !== -1) {
    allNotes[idx] = {
      ...allNotes[idx],
      id: newNoteId,
      title: latestChange?.title ?? push.title,
      folder: latestChange?.folder ?? push.folder ?? 'Notes',
      updated: newNoteRecord.updated,
      content: latestChange?.content ?? push.content,
      versionId: newVersion.id,
      hasContent: true,
      isLocalOnly: false
    };
  } else if (latestChange?.action !== 'delete') {
    allNotes.push({
      id: newNoteId,
      title: latestChange?.title ?? push.title,
      folder: latestChange?.folder ?? push.folder ?? 'Notes',
      updated: newNoteRecord.updated,
      content: latestChange?.content ?? push.content,
      versionId: newVersion.id,
      hasContent: true,
      isLocalOnly: false
    });
  }

  moveDraft(localNoteId, newNoteId);
  removeLocalNote(localNoteId);

  if (latestChange) {
    pendingPushes[newNoteId] = {
      ...latestChange,
      action: latestChange.action === 'delete' ? 'delete' : 'update',
      noteId: newNoteId
    };
    persistPendingPushes();
    flushNotePush(newNoteId);
  }

  if (currentNoteId === localNoteId) {
    currentNoteId = newNoteId;
    const note = allNotes.find(n => n.id === newNoteId);
    if (note && latestChange?.action !== 'delete') renderNoteDetail(note);
  }

  renderNoteList();
}

// ─── Core GUI Update ──────────────────────────────────────────────────────────

function updateGUI() {
  // 1. Rebuild folder list
  const folders = ['Notes', ...new Set(allNotes.map(n => n.folder).filter(f => f && f !== 'Notes'))].sort((a, b) =>
    a === 'Notes' ? -1 : b === 'Notes' ? 1 : a.localeCompare(b)
  );

  const folderList = document.getElementById('folder-list');
  folderList.innerHTML = folders.map(folder => `
    <li class="folder-item ${folder === currentFolder ? 'active' : ''}"
        data-folder="${escapeHtml(folder)}">
      ${escapeHtml(folder)}
    </li>
  `).join('');

  folderList.querySelectorAll('[data-folder]').forEach(item => {
    item.addEventListener('click', () => filterByFolder(item.dataset.folder));
  });

  // 2. Rebuild notes list
  renderNoteList();

  document.getElementById('current-folder-title').textContent = currentFolder;

  // 3. Update note detail pane
  if (!currentNoteId) {
    document.getElementById('note-detail').innerHTML = '<p class="empty">Select a note to view</p>';
    if (window.innerWidth <= 768) {
      closeDetailView();
    }
  }
}

function renderNoteList() {
  const notes = allNotes.filter(n => n.folder === currentFolder);
  const notesList = document.getElementById('notes-list');

  closeNoteContextMenu();

  if (notes.length === 0) {
    notesList.innerHTML = '<li class="empty-state">No notes</li>';
  } else {
    notesList.innerHTML = notes.map(note => `
      <li class="folder-item ${note.id === currentNoteId ? 'active' : ''}"
          data-note-id="${note.id}">
        <span class="note-list-title">${escapeHtml(getDisplayTitle(note)) || '[untitled]'}</span>
        ${hasDraft(note.id) ? '<span class="unsaved-dot" title="Unsaved local changes"></span>' : ''}
      </li>
    `).join('');

    notesList.querySelectorAll('[data-note-id]').forEach(item => {
      item.addEventListener('click', () => selectNote(item.dataset.noteId));
      item.addEventListener('contextmenu', (event) => openNoteContextMenu(event, item.dataset.noteId));
    });
  }
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadNotes() {
  try {
    const fetched = await pb.collection('jnote').getFullList({ sort: '-updated', filter: 'deleted=false' });
    allNotes = await Promise.all(fetched.map(async n => ({
      id: n.id,
      title: await decryptString(n.title),
      folder: await decryptString(n.folder),
      updated: n.updated,
      hasContent: false
    })));
    mergeLocalNotesIntoNotes();
    mergePendingPushesIntoNotes();
    mergeOrphanLocalDraftsIntoNotes();
    updateGUI();
  } catch (err) {
    console.error('Error loading notes:', err);
    document.getElementById('note-detail').innerHTML = '<p class="error">Failed to load or decrypt notes</p>';
    throw err;
  }
}

function mergeLocalNotesIntoNotes() {
  Object.values(getLocalNotes()).forEach(localNote => {
    const idx = allNotes.findIndex(note => note.id === localNote.id);
    if (idx !== -1) {
      allNotes[idx] = { ...allNotes[idx], ...localNote };
    } else {
      allNotes.push(localNote);
    }
  });
}

function mergeOrphanLocalDraftsIntoNotes() {
  Object.entries(getDrafts()).forEach(([noteId, draft]) => {
    if (!noteId.startsWith('local-') || allNotes.some(note => note.id === noteId) || pendingPushes[noteId]) return;

    const note = {
      id: noteId,
      title: draft.title || '',
      folder: draft.folder || 'Notes',
      updated: draft.updatedAt || new Date().toISOString(),
      content: draft.content || '',
      hasContent: true,
      isLocalOnly: true
    };

    allNotes.push(note);
    upsertLocalNote(note);
  });
}

function mergePendingPushesIntoNotes() {
  Object.values(pendingPushes).forEach(push => {
    if (push.action === 'delete') {
      allNotes = allNotes.filter(note => note.id !== push.noteId);
      return;
    }

    const idx = allNotes.findIndex(note => note.id === push.noteId);
    if (idx !== -1) {
      allNotes[idx] = {
        ...allNotes[idx],
        title: push.title,
        content: push.content,
        hasContent: true
      };
      return;
    }

    if (push.action === 'create') {
      allNotes.push({
        id: push.noteId,
        title: push.title,
        folder: push.folder || 'Notes',
        updated: push.queuedAt,
        content: push.content,
        hasContent: true,
        isLocalOnly: true
      });
    }
  });
}

// ─── Folder & Note Selection ──────────────────────────────────────────────────

function filterByFolder(folder) {
  currentFolder = folder;
  currentNoteId = null;
  updateGUI();
  closeFoldersDrawer();
}

async function selectNote(noteId) {
  currentNoteId = noteId;
  updateGUI(); // Reflect active states immediately

  if (window.innerWidth <= 768) {
    closeFoldersDrawer();
    openDetailView();
  }

  const noteIndex = allNotes.findIndex(n => n.id === noteId);
  const local = allNotes[noteIndex];

  const container = document.getElementById('note-detail');
  if (!local) {
    container.innerHTML = '<p class="empty">Select a note to view</p>';
    return;
  }

  if (!local?.hasContent && !local?.isLocalOnly) {
    container.innerHTML = '<p class="empty">Loading note...</p>';
    try {
      const note = allNotes[noteIndex];

      const query = await pb.collection('jnote_content').getList(1, 1, {
        filter: `note = "${noteId}"`,
        sort: '-created',
      });
      const latest = query.items[0];
      if (!latest) {
        return;
      }

      note.title = await decryptString(latest.title);
      note.content = await decryptString(latest.content);
      note.versionId = latest.id;
      note.hasContent = true;

      renderNoteDetail(note);

    } catch (err) {
      console.error('Error fetching note:', err);
      container.innerHTML = '<p class="error">Failed to load note</p>';
    }
  } else {
    renderNoteDetail(local);
  }
}

// ─── Note Detail Rendering ────────────────────────────────────────────────────

function renderNoteDetail(note) {
  const pendingPush = getPendingPush(note.id);
  const committedNote = pendingPush ? { ...note, title: pendingPush.title, content: pendingPush.content } : note;
  const draft = getDraft(note.id);
  const displayNote = draft ? { ...committedNote, ...draft } : committedNote;
  const canCommit = Boolean(draft || note.isLocalOnly);
  currentNoteState = { title: committedNote.title, content: committedNote.content };

  const container = document.getElementById('note-detail');
  container.innerHTML = `
    <div class="note-actions">
      <button class="btn-secondary ripple ${draft ? '' : 'hide'}" id="btn-revert">Revert Changes</button>
      <button class="btn-primary ripple" id="btn-save" ${canCommit ? '' : 'disabled'}>Commit</button>
      <button class="btn-secondary ripple" id="btn-move">Move</button>
      <button class="btn-secondary ripple" id="btn-delete">Delete</button>
    </div>
    <div contenteditable="true" placeholder="Title" class="note-title" id="edit-title">${escapeHtml(displayNote.title)}</div>
    <div contenteditable="true" placeholder="Take a note..." class="note-detail-content editable" id="edit-content">${escapeHtml(displayNote.content)}</div>
  `;

  const titleEl = document.getElementById('edit-title');
  const contentEl = document.getElementById('edit-content');

  const saveBtn = document.getElementById('btn-save');
  const revertBtn = document.getElementById('btn-revert');

  const persistCurrentDraft = () => {
    const title = getEditableText(titleEl, { trim: true });
    const content = getEditableText(contentEl);
    const localNote = allNotes.find(n => n.id === note.id);

    if (localNote?.isLocalOnly) {
      localNote.title = title;
      localNote.content = content;
      localNote.updated = new Date().toISOString();
      upsertLocalNote(localNote);
    }

    if (title === currentNoteState.title && content === currentNoteState.content) {
      clearDraft(note.id);
      setCanSave(false);
    } else {
      saveDraft(note.id, title, content, localNote?.folder || note.folder || 'Notes');
      setCanSave(true);
    }

    renderNoteList();
  };

  [titleEl, contentEl].forEach(el => {
    el.addEventListener('input', () => {
      persistCurrentDraft();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el === titleEl) {
        e.preventDefault();
        contentEl.focus();
      }
    });
  });

  saveBtn.addEventListener('click', () => saveNote(note.id));
  revertBtn.addEventListener('click', () => revertNoteDraft(note.id));
  document.getElementById('btn-move').addEventListener('click', () => openFolderModal('move', note));
  document.getElementById('btn-delete').addEventListener('click', () => deleteNote(note.id));
}

// ─── CRUD Operations ──────────────────────────────────────────────────────────

function saveNote(noteId) {
  const title = getEditableText(document.getElementById('edit-title'), { trim: true });
  const content = getEditableText(document.getElementById('edit-content'));

  commitNote(noteId, title, content);
}

function commitNote(noteId, title, content) {
  const idx = allNotes.findIndex(n => n.id === noteId);
  if (idx !== -1) {
    allNotes[idx].title = title;
    allNotes[idx].content = content;
    allNotes[idx].updated = new Date().toISOString();
    allNotes[idx].hasContent = true;
    upsertLocalNote(allNotes[idx]);
  }

  clearDraft(noteId);
  if (currentNoteId === noteId) {
    currentNoteState = { title, content };
    setCanSave(false);
  }
  renderNoteList();
  queuePush(noteId, title, content);
}

function commitNoteFromMenu(noteId) {
  const commit = getNoteCommitPayload(noteId);
  if (!commit) return;

  commitNote(noteId, commit.title, commit.content);
  if (currentNoteId === noteId) {
    const note = allNotes.find(n => n.id === noteId);
    if (note) renderNoteDetail(note);
  }
}

function getNoteCommitPayload(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return null;

  const draft = getDraft(noteId);
  if (draft) {
    return {
      title: draft.title || '',
      content: draft.content || ''
    };
  }

  if (note.isLocalOnly) {
    return {
      title: note.title || '',
      content: note.content || ''
    };
  }

  return null;
}

function revertNoteDraft(noteId) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  clearDraft(noteId);
  renderNoteList();
  renderNoteDetail(note);
}

// let noteSaveTimeout = null;

function setCanSave(noteHasChanges) {
  const saveBtn = document.getElementById('btn-save');
  const revertBtn = document.getElementById('btn-revert');
  const note = allNotes.find(n => n.id === currentNoteId);
  if (saveBtn) saveBtn.disabled = !(noteHasChanges || note?.isLocalOnly);
  if (revertBtn) revertBtn.classList.toggle('hide', !noteHasChanges);

  // if (noteHasChanges) {
  //   clearTimeout(noteSaveTimeout);
  //   noteSaveTimeout = setTimeout(() => {
  //     if (currentNoteId) {
  //       saveNote(currentNoteId);
  //       console.log('Auto-saved note');
  //     }
  //   }, 500);
  // }
}

function commitCurrentNoteFromShortcut() {
  if (!currentNoteId) return;

  const saveBtn = document.getElementById('btn-save');
  if (saveBtn?.disabled) return;

  saveNote(currentNoteId);
}

function createNewNote(folder) {
  const noteData = {
    id: makeLocalNoteId(),
    title: '',
    folder: folder || 'Notes',
    updated: new Date().toISOString(),
    hasContent: true,
    content: '',
    isLocalOnly: true
  };

  allNotes.push(noteData);
  upsertLocalNote(noteData);

  currentFolder = noteData.folder;
  currentNoteId = noteData.id;

  updateGUI();
  renderNoteDetail(noteData);
}

function deleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;

  const note = allNotes.find(n => n.id === noteId);
  clearDraft(noteId);
  removeLocalNote(noteId);
  allNotes = allNotes.filter(n => n.id !== noteId);
  if (currentNoteId === noteId) currentNoteId = null;
  updateGUI();

  if (note?.isLocalOnly && !activePushes.has(noteId)) {
    delete pendingPushes[noteId];
    persistPendingPushes();
    updateSyncStatus();
    return;
  }

  queueDelete(noteId);
}

async function moveNoteToFolder(noteId, folder) {
  const note = allNotes.find(n => n.id === noteId);
  const targetFolder = folder || 'Notes';
  if (note?.isLocalOnly) {
    note.folder = targetFolder;
    note.updated = new Date().toISOString();
    upsertLocalNote(note);
    if (pendingPushes[noteId]?.action === 'create') {
      pendingPushes[noteId].folder = note.folder;
      persistPendingPushes();
    }
    updateGUI();
    return;
  }

  try {
    const updated = await pb.collection('jnote').update(noteId, {
      folder: await encryptString(targetFolder)
    });
    
    const idx = allNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      allNotes[idx] = { ...allNotes[idx], folder: targetFolder, updated: updated.updated };
    }

    updateGUI();
  } catch (err) {
    console.error('Error moving note:', err);
    alert('Failed to move note');
  }
}

// ─── Folder Modal ─────────────────────────────────────────────────────────────

function openFolderModal(mode, note = null) {
  const modal = document.getElementById('folder-modal');
  const customFolderInput = document.getElementById('custom-folder-name');

  document.getElementById('modal-header').textContent =
    mode === 'create' ? 'Create New Note' : 'Move Note to Folder';

  customFolderInput.value = '';
  selectedFolderInModal = mode === 'move' ? (note?.folder || '') : '';

  const folders = [...new Set(allNotes.map(n => n.folder).filter(Boolean))].sort();
  const folderSelection = document.getElementById('folder-selection');

  folderSelection.innerHTML = folders.map(folder => `
    <button class="folder-option ${selectedFolderInModal === folder ? 'selected' : ''}"
            data-folder="${escapeHtml(folder)}">
      ${escapeHtml(folder)}
    </button>
  `).join('');

  folderSelection.querySelectorAll('.folder-option').forEach(btn => {
    btn.addEventListener('click', () => {
      folderSelection.querySelectorAll('.folder-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedFolderInModal = btn.dataset.folder;
      customFolderInput.value = '';
    });
  });

  folderModalCallback = () => {
    const targetFolder = customFolderInput.value.trim() || selectedFolderInModal;
    closeFolderModal();
    if (mode === 'create') createNewNote(targetFolder);
    else if (mode === 'move') moveNoteToFolder(note.id, targetFolder);
  };

  modal.classList.add('show');
}

function closeFolderModal() {
  document.getElementById('folder-modal').classList.remove('show');
  folderModalCallback = null;
}

// ─── Mobile Menu ──────────────────────────────────────────────────────────────

function openFoldersDrawer() {
  const foldersContainer = document.getElementById('folders-container');
  const overlay = document.getElementById('mobile-overlay');
  foldersContainer.classList.add('open');
  overlay.classList.add('show');
}

function closeFoldersDrawer() {
  const foldersContainer = document.getElementById('folders-container');
  const overlay = document.getElementById('mobile-overlay');
  foldersContainer.classList.remove('open');
  overlay.classList.remove('show');
}

function openDetailView() {
  const detailContainer = document.getElementById('detail-container');
  const overlay = document.getElementById('mobile-overlay');
  detailContainer.classList.add('open');
  overlay.classList.add('show');
}

function closeDetailView() {
  const detailContainer = document.getElementById('detail-container');
  const overlay = document.getElementById('mobile-overlay');
  detailContainer.classList.remove('open');
  overlay.classList.remove('show');
}

function toggleMenu() {
  const foldersContainer = document.getElementById('folders-container');
  if (foldersContainer.classList.contains('open')) {
    closeFoldersDrawer();
  } else {
    openFoldersDrawer();
  }
}

// ─── Note Context Menu ───────────────────────────────────────────────────────

function openNoteContextMenu(event, noteId) {
  event.preventDefault();
  event.stopPropagation();

  const note = allNotes.find(n => n.id === noteId);
  if (!note) return;

  const menu = getNoteContextMenu();
  activeNoteContextMenuId = noteId;

  document.querySelectorAll('[data-note-id].context-open').forEach(item => {
    item.classList.remove('context-open');
  });
  document.querySelector(`[data-note-id="${cssEscape(noteId)}"]`)?.classList.add('context-open');

  const canCommit = Boolean(getNoteCommitPayload(noteId));
  menu.querySelector('[data-action="commit"]').disabled = !canCommit;
  menu.hidden = false;

  positionNoteContextMenu(menu, event.clientX, event.clientY);
}

function getNoteContextMenu() {
  let menu = document.getElementById('note-context-menu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'note-context-menu';
  menu.className = 'note-context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="commit">
      <i aria-hidden="true">cloud_upload</i>
      <span>Commit</span>
    </button>
    <button type="button" role="menuitem" data-action="move">
      <i aria-hidden="true">drive_file_move</i>
      <span>Move</span>
    </button>
    <button type="button" role="menuitem" data-action="delete" class="danger">
      <i aria-hidden="true">delete</i>
      <span>Delete</span>
    </button>
  `;

  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || !activeNoteContextMenuId) return;

    const noteId = activeNoteContextMenuId;
    const action = button.dataset.action;
    closeNoteContextMenu();

    if (action === 'commit') {
      commitNoteFromMenu(noteId);
    } else if (action === 'move') {
      const note = allNotes.find(n => n.id === noteId);
      if (note) openFolderModal('move', note);
    } else if (action === 'delete') {
      deleteNote(noteId);
    }
  });

  document.body.appendChild(menu);
  return menu;
}

function positionNoteContextMenu(menu, x, y) {
  const padding = 8;
  menu.style.left = '0px';
  menu.style.top = '0px';

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - padding);
  const top = Math.min(y, window.innerHeight - rect.height - padding);

  menu.style.left = `${Math.max(padding, left)}px`;
  menu.style.top = `${Math.max(padding, top)}px`;
}

function closeNoteContextMenu() {
  const menu = document.getElementById('note-context-menu');
  if (menu) menu.hidden = true;

  activeNoteContextMenuId = null;
  document.querySelectorAll('[data-note-id].context-open').forEach(item => {
    item.classList.remove('context-open');
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

function openSettingsDialog() {
  document.getElementById('settings-dialog')?.showModal();
}

function openCustomCssDialog() {
  const settingsDialog = document.getElementById('settings-dialog');
  const customCssDialog = document.getElementById('custom-css-dialog');
  const customCssInput = document.getElementById('custom-css-input');

  if (!customCssDialog || !customCssInput) return;

  settingsDialog?.close();
  customCssInput.value = getCustomCss();
  customCssDialog.showModal();
  customCssInput.focus();
}

function closeDialogOnBackdropClick(event) {
  const dialog = event.currentTarget;
  if (!dialog.open) return;

  const rect = dialog.getBoundingClientRect();
  const clickedInDialog =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (!clickedInDialog) dialog.close();
}

function bindSettingsDialogs() {
  const settingsDialog = document.getElementById('settings-dialog');
  const customCssDialog = document.getElementById('custom-css-dialog');
  const customCssInput = document.getElementById('custom-css-input');

  document.getElementById('settings-btn')?.addEventListener('click', openSettingsDialog);
  document.getElementById('open-custom-css-dialog')?.addEventListener('click', openCustomCssDialog);

  document.getElementById('save-custom-css')?.addEventListener('click', () => {
    saveCustomCss(customCssInput?.value || '');
    customCssDialog?.close();
  });

  document.getElementById('clear-custom-css')?.addEventListener('click', () => {
    if (customCssInput) customCssInput.value = '';
    saveCustomCss('');
  });

  [settingsDialog, customCssDialog].forEach(dialog => {
    dialog?.addEventListener('click', closeDialogOnBackdropClick);
  });
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text ?? '').replace(/[&<>"']/g, m => map[m]);
}

function getEditableText(element, options = {}) {
  if (!element) return '';

  const text = (element.innerText ?? element.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n');

  if (options.trim) return text.trim();
  return text.trim() ? text : '';
}

function getDisplayTitle(note) {
  return getDraft(note.id)?.title ?? getPendingPush(note.id)?.title ?? note.title;
}

// ─── Encryption Unlock Modal ─────────────────────────────────────────────────

function bindEncryptionModal() {
  const form = document.getElementById('encryption-form');
  const input = document.getElementById('encryption-passphrase');

  form?.addEventListener('submit', handleEncryptionSubmit);
  input?.addEventListener('input', () => setEncryptionError(''));
}

function showEncryptionModal() {
  const modal = document.getElementById('encryption-modal');
  const input = document.getElementById('encryption-passphrase');

  modal?.classList.add('show');
  window.setTimeout(() => input?.focus(), 0);
}

function hideEncryptionModal() {
  document.getElementById('encryption-modal')?.classList.remove('show');
}

async function unlockAndStart(passphrase, options = {}) {
  await unlockEncryption(passphrase);
  await loadEncryptedClientStores();
  if (options.rememberPassphrase) saveEncryptionPassphrase(passphrase);
  hideEncryptionModal();
  await loadNotes();
  updateSyncStatus();
  flushPendingPushes();
}

async function autoUnlockFromStoredPassphrase() {
  const storedPassphrase = getStoredEncryptionPassphrase();
  if (!storedPassphrase) {
    showEncryptionModal();
    return;
  }

  setEncryptionUnlockBusy(true);
  setEncryptionError('');

  try {
    await unlockAndStart(storedPassphrase);
  } catch (err) {
    encryptionState = null;
    drafts = {};
    localNotes = {};
    pendingPushes = {};
    clearStoredEncryptionPassphrase();
    updateSyncStatus();
    console.error('Saved encryption passphrase could not unlock notes:', err);
    setEncryptionError('Saved passphrase could not unlock notes. Enter it again.');
    showEncryptionModal();
  } finally {
    setEncryptionUnlockBusy(false);
  }
}

async function handleEncryptionSubmit(event) {
  event.preventDefault();

  const input = document.getElementById('encryption-passphrase');
  const passphrase = input?.value || '';

  if (!passphrase) {
    setEncryptionError('Enter a passphrase to unlock your notes.');
    input?.focus();
    return;
  }

  setEncryptionError('');
  setEncryptionUnlockBusy(true);

  try {
    await unlockAndStart(passphrase, { rememberPassphrase: true });
    input.value = '';
  } catch (err) {
    encryptionState = null;
    drafts = {};
    localNotes = {};
    pendingPushes = {};
    clearStoredEncryptionPassphrase();
    updateSyncStatus();
    console.error('Could not unlock encrypted notes:', err);
    setEncryptionError('Could not unlock notes. Check the passphrase and try again.');
    showEncryptionModal();
    input?.focus();
    input?.select();
  } finally {
    setEncryptionUnlockBusy(false);
  }
}

function setEncryptionError(message) {
  const errorEl = document.getElementById('encryption-error');
  if (!errorEl) return;

  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setEncryptionUnlockBusy(isBusy) {
  const submitButton = document.querySelector('#encryption-form button[type="submit"]');
  if (!submitButton) return;

  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? 'Unlocking...' : 'Unlock';
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  updateSyncStatus();
  bindSettingsDialogs();
  bindEncryptionModal();

  document.getElementById('btn-create-note').addEventListener('click', () => createNewNote(currentFolder));
  document.getElementById('folder-modal-confirm').addEventListener('click', () => folderModalCallback?.());
  document.getElementById('folder-modal-cancel').addEventListener('click', closeFolderModal);

  // Mobile navigation handlers
  document.getElementById('hamburger-btn').addEventListener('click', toggleMenu);
  document.getElementById('close-detail-btn').addEventListener('click', closeDetailView);
  document.getElementById('mobile-overlay').addEventListener('click', () => {
    closeNoteContextMenu();
    closeDetailView();
    closeFoldersDrawer();
  });

  // Handle window resize to close drawers on desktop
  window.addEventListener('resize', () => {
    closeNoteContextMenu();
    if (window.innerWidth > 768) {
      closeFoldersDrawer();
      closeDetailView();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeNoteContextMenu();
      return;
    }

    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    commitCurrentNoteFromShortcut();
  });

  window.addEventListener('click', closeNoteContextMenu);
  window.addEventListener('scroll', closeNoteContextMenu, true);

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnfinishedPushes()) return;
    event.preventDefault();
    event.returnValue = 'Your latest commit is still pushing to the cloud.';
  });

  autoUnlockFromStoredPassphrase();
});
