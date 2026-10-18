import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { SiteEmoteRecord } from '@shared/shared-types';

export const useSiteEmotesStore = defineStore('siteEmotes', () => {
  const emotes = ref<SiteEmoteRecord[]>([]);

  function setEmotes(next: SiteEmoteRecord[]): void {
    emotes.value = next;
  }

  return {
    emotes,
    setEmotes,
  };
});
