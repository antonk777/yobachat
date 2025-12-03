<script setup lang="ts">
import ChatMessageComponent from '@/components/ChatMessage.vue';
import ChatSettingsModal from '@/components/ChatSettings.vue';
import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useWSConnection } from '@/composables/useWSConnection';

import TwitchIcon from '@/assets/twitch.svg';
import YouTubeIcon from '@/assets/youtube.svg';
import TelegramIcon from '@/assets/telegram.svg';
import VKVideoIcon from '@/assets/vkvideo.svg';
import KickIcon from '@/assets/kick.svg';

const
  ws = useWSConnection(),
  settingsStore = useSettingsStore(),
  messagesStore = useMessagesStore(),
  uiStore = useUIStore()

function handleMessageClick(messageId: string) {
  if (!messagesStore.isSelectionMode) {
    messagesStore.isSelectionMode = true;
    messagesStore.selectedMessageIds = [messageId];
    return;
  }

  messagesStore.toggleMessageSelection(messageId);
}

function deleteSelectedMessages() {
  if (!messagesStore.hasSelectedMessages) {
    return;
  }

  const idsToDelete = [...messagesStore.selectedMessageIds];

  ws.deleteMessage(idsToDelete);

  messagesStore.resetSelection();
}

const getPlatformIcon = (platformId: string) => {
  switch (platformId) {
    case 'twitch':
      return `url(${TwitchIcon})`;
    case 'youtube':
      return `url(${YouTubeIcon})`;
    case 'telegram':
      return `url(${TelegramIcon})`;
    case 'vkvideo':
      return `url(${VKVideoIcon})`;
    case 'kick':
      return `url(${KickIcon})`;
    default:
      return null;
  }
};
</script>

<template>
  <div class="admin-panel">
    <div class="admin-header">
      <h1>Chat Admin Panel</h1>

      <div class="connection-status" :class="{ connected: ws.connected }">
        {{ ws.connected ? '🟢 Connected' : '🔴 Disconnected' }}
        <template v-if="uiStore.lastStatusMessage">
          {{ uiStore.lastStatusMessage }}
        </template>
      </div>

      <button
        class="btn btn-secondary"
        @click="uiStore.isSettingsOpen = true"
        :disabled="!ws.connected"
        title="Configure chat appearance settings"
      >
        Settings
      </button>

      <button
        class="btn btn-secondary"
        @click="ws.refreshBetterTTV"
        :disabled="!ws.connected"
        title="Reload BetterTTV emotes on the server"
      >
        Refresh BetterTTV
      </button>
    </div>

    <div class="admin-content">
      <div class="admin-section">
        <h2>Active Platforms</h2>
        <div v-if="uiStore.platforms.length > 0" class="platforms-list">
          <div
            v-for="platform in uiStore.platforms"
            :key="platform.id"
            class="platform-item"
            :style="{
              '--platform-color': platform.color,
              '--platform-icon': getPlatformIcon(platform.id)
            }"
          >
            <span class="platform-icon">
              {{ platform.abbr }}
            </span>

            <span class="platform-name">{{ platform.name }}</span>

            <span class="platform-status">
              {{ platform.active ? '🟢' : '🔴 Inactive' }}
            </span>
          </div>
        </div>
        <div v-else class="empty-state">
          No platforms yet
        </div>
      </div>

      <div class="admin-section messages-section">
        <header class="messages-header">
          <h2>Recent Messages</h2>
          <div class="messages-header-actions">
            <button
              @click="ws.clearAllMessages"
              class="btn btn-secondary"
              :disabled="!ws.connected"
              title="Delete all messages from the chat"
            >
              Clear All
            </button>

            <template v-if="messagesStore.isSelectionMode">
              <span class="selection-count">
                {{ messagesStore.selectedMessageIds.length }} selected
              </span>

              <button
                @click="deleteSelectedMessages"
                class="btn btn-secondary"
                :disabled="!ws.connected || !messagesStore.hasSelectedMessages"
                title="Delete selected messages"
              >
                Delete Selected
              </button>

              <button
                @click="messagesStore.resetSelection"
                class="btn btn-secondary"
                title="Exit selection mode"
              >
                Cancel
              </button>
            </template>
          </div>
        </header>

        <div class="messages-container">
          <div
            v-for="message in messagesStore.messages"
            :key="message.id"
            class="message-item"
            @click="handleMessageClick(message.id)"
          >
            <input
              v-if="messagesStore.isSelectionMode"
              type="checkbox"
              class="message-select"
              :checked="messagesStore.selectedMessageIds.includes(message.id)"
              @click.stop="messagesStore.toggleMessageSelection(message.id)"
            />

            <ChatMessageComponent
              :message="message"
              :settings="settingsStore.settings!"
            />

            <button
              @click.stop="ws.deleteMessage(message.id)"
              class="btn-delete"
              title="Delete message"
            >
              🗑️
            </button>
          </div>
          <div v-if="messagesStore.messages.length === 0" class="empty-state">
            No messages yet
          </div>
        </div>
      </div>
    </div>

    <ChatSettingsModal />
  </div>
</template>

<style scoped>
.admin-panel {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: var(--bg-color);
  border-bottom: 1px solid var(--border-color);

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }
}

.connection-status {
  padding: .5rem 1rem;
  border-radius: .25rem;
  background-color: var(--border-color);

  &.connected {
    background-color: var(--success-color);
  }
}

.admin-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr;
  gap: 1rem;

  flex: 1;
  padding: 1rem;
  overflow: hidden;
}

.admin-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--bg-color);
  border-radius: .5rem;
  padding: 1rem;

  h2 {
    margin: 0 0 1rem 0;
    font-size: 1.2rem;
    font-weight: 600;
  }
}

.messages-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;

  h2 {
    margin: 0;
  }
}

.messages-header-actions {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.messages-section {
  grid-column: 1 / -1;
  overflow-y: auto;
}

.platforms-list {
  display: flex;
  flex-direction: column;
  gap: .5rem;
  flex: 1;
  margin-bottom: 1rem;
}

.platform-item {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .75rem;
  background-color: var(--bg-color-dark);

  .platform-icon {
    width: 1.25rem;
    height: 1.25rem;
    mask-image: var(--platform-icon) no-repeat center center / contain;
    background-color: var(--platform-color);
  }

  .platform-indicator {
    width: .75rem;
    height: .75rem;
    border-radius: 50%;
    background-color: var(--indicator-color);
  }

  .platform-name {
    flex: 1;
    font-weight: 500;
  }

  .platform-status {
    font-size: .875rem;
    color: var(--text-muted);
  }
}

.btn {
  padding: .5rem 1rem;
  border: none;
  border-radius: .25rem;
  font-size: 1rem;
  font-weight: 500;
  transition: background-color .2s;
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-color);

  &:hover {
    background-color: color-mix(in srgb, var(--primary-color) 80%, white 20%);
  }
}

.btn-secondary {
  background-color: var(--border-color);
  color: var(--text-color);

  &:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.messages-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  flex: 1;
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;

  padding: 1rem;
  background-color: var(--bg-color-dark);
  border-radius: .25rem;
  border: 1px solid var(--border-color);

  :deep(.chat-message) {
    flex: 1;
  }
}

.message-select {
  margin-top: .25rem;
}

.btn-delete {
  background: none;
  border: none;
  padding: .25rem;
  opacity: .7;
  font-size: 1.25rem;
  transition: opacity .2s;

  &:hover {
    opacity: 1;
  }
}

.empty-state {
  margin: auto;
  align-content: center;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem;
}
</style>

