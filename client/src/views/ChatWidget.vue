<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import ChatMessage from '@/components/ChatMessage.vue';

import { useMessagesStore } from '@/stores/messages';
import { useSettingsStore } from '@/stores/settings';
import { useWSConnection } from '@/composables/useWSConnection';
import { useUIStore } from '@/stores/ui';
import { useFontSettings } from '@/composables/useFontSettings';

const kDefaultLineHeight = 1.2;

const
  messagesStore = useMessagesStore(),
  settingsStore = useSettingsStore(),
  uiStore = useUIStore();

const userLineHeight = computed(() => (settingsStore.settings?.userLineHeight ?? kDefaultLineHeight).toString());

const { connected: wsConnected, status: wsStatus, connect } = useWSConnection();

// Apply font settings for user widget
useFontSettings(() => settingsStore.settings, 'user');

// Handle widget refresh event
function handleWidgetRefresh() {
  // Reload the page to refresh the widget
  window.location.reload();
}

// Connect immediately for widget (no authentication required)
onMounted(() => {
  connect();
  window.addEventListener('widgetRefresh', handleWidgetRefresh);
});

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
      <ChatMessage
        v-for="message in messagesStore.messages"
        class="chat-message"
        :key="message.id"
        :message="message"
        :settings="settingsStore.settings!"
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

  filter:
    drop-shadow(.05rem .05rem .05rem #000)
    drop-shadow(.125rem .125rem .25rem #000);
  /* -webkit-text-stroke: .1rem hsl(0 0% 0% / 50%); */
  /* paint-order: stroke fill; */

  /* mask: linear-gradient(to bottom, transparent, #fff 2.5rem); */
}

.chat-messages {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex: 1;
  padding-inline: calc(var(--spacing) * .5);
  padding-bottom: calc(var(--message-spacing) / 2);
  overflow: hidden;
}

.chat-message {
  height: calc-size(max-content, size);
  padding-block: calc(var(--message-spacing) / 2);
  opacity: 1;
  overflow: hidden;
  transition:
    padding-block 400ms ease,
    height 400ms ease,
    opacity 400ms ease-in-out 400ms;

  @starting-style {
    padding-block: 0;
    height: 0;
    opacity: 0;
  }
}

.connection-status {
  flex: none;
  padding: var(--spacing);
  color: hsl(from var(--error-color) h s calc(l + 10));
  font-size: var(--font-size-small);
  text-align: center;
}
</style>

