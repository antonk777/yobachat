import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

import type { ChatMessage, ChatMessageSegment, ChatMessageClient } from '@shared/shared-types.js';
import { getMessageSegments as splitMessageSegments } from 'yobachat-shared';

import { useSettingsStore } from '@/stores/settings';
import { kMaxHistoryMessages } from '@shared/shared-constants';

export const useMessagesStore = defineStore('messages', () => {
  const settingsStore = useSettingsStore();

  const
    seenMessageIds = ref<Set<string>>(new Set()),
    messages = ref<ChatMessageClient[]>([]),
    deletedMessageIds = ref<string[]>([]),
    isSelectionMode = ref(false),
    selectedMessageIds = ref<string[]>([])

  const hasSelectedMessages = computed(() => selectedMessageIds.value.length > 0);

  function addMessage(message: ChatMessage) {
    if (deletedMessageIds.value.includes(message.id)) {
      return;
    }

    const wasSeen = seenMessageIds.value.has(message.id);

    if (wasSeen) {
      const index = messages.value.findIndex(m => m.id === message.id);

      if (index !== -1) {
        messages.value[index] = processMessage(message);
      }
    } else {
      seenMessageIds.value.add(message.id);
      messages.value.push(processMessage(message));
    }

    // Sort by timestamp
    messages.value = messages.value.sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the last N messages
    if (messages.value.length > kMaxHistoryMessages) {
      messages.value = messages.value.slice(-kMaxHistoryMessages);
    }
  }

  function removeMessage(messageId: string) {
    messages.value = messages.value.filter(m => m.id !== messageId);
  }

  function clearAllMessages() {
    messages.value = [];
  }

  function setDeletedMessageIds(ids: string[]) {
    deletedMessageIds.value = ids;
    messages.value = messages.value.filter(message => !deletedMessageIds.value.includes(message.id));
  }

  function addDeletedMessageId(id: string) {
    deletedMessageIds.value.push(id);
    messages.value = messages.value.filter(message => message.id !== id);
  }

  function removeDeletedMessageId(id: string) {
    deletedMessageIds.value = deletedMessageIds.value.filter(i => i !== id);
    messages.value = messages.value.filter(message => message.id !== id);
  }

  function isDeleted(messageId: string): boolean {
    return deletedMessageIds.value.includes(messageId);
  }

  function resetSelection() {
    isSelectionMode.value = false;
    selectedMessageIds.value = [];
  }

  function toggleMessageSelection(messageId: string) {
    const index = selectedMessageIds.value.indexOf(messageId);

    if (index === -1) {
      selectedMessageIds.value.push(messageId);
    } else {
      selectedMessageIds.value.splice(index, 1);
    }

    if (selectedMessageIds.value.length === 0) {
      isSelectionMode.value = false;
    }
  }

  function updateMessages() {
    messages.value = messages.value
      .filter(message => !deletedMessageIds.value.includes(message.id))
      .map(message => processMessage(message))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the last N messages
    if (messages.value.length > kMaxHistoryMessages) {
      messages.value = messages.value.slice(-kMaxHistoryMessages);
    }
  }

  function processMessage(message: ChatMessage): ChatMessageClient {
    let replyTo: ChatMessageClient | undefined;

    if (message.replyToId && message.id !== message.replyToId) {
      const foundReply = messages.value.find(m => m.id === message.replyToId);

      if (foundReply) {
        // Deep clone the message, excluding replyTo to prevent circular references
        replyTo = deepCloneMessage(foundReply);
      }
    }

    return {
      ...message,
      usernameFiltered: settingsStore.filterText(message.username),
      segments: getMessageSegments(message),
      replyTo
    }
  }

  /**
   * Process text into segments (text, links, emotes) based on settings and context
   * @param message - The message to process
   * @returns Array of segments
   */
  function getMessageSegments(message: ChatMessage): ChatMessageSegment[] {
    let filtered = message.message;

    if (settingsStore.filterBadWords && settingsStore.badWords.length > 0) {
      const lowerText = filtered.toLowerCase();

      for (const word of settingsStore.badWords) {
        if (lowerText.indexOf(word) !== -1) {
          const regex = new RegExp(word, 'gi');
          filtered = filtered.replace(regex, '*'.repeat(word.length));
        }
      }
    }

    return splitMessageSegments(
      { message: filtered, emotesMap: message.emotesMap },
      { showEmotes: settingsStore.settings?.showEmotes === true },
    );
  }

  function deepCloneMessage(message: ChatMessageClient, visited = new WeakSet<object>()): ChatMessageClient {
    // Handle circular references
    if (visited.has(message)) {
      throw new Error('Circular reference detected');
    }

    visited.add(message);

    // Deep clone arrays
    const cloneArray = <T>(arr: T[]): T[] => {
      return arr.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return deepCloneObject(item as Record<string, unknown>, visited) as T;
        }
        return item;
      });
    };

    // Deep clone objects
    const deepCloneObject = (obj: Record<string, unknown>, visited: WeakSet<object>): Record<string, unknown> => {
      const cloned: Record<string, unknown> = {};

      for (const key in obj) {
        if (key === 'replyTo') {
          // Skip replyTo to prevent circular references
          continue;
        }

        const value = obj[key];

        if (value === null || value === undefined) {
          cloned[key] = value;
        } else if (Array.isArray(value)) {
          cloned[key] = cloneArray(value);
        } else if (value instanceof Date) {
          cloned[key] = new Date(value);
        } else if (typeof value === 'object') {
          if (visited.has(value as object)) {
            // Skip circular references
            continue;
          }

          visited.add(value as object);
          cloned[key] = deepCloneObject(value as Record<string, unknown>, visited);
        } else {
          cloned[key] = value;
        }
      }
      return cloned;
    };

    const cloned = deepCloneObject(message as unknown as Record<string, unknown>, visited) as unknown as ChatMessageClient;

    return cloned;
  }

  // Update messages when bad words or filter bad words setting change
  // watch(() => settingsStore.badWords, () => {
  //   updateMessages();
  // });

  // watch(() => settingsStore.filterBadWords, () => {
  //   updateMessages();
  // });

  watch(() => settingsStore.settings, () => {
    updateMessages();
  });

  return {
    messages,
    deletedMessageIds,
    isSelectionMode,
    selectedMessageIds,
    hasSelectedMessages,
    addMessage,
    removeMessage,
    clearAllMessages,
    setDeletedMessageIds,
    addDeletedMessageId,
    removeDeletedMessageId,
    isDeleted,
    resetSelection,
    toggleMessageSelection,
    getMessageSegments
  };
},
{
  persist: {
    pick: ['deletedMessageIds']
  }
});

