import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import type { ChatSettings } from '@shared/shared-types.js';

import { useWSConnection } from '@/composables/useWSConnection';

export const useSettingsStore = defineStore('settings', () => {
  const ws = useWSConnection()

  const settings = ref<ChatSettings | null>(null);

  const
    badWords = computed(() => settings.value?.badWords ?? []),
    filterBadWords = computed(() => settings.value?.filterBadWords ?? true),
    filterLinks = computed(() => settings.value?.filterLinks ?? true);

  function setSettings(newSettings: ChatSettings) {
    settings.value = newSettings;
  }

  function updateChatSettings(newSettings: Partial<ChatSettings>) {
    if (!settings.value) {
      return;
    }

    settings.value = {
      ...(settings.value ?? {}),
      ...newSettings
    };

    // Send only the changed properties (partial update) to the server
    ws.updateChatSettings(newSettings);
  }

  function setBadWords(words: string[]) {
    if (settings.value) {
      settings.value.badWords = words;
    }
  }

  function addBadWord(input: string): boolean {
    if (!settings.value || !input.trim()) {
      return false;
    }

    // Split by commas and process each word
    const wordsToAdd = input
      .split(',')
      .map(word => word.trim().toLowerCase())
      .filter(word => word.length >= 3);

    if (wordsToAdd.length === 0) {
      return false;
    }

    // Filter out words that already exist and add new ones
    const existingWords = new Set(badWords.value);
    const newWords = wordsToAdd.filter(word => !existingWords.has(word));

    if (newWords.length === 0) {
      return false;
    }

    const updatedWords = [...badWords.value, ...newWords];
    settings.value.badWords = updatedWords;
    ws.updateBadWords(updatedWords);

    return true;
  }

  function removeBadWord(word: string): boolean {
    if (!settings.value) {
      return false;
    }

    const sanitizedWord = word.toLowerCase().trim();

    const updatedWords = badWords.value.filter(w => w !== sanitizedWord);

    settings.value.badWords = updatedWords;
    ws.updateBadWords(updatedWords);

    return true;
  }

  function filterText(text: string): string {
    let filtered = text;

    // Filter out URLs if enabled
    if (filterLinks.value) {
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/gi;
      filtered = filtered.replace(urlRegex, '[🔗link filtered]');
    }

    // Filter bad words if enabled
    if (badWords.value.length === 0 || !filterBadWords.value) {
      return filtered;
    }

    const lowerText = filtered.toLowerCase();

    for (const word of badWords.value) {
      if (lowerText.indexOf(word) !== -1) {
        const regex = new RegExp(word, 'gi');
        filtered = filtered.replace(regex, '*'.repeat(word.length));
      }
    }

    return filtered;
  }

  return {
    settings,
    badWords,
    filterBadWords,
    filterLinks,
    setSettings,
    updateChatSettings,
    setBadWords,
    addBadWord,
    removeBadWord,
    filterText
  };
});
