import { defineStore } from 'pinia';

export const useThemeStore = defineStore('theme', {
  state: () => ({
    isDark: false as boolean,
    fontSize: 14 as number,
    tabSize: 2 as number,
    wordWrap: true as boolean,
    splitRatio: 50 as number,
    accentColor: '#e25555' as string,
  }),
  actions: {
    toggleTheme() {
      this.isDark = !this.isDark;
      document.documentElement.classList.toggle('dark', this.isDark);
      this.saveSettings();
    },
    setFontSize(size: number) {
      this.fontSize = size;
      this.saveSettings();
    },
    setTabSize(size: number) {
      this.tabSize = size;
      this.saveSettings();
    },
    setWordWrap(wrap: boolean) {
      this.wordWrap = wrap;
      this.saveSettings();
    },
    setSplitRatio(ratio: number) {
      this.splitRatio = ratio;
      this.saveSettings();
    },
    loadSettings() {
      try {
        const saved = localStorage.getItem('mardown-beautiful-theme');
        if (saved) {
          const s = JSON.parse(saved) as Record<string, unknown>;
          if (s.isDark) {
            this.isDark = true;
            document.documentElement.classList.add('dark');
          }
          if (s.fontSize) this.fontSize = s.fontSize as number;
          if (s.tabSize) this.tabSize = s.tabSize as number;
          if (s.wordWrap !== undefined) this.wordWrap = s.wordWrap as boolean;
          if (s.splitRatio) this.splitRatio = s.splitRatio as number;
          if (s.accentColor) {
            const savedAccent = s.accentColor as string;
            this.accentColor = savedAccent === '#0ea5e9' ? '#e25555' : savedAccent;
            document.documentElement.style.setProperty('--accent', this.accentColor);
          }
        }
      } catch {
        // ignore
      }
    },
    saveSettings() {
      localStorage.setItem(
        'mardown-beautiful-theme',
        JSON.stringify({
          isDark: this.isDark,
          fontSize: this.fontSize,
          tabSize: this.tabSize,
          wordWrap: this.wordWrap,
          splitRatio: this.splitRatio,
          accentColor: this.accentColor,
        })
      );
    },
  },
});
