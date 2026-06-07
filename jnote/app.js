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
const PUSH_RETRY_DELAY = 5000;
let pendingPushes = getPendingPushes();
let activePushes = new Set();
let pushRetryTimers = new Map();
let hasPushError = false;
let syncStatusAnimationTimer = null;
let activeNoteContextMenuId = null;

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

function saveDraft(noteId, title, content, folder = 'Notes') {
  const drafts = getDrafts();
  drafts[noteId] = {
    title,
    content,
    folder,
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

function moveDraft(fromNoteId, toNoteId) {
  const drafts = getDrafts();
  if (!drafts[fromNoteId]) return;
  drafts[toNoteId] = drafts[fromNoteId];
  delete drafts[fromNoteId];
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function getLocalNotes() {
  try {
    const localNotes = JSON.parse(localStorage.getItem(LOCAL_NOTES_STORAGE_KEY) || '{}');
    return localNotes && typeof localNotes === 'object' ? localNotes : {};
  } catch (err) {
    console.warn('Could not read local notes:', err);
    return {};
  }
}

function persistLocalNotes(localNotes) {
  localStorage.setItem(LOCAL_NOTES_STORAGE_KEY, JSON.stringify(localNotes));
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
        const newNoteRecord = await pb.collection('jnote').create({
          title: push.title,
          folder: push.folder || 'Notes'
        });
        const newVersion = await pb.collection('jnote_content').create({
          note: newNoteRecord.id,
          title: push.title,
          content: push.content
        });

        const latestPending = pendingPushes[noteId];
        delete pendingPushes[noteId];
        persistPendingPushes();
        applyCreatePushResult(noteId, push, newNoteRecord, newVersion, latestPending);
      } else {
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

function applyCreatePushResult(localNoteId, push, newNoteRecord, newVersion, latestPending) {
  const newNoteId = newNoteRecord.id;
  const idx = allNotes.findIndex(n => n.id === localNoteId);
  const latestChange = latestPending && latestPending.id !== push.id ? latestPending : null;

  if (idx !== -1) {
    allNotes[idx] = {
      ...allNotes[idx],
      id: newNoteId,
      title: latestChange?.title ?? newNoteRecord.title,
      folder: newNoteRecord.folder || push.folder || 'Notes',
      updated: newNoteRecord.updated,
      content: latestChange?.content ?? push.content,
      versionId: newVersion.id,
      hasContent: true,
      isLocalOnly: false
    };
  } else if (latestChange?.action !== 'delete') {
    allNotes.push({
      id: newNoteId,
      title: latestChange?.title ?? newNoteRecord.title,
      folder: newNoteRecord.folder || push.folder || 'Notes',
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
    allNotes = fetched.map(n => ({
      id: n.id,
      title: n.title,
      folder: n.folder || 'Notes',
      updated: n.updated,
      hasContent: false
    }));
    mergeLocalNotesIntoNotes();
    mergePendingPushesIntoNotes();
    mergeOrphanLocalDraftsIntoNotes();
    updateGUI();
  } catch (err) {
    console.error('Error loading notes:', err);
    document.getElementById('note-detail').innerHTML = '<p class="error">Failed to load notes</p>';
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
    const title = titleEl.textContent.trim();
    const content = contentEl.textContent.trim();
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
  const title = (document.getElementById('edit-title')?.textContent || '').trim();
  const content = (document.getElementById('edit-content')?.textContent || '').trim();

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
  if (note?.isLocalOnly) {
    note.folder = folder || 'Notes';
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

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
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
});
