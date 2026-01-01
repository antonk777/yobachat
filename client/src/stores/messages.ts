import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

import type { ChatMessage, ChatMessageSegment, ChatMessageClient } from '@shared/shared-types.js';

import { useSettingsStore } from '@/stores/settings';
import { kMaxHistoryMessages } from '@shared/shared-constants';

interface Match {
  type: 'url' | 'emote';
  index: number;
  length: number;
  content: string;
  url?: string;
}

// URL regex pattern - matches http(s):// URLs and common patterns
const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;

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
    // Filter bad words but not links (we'll handle links separately based on context)
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

    const segments: ChatMessageSegment[] = [];

    const showEmotes = (
      settingsStore.settings?.showEmotes &&
      message.emotesMap &&
      Object.keys(message.emotesMap).length > 0
    )

    const matches: Match[] = [];

    // Find all URLs
    urlRegex.lastIndex = 0;

    let urlMatch;

    while ((urlMatch = urlRegex.exec(filtered)) !== null) {
      matches.push({
        type: 'url',
        index: urlMatch.index,
        length: urlMatch[0].length,
        content: urlMatch[0]
      });
    }

    // Find all emotes if enabled
    if (showEmotes) {
      const emoteIds = Object.keys(message.emotesMap!)
        .sort((a, b) => b.length - a.length);

      for (const emoteId of emoteIds) {
        let searchIndex = 0;

        while (true) {
          const index = filtered.indexOf(emoteId, searchIndex);
          if (index === -1) break;

          matches.push({
            type: 'emote',
            index,
            length: emoteId.length,
            content: emoteId,
            url: message.emotesMap![emoteId]
          });

          searchIndex = index + 1;
        }
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.index - b.index);

    // Remove overlapping matches (emotes take precedence over URLs)
    const filteredMatches: Match[] = [];
    let lastProcessedEnd = 0;

    for (const match of matches) {
      const matchEnd = match.index + match.length;
      const isOverlapping = match.index < lastProcessedEnd;

      if (!isOverlapping) {
        // No overlap, add the match
        filteredMatches.push(match);
        lastProcessedEnd = matchEnd;
      } else if (match.type === 'emote') {
        // Emote overlaps with previous matches - remove overlapping URLs
        while (filteredMatches.length > 0) {
          const lastMatch = filteredMatches[filteredMatches.length - 1];
          const lastMatchEnd = lastMatch.index + lastMatch.length;

          if (lastMatchEnd <= match.index) {
            break; // No more overlaps
          }

          filteredMatches.pop();
        }

        filteredMatches.push(match);
        lastProcessedEnd = matchEnd;
      }
      // If it's an overlapping URL, skip it (emotes take precedence)
    }

    // Build segments from matches
    let lastIndex = 0;
    for (const match of filteredMatches) {
      // Add text before the match
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          content: filtered.substring(lastIndex, match.index)
        });
      }

      // Add the match as a segment
      if (match.type === 'url') {
        segments.push({
          type: 'link',
          content: match.content,
          url: match.content
        });
      } else {
        segments.push({
          type: 'emote',
          content: match.content,
          url: match.url!
        });
      }

      lastIndex = match.index + match.length;
    }

    // Add remaining text after the last match
    if (lastIndex < filtered.length) {
      segments.push({
        type: 'text',
        content: filtered.substring(lastIndex)
      });
    }

    // If no matches were found, return the original text as a single segment
    if (segments.length === 0) {
      return [{ type: 'text', content: filtered }];
    }

    return segments;
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

