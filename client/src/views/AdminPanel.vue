<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';

import ChatMessageComponent from '@/components/ChatMessage.vue';
import ChatSettingsModal from '@/components/ChatSettings.vue';
import StatusHistoryModal from '@/components/StatusHistoryModal.vue';

import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useWSConnection } from '@/composables/useWSConnection';
import { useFontSettings } from '@/composables/useFontSettings';


const kDefaultLineHeight = 1.2;

const
  ws = useWSConnection(),
  settingsStore = useSettingsStore(),
  messagesStore = useMessagesStore(),
  uiStore = useUIStore();

const messagesContainer = useTemplateRef('messagesContainer');
const moreMenuRef = ref<HTMLElement | null>(null);

// Apply font settings for admin panel
useFontSettings(() => settingsStore.settings, 'admin');

const adminLineHeight = computed(() => (settingsStore.settings?.adminLineHeight ?? kDefaultLineHeight).toString());

const isMoreMenuOpen = ref(false);
const platformsExpanded = ref(false);

function hasPlatformIcon(platformId: string): boolean {
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame'].includes(platformId);
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

function handleRefreshWidget() {
  if (!ws.connected) {
    return;
  }

  ws.refreshWidget();
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

function openStatusHistory() {
  uiStore.isStatusHistoryOpen = true;
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
      <h1 class="admin-header-title">yobachat</h1>

      <div class="admin-header-actions">
        <div
          class="connection-status"
          :class="{ connected: ws.connected }"
          @click="openStatusHistory"
          title="View status history"
        >
          {{ ws.connected ? '🟢' : '🔴 Disconnected' }}
        </div>

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
              @click="handleRefreshWidget"
              :disabled="!ws.connected"
              title="Refresh the chat widget"
            >
              Refresh Widget
            </button>
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

    <div
      class="admin-section messages-section"
      ref="messagesContainer"
    >
      <header
        class="messages-header"
        :class="{ 'selection-mode': messagesStore.isSelectionMode }"
      >
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
          class="btn btn-warn"
          :disabled="!ws.connected"
          title="Delete all messages from the chat"
        >
          🧹
        </button>
      </header>

      <div
        class="messages-container"
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
      <button
        class="platforms-section-toggle"
        @click="platformsExpanded = !platformsExpanded"
        title="Toggle platforms list"
      >
        {{ platformsExpanded ? '➖' : '➕' }}
      </button>
      <div v-if="uiStore.platforms.length > 0" class="platforms-list">
        <div
          v-for="platform in uiStore.platforms"
          :key="platform.id"
          class="platform-item"
          :style="{ '--platform-color': platform.color }"
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
  <StatusHistoryModal />
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
  align-items: center;
  width: 100%;
  gap: calc(var(--spacing) * .75);
  padding: calc(var(--spacing) * .75);
  background-color: var(--bg-color);
  border-bottom: 1px solid var(--border-color);
}

@keyframes gradient-shift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.admin-header-title {
  align-content: center;
  height: 100%;
  font-family: 'Futura PT', var(--font-family);
  font-size: .75rem;
  font-weight: 700;
  text-align: center;
  text-box: trim-both ex alphabetic;

  background: linear-gradient(135deg, #4a9eff 0%, #995eff 50%, #ff74b9 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  background-size: 200% 200%;
  animation: gradient-shift 10s ease infinite;

  @media (width > 400px) {
    font-size: 1rem;
  }

  @media (width > 450px) {
    font-size: 1.5rem;
  }
}

.admin-header-actions {
  display: flex;
  justify-content: center;
  gap: calc(var(--spacing) * .75);
  margin-left: auto;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}

.connection-status {
  align-content: center;
  padding: calc(var(--spacing) * .5);
  border-radius: .25rem;
  cursor: pointer;
  transition: background-color .2s;

  &:hover {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }

  &.connected:hover {
    background-color: var(--success-color);
  }
}

.more-menu {
  position: relative;
}

.more-menu-toggle {
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

.messages-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color);
}

.messages-header {
  position: sticky;
  top: 0;
  z-index: 2;

  flex: none;

  display: flex;
  justify-content: flex-end;
  align-items: stretch;
  flex-wrap: wrap;
  gap: calc(var(--spacing) * .5);

  padding: calc(var(--spacing) * .5) calc(var(--spacing) * .75);

  transition: background-color .2s;

  @media (width > 450px) {
    padding: calc(var(--spacing) * .5) var(--spacing);
  }

  &.selection-mode {
    background-color: var(--bg-color-modal);
    backdrop-filter: blur(10px);
  }
}

.selection-count {
  margin-right: auto;
  align-content: center;
  font-size: .85rem;
}

.messages-container {
  flex: 1;
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

    position: absolute;
    right: calc(var(--spacing) * .5);
    top: calc(var(--spacing) * .5);

    line-height: var(--chat-line-height, var(--line-height));
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

.platforms-section {
  position: relative;
  border-top: 1px solid var(--border-color);
  padding: calc(var(--spacing) * .5) var(--spacing);
  padding-right: calc(var(--spacing) * 2 + 1.5rem);
}

.platforms-section-toggle {
  position: absolute;
  top: calc(var(--spacing) * .75);
  right: calc(var(--spacing) * .5);
  width: 1.5rem;
  height: 1.5rem;
  line-height: 1.5rem;
  text-align: center;
  border-radius: .25rem;
  transition: background-color .2s;

  &:hover {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }
}

.platforms-list {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--spacing) * .5);
  flex: 1;

  .platforms-section.expanded & {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  }
}

.platform-item {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  padding: calc(var(--spacing) * .5);
  overflow: hidden;

  .platforms-section.expanded & {
    background-color: var(--bg-color-bright);
    border-radius: .5rem;
  }

  .platform-icon {
    display: block;
    flex: none;
    width: 1rem;
    height: 1rem;
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

    &.icon-goodgame {
      mask-image: url('@/assets/goodgame.png');
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
    white-space: nowrap;

    .platforms-section:not(.expanded) & {
      display: none;
    }
  }

  .platform-status {
    color: var(--text-muted);

    @media (width <= 400px) {
      font-size: .85rem;
    }
  }
}

.empty-state {
  margin: auto;
  align-content: center;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem;
}

input[type="checkbox"] {
  width: 1.25ex;
  height: 1.25ex;
}
</style>

