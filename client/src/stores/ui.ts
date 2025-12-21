import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import type { PlatformWithStatus, ServerStatusConnection } from '@shared/shared-types.js';

import { useSettingsStore } from '@/stores/settings';

export interface ConnectionStatusEntry {
  connected: boolean;
  message?: string;
  timestamp: number;
}

export const useUIStore = defineStore('ui', () => {
  const settingsStore = useSettingsStore()

  const
    serverStatus = ref<ServerStatusConnection[]>([]),
    platforms = ref<PlatformWithStatus[]>([]),
    isSettingsOpen = ref(false),
    isStatusHistoryOpen = ref(false),
    connectionStatusHistory = ref<ConnectionStatusEntry[]>([]);

  const lastStatus = computed(() => {
    if (serverStatus.value.length === 0) {
      return null;
    }

    return serverStatus.value[serverStatus.value.length - 1];
  });

  const isReady = computed(() => Boolean(settingsStore.settings));

  function updatePlatformStatus(platform: PlatformWithStatus) {
    const index = platforms.value.findIndex(p => p.id === platform.id);

    if (index !== -1) {
      platforms.value[index] = platform;
    } else {
      platforms.value.push(platform);
    }
  }

  function addConnectionStatusEntry(connected: boolean, message?: string) {
    connectionStatusHistory.value.push({
      connected,
      message,
      timestamp: Date.now()
    });
  }

  return {
    isReady,
    serverStatus,
    platforms,
    isSettingsOpen,
    isStatusHistoryOpen,
    connectionStatusHistory,
    lastStatus,
    updatePlatformStatus,
    addConnectionStatusEntry
  };
});
