<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import ChatMessageComponent from '@/components/ChatMessage.vue';

import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useWSConnection } from '@/composables/useWSConnection';
import { useUIStore } from '@/stores/ui';
import { useFontSettings } from '@/composables/useFontSettings';

const DEFAULT_LINE_HEIGHT = 1.2;

const
  messagesStore = useMessagesStore(),
  settingsStore = useSettingsStore(),
  uiStore = useUIStore();

const userLineHeight = computed(() => (settingsStore.settings?.userLineHeight ?? DEFAULT_LINE_HEIGHT).toString());

const { connected: wsConnected, status: wsStatus, connect } = useWSConnection();

// Connect immediately for widget (no authentication required)
onMounted(() => {
  connect();
  window.addEventListener('widgetRefresh', handleWidgetRefresh);
});

// Apply font settings for user widget
useFontSettings(() => settingsStore.settings, 'user');

// Handle widget refresh event
function handleWidgetRefresh() {
  // Reload the page to refresh the widget
  window.location.reload();
}


onUnmounted(() => {
  window.removeEventListener('widgetRefresh', handleWidgetRefresh);
});
</script>

<template>
  <div
    class="chat"
    :style="{ '--chat-line-height': userLineHeight }"
  >
    <div
      class="chat-messages"
      ref="container"
      v-if="uiStore.isReady"
    >
      <ChatMessageComponent
        v-for="message in messagesStore.messages"
        class="chat-message"
        :key="message.id"
        :message="message"
        :settings="settingsStore.settings!"
        :animate="false"
      />
    </div>
    <div v-if="!wsConnected" class="connection-status">
      Not connected ({{ wsStatus.toLowerCase() }})
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100dvh;

  line-height: var(--chat-line-height, var(--line-height));
  font-family: var(--font-family);

  color: var(--text-color);

  font-size: var(--font-size);
  font-weight: var(--font-weight);
  font-stretch: var(--font-stretch);

  filter: drop-shadow(.125rem .125rem .25rem #000);
  -webkit-text-stroke: .1rem hsl(0 0% 0% / 50%);
  paint-order: stroke fill;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex: 1;
  padding: calc(var(--spacing) * .5);
  overflow: hidden;
}

.chat-message {
  margin-top: calc(var(--spacing) * .6);

  height: calc-size(max-content, size);
  opacity: 1;
  transition:
    height 300ms ease,
    opacity 300ms ease,
    margin-top 300ms ease;

  @starting-style {
    height: 0;
    opacity: 0;
    margin-bottom: 0;
  }
}

.connection-status {
  flex: none;
  padding: var(--spacing);
  color: var(--error-color);
  font-size: var(--font-size-small);
  text-align: center;
}
</style>

