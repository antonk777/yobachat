<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import type { ChatSettings, TelegramVideoItem } from '@shared/shared-types';
import { kWSMessageType } from '@shared/shared-types';
import { kDefaultChatSettings } from '@shared/shared-constants';
import { decodeWSMessage } from '@shared/shared-messenger';
import { getWsUrl } from '@shared/shared-urls';
import { kSharedConfig } from '@/config';

const mediaContainer = ref<HTMLElement | null>(null);
const statusText = ref('');

let minLoops = kDefaultChatSettings.tgVideoWidgetMinLoops;
let minDurationMs = kDefaultChatSettings.tgVideoWidgetMinDurationSec * 1000;

let lastMediaId: string | null = null;
let videoLoopCount = 0;
let videoStartTime: number | null = null;
let videoHideTimeout: number | null = null;
let videoEndedHandler: (() => void) | null = null;
let disconnectDebounceTimeout: number | null = null;
let ws: WebSocket | null = null;
let reconnectTimeout: number | null = null;
let shouldReconnect = true;

function applyWidgetTimeoutSettings(settings: ChatSettings): void {
  minLoops = settings.tgVideoWidgetMinLoops;
  minDurationMs = settings.tgVideoWidgetMinDurationSec * 1000;
}

function hideVideo(): void {
  const container = mediaContainer.value;

  if (!container) {
    return;
  }

  if (videoHideTimeout != null) {
    clearTimeout(videoHideTimeout);
    videoHideTimeout = null;
  }

  if (videoEndedHandler) {
    const video = container.querySelector('video');
    if (video) {
      video.removeEventListener('ended', videoEndedHandler);
    }
    videoEndedHandler = null;
  }

  videoLoopCount = 0;
  videoStartTime = null;
  container.innerHTML = '';
  lastMediaId = null;
}

function checkVideoHideConditions(): void {
  if (videoStartTime == null) {
    return;
  }

  const elapsedTime = Date.now() - videoStartTime;
  const shouldHide = videoLoopCount >= minLoops && elapsedTime >= minDurationMs;

  if (shouldHide) {
    hideVideo();
  }
}

function setupVideoTracking(videoElement: HTMLVideoElement): void {
  videoLoopCount = 0;
  videoStartTime = Date.now();

  if (videoEndedHandler) {
    videoElement.removeEventListener('ended', videoEndedHandler);
  }

  videoEndedHandler = () => {
    videoLoopCount += 1;
    checkVideoHideConditions();

    if (videoStartTime == null) {
      return;
    }

    const elapsedTime = Date.now() - videoStartTime;
    const shouldHide = videoLoopCount >= minLoops && elapsedTime >= minDurationMs;

    if (!shouldHide) {
      videoElement.currentTime = 0;
      void videoElement.play();
    }
  };

  videoElement.addEventListener('ended', videoEndedHandler);

  if (videoHideTimeout != null) {
    clearTimeout(videoHideTimeout);
  }

  // Recheck after min duration so time-based hide can fire even mid-loop
  videoHideTimeout = window.setTimeout(() => {
    checkVideoHideConditions();
  }, minDurationMs);
}

function showConnectionStatus(connected: boolean): void {
  if (connected) {
    if (disconnectDebounceTimeout != null) {
      clearTimeout(disconnectDebounceTimeout);
      disconnectDebounceTimeout = null;
    }
    statusText.value = '';
    return;
  }

  if (disconnectDebounceTimeout != null) {
    clearTimeout(disconnectDebounceTimeout);
  }

  disconnectDebounceTimeout = window.setTimeout(() => {
    statusText.value = 'Нет подключения к серверу';
    hideVideo();
    disconnectDebounceTimeout = null;
  }, 10000);
}

function displayMedia(media: TelegramVideoItem | null): void {
  const container = mediaContainer.value;

  if (!container) {
    return;
  }

  if (!media?.fileUrl) {
    hideVideo();
    return;
  }

  if (media.fileId === lastMediaId) {
    return;
  }

  lastMediaId = media.fileId;

  if (videoHideTimeout != null) {
    clearTimeout(videoHideTimeout);
    videoHideTimeout = null;
  }

  if (videoEndedHandler) {
    const oldVideo = container.querySelector('video');
    if (oldVideo) {
      oldVideo.removeEventListener('ended', videoEndedHandler);
    }
    videoEndedHandler = null;
  }

  container.innerHTML = `<video class="media-video" autoplay muted playsinline>
    <source src="${media.fileUrl}" type="video/mp4">
  </video>`;

  const videoElement = container.querySelector('video');

  if (videoElement) {
    videoElement.addEventListener('loadedmetadata', () => {
      setupVideoTracking(videoElement);
    });

    if (videoElement.readyState >= 1) {
      setupVideoTracking(videoElement);
    }
  }
}

function connectWebSocket(): void {
  if (!shouldReconnect) {
    return;
  }

  const wsUrl = getWsUrl(kSharedConfig);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    showConnectionStatus(true);
  };

  ws.onmessage = (event) => {
    try {
      showConnectionStatus(true);
      const message = decodeWSMessage(String(event.data));

      if (!message) {
        return;
      }

      if (message.type === kWSMessageType.chatSettings) {
        applyWidgetTimeoutSettings(message.data);
        checkVideoHideConditions();
        return;
      }

      if (message.type === kWSMessageType.tgVideoApproved) {
        displayMedia(message.data);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };

  ws.onerror = () => {
    showConnectionStatus(false);
  };

  ws.onclose = () => {
    showConnectionStatus(false);
    reconnectTimeout = window.setTimeout(connectWebSocket, 3000);
  };
}

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  shouldReconnect = false;

  if (reconnectTimeout != null) {
    clearTimeout(reconnectTimeout);
  }

  if (disconnectDebounceTimeout != null) {
    clearTimeout(disconnectDebounceTimeout);
  }

  if (ws) {
    ws.close();
  }

  hideVideo();
});
</script>

<template>
  <div class="tg-video-root">
    <div class="status">{{ statusText }}</div>
    <div ref="mediaContainer" class="media-container" />
  </div>
</template>

<style>
html.tg-video-page,
html.tg-video-page body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
}

.tg-video-root {
  position: fixed;
  inset: 0;
  background: transparent;
}

.media-container {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: center;
}

.media-video {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.status {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
  text-align: center;
  text-shadow: 0 2px 10px #000;
  font-family: system-ui, sans-serif;
  pointer-events: none;
}
</style>
