const pb = new PocketBase('https://joemt.fly.dev');
let allNotes = [];
let currentFolder = 'all';

async function loadNotes() {
  try {
    allNotes = await pb.collection('jnote').getFullList({
      sort: '-updated',
    });
    
    populateFolders();
    displayNotes(allNotes);
  } catch (error) {
    console.error('Error loading notes:', error);
    document.getElementById('notes-container').innerHTML = 
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
  
  // Close mobile menu
  closeMobileMenu();
  
  // Update active state
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });
  element.classList.add('active');
  
  // Filter and display
  const filtered = folder === 'all' 
    ? allNotes 
    : allNotes.filter(note => note.folder === folder);
  
  displayNotes(filtered);
}

function displayNotes(notes) {
  const container = document.getElementById('notes-container');
  
  if (notes.length === 0) {
    container.innerHTML = '<p class="empty">No notes found</p>';
    return;
  }
  
  container.innerHTML = notes.map(note => `
    <div class="note-card">
      <h2>${escapeHtml(note.title)}</h2>
      <p class="note-content">${escapeHtml(note.content)}</p>
      <div class="note-footer">
        ${formatDate(note.updated)}
      </div>
    </div>
  `).join('');
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
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
