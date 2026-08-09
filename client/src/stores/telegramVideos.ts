import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { TelegramVideoItem } from '@shared/shared-types';

export const useTelegramVideosStore = defineStore('telegramVideos', () => {
  const pending = ref<TelegramVideoItem[]>([]);
  const approved = ref<TelegramVideoItem | null>(null);

  function setPending(videos: TelegramVideoItem[]): void {
    pending.value = videos;
  }

  function setApproved(video: TelegramVideoItem | null): void {
    approved.value = video;
  }

  return {
    pending,
    approved,
    setPending,
    setApproved,
  };
});
