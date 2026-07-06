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
const REMEMBERED_DEVICE_KEY_STORAGE_KEY = 'jnote.rememberedDeviceKey.v1';
const PUSH_RETRY_DELAY = 5000;
const ENCRYPTED_VALUE_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KDF_ALGORITHM = 'PBKDF2';
const KDF_HASH = 'SHA-256';
const KDF_ITERATIONS = 310000;
const AES_KEY_LENGTH = 256;
const ENCRYPTION_SALT_BYTES = 16;
const ENCRYPTION_IV_BYTES = 12;
const ACCOUNT_URL = 'https://joe.mt/account';
const KEYBOARD_VIEWPORT_THRESHOLD = 120;
const EXPORT_FORMAT_VERSION = 1;
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
let currentUser = null;
let encryptionMode = 'unlock';
let stableAppViewport = { width: window.innerWidth, height: window.innerHeight };
let lastEditableFocusAt = 0;
let isKeyMigrationRunning = false;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

syncAppViewportSize({ force: true });
applyCustomCss();

function isEditableElement(element) {
  if (!element || element === document.body) return false;

  return element.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    || Boolean(element.closest?.('[contenteditable]:not([contenteditable="false"])'));
}

function syncAppViewportSize(options = {}) {
  const force = options.force === true;
  const visualViewport = window.visualViewport;
  const width = Math.round(window.innerWidth);
  const height = Math.round(window.innerHeight);
  const visualHeight = Math.round(visualViewport?.height || height);
  const visualOffsetTop = Math.round(visualViewport?.offsetTop || 0);
  const widthChanged = Math.abs(width - stableAppViewport.width) > 40;
  const recentEditableFocus = Date.now() - lastEditableFocusAt < 800;
  const keyboardShrink = Math.max(stableAppViewport.height - visualHeight, stableAppViewport.height - height);
  const keyboardLikely = !widthChanged
    && keyboardShrink > KEYBOARD_VIEWPORT_THRESHOLD
    && (isEditableElement(document.activeElement) || recentEditableFocus);

  if (force || !keyboardLikely) {
    stableAppViewport = { width, height };
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  const keyboardInset = keyboardLikely
    ? Math.max(0, Math.round(stableAppViewport.height - visualHeight - visualOffsetTop))
    : 0;

  document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
}

function hasKeyboardSizedViewport() {
  const visualHeight = Math.round(window.visualViewport?.height || window.innerHeight);
  const shrink = Math.max(stableAppViewport.height - visualHeight, stableAppViewport.height - window.innerHeight);

  return shrink > KEYBOARD_VIEWPORT_THRESHOLD;
}

function bindAppViewportSize() {
  window.addEventListener('resize', () => syncAppViewportSize());
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => syncAppViewportSize({ force: true }), 300);
  });

  window.visualViewport?.addEventListener('resize', () => syncAppViewportSize());
  window.visualViewport?.addEventListener('scroll', () => syncAppViewportSize());

  window.addEventListener('focusin', (event) => {
    if (isEditableElement(event.target)) lastEditableFocusAt = Date.now();
    syncAppViewportSize();
  }, true);

  window.addEventListener('focusout', () => {
    lastEditableFocusAt = Date.now();
    window.setTimeout(() => {
      syncAppViewportSize({
        force: !isEditableElement(document.activeElement) && !hasKeyboardSizedViewport()
      });
    }, 500);
  }, true);
}

// ─── Client-Side Encryption ──────────────────────────────────────────────────

function assertWebCryptoAvailable() {
  if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
    throw new Error('Web Crypto is unavailable. Open this app over HTTPS or localhost.');
  }
}

function getCurrentUserId() {
  return currentUser?.id || pb.authStore.record?.id || '';
}

function getUserScopedStorageKey(storageKey) {
  const userId = getCurrentUserId();
  return userId ? `${storageKey}.${userId}` : storageKey;
}

function getOwnedNotesFilter(extraFilter = '') {
  const userId = getCurrentUserId();
  const filters = [];
  if (userId) filters.push(`user = "${userId}"`);
  if (extraFilter) filters.push(extraFilter);
  return filters.join(' && ');
}

async function loadCurrentUser() {
  if (!pb.authStore.isValid || !pb.authStore.record?.id) {
    throw new Error('JNote requires an authenticated PocketBase user.');
  }

  currentUser = await pb.collection('users').getOne(pb.authStore.record.id);
  return currentUser;
}

async function markJnoteKeySet() {
  if (!currentUser || currentUser.is_jnote_key_set) return;

  currentUser = await pb.collection('users').update(currentUser.id, {
    is_jnote_key_set: true
  });

  if (pb.authStore.token && pb.authStore.record) {
    pb.authStore.save(pb.authStore.token, { ...pb.authStore.record, ...currentUser });
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
    return normalizeEncryptionMetadata(JSON.parse(localStorage.getItem(getUserScopedStorageKey(ENCRYPTION_METADATA_STORAGE_KEY)) || 'null'));
  } catch (err) {
    console.warn('Could not read encryption metadata:', err);
    return null;
  }
}

function saveEncryptionMetadata(metadata) {
  try {
    localStorage.setItem(getUserScopedStorageKey(ENCRYPTION_METADATA_STORAGE_KEY), JSON.stringify(metadata));
  } catch (err) {
    console.warn('Could not save encryption metadata:', err);
  }
}

async function getRemoteEncryptionMetadata() {
  const result = await pb.collection('jnote').getList(1, 1, {
    sort: '-updated',
    filter: getOwnedNotesFilter('deleted=false')
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

async function unlockEncryption(passphrase, options = {}) {
  assertWebCryptoAvailable();

  const metadata = await resolveEncryptionMetadata();
  const key = await deriveEncryptionKey(passphrase, metadata, { extractable: Boolean(options.rememberDevice) });
  encryptionState = { key, metadata };

  await validateEncryptionKey();
  saveEncryptionMetadata(metadata);

  if (options.rememberDevice) {
    await rememberCurrentDeviceKey();
  }
}

async function deriveEncryptionKey(passphrase, metadata, options = {}) {
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
    Boolean(options.extractable),
    ['encrypt', 'decrypt']
  );
}

function getRememberedDeviceKeyRecord() {
  try {
    const record = JSON.parse(localStorage.getItem(getUserScopedStorageKey(REMEMBERED_DEVICE_KEY_STORAGE_KEY)) || 'null');
    const metadata = normalizeEncryptionMetadata(record?.metadata);
    if (!record || record.v !== ENCRYPTED_VALUE_VERSION || record.alg !== ENCRYPTION_ALGORITHM) return null;
    if (typeof record.key !== 'string' || !metadata) return null;
    return { ...record, metadata };
  } catch (err) {
    console.warn('Could not read remembered device key:', err);
    return null;
  }
}

async function unlockRememberedDevice() {
  assertWebCryptoAvailable();

  const record = getRememberedDeviceKeyRecord();
  if (!record) return false;

  try {
    const key = await window.crypto.subtle.importKey(
      'raw',
      base64ToBytes(record.key),
      { name: ENCRYPTION_ALGORITHM, length: AES_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    encryptionState = { key, metadata: record.metadata };
    await validateEncryptionKey();
    saveEncryptionMetadata(record.metadata);
    return true;
  } catch (err) {
    encryptionState = null;
    forgetRememberedDeviceKey();
    console.warn('Remembered device key could not unlock notes:', err);
    return false;
  }
}

async function rememberCurrentDeviceKey() {
  if (!encryptionState) return;

  const rawKey = await window.crypto.subtle.exportKey('raw', encryptionState.key);
  try {
    localStorage.setItem(getUserScopedStorageKey(REMEMBERED_DEVICE_KEY_STORAGE_KEY), JSON.stringify({
      v: ENCRYPTED_VALUE_VERSION,
      alg: ENCRYPTION_ALGORITHM,
      metadata: encryptionState.metadata,
      key: bytesToBase64(new Uint8Array(rawKey)),
      createdAt: new Date().toISOString()
    }));
  } catch (err) {
    console.warn('Could not remember this device:', err);
  }
}

function forgetRememberedDeviceKey() {
  try {
    localStorage.removeItem(getUserScopedStorageKey(REMEMBERED_DEVICE_KEY_STORAGE_KEY));
  } catch (err) {
    console.warn('Could not forget remembered device key:', err);
  }
}

async function validateEncryptionKey(state = encryptionState) {
  let remoteSample = null;

  try {
    const result = await pb.collection('jnote').getList(1, 1, {
      sort: '-updated',
      filter: getOwnedNotesFilter('deleted=false')
    });
    remoteSample = result.items[0]?.title || result.items[0]?.folder;
  } catch (err) {
    console.warn('Could not validate passphrase against remote notes:', err);
  }

  if (remoteSample) {
    await decryptStringWithState(remoteSample, state);
    return;
  }

  const localSample = findEncryptedLocalStoreSample();
  if (localSample) await decryptStringWithState(localSample, state);
}

function findEncryptedLocalStoreSample() {
  for (const key of [DRAFTS_STORAGE_KEY, LOCAL_NOTES_STORAGE_KEY, PENDING_PUSHES_STORAGE_KEY]) {
    const value = localStorage.getItem(getUserScopedStorageKey(key));
    if (isEncryptedEnvelopeString(value)) return value;
  }
  return null;
}

async function encryptString(plaintext) {
  return encryptStringWithState(plaintext, encryptionState);
}

async function encryptStringWithState(plaintext, state = encryptionState) {
  if (!state) throw new Error('Notes are locked.');

  const iv = window.crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    state.key,
    textEncoder.encode(String(plaintext ?? ''))
  );

  return JSON.stringify({
    ...state.metadata,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext))
  });
}

async function decryptString(encryptedValue) {
  return decryptStringWithState(encryptedValue, encryptionState);
}

async function decryptStringWithState(encryptedValue, state = encryptionState) {
  if (!state) throw new Error('Notes are locked.');

  const envelope = parseEncryptedEnvelope(encryptedValue);
  if (envelope.kdf.salt !== state.metadata.kdf.salt) {
    throw new Error('Encrypted data was created with a different key salt.');
  }

  const plaintext = await window.crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: base64ToBytes(envelope.iv) },
    state.key,
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

async function getEncryptedObjectStore(storageKey, state = encryptionState) {
  const scopedStorageKey = getUserScopedStorageKey(storageKey);
  const stored = localStorage.getItem(scopedStorageKey);
  if (!stored) return {};

  if (!isEncryptedEnvelopeString(stored)) {
    localStorage.removeItem(scopedStorageKey);
    return {};
  }

  const decrypted = await decryptStringWithState(stored, state);
  const parsed = JSON.parse(decrypted);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function getEncryptedObjectStoreKeys() {
  return [DRAFTS_STORAGE_KEY, LOCAL_NOTES_STORAGE_KEY, PENDING_PUSHES_STORAGE_KEY];
}

function invalidateEncryptedObjectStorePersists() {
  getEncryptedObjectStoreKeys().forEach(storageKey => {
    const scopedStorageKey = getUserScopedStorageKey(storageKey);
    encryptedStorePersistVersions[scopedStorageKey] = (encryptedStorePersistVersions[scopedStorageKey] || 0) + 1;
  });
}

async function saveEncryptedObjectStoreNow(storageKey, value, state = encryptionState) {
  if (!state) throw new Error('Notes are locked.');

  const scopedStorageKey = getUserScopedStorageKey(storageKey);
  const snapshot = JSON.parse(JSON.stringify(value || {}));

  if (Object.keys(snapshot).length === 0) {
    localStorage.removeItem(scopedStorageKey);
    return;
  }

  localStorage.setItem(scopedStorageKey, await encryptStringWithState(JSON.stringify(snapshot), state));
}

function persistEncryptedObjectStore(storageKey, value) {
  if (!encryptionState) return;

  const scopedStorageKey = getUserScopedStorageKey(storageKey);
  const snapshot = JSON.parse(JSON.stringify(value || {}));
  const sequence = (encryptedStorePersistVersions[scopedStorageKey] || 0) + 1;
  encryptedStorePersistVersions[scopedStorageKey] = sequence;

  if (Object.keys(snapshot).length === 0) {
    localStorage.removeItem(scopedStorageKey);
    return;
  }

  encryptString(JSON.stringify(snapshot))
    .then(encrypted => {
      if (encryptedStorePersistVersions[scopedStorageKey] !== sequence) return;
      localStorage.setItem(scopedStorageKey, encrypted);
    })
    .catch(err => console.warn('Could not persist encrypted local store:', err));
}

async function encryptNoteRecordPayload(title, folder = 'Notes') {
  return {
    title: await encryptString(title),
    folder: await encryptString(folder || 'Notes'),
    user: getCurrentUserId()
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

  if (isKeyMigrationRunning) {
    syncBar.classList.remove('is-idle', 'has-error');
    setSyncStatusText(syncText, 'Changing encryption key...');
    return;
  }

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
  if (isKeyMigrationRunning) return;
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
    const fetched = await pb.collection('jnote').getFullList({ sort: '-updated', filter: getOwnedNotesFilter('deleted=false') });
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

// ─── Plaintext Export ────────────────────────────────────────────────────────

function escapePocketBaseFilterValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function fetchOwnedRemoteNoteRecords() {
  return pb.collection('jnote').getFullList({
    sort: '-updated',
    filter: getOwnedNotesFilter()
  });
}

async function fetchNoteContentRecords(noteId) {
  return pb.collection('jnote_content').getFullList({
    sort: 'created',
    filter: `note = "${escapePocketBaseFilterValue(noteId)}"`
  });
}

async function decryptStoredField(value, state = encryptionState) {
  if (isEncryptedEnvelopeString(value)) return decryptStringWithState(value, state);
  return String(value ?? '');
}

async function buildPlaintextExport() {
  if (!encryptionState) throw new Error('Notes are locked.');

  const remoteNotes = await fetchOwnedRemoteNoteRecords();
  const remoteNoteIds = new Set(remoteNotes.map(note => note.id));
  const notes = [];

  for (const note of remoteNotes) {
    const versions = await fetchNoteContentRecords(note.id);
    notes.push({
      id: note.id,
      source: 'cloud',
      title: await decryptStoredField(note.title),
      folder: await decryptStoredField(note.folder),
      deleted: Boolean(note.deleted),
      created: note.created || null,
      updated: note.updated || null,
      versions: await Promise.all(versions.map(async version => ({
        id: version.id,
        created: version.created || null,
        updated: version.updated || null,
        title: await decryptStoredField(version.title),
        content: await decryptStoredField(version.content)
      })))
    });
  }

  Object.values(getLocalNotes())
    .filter(note => !remoteNoteIds.has(note.id))
    .forEach(note => {
      notes.push({
        id: note.id,
        source: 'local',
        title: note.title || '',
        folder: note.folder || 'Notes',
        deleted: false,
        created: null,
        updated: note.updated || null,
        versions: [{
          id: `${note.id}-local-current`,
          created: null,
          updated: note.updated || null,
          title: note.title || '',
          content: note.content || ''
        }]
      });
    });

  return {
    format: 'jnote.plaintext-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    localChanges: {
      drafts: Object.entries(getDrafts()).map(([noteId, draft]) => ({
        noteId,
        title: draft.title || '',
        content: draft.content || '',
        folder: draft.folder || 'Notes',
        updatedAt: draft.updatedAt || null
      })),
      pendingPushes: Object.values(getPendingPushes()).map(push => ({
        action: push.action,
        noteId: push.noteId,
        title: push.title || '',
        content: push.content || '',
        folder: push.folder || 'Notes',
        queuedAt: push.queuedAt || null
      }))
    },
    settings: {
      customCss: getCustomCss()
    }
  };
}

function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeExportFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `jnote-plaintext-export-${timestamp}.json`;
}

async function downloadAllDataNotes() {
  const button = document.getElementById('download-all-data');
  const originalText = button?.querySelector('span')?.textContent || '';

  if (!encryptionState) {
    alert('Unlock notes before exporting.');
    return;
  }

  if (button) button.disabled = true;
  if (button?.querySelector('span')) button.querySelector('span').textContent = 'Preparing download...';

  try {
    const data = await buildPlaintextExport();
    downloadJsonFile(data, makeExportFilename());
    document.getElementById('settings-dialog')?.close();
  } catch (err) {
    console.error('Could not export notes:', err);
    alert('Could not export notes. Check your connection and try again.');
  } finally {
    if (button) button.disabled = false;
    if (button?.querySelector('span')) button.querySelector('span').textContent = originalText;
  }
}

// ─── Decryption Key Migration ────────────────────────────────────────────────

async function verifyStateMatchesUnlockedKey(candidateState) {
  const challenge = `${Date.now()}-${randomBase64(32)}`;
  const encryptedChallenge = await encryptStringWithState(challenge, encryptionState);
  const decryptedChallenge = await decryptStringWithState(encryptedChallenge, candidateState);

  if (decryptedChallenge !== challenge) {
    throw new Error('Current key could not be verified.');
  }
}

async function getVerifiedCurrentKeyState(passphrase) {
  if (!encryptionState?.metadata) throw new Error('Notes are locked.');

  const metadata = encryptionState.metadata;
  const key = await deriveEncryptionKey(passphrase, metadata);
  const candidateState = { key, metadata };

  await validateEncryptionKey(candidateState);
  await verifyStateMatchesUnlockedKey(candidateState);

  return candidateState;
}

async function buildKeyMigrationPlan(oldState, newState) {
  const noteRecords = await fetchOwnedRemoteNoteRecords();
  const noteUpdates = [];
  const contentUpdates = [];

  for (const note of noteRecords) {
    const title = await decryptStoredField(note.title, oldState);
    const folder = await decryptStoredField(note.folder, oldState);

    noteUpdates.push({
      id: note.id,
      oldPayload: {
        title: note.title,
        folder: note.folder
      },
      newPayload: {
        title: await encryptStringWithState(title, newState),
        folder: await encryptStringWithState(folder, newState)
      }
    });

    const versions = await fetchNoteContentRecords(note.id);
    for (const version of versions) {
      const versionTitle = await decryptStoredField(version.title, oldState);
      const versionContent = await decryptStoredField(version.content, oldState);

      contentUpdates.push({
        id: version.id,
        oldPayload: {
          title: version.title,
          content: version.content
        },
        newPayload: {
          title: await encryptStringWithState(versionTitle, newState),
          content: await encryptStringWithState(versionContent, newState)
        }
      });
    }
  }

  return { noteUpdates, contentUpdates };
}

async function restoreKeyMigrationPlan(plan) {
  const failures = [];

  for (const update of plan.noteUpdates) {
    try {
      await pb.collection('jnote').update(update.id, update.oldPayload);
    } catch (err) {
      failures.push({ collection: 'jnote', id: update.id, error: err });
    }
  }

  for (const update of plan.contentUpdates) {
    try {
      await pb.collection('jnote_content').update(update.id, update.oldPayload);
    } catch (err) {
      failures.push({ collection: 'jnote_content', id: update.id, error: err });
    }
  }

  return failures;
}

function isJnoteContentUpdatePermissionError(err) {
  const message = String(err?.message || err?.response?.message || err?.data?.message || '');
  return err?.status === 403 && message.includes('Only superusers can perform this action');
}

function createJnoteContentUpdatePermissionError(cause) {
  const err = new Error('The server is blocking note-version re-encryption. Update permission is required on jnote_content records before the decryption key can be changed.');
  err.code = 'JNOTE_CONTENT_UPDATE_FORBIDDEN';
  err.cause = cause;
  return err;
}

async function applyKeyMigrationPlan(plan, onStatus = () => {}) {
  const total = plan.noteUpdates.length + plan.contentUpdates.length;
  const applied = { noteUpdates: [], contentUpdates: [] };
  let completed = 0;

  try {
    for (const update of plan.contentUpdates) {
      await pb.collection('jnote_content').update(update.id, update.newPayload);
      applied.contentUpdates.push(update);
      completed += 1;
      onStatus(`Re-encrypting cloud data... ${completed}/${total}`);
    }

    for (const update of plan.noteUpdates) {
      await pb.collection('jnote').update(update.id, update.newPayload);
      applied.noteUpdates.push(update);
      completed += 1;
      onStatus(`Re-encrypting cloud data... ${completed}/${total}`);
    }
  } catch (err) {
    if (applied.noteUpdates.length === 0 && applied.contentUpdates.length === 0 && isJnoteContentUpdatePermissionError(err)) {
      throw createJnoteContentUpdatePermissionError(err);
    }

    onStatus('Migration failed. Restoring previous encryption...');
    const rollbackFailures = await restoreKeyMigrationPlan(applied);

    if (rollbackFailures.length > 0) {
      const rollbackError = new Error('Key change failed and automatic rollback could not finish. Keep this app open and try again.');
      rollbackError.cause = err;
      rollbackError.rollbackFailures = rollbackFailures;
      throw rollbackError;
    }

    const restoredError = new Error('Key change failed. Notes were restored to the previous key.');
    restoredError.cause = err;
    throw restoredError;
  }
}

async function saveLocalStoresWithState(state) {
  invalidateEncryptedObjectStorePersists();
  await saveEncryptedObjectStoreNow(DRAFTS_STORAGE_KEY, drafts, state);
  await saveEncryptedObjectStoreNow(LOCAL_NOTES_STORAGE_KEY, localNotes, state);
  await saveEncryptedObjectStoreNow(PENDING_PUSHES_STORAGE_KEY, pendingPushes, state);
}

function getRawEncryptedObjectStoreBackup() {
  return getEncryptedObjectStoreKeys().map(storageKey => {
    const scopedStorageKey = getUserScopedStorageKey(storageKey);
    return {
      scopedStorageKey,
      value: localStorage.getItem(scopedStorageKey)
    };
  });
}

function restoreRawEncryptedObjectStoreBackup(backup) {
  backup.forEach(item => {
    try {
      if (item.value === null) {
        localStorage.removeItem(item.scopedStorageKey);
      } else {
        localStorage.setItem(item.scopedStorageKey, item.value);
      }
    } catch (err) {
      console.warn('Could not restore encrypted local store backup:', err);
    }
  });
}

async function changeDecryptionKey(currentPassphrase, newPassphrase, onStatus = () => {}) {
  if (!encryptionState) throw new Error('Unlock notes before changing the key.');
  if (activePushes.size > 0) throw new Error('Wait for the current cloud push to finish, then try again.');

  isKeyMigrationRunning = true;
  updateSyncStatus();

  try {
    onStatus('Verifying current key...');
    const oldState = await getVerifiedCurrentKeyState(currentPassphrase);
    const rememberDevice = Boolean(getRememberedDeviceKeyRecord());
    const newMetadata = createEncryptionMetadata();
    const newState = {
      key: await deriveEncryptionKey(newPassphrase, newMetadata, { extractable: rememberDevice }),
      metadata: newMetadata
    };

    onStatus('Preparing encrypted records...');
    const plan = await buildKeyMigrationPlan(oldState, newState);

    onStatus('Re-encrypting cloud data...');
    await applyKeyMigrationPlan(plan, onStatus);

    onStatus('Saving encrypted local data...');
    const localStoreBackup = getRawEncryptedObjectStoreBackup();
    try {
      await saveLocalStoresWithState(newState);
    } catch (err) {
      restoreRawEncryptedObjectStoreBackup(localStoreBackup);
      onStatus('Local save failed. Restoring previous encryption...');
      const rollbackFailures = await restoreKeyMigrationPlan(plan);

      if (rollbackFailures.length > 0) {
        const rollbackError = new Error('Key change failed and automatic rollback could not finish. Keep this app open and try again.');
        rollbackError.cause = err;
        rollbackError.rollbackFailures = rollbackFailures;
        throw rollbackError;
      }

      const restoredError = new Error('Key change failed. Notes were restored to the previous key.');
      restoredError.cause = err;
      throw restoredError;
    }

    encryptionState = newState;
    saveEncryptionMetadata(newMetadata);

    if (rememberDevice) {
      await rememberCurrentDeviceKey();
    } else {
      forgetRememberedDeviceKey();
    }

    onStatus('Reloading notes...');
    try {
      await loadNotes();
    } catch (err) {
      console.warn('Key changed, but notes could not be reloaded immediately:', err);
    }
  } finally {
    isKeyMigrationRunning = false;
    updateSyncStatus();
  }

  flushPendingPushes();
}

function getEncryptedEnvelopeSalt(value) {
  return extractEncryptionMetadata(value)?.kdf?.salt || '';
}

function addUniqueMetadataCandidate(metadataBySalt, metadata) {
  const normalized = normalizeEncryptionMetadata(metadata);
  const salt = normalized?.kdf?.salt;
  if (!salt || metadataBySalt.has(salt)) return;
  metadataBySalt.set(salt, normalized);
}

function addRecoverySample(samples, metadataBySalt, value, source) {
  if (!isEncryptedEnvelopeString(value)) return;

  const metadata = extractEncryptionMetadata(value);
  const salt = metadata?.kdf?.salt;
  if (!metadata || !salt) return;

  addUniqueMetadataCandidate(metadataBySalt, metadata);
  samples.push({ value, source, salt });
}

async function collectRecoveryKeyMaterial(noteRecords) {
  const samples = [];
  const metadataBySalt = new Map();

  addUniqueMetadataCandidate(metadataBySalt, getStoredEncryptionMetadata());

  getEncryptedObjectStoreKeys().forEach(storageKey => {
    addRecoverySample(
      samples,
      metadataBySalt,
      localStorage.getItem(getUserScopedStorageKey(storageKey)),
      'local_store'
    );
  });

  for (const note of noteRecords) {
    addRecoverySample(samples, metadataBySalt, note.title, 'jnote');
    addRecoverySample(samples, metadataBySalt, note.folder, 'jnote');

    const versions = await fetchNoteContentRecords(note.id);
    versions.forEach(version => {
      addRecoverySample(samples, metadataBySalt, version.title, 'jnote_content');
      addRecoverySample(samples, metadataBySalt, version.content, 'jnote_content');
    });
  }

  return {
    samples,
    metadataCandidates: [...metadataBySalt.values()]
  };
}

async function getMatchedRecoveryStates(passphrases, metadataCandidates, samples) {
  const states = [];

  for (const passphrase of passphrases) {
    for (const metadata of metadataCandidates) {
      const matchingSamples = samples.filter(sample => sample.salt === metadata.kdf.salt);
      if (matchingSamples.length === 0) continue;

      const state = {
        key: await deriveEncryptionKey(passphrase.value, metadata),
        metadata,
        recoveryLabel: passphrase.label,
        matchedSources: new Set()
      };

      for (const sample of matchingSamples) {
        try {
          await decryptStringWithState(sample.value, state);
          state.matchedSources.add(sample.source);
        } catch (err) {
          // This passphrase does not match this salt.
        }
      }

      if (state.matchedSources.size > 0) states.push(state);
    }
  }

  return states;
}

function selectOldRecoveryState(states) {
  const oldStates = states.filter(state => state.recoveryLabel === 'old');
  return oldStates.find(state => (
    state.matchedSources.has('jnote_content') ||
    state.matchedSources.has('local_store')
  )) || oldStates[0] || null;
}

async function decryptWithRecoveryStates(value, states) {
  if (!isEncryptedEnvelopeString(value)) return String(value ?? '');

  const salt = getEncryptedEnvelopeSalt(value);
  const matchingStates = states.filter(state => state.metadata.kdf.salt === salt);

  for (const state of matchingStates) {
    try {
      return await decryptStringWithState(value, state);
    } catch (err) {
      // Try the next state with this salt.
    }
  }

  throw new Error('Could not decrypt mixed-key note metadata with the provided keys.');
}

async function recoverFailedKeyChange(oldPassphrase, newPassphrase, onStatus = () => {}) {
  assertWebCryptoAvailable();
  if (activePushes.size > 0) throw new Error('Wait for the current cloud push to finish, then try recovery again.');

  isKeyMigrationRunning = true;
  updateSyncStatus();

  try {
    await loadCurrentUser();

    onStatus('Reading encrypted records...');
    const noteRecords = await fetchOwnedRemoteNoteRecords();
    const { samples, metadataCandidates } = await collectRecoveryKeyMaterial(noteRecords);

    if (metadataCandidates.length === 0) {
      throw new Error('No encrypted note data was found to recover.');
    }

    onStatus('Checking recovery keys...');
    const states = await getMatchedRecoveryStates([
      { label: 'old', value: oldPassphrase },
      { label: 'new', value: newPassphrase }
    ], metadataCandidates, samples);
    const oldState = selectOldRecoveryState(states);

    if (!oldState) {
      throw new Error('The old key did not decrypt any existing note history or local data.');
    }

    const noteUpdates = [];
    for (const note of noteRecords) {
      const title = await decryptWithRecoveryStates(note.title, states);
      const folder = await decryptWithRecoveryStates(note.folder, states);

      noteUpdates.push({
        id: note.id,
        payload: {
          title: await encryptStringWithState(title, oldState),
          folder: await encryptStringWithState(folder, oldState)
        }
      });
    }

    for (let i = 0; i < noteUpdates.length; i += 1) {
      const update = noteUpdates[i];
      await pb.collection('jnote').update(update.id, update.payload);
      onStatus(`Restoring note metadata... ${i + 1}/${noteUpdates.length}`);
    }

    encryptionState = oldState;
    saveEncryptionMetadata(oldState.metadata);
    await loadEncryptedClientStores();
    hideEncryptionModal();
    await loadNotes();
    updateSyncStatus();
  } finally {
    isKeyMigrationRunning = false;
    updateSyncStatus();
  }

  flushPendingPushes();
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

function openChangeKeyDialog() {
  const settingsDialog = document.getElementById('settings-dialog');
  const changeKeyDialog = document.getElementById('change-key-dialog');
  const currentKeyInput = document.getElementById('current-decryption-key');

  if (!changeKeyDialog || !currentKeyInput) return;

  settingsDialog?.close();
  resetChangeKeyDialog();
  changeKeyDialog.showModal();
  currentKeyInput.focus();
}

function closeChangeKeyDialog() {
  if (isKeyMigrationRunning) return;
  document.getElementById('change-key-dialog')?.close();
}

function resetChangeKeyDialog() {
  document.getElementById('change-key-form')?.reset();
  setChangeKeyStatus('');
  setChangeKeyError('');
  setChangeKeyBusy(false);
}

function setChangeKeyStatus(message) {
  const statusEl = document.getElementById('change-key-status');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function setChangeKeyError(message) {
  const errorEl = document.getElementById('change-key-error');
  if (!errorEl) return;

  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setChangeKeyBusy(isBusy) {
  const fields = [
    'current-decryption-key',
    'new-decryption-key',
    'confirm-new-decryption-key'
  ];
  const submitButton = document.getElementById('submit-change-key');
  const cancelButton = document.getElementById('cancel-change-key');
  const closeButton = document.getElementById('close-change-key-dialog');

  fields.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.disabled = isBusy;
  });

  if (submitButton) {
    submitButton.disabled = isBusy;
    submitButton.textContent = isBusy ? 'Changing key...' : 'Change key';
  }
  if (cancelButton) cancelButton.disabled = isBusy;
  if (closeButton) closeButton.disabled = isBusy;
}

function getKeyChangeFailureMessage(err) {
  if (err?.code === 'JNOTE_CONTENT_UPDATE_FORBIDDEN') {
    return 'Server permission needed: jnote_content records cannot be updated by this user, so note history cannot be re-encrypted. Add an update rule for owned note versions, then try again.';
  }

  if (err?.rollbackFailures?.length) {
    return 'Key change failed and automatic rollback could not finish. Keep this app open and try again when your connection is stable.';
  }

  if (err?.message) return err.message;

  return 'Could not change the key. Your notes are still using the previous key.';
}

async function handleChangeKeySubmit(event) {
  event.preventDefault();

  const currentKeyInput = document.getElementById('current-decryption-key');
  const newKeyInput = document.getElementById('new-decryption-key');
  const confirmKeyInput = document.getElementById('confirm-new-decryption-key');
  const currentKey = currentKeyInput?.value || '';
  const newKey = newKeyInput?.value || '';
  const confirmKey = confirmKeyInput?.value || '';

  setChangeKeyError('');
  setChangeKeyStatus('');

  if (!currentKey || !newKey || !confirmKey) {
    setChangeKeyError('Enter the current key, the new key, and the confirmation.');
    (!currentKey ? currentKeyInput : !newKey ? newKeyInput : confirmKeyInput)?.focus();
    return;
  }

  if (newKey !== confirmKey) {
    setChangeKeyError('The new key and confirmation do not match.');
    confirmKeyInput?.focus();
    confirmKeyInput?.select();
    return;
  }

  if (newKey === currentKey) {
    setChangeKeyError('Choose a new key that is different from the current key.');
    newKeyInput?.focus();
    newKeyInput?.select();
    return;
  }

  setChangeKeyBusy(true);

  try {
    await changeDecryptionKey(currentKey, newKey, setChangeKeyStatus);
    currentKeyInput.value = '';
    newKeyInput.value = '';
    confirmKeyInput.value = '';
    setChangeKeyStatus('Decryption key changed.');
    window.setTimeout(() => {
      closeChangeKeyDialog();
      alert('Your decryption key was changed and existing notes were re-encrypted.');
    }, 250);
  } catch (err) {
    console.error('Could not change decryption key:', err);
    setChangeKeyError(getKeyChangeFailureMessage(err));
  } finally {
    setChangeKeyBusy(false);
  }
}

function closeDialogOnBackdropClick(event) {
  const dialog = event.currentTarget;
  if (!dialog.open) return;
  if (dialog.id === 'change-key-dialog' && isKeyMigrationRunning) return;

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
  const changeKeyDialog = document.getElementById('change-key-dialog');

  document.getElementById('settings-btn')?.addEventListener('click', openSettingsDialog);
  document.getElementById('open-custom-css-dialog')?.addEventListener('click', openCustomCssDialog);
  document.getElementById('download-all-data')?.addEventListener('click', downloadAllDataNotes);
  document.getElementById('open-change-key-dialog')?.addEventListener('click', openChangeKeyDialog);
  document.getElementById('change-key-form')?.addEventListener('submit', handleChangeKeySubmit);
  document.getElementById('cancel-change-key')?.addEventListener('click', closeChangeKeyDialog);
  document.getElementById('close-change-key-dialog')?.addEventListener('click', closeChangeKeyDialog);
  document.getElementById('forget-remembered-device')?.addEventListener('click', () => {
    forgetRememberedDeviceKey();
    settingsDialog?.close();
    alert('This browser will ask for your encryption passphrase next time.');
  });

  document.getElementById('save-custom-css')?.addEventListener('click', () => {
    saveCustomCss(customCssInput?.value || '');
    customCssDialog?.close();
  });

  document.getElementById('clear-custom-css')?.addEventListener('click', () => {
    if (customCssInput) customCssInput.value = '';
    saveCustomCss('');
  });

  [
    'current-decryption-key',
    'new-decryption-key',
    'confirm-new-decryption-key'
  ].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      setChangeKeyError('');
    });
  });

  [settingsDialog, customCssDialog, changeKeyDialog].forEach(dialog => {
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
  document.getElementById('show-key-recovery')?.addEventListener('click', () => setKeyRecoveryVisible(true));
  document.getElementById('key-recovery-submit')?.addEventListener('click', handleKeyRecoverySubmit);
  document.getElementById('recovery-old-key')?.addEventListener('input', () => setKeyRecoveryError(''));
  document.getElementById('recovery-new-key')?.addEventListener('input', () => setKeyRecoveryError(''));
}

function setEncryptionModalMode(mode) {
  encryptionMode = mode;

  const title = document.getElementById('encryption-title');
  const copy = document.querySelector('.encryption-copy');
  const warning = document.querySelector('.encryption-warning');
  const input = document.getElementById('encryption-passphrase');
  const label = document.querySelector('label[for="encryption-passphrase"]');
  const rememberButton = document.querySelector('[data-remember-device="true"]');
  const onceButton = document.querySelector('[data-remember-device="false"]');
  const recoveryToggle = document.getElementById('show-key-recovery');
  const isSetup = mode === 'setup';

  setKeyRecoveryVisible(false);
  setKeyRecoveryError('');
  setKeyRecoveryStatus('');
  if (title) title.textContent = isSetup ? 'Create encryption key' : 'Unlock encrypted notes';
  if (copy) {
    copy.textContent = isSetup
      ? 'Choose the key that will encrypt your notes. This key is never sent to the server.'
      : 'Enter your decryption key to decrypt your notes.';
  }
  if (warning) {
    warning.textContent = isSetup
      ? 'If you forget this key, your notes cannot be recovered.'
      : `If you forgot it, your notes cannot be recovered.`;
  }
  if (input) {
    input.value = '';
    input.disabled = false;
    input.autocomplete = isSetup ? 'new-password' : 'current-password';
  }
  if (label) label.textContent = isSetup ? 'New encryption key' : 'Decryption key';
  if (recoveryToggle) recoveryToggle.hidden = isSetup;
  if (rememberButton) {
    rememberButton.disabled = false;
    rememberButton.textContent = isSetup ? 'Create and Save in Browser' : 'Unlock and Remember';
  }
  if (onceButton) {
    onceButton.disabled = false;
    onceButton.textContent = isSetup ? 'Create and Unlock Once' : 'Unlock Once';
  }
}

function showAuthRequired() {
  const title = document.getElementById('encryption-title');
  const copy = document.querySelector('.encryption-copy');
  const warning = document.querySelector('.encryption-warning');
  const input = document.getElementById('encryption-passphrase');
  const buttons = document.querySelectorAll('#encryption-form button[type="submit"]');
  const recoveryToggle = document.getElementById('show-key-recovery');

  if (title) title.textContent = 'Sign in required';
  if (copy) copy.textContent = 'JNote uses the account session from joe.mt/account.';
  if (warning) warning.textContent = `Sign in at ${ACCOUNT_URL}, then return to JNote.`;
  if (input) input.disabled = true;
  setKeyRecoveryVisible(false);
  if (recoveryToggle) recoveryToggle.hidden = true;
  buttons.forEach(button => { button.disabled = true; });
  setEncryptionError('');
  showEncryptionModal();
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

function setKeyRecoveryVisible(isVisible) {
  const panel = document.getElementById('key-recovery-panel');
  const toggle = document.getElementById('show-key-recovery');

  if (panel) panel.hidden = !isVisible;
  if (toggle) toggle.hidden = isVisible || encryptionMode === 'setup';
  if (isVisible) window.setTimeout(() => document.getElementById('recovery-old-key')?.focus(), 0);
}

function setKeyRecoveryStatus(message) {
  const statusEl = document.getElementById('key-recovery-status');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function setKeyRecoveryError(message) {
  const errorEl = document.getElementById('key-recovery-error');
  if (!errorEl) return;

  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setKeyRecoveryBusy(isBusy) {
  const fields = ['recovery-old-key', 'recovery-new-key'];
  const submitButton = document.getElementById('key-recovery-submit');

  fields.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.disabled = isBusy;
  });

  if (submitButton) {
    submitButton.disabled = isBusy;
    submitButton.textContent = isBusy ? 'Restoring...' : 'Restore old key';
  }
}

async function handleKeyRecoverySubmit() {
  const oldKeyInput = document.getElementById('recovery-old-key');
  const newKeyInput = document.getElementById('recovery-new-key');
  const oldKey = oldKeyInput?.value || '';
  const newKey = newKeyInput?.value || '';

  setKeyRecoveryError('');
  setKeyRecoveryStatus('');

  if (!oldKey || !newKey) {
    setKeyRecoveryError('Enter the old key and the attempted new key.');
    (!oldKey ? oldKeyInput : newKeyInput)?.focus();
    return;
  }

  setKeyRecoveryBusy(true);

  try {
    await recoverFailedKeyChange(oldKey, newKey, setKeyRecoveryStatus);
    oldKeyInput.value = '';
    newKeyInput.value = '';
    setEncryptionError('');
    alert('Recovered note metadata to the old key. You can unlock with the old key now.');
  } catch (err) {
    console.error('Could not recover failed key change:', err);
    setKeyRecoveryError(err?.message || 'Could not recover the failed key change.');
  } finally {
    setKeyRecoveryBusy(false);
  }
}

async function handleEncryptionSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = document.getElementById('encryption-passphrase');
  const submitButtons = [...form.querySelectorAll('button[type="submit"]')];
  const submitButton = event.submitter?.matches?.('button[type="submit"]') ? event.submitter : submitButtons[0];
  const rememberDevice = submitButton?.dataset.rememberDevice === 'true';
  const passphrase = input?.value || '';

  if (!passphrase) {
    setEncryptionError('Enter a passphrase to unlock your notes.');
    input?.focus();
    return;
  }

  setEncryptionError('');
  const originalSubmitText = submitButton?.textContent || '';
  submitButtons.forEach(button => { button.disabled = true; });
  if (submitButton) submitButton.textContent = 'Unlocking...';

  try {
    await unlockEncryption(passphrase, { rememberDevice });
    if (encryptionMode === 'setup') {
      await markJnoteKeySet();
    }
    input.value = '';
    await finishEncryptionUnlock();
  } catch (err) {
    encryptionState = null;
    drafts = {};
    localNotes = {};
    pendingPushes = {};
    updateSyncStatus();
    console.error('Could not unlock encrypted notes:', err);
    setEncryptionError('Could not unlock notes. Check the passphrase, or use recovery if this happened after a failed key change.');
    showEncryptionModal();
    input?.focus();
    input?.select();
  } finally {
    submitButtons.forEach(button => { button.disabled = false; });
    if (submitButton) submitButton.textContent = originalSubmitText;
  }
}

function setEncryptionError(message) {
  const errorEl = document.getElementById('encryption-error');
  if (!errorEl) return;

  errorEl.textContent = message;
  errorEl.hidden = !message;
}

async function initializeEncryptionUnlock() {
  try {
    await loadCurrentUser();

    if (currentUser.is_jnote_key_set && await unlockRememberedDevice()) {
      await finishEncryptionUnlock();
      return;
    }
  } catch (err) {
    console.warn('Could not initialize encrypted notes:', err);
    showAuthRequired();
    return;
  }

  setEncryptionModalMode(currentUser?.is_jnote_key_set ? 'unlock' : 'setup');
  showEncryptionModal();
}

async function finishEncryptionUnlock() {
  await loadEncryptedClientStores();
  hideEncryptionModal();
  await loadNotes();
  updateSyncStatus();
  flushPendingPushes();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  bindAppViewportSize();
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
    if (isKeyMigrationRunning) {
      event.preventDefault();
      event.returnValue = 'Your notes are being re-encrypted. Do not close the app yet.';
      return;
    }

    if (!hasUnfinishedPushes()) return;
    event.preventDefault();
    event.returnValue = 'Your latest commit is still pushing to the cloud.';
  });

  initializeEncryptionUnlock();
});
