<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';

import ChatMessage from '@/components/ChatMessage.vue';
import ChatSettingsModal from '@/components/ChatSettings.vue';
import StatusHistoryModal from '@/components/StatusHistoryModal.vue';
import CustomEmotes from '@/components/CustomEmotes.vue';
import TelegramVideoQueue from '@/components/TelegramVideoQueue.vue';

import { useMessagesStore } from '@/stores/messages';
import { useSiteEmotesStore } from '@/stores/siteEmotes';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useWSConnection } from '@/composables/useWSConnection';
import { useFontSettings } from '@/composables/useFontSettings';
import { useAuth } from '@/composables/useAuth';
import { useDeluxeUserColor } from '@/composables/useDeluxeUserColor';
import { getWsUrl } from '@shared/shared-urls';
import { kSharedConfig } from '@/config';
import 'yobachat-shared/assets/chat-icons.css';


const kDefaultLineHeight = 1.2;

const
  auth = useAuth(),
  ws = useWSConnection(),
  settingsStore = useSettingsStore(),
  messagesStore = useMessagesStore(),
  siteEmotesStore = useSiteEmotesStore(),
  uiStore = useUIStore();

/**
 * Admin content is hidden until `chatSettings` arrives over the WebSocket (`uiStore.isReady`).
 * If WSS never connects, the page used to look "blank" (only --bg-color). We surface status explicitly.
 * Delay showing the hard error so we do not flash "disconnected" before the first connect attempt.
 */
const canShowConnectionHelp = ref(false);

const wsStatus = computed(() => ws.status.value);

const wssUrlDisplay = computed(() => getWsUrl(kSharedConfig));

let connectionHelpTimer: ReturnType<typeof setTimeout> | null = null;

// Verify existing session, then connect WebSocket
onMounted(async () => {
  const result = await auth.verifyToken();

  if (!result.ok) {
    window.location.href = '/login.html';
    return;
  }

  ws.connect();

  connectionHelpTimer = setTimeout(() => {
    canShowConnectionHelp.value = true;
  }, 2500);
});

onUnmounted(() => {
  if (connectionHelpTimer != null) {
    clearTimeout(connectionHelpTimer);
  }
});

const messagesContainer = useTemplateRef('messagesContainer');
const moreMenuRef = ref<HTMLElement | null>(null);
const navMenuRef = ref<HTMLElement | null>(null);
const qrMenuRef = ref<HTMLElement | null>(null);
const qrTextInput = ref<HTMLInputElement | null>(null);

// Apply font settings for admin panel
useFontSettings(() => settingsStore.settings, 'admin');

// Animate deluxe user color
useDeluxeUserColor();

const adminLineHeight = computed(() => (settingsStore.settings?.adminLineHeight ?? kDefaultLineHeight).toString());

const isMoreMenuOpen = ref(false);
const isNavMenuOpen = ref(false);
const isQrMenuOpen = ref(false);
const adminScreen = ref<'chat' | 'emotes'>('chat');
const platformsExpanded = ref(false);
const qrText = ref('');
const qrLink = ref('');
const qrError = ref('');
const kLastQrKey = 'yobachat-last-qr';

function readLastQr(): { text: string, link: string } {
  try {
    const raw = localStorage.getItem(kLastQrKey);

    if (!raw) {
      return { text: '', link: '' };
    }

    const parsed = JSON.parse(raw) as { text?: unknown, link?: unknown };

    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      link: typeof parsed.link === 'string' ? parsed.link : '',
    };
  } catch {
    return { text: '', link: '' };
  }
}

function restoreLastQr(): void {
  const last = readLastQr();
  qrText.value = last.text;
  qrLink.value = last.link;
}

const wsConnected = computed(() => ws.connected.value);

function hasPlatformIcon(platformId: string): boolean {
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame'].includes(platformId);
}

function toggleMoreMenu() {
  if (!wsConnected.value) {
    return;
  }

  isNavMenuOpen.value = false;
  isQrMenuOpen.value = false;
  isMoreMenuOpen.value = !isMoreMenuOpen.value;
}

function closeMoreMenu() {
  isMoreMenuOpen.value = false;
}

function toggleNavMenu() {
  isMoreMenuOpen.value = false;
  isQrMenuOpen.value = false;
  isNavMenuOpen.value = !isNavMenuOpen.value;
}

async function toggleQrMenu() {
  if (!wsConnected.value) {
    return;
  }

  isMoreMenuOpen.value = false;
  isNavMenuOpen.value = false;
  isQrMenuOpen.value = !isQrMenuOpen.value;

  if (!isQrMenuOpen.value) {
    qrError.value = '';
    return;
  }

  restoreLastQr();
  await nextTick();
  qrTextInput.value?.focus();
}

function closeQrMenu() {
  isQrMenuOpen.value = false;
  qrError.value = '';
}

function closeNavMenu() {
  isNavMenuOpen.value = false;
}

function handleRefreshWidget() {
  if (!wsConnected.value) {
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

function handleLogout() {
  auth.logout();
  window.location.href = '/login.html';
}

onClickOutside(moreMenuRef, () => {
  closeMoreMenu();
});

onClickOutside(navMenuRef, () => {
  closeNavMenu();
});

onClickOutside(qrMenuRef, () => {
  closeQrMenu();
});

function normalizeQrLink(raw: string): string | null {
  const value = raw.trim();

  if (!value) {
    return null;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(withScheme);

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.href.length > 2048) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function postQr(): void {
  if (!wsConnected.value) {
    return;
  }

  const text = qrText.value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const url = normalizeQrLink(qrLink.value);

  if (!url) {
    qrError.value = 'Enter a valid link';
    return;
  }

  qrError.value = '';
  ws.postQr(text, url);
  localStorage.setItem(kLastQrKey, JSON.stringify({ text, link: url }));
  qrText.value = text;
  qrLink.value = url;
  isQrMenuOpen.value = false;
}

function scrollMessagesToEnd(): void {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

// Auto-scroll to bottom when new messages arrive
watch(() => messagesStore.messages[messagesStore.messages.length - 1], async () => {
  await nextTick();
  scrollMessagesToEnd();
});

watch(
  () => siteEmotesStore.emotes.filter(emote => emote.status === 'pending').length,
  async (count, previous) => {
    if (previous === undefined || count <= previous || adminScreen.value !== 'chat') {
      return;
    }

    await nextTick();
    scrollMessagesToEnd();
  },
);
</script>

<template>
  <div v-if="!uiStore.isReady" class="admin-bootstrap">
    <h1 class="admin-bootstrap-title">yobachat</h1>
    <p v-if="wsStatus === 'CONNECTING'" class="admin-bootstrap-line">Connecting to chat server…</p>
    <p v-else-if="canShowConnectionHelp && wsStatus === 'CLOSED'" class="admin-bootstrap-line admin-bootstrap-warn">
      Cannot open a WebSocket to the chat server.
      Expected URL: <code class="admin-bootstrap-code">{{ wssUrlDisplay }}</code>
    </p>
    <p v-else class="admin-bootstrap-line">Loading admin…</p>
    <p v-if="canShowConnectionHelp && wsStatus === 'CLOSED'" class="admin-bootstrap-hint">
      Check that the process is running, <code>consoleMode</code> is off in server config, and your reverse proxy forwards WSS (Upgrade) to the WebSocket port.
    </p>
  </div>
  <div class="admin-panel" v-else>
    <div class="admin-header">
      <div class="admin-header-brand">
        <div class="nav-menu" ref="navMenuRef">
          <button
            class="btn nav-menu-toggle"
            type="button"
            :aria-expanded="isNavMenuOpen"
            title="Open navigation"
            @click="toggleNavMenu"
            @keydown.escape="closeNavMenu"
          >
            ☰
          </button>

          <nav v-if="isNavMenuOpen" class="nav-menu-dropdown" aria-label="Widgets">
            <button
              class="nav-menu-item"
              type="button"
              @click="adminScreen = adminScreen === 'emotes' ? 'chat' : 'emotes'; closeNavMenu()"
            >
              {{ adminScreen === 'emotes' ? 'Chat' : 'Custom emotes' }}
            </button>
            <a
              class="nav-menu-item"
              href="/widget.html"
              target="_blank"
              rel="noopener noreferrer"
              @click="closeNavMenu"
            >
              Chat widget
            </a>
            <a
              class="nav-menu-item"
              href="/tg-video.html"
              target="_blank"
              rel="noopener noreferrer"
              @click="closeNavMenu"
            >
              Telegram video
            </a>
          </nav>
        </div>

      </div>

      <div class="admin-header-actions">
        <div
          class="connection-status"
          :class="{ connected: wsConnected }"
          @click="openStatusHistory"
          title="View status history"
        >
          <template v-if="wsConnected">
            🟢
          </template>
          <template v-else>
            🔴 Disconnected
          </template>
        </div>

        <button
          class="btn btn-secondary admin-icon-btn"
          type="button"
          aria-label="Settings"
          @click="closeQrMenu(); uiStore.isSettingsOpen = true"
          :disabled="!wsConnected"
          title="Settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.14.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.64.22l2.39-.96c.49.41 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.14-.53 1.63-.94l2.39.96c.25.09.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
          </svg>
        </button>

        <div class="qr-menu" ref="qrMenuRef">
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="!wsConnected"
            :aria-expanded="isQrMenuOpen"
            title="Post a link as a QR code"
            @click="toggleQrMenu"
            @keydown.escape="closeQrMenu"
          >
            QR
          </button>

          <form
            v-if="isQrMenuOpen"
            class="qr-post"
            @submit.prevent="postQr"
            @keydown.escape="closeQrMenu"
          >
            <input
              ref="qrTextInput"
              v-model="qrText"
              class="qr-post-input"
              type="text"
              maxlength="500"
              placeholder="Text"
              autocomplete="off"
            >
            <input
              v-model="qrLink"
              class="qr-post-input"
              type="text"
              maxlength="2048"
              placeholder="Link"
              autocomplete="off"
              inputmode="url"
            >
            <button
              class="btn btn-primary qr-post-button"
              type="submit"
              :disabled="!wsConnected || !qrLink.trim()"
            >
              Post
            </button>
            <p v-if="qrError" class="qr-post-error">{{ qrError }}</p>
          </form>
        </div>

        <div class="more-menu" ref="moreMenuRef">
          <button
            class="btn btn-secondary more-menu-toggle"
            :disabled="!wsConnected"
            @click="toggleMoreMenu"
            @keydown.escape="closeMoreMenu"
          >
            ⋯
          </button>

          <div v-if="isMoreMenuOpen" class="more-menu-dropdown">
            <div class="more-menu-item user-info-container">
              <div class="user-info" v-if="auth.username">
                {{ auth.username }}
              </div>
              <button
                class="btn btn-secondary"
                @click="handleLogout"
                title="Logout"
              >
                Logout
              </button>
            </div>

            <button
              type="button"
              class="more-menu-item"
              @click="handleRefreshWidget"
              :disabled="!wsConnected"
              title="Refresh the chat widget"
            >
              Refresh Widget
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="adminScreen === 'chat'"
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
            :disabled="!wsConnected || !messagesStore.hasSelectedMessages"
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
          :disabled="!wsConnected"
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

          <ChatMessage
            class="chat-message"
            :message="message"
            :settings="settingsStore.settings!"
            :is-in-admin="true"
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
        <CustomEmotes mode="chat" />
      </div>
    </div>

    <TelegramVideoQueue v-if="adminScreen === 'chat'" />

    <div
      v-if="adminScreen === 'chat'"
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
            {{ platform.active ? '🟢' : '🔴' }}
          </span>
        </div>
      </div>
      <div v-else class="empty-state">
        No platforms yet
      </div>
    </div>

    <CustomEmotes v-if="adminScreen === 'emotes'" mode="manage" />
  </div>

  <ChatSettingsModal />
  <StatusHistoryModal />
</template>

<style scoped>
.admin-bootstrap {
  min-height: 100dvh;
  padding: calc(var(--spacing) * 2);
  background-color: var(--bg-color-dark);
  color: var(--text-color);
  box-sizing: border-box;
}

.admin-bootstrap-title {
  margin: 0 0 var(--spacing);
  font-family: 'Futura PT', var(--font-family);
  font-size: 1rem;
  font-weight: 700;
}

.admin-bootstrap-line {
  margin: 0 0 var(--spacing);
  line-height: 1.5;
  max-width: 40rem;
}

.admin-bootstrap-warn {
  color: var(--warning-color);
}

.admin-bootstrap-code {
  display: inline;
  word-break: break-all;
  font-size: 0.85em;
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: var(--bg-color-bright);
  color: var(--text-color);
}

.admin-bootstrap-hint {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  max-width: 40rem;
}

.admin-panel {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
}

.admin-header {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  width: 100%;
  gap: calc(var(--spacing) * .75);
  padding: calc(var(--spacing) * .75);
  background-color: var(--bg-color);
  border-bottom: 1px solid var(--border-color);
}

.admin-header-brand {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .75);
  flex: none;
  min-width: max-content;
}

.nav-menu {
  position: relative;
  flex: none;
}

.nav-menu-toggle {
  font-size: 1.15rem;
  line-height: 1;
  background-color: transparent;

  &:hover {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }
}

.nav-menu-dropdown {
  position: absolute;
  top: calc(100% + .5rem);
  left: 0;
  z-index: 6;

  display: flex;
  flex-direction: column;

  min-width: 12rem;
  padding: .35rem 0;
  border: 1px solid var(--border-color);

  border-radius: .35rem;
  background-color: var(--bg-color);
  box-shadow: 0 10px 30px hsla(0 0% 0% / .35);
}

.nav-menu-item {
  display: block;
  width: 100%;
  padding: .55rem .9rem;
  border: 0;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  text-align: left;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: color-mix(in srgb, var(--border-color) 80%, white 20%);
  }
}

.admin-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    display: block;
    width: 1rem;
    height: 1rem;
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
  z-index: 5;

  border: 1px solid var(--border-color);
  min-width: 12rem;
  padding: .35rem 0;

  background-color: var(--bg-color);
  border-radius: .35rem;
  box-shadow: 0 10px 30px hsla(0 0% 0% / .35);

  background: var(--bg-color-modal);
  backdrop-filter: blur(10px);
}

.more-menu-item {
  width: 100%;
  padding: .65rem calc(var(--spacing) * .75);
  color: var(--text-color);

  &:hover:not(:disabled) {
    background-color: var(--bg-color-dark);
  }

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
}

.user-info-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: calc(var(--spacing) * .5);
}

.user-info {
  font-size: .9rem;
  color: var(--text-muted);
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
  pointer-events: none;
  transition: background-color .2s;

  > * {
    pointer-events: auto;
  }

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
  padding-block: calc(var(--message-spacing) / 2);
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing);
  padding: calc(var(--message-spacing) / 2) var(--spacing);
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

    &:hover {
      opacity: 1;
    }
  }

  &:hover .message-delete {
    display: block;
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
    grid-template-columns: repeat(auto-fit, minmax(8rem, auto));
  }
}

.platform-item {
  display: flex;
  align-items: center;
  gap: var(--whitespace);
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
  }

  .platform-badge {
    display: block;
    align-self: center;
    flex: none;

    min-width: var(--platform-icon-size);
    height: var(--platform-icon-size);
    line-height: var(--platform-icon-size);

    font-size: var(--font-size-small);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .platform-name {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
  }

  .platform-status {
    color: var(--text-muted);
    white-space: nowrap;

    @media (width <= 400px) {
      font-size: .85rem;
    }
  }
}

.platforms-section:not(.expanded) .platform-name {
  display: none;
}

.qr-menu {
  position: relative;
  display: flex;
}

.qr-menu > .btn {
  display: flex;
  align-items: center;
}

.qr-post {
  position: absolute;
  top: calc(100% + .5rem);
  right: 0;
  z-index: 6;

  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * .5);
  width: min(18rem, calc(100vw - 2rem));
  padding: calc(var(--spacing) * .75);

  border: 1px solid var(--border-color);
  border-radius: .35rem;
  background-color: var(--bg-color);
  box-shadow: 0 10px 30px hsla(0 0% 0% / .35);
}

.qr-post-input {
  width: 100%;
  padding: calc(var(--spacing) * .45) calc(var(--spacing) * .6);
  border: 1px solid var(--border-color);
  border-radius: .25rem;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
  font: inherit;
}

.qr-post-button {
  align-self: flex-end;
  text-align: center;
}

.qr-post-error {
  flex: 1 1 100%;
  margin: 0;
  color: var(--error-color);
  font-size: .8rem;
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

