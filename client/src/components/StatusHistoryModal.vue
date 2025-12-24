<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef, watchEffect } from 'vue';

import { useUIStore } from '@/stores/ui';
import { ServerStatusConnection } from '@shared/shared-types';


const uiStore = useUIStore();
const currentTime = ref(Date.now());

let intervalId: ReturnType<typeof setInterval> | null = null;

const isOpen = computed(() => uiStore.isStatusHistoryOpen);
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog');

const handleClose = () => {
  uiStore.isStatusHistoryOpen = false;
};

const handleBackdropClick = (event: MouseEvent) => {
  // If the click target is the dialog itself (backdrop), close it
  if (event.target === event.currentTarget) {
    handleClose();
  }
};

// Combine connection status history and server status into a unified list
const statusHistory = computed(() => {
  const entries: Array<ServerStatusConnection> = [];

  // Add connection status entries
  uiStore.connectionStatusHistory.forEach(entry => {
    entries.push({
      ...entry,
      type: 'connection'
    });
  });

  // Add server status entries
  uiStore.serverStatus.forEach(entry => {
    entries.push({
      connected: entry.connected,
      message: entry.message,
      timestamp: entry.timestamp,
      type: 'server'
    });
  });

  // Sort by timestamp (newest first)
  return entries.sort((a, b) => b.timestamp - a.timestamp);
});

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');

  const timedate = date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  })

  return `${timedate}.${milliseconds} UTC`;
}

function formatTimeElapsed(timestamp: number): string {
  const now = currentTime.value;
  const elapsed = now - timestamp;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      parts.push(`${remainingHours}h`);
    }
  }

  if (minutes > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      parts.push(`${remainingMinutes}m`);
    }
  }

  if (seconds > 0 || parts.length === 0) {
    const remainingSeconds = seconds % 60;

    if (remainingSeconds <= 2) {
      return 'just now';
    }

    if (remainingSeconds > 0 || parts.length === 0) {
      parts.push(`${remainingSeconds}s`);
    }
  }

  return parts.join(' ') + ' ago';
}

watchEffect(() => {
  if (isOpen.value) {
    dialogRef.value?.showModal();
    // Start updating time every 2 seconds when modal opens
    currentTime.value = Date.now();
    intervalId = setInterval(() => {
      currentTime.value = Date.now();
    }, 1000);
  } else {
    dialogRef.value?.close();
    // Stop interval when modal closes
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
});

onUnmounted(() => {
  // Clean up interval on component unmount
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>

<template>
  <dialog
    v-if="isOpen"
    ref="dialog"
    class="status-history-modal"
    @close="handleClose"
    @click="handleBackdropClick"
  >
    <div class="status-history-modal-header">
      <h2 class="status-history-modal-title">Connection Status History</h2>
      <button
        class="status-history-modal-close"
        @click.prevent="handleClose"
        autofocus
        title="Close"
      >
        ✕
      </button>
    </div>

    <div class="status-history-content">
      <div
        v-if="statusHistory.length === 0"
        class="empty-state"
        :key="'empty-state'"
      >
        No status history available
      </div>

      <div
        v-for="(entry, index) in statusHistory"
        :key="`${entry.timestamp}-${index}`"
        class="status-history-item"
        :class="{ connected: entry.connected }"
      >
        <div class="status-indicator">
          {{ entry.connected ? '🟢' : '🔴' }}
        </div>

        <div class="status-details">
          <div class="status-header">
            <span class="status-type">
              {{ entry.type === 'connection' ? 'WebSocket' : 'Server' }}
            </span>
            <span class="status-state">
              {{ entry.connected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>

          <div v-if="entry.message" class="status-message">
            {{ entry.message }}
          </div>

          <time class="status-time">
            {{ formatTimeElapsed(entry.timestamp) }}

            <span>{{ formatTimestamp(entry.timestamp) }}</span>
          </time>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.status-history-modal {
  display: flex;
  flex-direction: column;

  width: min(600px, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  margin: auto;
  overflow: hidden;

  border: 1px solid var(--border-color);
  background: var(--bg-color-modal);
  border-radius: .5rem;
  backdrop-filter: blur(10px);

  &::backdrop {
    background-color: var(--bg-color-modal-backdrop);
  }
}

.status-history-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing);
  border-bottom: 1px solid var(--border-color);
}

.status-history-modal-title {
  font-size: 1rem;
  font-weight: 500;
}

.status-history-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 1.5rem;
  height: 1.5rem;
  line-height: 1;

  color: var(--text-color);
  font-size: 1.25rem;
  cursor: pointer;
  opacity: .7;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }
}

.status-history-content {
  flex: 1;

  display: flex;
  flex-direction: column;

  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color);
}

.status-history-item {
  display: flex;
  gap: calc(var(--spacing) * .5);
  padding: var(--spacing);
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.2s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: var(--bg-color-dark);
  }

  &.connected {
    .status-details {
      .status-state {
        color: var(--success-color);
      }
    }
  }

  &:not(.connected) {
    .status-details {
      .status-state {
        color: var(--error-color);
      }
    }
  }
}

.status-indicator {
  flex: none;
  display: flex;
  align-items: flex-start;
  line-height: 1;
}

.status-details {
  flex: 1;
}

.status-header {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  flex-wrap: wrap;
}

.status-type {
  color: var(--text-color);
  font-weight: 600;
}

.status-state {
  font-weight: 500;
  font-size: 0.9rem;
}

.status-message {
  line-height: 1.4;
  font-size: .9rem;
}

.status-time {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: .7rem;
  font-variant-numeric: tabular-nums;

  span {
    font-size: .5rem;
    opacity: .5;
  }
}

.empty-state {
  padding: 3rem var(--spacing);
  text-align: center;
  color: var(--text-muted);
}
</style>

