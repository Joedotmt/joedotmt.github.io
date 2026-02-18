const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'all';
let currentNoteId = null;
let folderModalCallback = null;
let selectedFolderInModal = '';
let currentNoteState = { title: '', content: '' };
let noteHasChanges = false;

async function loadNotes() {
  try {
    const fetched = await pb.collection('jnote').getFullList({ sort: '-updated', filter: 'deleted=false' });

    allNotes = fetched.map(n => ({
      id: n.id,
      title: n.title || '[untitled]',
      folder: n.folder || '',
      updated: n.updated,
      hasContent: false
    }));

    displayFolders();
    filterByFolder('', document.querySelector('[data-folder=""]'));
  } catch (error) {
    console.error('Error loading notes:', error);
    document.getElementById('note-detail').innerHTML = 
      '<p class="error">Failed to load notes</p>';
  }
}

function displayFolders() {
  const folders = new Set();
  allNotes.forEach(note => {
    if (note.folder) {
      folders.add(note.folder);
    }
  });
  
  const folderList = document.getElementById('folder-list');
  
  folderList.innerHTML = '';
  
  Array.from(folders).sort().forEach(folder => {
    folderList.innerHTML += `
      <li onclick="filterByFolder('${folder}', this)" class="folder-item" data-folder="${folder}">
        ${folder}
      </li>
    `;
  });
}

function filterByFolder(folder, element) {
  console.log('Filtering by folder:', folder);
  currentFolder = folder;
  currentNoteId = null;
  
  // Close mobile menu
  closeMobileMenu();
  
  // Update active state
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });
  element.classList.add('active');
    
  updateGUI();
}

/**
 * Displays a list of notes in the UI.
 * @param {list} notes - The list of notes to display.
 */
function displayNotes(notes) {
  const notesList = document.getElementById('notes-list');
  
  if (notes.length === 0) {
    notesList.innerHTML = '<li class="empty-state">No notes</li>';
    return;
  }
  
  notesList.innerHTML = notes.map(note => `
    <li class="folder-item" data-note-id="${note.id}">
      ${escapeHtml(note.title)}
    </li>
  `).join('');
  
  // Add click handlers
  document.querySelectorAll('.folder-item[data-note-id]').forEach(item => {
    item.addEventListener('click', () => {
      const noteId = item.getAttribute('data-note-id');
      selectNote(noteId);
    });
  });
}

function selectNote(noteId) {
  (async () => {
    currentNoteId = noteId;
    noteHasChanges = false;

    document.querySelectorAll('.folder-item[data-note-id]').forEach(item => item.classList.remove('active'));
    const activeEl = document.querySelector(`[data-note-id="${noteId}"]`);
    if (activeEl) activeEl.classList.add('active');

    const noteIndex = allNotes.findIndex(n => n.id === noteId);
    const local = noteIndex !== -1 ? allNotes[noteIndex] : null;

    const container = document.getElementById('note-detail');
    if (!local || !local.hasContent) {
      container.innerHTML = '<p class="empty">Loading note...</p>';
      try {
        const full = await pb.collection('jnote').getOne(noteId);
        full.hasContent = true;
        allNotes[noteIndex] = full;
        displayNoteDetail(full);
      } catch (err) {
        console.error('Error fetching note:', err);
        container.innerHTML = '<p class="error">Failed to load note</p>';
      }
    } else {
      displayNoteDetail(local);
    }
  })();
}

function displayNoteDetail(note) {
  const container = document.getElementById('note-detail');
  
  currentNoteState = { title: note.title, content: note.content };
  
  container.innerHTML = `
    <div class="note-actions">
      <button class="btn-primary" id="btn-save" disabled>Save</button>
      <button class="btn-secondary" id="btn-move">Move</button>
      <button class="btn-secondary" id="btn-delete">Delete</button>
    </div>
    <textarea class="note-title editable" id="edit-title">${escapeHtml(note.title)}</textarea>
    <textarea class="note-detail-content editable" id="edit-content">${escapeHtml(note.content)}</textarea>
  `;
  
  const titleInput = document.getElementById('edit-title');
  const contentInput = document.getElementById('edit-content');
  const saveBtn = document.getElementById('btn-save');
  
  const autoGrow = (textarea) => {
    textarea.style.height = '1em';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  
  const checkChanges = () => {
    const titleChanged = titleInput.value !== currentNoteState.title;
    const contentChanged = contentInput.value !== currentNoteState.content;
    noteHasChanges = titleChanged || contentChanged;
    saveBtn.disabled = !noteHasChanges;
  };
  
  titleInput.addEventListener('input', () => {
    autoGrow(titleInput);
    checkChanges();
  });
  contentInput.addEventListener('input', () => {
    autoGrow(contentInput);
    checkChanges();
  });
  
  // Initialize heights on load
  autoGrow(titleInput);
  autoGrow(contentInput);
  
  document.getElementById('btn-save').addEventListener('click', () => saveNote(note.id));
  document.getElementById('btn-move').addEventListener('click', () => openFolderModal('move', note));
  document.getElementById('btn-delete').addEventListener('click', () => deleteNote(note.id));
}

async function saveNote(noteId) {
  const title = document.getElementById('edit-title').value.trim();
  const content = document.getElementById('edit-content').value.trim();
  
  try {
    const updatedNote = await pb.collection('jnote').update(noteId, {
      title,
      content
    });
    
    const noteIndex = allNotes.findIndex(n => n.id === noteId);
    if (noteIndex !== -1) {
      updatedNote.hasContent = true;
      allNotes[noteIndex] = updatedNote;
    }

    // Update title in the notes list sidebar (if visible)
    const noteListEl = document.querySelector(`[data-note-id="${noteId}"]`);
    if (noteListEl) {
      noteListEl.innerHTML = escapeHtml(updatedNote.title || '[untitled]');
    }
    
    currentNoteState = { title: updatedNote.title, content: updatedNote.content };
    noteHasChanges = false;
    document.getElementById('btn-save').disabled = true;
    displayNoteDetail(updatedNote);
  } catch (error) {
    console.error('Error saving note:', error);
    alert('Failed to save note');
  }
}

async function deleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) {
    return;
  }
  
  try {
    // Mark note as deleted instead of deleting it permanently
    await pb.collection('jnote').update(noteId, { deleted: true });
    allNotes = allNotes.filter(n => n.id !== noteId);
    currentNoteId = null;
  } catch (error) {
    console.error('Error deleting note:', error);
    alert('Failed to delete note');
  }
}

function updateGUI(){
    displayNotes(getNotesInCurrentFolder());
    if (currentNoteId == null) {
      showEmptyNoteDetail();
    }
}

function getNotesInCurrentFolder() {
  return currentFolder === ''
    ? allNotes.filter(note => !note.folder || note.folder === '')
    : allNotes.filter(note => note.folder === currentFolder);
}

function openFolderModal(mode, note = null) {
  const modal = document.getElementById('folder-modal');
  const modalHeader = document.getElementById('modal-header');
  const folderSelection = document.getElementById('folder-selection');
  const customFolderInput = document.getElementById('custom-folder-name');
  
  modalHeader.textContent = mode === 'create' ? 'Create New Note' : 'Move Note to Folder';
  customFolderInput.value = '';
  
  selectedFolderInModal = mode === 'move' ? (note.folder || '') : '';
  
  const folders = new Set();
  allNotes.forEach(n => {
    if (n.folder) {
      folders.add(n.folder);
    }
  });
  
  folderSelection.innerHTML = Array.from(folders).sort().map(folder => `
    <button class="folder-option ${selectedFolderInModal === folder ? 'selected' : ''}" data-folder="${folder}">
      ${escapeHtml(folder)}
    </button>
  `).join('');
  
  folderSelection.innerHTML += `
    <button class="folder-option ${selectedFolderInModal === '' ? 'selected' : ''}" data-folder="">
      Notes
    </button>
  `;
  
  document.querySelectorAll('.folder-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.folder-option').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      selectedFolderInModal = e.target.getAttribute('data-folder');
      customFolderInput.value = '';
    });
  });
  
  folderModalCallback = () => {
    const customFolder = customFolderInput.value.trim();
    const targetFolder = customFolder || selectedFolderInModal;
    
    if (mode === 'create') {
      closeFolderModal();
      createNewNote(targetFolder);
    } else if (mode === 'move') {
      moveNoteToFolder(note.id, targetFolder);
      closeFolderModal();
    }
  };
  
  modal.classList.add('show');
}

async function createNewNote(folder) {
  try {
    const newNote = await pb.collection('jnote').create({
      title: 'Note',
      content: '',
      folder: folder || ''
    });
    
    const minimal = {
      id: newNote.id,
      title: newNote.title || 'Note',
      folder: newNote.folder || '',
      updated: newNote.updated,
      hasContent: true,
      content: newNote.content
    };
    allNotes.push(minimal);
    displayFolders();
    filterByFolder(folder, document.querySelector(`[data-folder="${folder}"]`));
    selectNote(newNote.id);
  } catch (error) {
    console.error('Error creating note:', error);
    alert('Failed to create note');
  }
}

async function moveNoteToFolder(noteId, folder) {
  try {
    const updatedNote = await pb.collection('jnote').update(noteId, {
      folder: folder || ''
    });
    
    const noteIndex = allNotes.findIndex(n => n.id === noteId);
    if (noteIndex !== -1) {
      updatedNote.hasContent = true;
      allNotes[noteIndex] = updatedNote;
    }
    
    displayFolders();
    filterByFolder(currentFolder, document.querySelector(`[data-folder="${currentFolder}"]`));
  } catch (error) {
    console.error('Error moving note:', error);
    alert('Failed to move note');
  }
}

function closeFolderModal() {
  const modal = document.getElementById('folder-modal');
  modal.classList.remove('show');
  folderModalCallback = null;
}

function escapeHtml(text) {
  text = text == null ? '' : String(text);
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>\"']/g, m => map[m]);
}

function openMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  sidebar.classList.add('show');
  overlay.classList.add('show');
}

function closeMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  sidebar.classList.remove('show');
  overlay.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  loadNotes();
  
  const menuButton = document.getElementById('menu-button');
  menuButton.addEventListener('click', openMobileMenu);
  
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', closeMobileMenu);
  
  const createBtn = document.getElementById('btn-create-note');
  createBtn.addEventListener('click', () => createNewNote(currentFolder));
  
  const confirmBtn = document.getElementById('folder-modal-confirm');
  const cancelBtn = document.getElementById('folder-modal-cancel');
  const customFolderInput = document.getElementById('custom-folder-name');
  
  confirmBtn.addEventListener('click', () => {
    if (folderModalCallback) {
      folderModalCallback();
    }
  });
  
  cancelBtn.addEventListener('click', closeFolderModal);
  
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });
});

function showEmptyNoteDetail() {
  const container = document.getElementById('note-detail');
  container.innerHTML = '<p class="empty">Select a note to view</p>';
}
