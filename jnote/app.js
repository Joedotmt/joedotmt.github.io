const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'Notes';
let currentNoteId = null;
let folderModalCallback = null;
let selectedFolderInModal = '';
let currentNoteState = { title: '', content: '' };
const DRAFTS_STORAGE_KEY = 'jnote.unsavedDrafts.v1';
const PENDING_PUSHES_STORAGE_KEY = 'jnote.pendingPushes.v1';
const PUSH_RETRY_DELAY = 5000;
let pendingPushes = getPendingPushes();
let activePushes = new Set();
let pushRetryTimers = new Map();
let hasPushError = false;
let syncStatusAnimationTimer = null;

function getDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) || '{}');
    return drafts && typeof drafts === 'object' ? drafts : {};
  } catch (err) {
    console.warn('Could not read local drafts:', err);
    return {};
  }
}

function getDraft(noteId) {
  return getDrafts()[noteId] || null;
}

function hasDraft(noteId) {
  return Boolean(getDraft(noteId));
}

function saveDraft(noteId, title, content) {
  const drafts = getDrafts();
  drafts[noteId] = {
    title,
    content,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function clearDraft(noteId) {
  const drafts = getDrafts();
  if (!drafts[noteId]) return;
  delete drafts[noteId];
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function getPendingPush(noteId) {
  return pendingPushes[noteId] || null;
}

function getPendingPushes() {
  try {
    const pushes = JSON.parse(localStorage.getItem(PENDING_PUSHES_STORAGE_KEY) || '{}');
    return pushes && typeof pushes === 'object' ? pushes : {};
  } catch (err) {
    console.warn('Could not read pending pushes:', err);
    return {};
  }
}

function persistPendingPushes() {
  localStorage.setItem(PENDING_PUSHES_STORAGE_KEY, JSON.stringify(pendingPushes));
}

function queuePush(noteId, title, content) {
  pendingPushes[noteId] = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    noteId,
    title,
    content,
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
      const updatedNote = await pb.collection('jnote').update(noteId, { title: push.title });
      const newVersion = await pb.collection('jnote_content').create({
        note: noteId,
        title: push.title,
        content: push.content
      });

      if (pendingPushes[noteId]?.id === push.id) {
        delete pendingPushes[noteId];
        persistPendingPushes();
        applyCloudPushResult(noteId, push, updatedNote, newVersion);
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
    allNotes[idx].title = updatedNote.title;
    allNotes[idx].updated = updatedNote.updated;
    allNotes[idx].content = push.content;
    allNotes[idx].versionId = newVersion.id;
    allNotes[idx].hasContent = true;
  }

  if (currentNoteId === noteId && !hasDraft(noteId) && !pendingPushes[noteId]) {
    currentNoteState = { title: updatedNote.title, content: push.content };
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
    <li onclick="filterByFolder('${escapeHtml(folder)}')"
        class="folder-item ${folder === currentFolder ? 'active' : ''}"
        data-folder="${escapeHtml(folder)}">
      ${escapeHtml(folder)}
    </li>
  `).join('');

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
    });
  }
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadNotes() {
  try {
    const fetched = await pb.collection('jnote').getFullList({ sort: '-updated', filter: 'deleted=false' });
    allNotes = fetched.map(n => ({
      id: n.id,
      title: n.title,
      folder: n.folder || 'Notes',
      updated: n.updated,
      hasContent: false
    }));
    updateGUI();
  } catch (err) {
    console.error('Error loading notes:', err);
    document.getElementById('note-detail').innerHTML = '<p class="error">Failed to load notes</p>';
  }
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

  if (!local?.hasContent) {
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

      note.title = getVersionTitle(latest, note.title);
      note.content = latest.content;
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
  currentNoteState = { title: committedNote.title, content: committedNote.content };

  const container = document.getElementById('note-detail');
  container.innerHTML = `
    <div class="note-actions">
      <button class="btn-secondary ripple ${draft ? '' : 'hide'}" id="btn-revert">Revert Changes</button>
      <button class="btn-primary ripple" id="btn-save" ${draft ? '' : 'disabled'}>Commit</button>
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
    const title = titleEl.textContent.trim();
    const content = contentEl.textContent.trim();

    if (title === currentNoteState.title && content === currentNoteState.content) {
      clearDraft(note.id);
      setCanSave(false);
    } else {
      saveDraft(note.id, title, content);
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
  const title = (document.getElementById('edit-title')?.textContent || '').trim();
  const content = (document.getElementById('edit-content')?.textContent || '').trim();

  const idx = allNotes.findIndex(n => n.id === noteId);
  if (idx !== -1) {
    allNotes[idx].title = title;
    allNotes[idx].content = content;
    allNotes[idx].updated = new Date().toISOString();
    allNotes[idx].hasContent = true;
  }

  clearDraft(noteId);
  currentNoteState = { title, content };
  setCanSave(false);
  renderNoteList();
  queuePush(noteId, title, content);
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
  if (saveBtn) saveBtn.disabled = !noteHasChanges;
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

async function createNewNote(folder) {
  try {
    // 1. Create the base note
    const newNoteRecord = await pb.collection('jnote').create({
      title: '',
      folder: folder || 'Notes'
    });

    // 2. Create the initial empty content version
    const initialContent = await pb.collection('jnote_content').create({
      note: newNoteRecord.id,
      title: newNoteRecord.title,
      content: ''
    });

    const noteData = {
      id: newNoteRecord.id,
      title: newNoteRecord.title,
      folder: newNoteRecord.folder || 'Notes',
      updated: newNoteRecord.updated,
      hasContent: true,
      content: initialContent.content,
      versionId: initialContent.id
    };

    allNotes.push(noteData);

    currentFolder = folder || 'Notes';
    currentNoteId = newNoteRecord.id;
    
    updateGUI();
    renderNoteDetail(noteData);
    
  } catch (err) {
    console.error('Error creating note:', err);
    alert('Failed to create note');
  }
}

async function deleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;

  try {
    await pb.collection('jnote').update(noteId, { deleted: true });
    clearDraft(noteId);
    allNotes = allNotes.filter(n => n.id !== noteId);
    currentNoteId = null;
    updateGUI();
  } catch (err) {
    console.error('Error deleting note:', err);
    alert('Failed to delete note');
  }
}

async function moveNoteToFolder(noteId, folder) {
  try {
    const updated = await pb.collection('jnote').update(noteId, { folder: folder || 'Notes' });
    
    const idx = allNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      // Merge updates without losing the content we already loaded
      allNotes[idx] = { ...allNotes[idx], ...updated };
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text ?? '').replace(/[&<>"']/g, m => map[m]);
}

function getDisplayTitle(note) {
  return getDraft(note.id)?.title ?? getPendingPush(note.id)?.title ?? note.title;
}

function getVersionTitle(version, fallbackTitle = '') {
  return typeof version?.title === 'string' ? version.title : fallbackTitle;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  loadNotes();
  updateSyncStatus();
  flushPendingPushes();

  document.getElementById('btn-create-note').addEventListener('click', () => createNewNote(currentFolder));
  document.getElementById('folder-modal-confirm').addEventListener('click', () => folderModalCallback?.());
  document.getElementById('folder-modal-cancel').addEventListener('click', closeFolderModal);

  // Mobile navigation handlers
  document.getElementById('hamburger-btn').addEventListener('click', toggleMenu);
  document.getElementById('close-detail-btn').addEventListener('click', closeDetailView);
  document.getElementById('mobile-overlay').addEventListener('click', () => {
    closeDetailView();
    closeFoldersDrawer();
  });

  // Handle window resize to close drawers on desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeFoldersDrawer();
      closeDetailView();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnfinishedPushes()) return;
    event.preventDefault();
    event.returnValue = 'Your latest commit is still pushing to the cloud.';
  });
});
