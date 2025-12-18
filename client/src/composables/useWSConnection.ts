import { computed, watch } from 'vue';
import { useWebSocket, createGlobalState } from '@vueuse/core';

import { ChatSettings, kWSMessageType, WSMessage } from '@shared/shared-types';

import { decodeWSMessage, encodeWSMessage } from '@shared/shared-messenger';
import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';

import { kSharedConfig } from '@/config';


export const useWSConnection = createGlobalState(() => {
  const url = `wss://${kSharedConfig.apiHost}${kSharedConfig.basePath}${kSharedConfig.wsPath}`;

  const
    messagesStore = useMessagesStore(),
    settingsStore = useSettingsStore(),
    uiStore = useUIStore()

  const { status, data, send: wsSend } = useWebSocket(url, {
    immediate: true,
    autoReconnect: {
      retries: Infinity,
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 20s
      delay: (retries: number) => Math.min(1000 * 2 ** (retries - 1), 20000),
      onFailed: () => console.error('WebSocket reconnection failed')
    }
  });

  const connected = computed(() => status.value === 'OPEN');

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
      if (parsed.type === kWSMessageType.serverStatus) {
        uiStore.serverStatus = parsed.data;
      }

      // Handle chat messages (batched)
      if (parsed.type === kWSMessageType.messageUpdate) {
        const messages = parsed.data.messages;
        if (Array.isArray(messages)) {
          messages.forEach(message => {
            messagesStore.addMessage(message);
          });
        }
      }

      if (parsed.type === kWSMessageType.messageUpdateDeletedIds) {
        messagesStore.setDeletedMessageIds(parsed.data.ids);
      }

      if (parsed.type === kWSMessageType.messageClearAll) {
        messagesStore.clearAllMessages();
      }

      if (parsed.type === kWSMessageType.chatSettings) {
        settingsStore.settings = parsed.data;
      }

      // Handle admin responses
      if (parsed.type === kWSMessageType.adminPlatformsStatus) {
        uiStore.platforms = parsed.data.platforms;
      }

      if (parsed.type === kWSMessageType.adminPlatformStatusUpdate) {
        uiStore.updatePlatformStatus(parsed.data.platform);
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

  function updateChatSettings(settings: Partial<ChatSettings>) {
    send({
      type: kWSMessageType.adminUpdateSettings,
      data: settings
    });
  }

  return {
    status,
    connected,
    send,
    deleteMessage,
    updateBadWords,
    clearAllMessages,
    refreshBetterTTV,
    updateChatSettings,
  };
});

