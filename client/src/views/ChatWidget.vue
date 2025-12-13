<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

import ChatMessageComponent from '@/components/ChatMessage.vue';
import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useWSConnection } from '@/composables/useWSConnection';
import { useUIStore } from '@/stores/ui';
import { useFontSettings } from '@/composables/useFontSettings';


const container = ref<HTMLElement | null>(null);

const
  messagesStore = useMessagesStore(),
  settingsStore = useSettingsStore(),
  ws = useWSConnection(),
  uiStore = useUIStore();

// Apply font settings for user widget
useFontSettings(() => settingsStore.settings, 'user');

// Auto-scroll to bottom when new messages arrive
watch(() => messagesStore.messages, async () => {
  await nextTick();

  if (container.value) {
    container.value.scrollTop = container.value.scrollHeight;
  }
});
</script>

<template>
  <div class="chat" v-if="uiStore.isReady">
    <div class="chat-messages" ref="container">
      <ChatMessageComponent
        v-for="message in messagesStore.messages"
        :key="message.id"
        :message="message"
        :settings="settingsStore.settings!"
      />
    </div>
    <div v-if="!ws.connected" class="connection-status">
      🔴 WebSocket Disconnected
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100dvh;

	line-height: var(--line-height);
	font-family: var(--font-family);

  color: var(--text-color);

	font-size: var(--font-size);
	font-weight: var(--font-weight);
  /* filter: drop-shadow(.5vw .5vw 1vw rgba(0,0,0,.75)); */
  text-shadow: .1rem .1rem .2rem rgba(0,0,0,.75);
}

.chat-messages {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: var(--spacing);
  flex: 1;

  padding: var(--spacing);

  overflow-x: hidden;
  overflow-y: scroll;
  scrollbar-width: none;
}

.connection-status {
  flex: none;
  padding: var(--spacing);
  color: var(--text-muted);
  font-size: var(--font-size-small);
  text-align: center;
}
</style>

