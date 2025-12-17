import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import type { ServerStatus, PlatformWithStatus } from '@shared/shared-types.js';

import { useSettingsStore } from '@/stores/settings';

export const useUIStore = defineStore('ui', () => {
  const settingsStore = useSettingsStore()

  const
    serverStatus = ref<ServerStatus | null>(null),
    platforms = ref<PlatformWithStatus[]>([]),
    isSettingsOpen = ref(false);

  const lastStatusMessage = computed(() => serverStatus.value?.message);

  const isReady = computed(() => Boolean(settingsStore.settings));

  function updatePlatformStatus(platform: PlatformWithStatus) {
    const index = platforms.value.findIndex(p => p.id === platform.id);

    if (index !== -1) {
      platforms.value[index] = platform;
    } else {
      platforms.value.push(platform);
    }
  }

  return {
    isReady,
    serverStatus,
    platforms,
    isSettingsOpen,
    lastStatusMessage,
    updatePlatformStatus
  };
});
