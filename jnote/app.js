const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'Notes';
let currentNoteId = null;
let folderModalCallback = null;
let selectedFolderInModal = '';
let currentNoteState = { title: '', content: '' };

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

  // 3. Update note detail pane
  if (!currentNoteId) {
    document.getElementById('note-detail').innerHTML = '<p class="empty">Select a note to view</p>';
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
        ${escapeHtml(note.title) || '[untitled]'}
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
  closeMobileMenu();
  updateGUI();
}

async function selectNote(noteId) {
  currentNoteId = noteId;
  updateGUI(); // Reflect active states immediately

  const noteIndex = allNotes.findIndex(n => n.id === noteId);
  const local = allNotes[noteIndex];

  const container = document.getElementById('note-detail');

  if (!local?.hasContent) {
    container.innerHTML = '<p class="empty">Loading note...</p>';
    try {
      const full = await pb.collection('jnote').getOne(noteId);
      full.hasContent = true;
      if (full.folder == "") full.folder = 'Notes';
      allNotes[noteIndex] = full;
      renderNoteDetail(full);
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
  currentNoteState = { title: note.title, content: note.content };

  const container = document.getElementById('note-detail');
  container.innerHTML = `
    <div class="note-actions">
      <button class="btn-primary" id="btn-save" disabled>Save</button>
      <button class="btn-secondary" id="btn-move">Move</button>
      <button class="btn-secondary" id="btn-delete">Delete</button>
    </div>
    <textarea placeholder="Title" class="note-title" id="edit-title">${escapeHtml(note.title)}</textarea>
    <textarea placeholder="Take a note..." class="note-detail-content editable" id="edit-content">${escapeHtml(note.content)}</textarea>
  `;

  const titleEl = document.getElementById('edit-title');
  const contentEl = document.getElementById('edit-content');


  const autoGrow = el => { el.style.height = '1em'; el.style.height = el.scrollHeight + 'px'; };

  const saveBtn = document.getElementById('btn-save');

  [titleEl, contentEl].forEach(el => {
    el.addEventListener('input', () => {
      autoGrow(el);
      setCanSave(true);
    });
    autoGrow(el);
  });

  saveBtn.addEventListener('click', () => saveNote(note.id));
  document.getElementById('btn-move').addEventListener('click', () => openFolderModal('move', note));
  document.getElementById('btn-delete').addEventListener('click', () => deleteNote(note.id));
}

// ─── CRUD Operations ──────────────────────────────────────────────────────────

async function saveNote(noteId) {
  const title = document.getElementById('edit-title').value.trim();
  const content = document.getElementById('edit-content').value.trim();

  try {
    const updated = await pb.collection('jnote').update(noteId, { title, content });
    updated.hasContent = true;

    const idx = allNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) allNotes[idx] = updated;

    currentNoteState = { title: updated.title, content: updated.content };



    setCanSave(false);

    renderNoteList();
  } catch (err) {
    console.error('Error saving note:', err);
    alert('Failed to save note');
  }
}

function setCanSave(noteHasChanges) {
  const saveBtn = document.getElementById('btn-save');
  if (!saveBtn) return;
  saveBtn.disabled = !noteHasChanges;
}

async function createNewNote(folder) {
  try {
    const newNote = await pb.collection('jnote').create({
      title: '',
      content: '',
      folder: folder || 'Notes'
    });

    allNotes.push({
      id: newNote.id,
      title: newNote.title,
      folder: newNote.folder || 'Notes',
      updated: newNote.updated,
      hasContent: true,
      content: newNote.content
    });

    currentFolder = folder || 'Notes';
    currentNoteId = newNote.id;
    updateGUI();
    renderNoteDetail(newNote);
  } catch (err) {
    console.error('Error creating note:', err);
    alert('Failed to create note');
  }
}

async function deleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;

  try {
    await pb.collection('jnote').update(noteId, { deleted: true });
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
    updated.hasContent = true;

    const idx = allNotes.findIndex(n => n.id === noteId);
    if (idx !== -1) allNotes[idx] = updated;

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

function openMobileMenu() {
  document.getElementById('sidebar').classList.add('show');
  document.getElementById('overlay').classList.add('show');
}

function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('overlay').classList.remove('show');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text ?? '').replace(/[&<>"']/g, m => map[m]);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadNotes();

  setInterval(() => {
    if (currentNoteId) {
      saveNote(currentNoteId);
    }
  }, 1000);

  document.getElementById('menu-button').addEventListener('click', openMobileMenu);
  document.getElementById('overlay').addEventListener('click', closeMobileMenu);
  document.getElementById('btn-create-note').addEventListener('click', () => createNewNote(currentFolder));
  document.getElementById('folder-modal-confirm').addEventListener('click', () => folderModalCallback?.());
  document.getElementById('folder-modal-cancel').addEventListener('click', closeFolderModal);

  window.addEventListener('resize', () => { if (window.innerWidth > 768) closeMobileMenu(); });
});