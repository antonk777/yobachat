import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

import type { ChatMessage, ChatMessageSegment, ChatMessageWithSegments } from '@shared/shared-types.js';

import { kMaxMessages } from '@/config';
import { useSettingsStore } from '@/stores/settings';

export const useMessagesStore = defineStore('messages', () => {
  const settingsStore = useSettingsStore();

  const
    seenMessageIds = ref<Set<string>>(new Set()),
    messages = ref<ChatMessageWithSegments[]>([]),
    deletedMessageIds = ref<string[]>([]),
    isSelectionMode = ref(false),
    selectedMessageIds = ref<string[]>([]),
    hasSelectedMessages = computed(() => selectedMessageIds.value.length > 0);

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
    if (messages.value.length > kMaxMessages) {
      messages.value = messages.value.slice(-kMaxMessages);
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
    if (messages.value.length > kMaxMessages) {
      messages.value = messages.value.slice(-kMaxMessages);
    }
  }

  function processMessage(message: ChatMessage): ChatMessageWithSegments {
    return {
      ...message,
      usernameFiltered: settingsStore.filterText(message.username),
      segments: getMessageSegments(message, settingsStore.settings?.showEmotes ?? true)
    }
  }

  function getMessageSegments(message: ChatMessage, showEmotes: boolean): ChatMessageSegment[] {
    const filtered = settingsStore.filterText(message.message);

    if (
      !showEmotes ||
      !message.emotesMap ||
      Object.keys(message.emotesMap).length === 0
    ) {
      return [{ type: 'text', content: filtered }];
    }

    const segments: ChatMessageSegment[] = [];

    let remainingText = filtered;

    const emoteIds = Object.keys(message.emotesMap)
      .sort((a, b) => b.length - a.length);

    while (remainingText.length > 0) {
      let foundEmote: { id: string; index: number } | null = null;

      for (const emoteId of emoteIds) {
        const index = remainingText.indexOf(emoteId);

        if (index !== -1 && (foundEmote === null || index < foundEmote.index)) {
          foundEmote = { id: emoteId, index };
        }
      }

      if (foundEmote === null) {
        if (remainingText.length > 0) {
          segments.push({ type: 'text', content: remainingText });
        }
        break;
      }

      if (foundEmote.index > 0) {
        segments.push({ type: 'text', content: remainingText.substring(0, foundEmote.index) });
      }

      segments.push({
        type: 'emote',
        content: foundEmote.id,
        url: message.emotesMap![foundEmote.id]
      });

      remainingText = remainingText.substring(foundEmote.index + foundEmote.id.length);
    }

    return segments;
  }

  // Update messages when bad words or filter bad words setting change
  watch(() => settingsStore.badWords, () => {
    updateMessages();
  });

  watch(() => settingsStore.filterBadWords, () => {
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
    toggleMessageSelection
  };
},
{
  persist: {
    pick: ['messages', 'deletedMessageIds']
  }
});

