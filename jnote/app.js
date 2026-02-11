const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'all';
let currentNoteId = null;

async function loadNotes() {
  try {
    allNotes = await pb.collection('jnote').getFullList({
      sort: '-updated',
    });
    
    populateFolders();
    filterByFolder('all', document.querySelector('[data-folder="all"]'));
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
  folderList.innerHTML = '<li class="folder-item active" data-folder="all">All Notes</li>';
  
  Array.from(folders).sort().forEach(folder => {
    const li = document.createElement('li');
    li.className = 'folder-item';
    li.textContent = folder;
    li.setAttribute('data-folder', folder);
    li.addEventListener('click', () => filterByFolder(folder, li));
    folderList.appendChild(li);
  });
  
  const allNotesItem = folderList.querySelector('[data-folder="all"]');
  allNotesItem.addEventListener('click', () => filterByFolder('all', allNotesItem));
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
  const filtered = folder === 'all' 
    ? allNotes 
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
    <li class="notes-list-item" data-note-id="${note.id}">
      <div class="notes-list-item-title">${escapeHtml(note.title)}</div>
    </li>
  `).join('');
  
  // Add click handlers
  document.querySelectorAll('.notes-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const noteId = item.getAttribute('data-note-id');
      selectNote(noteId);
    });
  });
}

function selectNote(noteId) {
  currentNoteId = noteId;
  
  // Update active state in list
  document.querySelectorAll('.notes-list-item').forEach(item => {
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
  document.getElementById('note-title').textContent = escapeHtml(note.title);
  
  container.innerHTML = `
    <div class="note-detail-content">${escapeHtml(note.content)}</div>
  `;
}

function showEmptyNoteDetail() {
  const container = document.getElementById('note-detail');
  document.getElementById('note-title').textContent = 'Notes';
  container.innerHTML = '<p class="empty">Select a note to view</p>';
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
  
  // Menu button click
  const menuButton = document.getElementById('menu-button');
  menuButton.addEventListener('click', openMobileMenu);
  
  // Overlay click to close
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', closeMobileMenu);
  
  // Window resize to handle responsive changes
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });
});
