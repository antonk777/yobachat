import { computed, watch, ref } from 'vue';
import { useWebSocket, createGlobalState } from '@vueuse/core';

import { ChatSettings, kWSMessageType, WSMessage } from '@shared/shared-types';

import { decodeWSMessage, encodeWSMessage } from '@shared/shared-messenger';
import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useAuth } from '@/composables/useAuth';

import { kSharedConfig } from '@/config';


export const useWSConnection = createGlobalState(() => {
  const auth = useAuth();

  // Build WebSocket URL with token if authenticated
  function buildWsUrl(): string {
    let url = `wss://${kSharedConfig.apiHost}${kSharedConfig.basePath}${kSharedConfig.wsPath}`;
    const token = auth.token.value;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }
    return url;
  }

  // Initialize URL ref with initial value
  const wsUrl = ref(buildWsUrl());

  const
    messagesStore = useMessagesStore(),
    settingsStore = useSettingsStore(),
    uiStore = useUIStore()

  const { status, data, send: wsSend, close, open } = useWebSocket(wsUrl, {
    immediate: false, // Don't connect immediately - let views decide when to connect
    autoReconnect: {
      retries: Infinity,
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      delay: (retries: number) => Math.min(1000 * 2 ** (retries - 1), 30000)
    }
  });

  // Close connection when user logs out (token becomes null)
  watch(() => auth.token.value, (newToken, oldToken) => {
    // Only handle logout case (token becomes null)
    // Login/connection is handled manually via connect() after verification
    if (oldToken !== undefined && newToken === null && oldToken !== null && status.value === 'OPEN') {
      close();
    }
  });

  const connected = computed(() => status.value === 'OPEN');

  // Track connection status changes
  watch(() => status.value, (newStatus, oldStatus) => {
    // Track initial connection or status changes
    if (oldStatus === undefined || newStatus !== oldStatus) {
      const isConnected = newStatus === 'OPEN';

      let message: string;

      if (isConnected) {
        message = 'Connected to server';
      } else {
        switch (newStatus) {
          case 'CLOSED':
            message = 'Connection closed';
            break;
          case 'CONNECTING':
            message = 'Connecting to server...';
            break;
          default:
            message = `Disconnected (${newStatus})`;
        }
      }

      uiStore.addConnectionStatusEntry(isConnected, message);
    }
  }, { immediate: true });

  // Parse incoming messages
  watch(data, newData => {
    if (!newData) {
      return;
    }

    try {
      const parsed = decodeWSMessage(newData);

      if (!parsed) {
        return;
      }

      // Handle connection status

      switch (parsed.type) {
        case kWSMessageType.adminServerStatus:
          uiStore.serverStatus.push({
            connected: parsed.data.connected,
            message: parsed.data.message,
            type: 'server',
            timestamp: Date.now()
          });
          break;

        case kWSMessageType.messageUpdate:
          const messages = parsed.data.messages;

          if (Array.isArray(messages)) {
            messages.forEach(message => messagesStore.addMessage(message));
          }

          break;

        case kWSMessageType.messageUpdateDeletedIds:
          messagesStore.setDeletedMessageIds(parsed.data.ids);
          break;

        case kWSMessageType.messageClearAll:
          messagesStore.clearAllMessages();
          break;

        case kWSMessageType.chatSettings:
          settingsStore.settings = parsed.data;
          break;

        case kWSMessageType.widgetRefresh:
          // Trigger a custom event that widgets can listen to
          window.dispatchEvent(new CustomEvent('widgetRefresh'));
          break;

        case kWSMessageType.adminPlatformsStatus:
          uiStore.platforms = parsed.data.platforms;
          break;

        case kWSMessageType.adminPlatformStatusUpdate:
          uiStore.updatePlatformStatus(parsed.data.platform);
          break;

        default:
          console.error('Unknown WebSocket message type:', parsed.type);
          break;
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  });

  function send(message: WSMessage) {
    if (!connected.value) {
      console.warn('Cannot send message: WebSocket not connected');
      return;
    }

    wsSend(encodeWSMessage(message));
  }

  function deleteMessage(messageIds: string[] | string) {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];

    send({
      type: kWSMessageType.adminDeleteMessage,
      data: { ids }
    });
  }

  function updateBadWords(words: string[]) {
    settingsStore.setBadWords(words);

    send({
      type: kWSMessageType.adminUpdateSettings,
      data: { badWords: words }
    });
  }

  function clearAllMessages() {
    send({
      type: kWSMessageType.adminClearAllMessages,
      data: {}
    });
  }

  function refreshBetterTTV() {
    send({
      type: kWSMessageType.adminRefreshBetterTTV,
      data: {}
    });
  }

  function refreshWidget() {
    send({
      type: kWSMessageType.adminRefreshWidget,
      data: {}
    });
  }

  function updateChatSettings(settings: Partial<ChatSettings>) {
    send({
      type: kWSMessageType.adminUpdateSettings,
      data: settings
    });
  }

  function connect() {
    // Update URL to ensure it has the latest token before connecting
    wsUrl.value = buildWsUrl();
    open();
  }

  return {
    status,
    connected,
    connect,
    send,
    deleteMessage,
    updateBadWords,
    clearAllMessages,
    refreshBetterTTV,
    refreshWidget,
    updateChatSettings,
  };
});

