<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';

import ChatMessageComponent from '@/components/ChatMessage.vue';
import ChatSettingsModal from '@/components/ChatSettings.vue';

import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useWSConnection } from '@/composables/useWSConnection';
import { useFontSettings } from '@/composables/useFontSettings';


const DEFAULT_LINE_HEIGHT = 1.2;

const
  ws = useWSConnection(),
  settingsStore = useSettingsStore(),
  messagesStore = useMessagesStore(),
  uiStore = useUIStore();

const messagesContainer = useTemplateRef('messagesContainer');
const moreMenuRef = ref<HTMLElement | null>(null);

// Apply font settings for admin panel
useFontSettings(() => settingsStore.settings, 'admin');

const adminLineHeight = computed(() => (settingsStore.settings?.adminLineHeight ?? DEFAULT_LINE_HEIGHT).toString());

const isMoreMenuOpen = ref(false);
const platformsExpanded = ref(false);

function hasPlatformIcon(platformId: string): boolean {
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick'].includes(platformId);
}

function toggleMoreMenu() {
  if (!ws.connected) {
    return;
  }

  isMoreMenuOpen.value = !isMoreMenuOpen.value;
}

function closeMoreMenu() {
  isMoreMenuOpen.value = false;
}

function handleRefreshBetterTTV() {
  if (!ws.connected) {
    return;
  }

  ws.refreshBetterTTV();
  closeMoreMenu();
}

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

onClickOutside(moreMenuRef, () => {
  closeMoreMenu();
});

watch(() => ws.connected, (connected) => {
  if (!connected) {
    closeMoreMenu();
  }
});

// Auto-scroll to bottom when new messages arrive
watch(() => messagesStore.messages, async () => {
  await nextTick();

  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});
</script>

<template>
  <div class="admin-panel" v-if="uiStore.isReady">
    <div class="admin-header">
      <h1>Chat Admin Panel</h1>

      <div class="connection-status" :class="{ connected: ws.connected }">
        {{ ws.connected ? '🟢 Connected' : '🔴 Disconnected' }}:
        <template v-if="uiStore.lastStatusMessage">
          {{ uiStore.lastStatusMessage }}
        </template>
      </div>

      <div class="header-actions">
        <button
          class="btn btn-secondary"
          @click="uiStore.isSettingsOpen = true"
          :disabled="!ws.connected"
          title="Configure chat appearance settings"
        >
          Settings
        </button>

        <div class="more-menu" ref="moreMenuRef">
          <button
            type="button"
            class="btn btn-secondary more-menu-toggle"
            :disabled="!ws.connected"
            @click="toggleMoreMenu"
            @keydown.escape="closeMoreMenu"
          >
            ⋯
          </button>

          <div v-if="isMoreMenuOpen" class="more-menu-dropdown">
            <button
              type="button"
              class="more-menu-item"
              @click="handleRefreshBetterTTV"
              :disabled="!ws.connected"
              title="Reload BetterTTV emotes on the server"
            >
              Refresh BetterTTV
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="admin-section messages-section">
      <header class="messages-header">
        <h2 class="admin-section-title">Chat</h2>
        <div class="messages-header-actions">
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

          <button
            @click="ws.clearAllMessages"
            class="btn btn-secondary"
            :disabled="!ws.connected"
            title="Delete all messages from the chat"
          >
            Clear All
          </button>
        </div>
      </header>

      <div
        class="messages-container"
        ref="messagesContainer"
        :style="{ '--chat-line-height': adminLineHeight }"
      >
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
            class="chat-message"
            :message="message"
            :settings="settingsStore.settings!"
          />

          <button
            @click.stop="ws.deleteMessage(message.id)"
            class="message-delete"
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

    <div
      class="admin-section platforms-section"
      :class="{ expanded: platformsExpanded }"
    >
      <h2
        class="admin-section-title platforms-section-title"
        @click="platformsExpanded = !platformsExpanded"
      >
        Platform status
        <span class="platforms-section-toggle">{{ platformsExpanded ? '-' : '+' }}</span>
      </h2>
      <div v-if="uiStore.platforms.length > 0" class="platforms-list">
        <div
          v-for="platform in uiStore.platforms"
          :key="platform.id"
          class="platform-item"
          :style="{
            '--platform-color': platform.color
          }"
        >
          <div
            v-if="hasPlatformIcon(platform.id)"
            class="platform-icon"
            :class="`icon-${platform.id}`"
            :aria-label="platform.abbr"
          />

          <span
            v-else
            class="platform-badge"
            :class="`badge-${platform.id}`"
          >
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
  </div>

  <ChatSettingsModal />
</template>

<style scoped>
.admin-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing);
  height: 100dvh;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
}

.admin-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: var(--spacing);
  padding: var(--spacing);
  background-color: var(--bg-color);
  border-bottom: 1px solid var(--border-color);

  h1 {
    width: 100%;
    font-size: 1.5rem;
    font-weight: 700;
    text-align: center;
  }
}

.connection-status {
  padding: calc(var(--spacing) * .5) var(--spacing);
  border-radius: .25rem;
  background-color: var(--border-color);

  &.connected {
    background-color: var(--success-color);
  }
}

.btn {
  padding: calc(var(--spacing) * .5) var(--spacing);
  border: none;
  border-radius: .25rem;
  font-weight: 500;
  transition: background-color .2s;

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
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

  &:hover {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }
}

.header-actions {
  display: flex;
  justify-content: center;
  gap: var(--spacing);
}

.more-menu {
  position: relative;
}

.more-menu-toggle {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  font-size: 1.2rem;
}

.more-menu-dropdown {
  position: absolute;
  top: calc(100% + .5rem);
  right: 0;
  min-width: 12rem;
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: .35rem;
  box-shadow: 0 10px 30px hsla(0 0% 0% / .35);
  padding: .35rem 0;
  z-index: 5;
}

.more-menu-item {
  width: 100%;
  padding: .65rem calc(var(--spacing) * .75);
  background: none;
  border: none;
  color: var(--text-color);
  text-align: left;
  font-size: 1rem;
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: var(--bg-color-dark);
  }

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
}

.admin-section {
  margin-inline: var(--spacing);
  overflow: hidden;
  background-color: var(--bg-color);
  border-radius: .5rem;
  padding: 1rem;

  &:last-child {
    margin-bottom: var(--spacing);
  }
}

.admin-section-title {
  font-size: 1.2rem;
  font-weight: 600;
}

.messages-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-inline: 0;
  padding-bottom: 0;
}

.messages-header {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-inline: var(--spacing);
  margin-bottom: 1rem;
}

.messages-header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing);
}

.messages-container {
  flex: 1;
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color);
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing);
  padding: calc(var(--spacing) * .5) var(--spacing);
  position: relative;
  width: 100%;
  transition: background-color .2s;
  cursor: default;

  &:nth-child(even) {
    background-color: var(--bg-color-dark);
  }

  &:hover {
    background-color: hsl(from var(--primary-color) h s l / 30%);
  }

  .message-select {
    align-self: center;
  }

  .chat-message {
    margin-top: 0 !important;
    flex: 1 !important;
  }

  .message-delete {
    display: none;
    font-size: .75rem;
    background: none;
    border: none;
    opacity: .5;
    transition: opacity .2s;

    .message-item:hover & {
      display: block;

      &:hover {
        opacity: 1;
      }
    }
  }
}

.platforms-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing);
  margin-bottom: var(--spacing);
  cursor: pointer;
}

.platforms-section-toggle {
  width: 1.5rem;
  height: 1.5rem;
  line-height: 1.5rem;
  text-align: center;
  font-size: 1.5rem;
}

.platforms-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing);
  flex: 1;

  .platforms-section.expanded & {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  }
}

.platform-item {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  padding: calc(var(--spacing) * .5);
  background-color: var(--bg-color-dark);
  border-radius: .5rem;

  .platform-icon {
    display: block;
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    background-color: var(--platform-color);
    mask-position: center center;
    mask-repeat: no-repeat;
    mask-size: contain;

    &.icon-twitch {
      mask-image: url('@/assets/twitch.svg');
    }

    &.icon-youtube {
      mask-image: url('@/assets/youtube.svg');
    }

    &.icon-telegram {
      mask-image: url('@/assets/telegram.svg');
    }

    &.icon-vkvideo {
      mask-image: url('@/assets/vkvideo.svg');
    }

    &.icon-kick {
      mask-image: url('@/assets/kick.svg');
    }
  }

  .platform-badge {
    display: block;
    align-self: center;
    flex: none;

    min-width: var(--badge-size);
    height: var(--badge-size);
    line-height: var(--badge-size);

    font-size: var(--font-size-small);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .platform-name {
    flex: 1;
    font-weight: 500;

    .platforms-section:not(.expanded) & {
      display: none;
    }
  }

  .platform-status {
    color: var(--text-muted);
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

