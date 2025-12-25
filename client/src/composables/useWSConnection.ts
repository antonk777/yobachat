import { computed, ref, watch } from 'vue';
import { createGlobalState } from '@vueuse/core';

import { ChatSettings, kWSMessageType, WSMessage } from '@shared/shared-types';

import { decodeWSMessage, encodeWSMessage } from '@shared/shared-messenger';
import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useAuth } from '@/composables/useAuth';

import { kSharedConfig } from '@/config';

type WSStatus = 'CONNECTING' | 'OPEN' | 'CLOSED';

// --- Low-level WebSocket state ---
let ws: WebSocket | null = null;

export const useWSConnection = createGlobalState(() => {
  const auth = useAuth();

  const status = ref<WSStatus>('CLOSED');
  const wsUrl = ref(buildWsUrl());

  const maxDelay = 30000;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;
  const shouldReconnect = ref(true);

  const messagesStore = useMessagesStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUIStore();

  // --- Build URL with token ---
  function buildWsUrl(): string {
    let url = `wss://${kSharedConfig.apiHost}${kSharedConfig.basePath}${kSharedConfig.wsPath}`;
    const token = auth.token.value;

    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    return url;
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (!shouldReconnect.value) {
      return;
    }

    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), maxDelay);

    clearReconnectTimer();
    reconnectTimer = window.setTimeout(() => {
      connectInternal();
    }, delay);
  }

  function handleIncomingMessage(rawData: string | ArrayBuffer | Blob): void {
    let newData: string;

    if (typeof rawData === 'string') {
      newData = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      newData = new TextDecoder().decode(rawData);
    } else {
      // Blob – handle asynchronously
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (rawData as Blob).text().then(handleIncomingMessage).catch(error => {
        console.error('Error reading Blob WebSocket message:', error);
      });
      return;
    }

    try {
      const parsed = decodeWSMessage(newData);

      if (!parsed) {
        return;
      }

      switch (parsed.type) {
        case kWSMessageType.adminServerStatus:
          uiStore.serverStatus.push({
            connected: parsed.data.connected,
            message: parsed.data.message,
            type: 'server',
            timestamp: Date.now()
          });
          break;

        case kWSMessageType.messageUpdate: {
          const messages = parsed.data.messages;

          if (Array.isArray(messages)) {
            messages.forEach(message => messagesStore.addMessage(message));
          }

          break;
        }

        case kWSMessageType.messageUpdateDeletedIds:
          messagesStore.setDeletedMessageIds(parsed.data.ids);
          break;

        case kWSMessageType.messageClearAll:
          messagesStore.clearAllMessages();
          break;

        case kWSMessageType.chatSettings:
          settingsStore.setSettings(parsed.data);
          break;

        case kWSMessageType.widgetRefresh:
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
  }

  function connectInternal(): void {
    // Prevent duplicate sockets
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      // console.log('WebSocket already connected or connecting, skipping connection');
      return;
    }

    clearReconnectTimer();

    const url = buildWsUrl();
    wsUrl.value = url;

    // console.log('Connecting to WebSocket', wsUrl.value);

    const socket = new WebSocket(url);
    ws = socket;
    status.value = 'CONNECTING';

    socket.onopen = () => {
      // console.log('WebSocket opened', ws);
      status.value = 'OPEN';
      reconnectAttempts = 0;
    };

    socket.onmessage = (event: MessageEvent) => {
      handleIncomingMessage(event.data as any);
    };

    socket.onerror = () => {
      // Errors are handled via onclose / reconnect
      // console.error('WebSocket error', e);
    };

    socket.onclose = () => {
      // console.error('WebSocket closed', e);
      status.value = 'CLOSED';
      ws = null;
      scheduleReconnect();
    };
  }

  // Close connection when user logs out (token becomes null)
  watch(() => auth.token.value, (newToken, oldToken) => {
    if (oldToken !== undefined && newToken === null && oldToken !== null) {
      // console.log('Token changed to null, closing WebSocket');
      shouldReconnect.value = false;
      clearReconnectTimer();

      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }

      status.value = 'CLOSED';
    }
  });

  const connected = computed(() => status.value === 'OPEN');

  // Track connection status changes for UI
  watch(() => status.value, (newStatus, oldStatus) => {
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

  function send(message: WSMessage): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const encoded = encodeWSMessage(message);
      ws.send(encoded);
    } catch (error) {
      console.error('Error encoding/sending WebSocket message:', error);
    }
  }

  function deleteMessage(messageIds: string[] | string): void {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];

    send({
      type: kWSMessageType.adminDeleteMessage,
      data: { ids }
    });
  }

  function updateBadWords(words: string[]): void {
    settingsStore.setBadWords(words);

    send({
      type: kWSMessageType.adminUpdateSettings,
      data: { badWords: words }
    });
  }

  function clearAllMessages(): void {
    send({
      type: kWSMessageType.adminClearAllMessages,
      data: {}
    });
  }

  function refreshBetterTTV(): void {
    send({
      type: kWSMessageType.adminRefreshBetterTTV,
      data: {}
    });
  }

  function refreshWidget(): void {
    send({
      type: kWSMessageType.adminRefreshWidget,
      data: {}
    });
  }

  function updateChatSettings(settings: Partial<ChatSettings>): void {
    send({
      type: kWSMessageType.adminUpdateSettings,
      data: settings
    });
  }

  function connect(): void {
    shouldReconnect.value = true;

    if (status.value === 'OPEN' || status.value === 'CONNECTING') {
      return;
    }

    reconnectAttempts = 0;
    connectInternal();
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

