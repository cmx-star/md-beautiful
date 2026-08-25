import { defineStore } from 'pinia';
import type { Note, Folder } from '@/types';

export const useNoteStore = defineStore('notes', {
  state: () => ({
    notes: [] as Note[],
    folders: [] as Folder[],
    activeNoteId: null as string | null,
    searchQuery: '' as string,
    sidebarOpen: true as boolean,
  }),
  actions: {
    setNotes(notes: Note[]) {
      this.notes = notes;
    },
    addNote(note: Note) {
      this.notes.unshift(note);
    },
    updateNote(id: string, updates: Partial<Note>) {
      const note = this.notes.find((n: Note) => n.id === id);
      if (note) {
        Object.assign(note, updates, { updatedAt: Date.now() });
      }
    },
    deleteNote(id: string) {
      this.notes = this.notes.filter((n: Note) => n.id !== id);
      if (this.activeNoteId === id) this.activeNoteId = null;
    },
    setActiveNote(id: string) {
      this.activeNoteId = id;
    },
    setSearchQuery(q: string) {
      this.searchQuery = q;
    },
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    setFolders(folders: Folder[]) {
      this.folders = folders;
    },
    addFolder(folder: Folder) {
      this.folders.unshift(folder);
    },
    updateFolder(id: string, updates: Partial<Folder>) {
      const f = this.folders.find((x: Folder) => x.id === id);
      if (f) Object.assign(f, updates);
    },
    deleteFolder(id: string) {
      this.folders = this.folders.filter((f: Folder) => f.id !== id);
      this.notes = this.notes.map((n: Note) =>
        n.folderId === id ? { ...n, folderId: null } : n
      );
    },
    getActiveNote() {
      return this.notes.find((n: Note) => n.id === this.activeNoteId);
    },
    getFilteredNotes() {
      if (!this.searchQuery.trim()) return this.notes;
      const q = this.searchQuery.toLowerCase();
      return this.notes.filter(
        (n: Note) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t: string) => t.toLowerCase().includes(q))
      );
    },
  },
  persist: {
    key: 'mardown-beautiful-notes',
    storage: localStorage,
  },
});
