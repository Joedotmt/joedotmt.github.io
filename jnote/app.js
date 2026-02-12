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
    allNotes = await pb.collection('jnote').getFullList({
      sort: '-updated',
    });
    
    populateFolders();
    filterByFolder('', document.querySelector('[data-folder=""]'));
  } catch (error) {
    console.error('Error loading notes:', error);
    document.getElementById('note-detail').innerHTML = 
      '<p class="error">Failed to load notes</p>';
  }
}

function populateFolders() {
  const folders = new Set();
  allNotes.forEach(note => {
    if (note.folder) {
      folders.add(note.folder);
    }
  });
  
  const folderList = document.getElementById('folder-list');
  
  // Clear and rebuild
  folderList.innerHTML = '<li class="folder-item active" data-folder="">Notes</li>';
  
  Array.from(folders).sort().forEach(folder => {
    const li = document.createElement('li');
    li.className = 'folder-item';
    li.textContent = folder;
    li.setAttribute('data-folder', folder);
    li.addEventListener('click', () => filterByFolder(folder, li));
    folderList.appendChild(li);
  });
  
  const unfiled = folderList.querySelector('[data-folder=""]');
  unfiled.addEventListener('click', () => filterByFolder('', unfiled));
}

function filterByFolder(folder, element) {
  currentFolder = folder;
  currentNoteId = null;
  
  // Close mobile menu
  closeMobileMenu();
  
  // Update active state
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });
  element.classList.add('active');
  
  // Filter notes
  const filtered = folder === '' 
    ? allNotes.filter(note => !note.folder || note.folder === '')
    : allNotes.filter(note => note.folder === folder);
  
  displayNotesList(filtered);
  showEmptyNoteDetail();
}

function displayNotesList(notes) {
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
  currentNoteId = noteId;
  noteHasChanges = false;
  
  // Update active state in list
  document.querySelectorAll('.folder-item[data-note-id]').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-note-id="${noteId}"]`).classList.add('active');
  
  // Find and display the note
  const note = allNotes.find(n => n.id === noteId);
  if (note) {
    displayNoteDetail(note);
  }
}

function displayNoteDetail(note) {
  const container = document.getElementById('note-detail');
  
  currentNoteState = { title: note.title, content: note.content };
  
  container.innerHTML = `
    <div class="note-actions">
      <button class="btn-primary" id="btn-save" disabled>Save</button>
      <button class="btn-secondary" id="btn-move">Move to Folder</button>
      <button class="btn-danger" id="btn-delete">Delete</button>
    </div>
    <textarea class="note-title editable" id="edit-title">${escapeHtml(note.title)}</textarea>
    <textarea class="note-detail-content editable" id="edit-content">${escapeHtml(note.content)}</textarea>
  `;
  
  const titleInput = document.getElementById('edit-title');
  const contentInput = document.getElementById('edit-content');
  const saveBtn = document.getElementById('btn-save');
  
  const checkChanges = () => {
    const titleChanged = titleInput.value !== currentNoteState.title;
    const contentChanged = contentInput.value !== currentNoteState.content;
    noteHasChanges = titleChanged || contentChanged;
    saveBtn.disabled = !noteHasChanges;
  };
  
  titleInput.addEventListener('input', checkChanges);
  contentInput.addEventListener('input', checkChanges);
  
  document.getElementById('btn-save').addEventListener('click', () => saveNote(note.id));
  document.getElementById('btn-move').addEventListener('click', () => openFolderModal('move', note));
  document.getElementById('btn-delete').addEventListener('click', () => deleteNote(note.id));
}

async function saveNote(noteId) {
  const title = document.getElementById('edit-title').value.trim();
  const content = document.getElementById('edit-content').value.trim();
  
  if (!title) {
    alert('Title cannot be empty');
    return;
  }
  
  try {
    const updatedNote = await pb.collection('jnote').update(noteId, {
      title,
      content
    });
    
    const noteIndex = allNotes.findIndex(n => n.id === noteId);
    if (noteIndex !== -1) {
      allNotes[noteIndex] = updatedNote;
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
    await pb.collection('jnote').delete(noteId);
    
    allNotes = allNotes.filter(n => n.id !== noteId);
    currentNoteId = null;
    
    const filtered = currentFolder === ''
      ? allNotes.filter(note => !note.folder || note.folder === '')
      : allNotes.filter(note => note.folder === currentFolder);
    
    displayNotesList(filtered);
    showEmptyNoteDetail();
  } catch (error) {
    console.error('Error deleting note:', error);
    alert('Failed to delete note');
  }
}

function openFolderModal(mode, note = null) {
  const modal = document.getElementById('folder-modal');
  const modalHeader = document.getElementById('modal-header');
  const folderSelection = document.getElementById('folder-selection');
  
  modalHeader.textContent = mode === 'create' ? 'Create New Note' : 'Move Note to Folder';
  
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
    });
  });
  
  folderModalCallback = () => {
    if (mode === 'create') {
      closeFolderModal();
      createNewNote(selectedFolderInModal);
    } else if (mode === 'move') {
      moveNoteToFolder(note.id, selectedFolderInModal);
      closeFolderModal();
    }
  };
  
  modal.classList.add('show');
}

async function createNewNote(folder) {
  try {
    const newNote = await pb.collection('jnote').create({
      title: 'Untitled Note',
      content: '',
      folder: folder || ''
    });
    
    allNotes.push(newNote);
    populateFolders();
    filterByFolder(folder, document.querySelector(`[data-folder="${folder}"]`));
    selectNote(newNote.id);
    enterEditMode(newNote);
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
      allNotes[noteIndex] = updatedNote;
    }
    
    populateFolders();
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
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
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
  createBtn.addEventListener('click', () => openFolderModal('create'));
  
  const folderModal = document.getElementById('folder-modal');
  const confirmBtn = document.getElementById('folder-modal-confirm');
  const cancelBtn = document.getElementById('folder-modal-cancel');
  const customFolderBtn = document.getElementById('custom-folder-btn');
  
  confirmBtn.addEventListener('click', () => {
    if (folderModalCallback) {
      folderModalCallback();
    }
  });
  
  cancelBtn.addEventListener('click', closeFolderModal);
  
  customFolderBtn.addEventListener('click', () => {
    const input = document.getElementById('custom-folder-input');
    input.style.display = input.style.display === 'none' ? 'flex' : 'none';
  });
  
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
