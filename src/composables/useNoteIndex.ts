import { computed } from 'vue';
import { useNoteStore } from '@/stores/noteStore';
import {
  buildNoteIndex,
  extractFromContent,
  splitFrontmatter,
  type IndexedNote,
  type NoteIndex,
} from '@/utils/noteIndex';

/**
 * Rebuildable knowledge index (Phase 3) — a pure view over the loaded
 * notes.  Nothing here persists; deleting the derived data loses nothing
 * since it can be recomputed from the Vault at any time.
 */
export function useNoteIndex() {
  const store = useNoteStore();
  return computed<NoteIndex>(() => {
    const notes: IndexedNote[] = store.notes.map((note) => {
      const { frontmatter, body } = splitFrontmatter(note.content);
      const extracted = extractFromContent(note.content);
      return {
        id: note.id,
        path:
          note.source?.kind === 'vault' || note.source?.kind === 'file'
            ? note.source.path
            : note.id,
        title: note.title,
        content: note.content,
        frontmatterId: frontmatter.id,
        tags: extracted.tags,
        frontmatter,
      };
    });
    return buildNoteIndex(notes);
  });
}
