<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { TelegramVideoItem } from '@shared/shared-types';
import { useTelegramVideosStore } from '@/stores/telegramVideos';
import { useSettingsStore } from '@/stores/settings';
import { useWSConnection } from '@/composables/useWSConnection';
import TelegramVideoLightbox, {
  type TelegramVideoLightboxSource,
} from '@/components/TelegramVideoLightbox.vue';

const telegramVideosStore = useTelegramVideosStore();
const settingsStore = useSettingsStore();
const ws = useWSConnection();

const lightboxVideo = ref<TelegramVideoLightboxSource | null>(null);

const showFallbackQueue = computed(() => {
  return !(settingsStore.settings?.showApprovedTgVideosInChat ?? false);
});

const pending = computed(() => telegramVideosStore.pending);
const hasPending = computed(() => pending.value.length > 0);

function formatDate(dateString?: string): string {
  if (!dateString) {
    return '';
  }

  return new Date(dateString).toLocaleString();
}

function openLightbox(video: TelegramVideoItem): void {
  lightboxVideo.value = {
    fileUrl: video.fileUrl,
    caption: video.caption || undefined,
    queueId: video.id,
  };
}

function closeLightbox(): void {
  lightboxVideo.value = null;
}

function approve(id: number): void {
  ws.approveTgVideo(id);
  closeLightbox();
}

function reject(id: number): void {
  if (!confirm('Reject this video? It will not be shown again.')) {
    return;
  }

  ws.rejectTgVideo(id);
  closeLightbox();
}

function onLightboxApprove(queueId: number): void {
  ws.approveTgVideo(queueId);
  closeLightbox();
}

function onLightboxReject(queueId: number): void {
  ws.rejectTgVideo(queueId);
  closeLightbox();
}

watch(pending, (videos) => {
  const open = lightboxVideo.value;

  if (!open?.queueId) {
    return;
  }

  if (!videos.some(v => v.id === open.queueId)) {
    closeLightbox();
  }
});
</script>

<template>
  <section v-if="showFallbackQueue" class="tg-video-queue">
    <p v-if="!hasPending" class="tg-video-empty">
      No pending videos
    </p>

    <div v-else class="tg-video-list">
      <article
        v-for="video in pending"
        :key="video.id"
        class="tg-video-item"
      >
        <button
          type="button"
          class="tg-video-preview-btn"
          title="Open fullscreen preview"
          @click="openLightbox(video)"
        >
          <video
            class="tg-video-preview"
            :src="video.fileUrl"
            muted
            playsinline
            loop
            autoplay
          />
        </button>

        <p v-if="video.caption" class="tg-video-caption">{{ video.caption }}</p>

        <p class="tg-video-date">{{ formatDate(video.date) }}</p>

        <div class="tg-video-actions">
          <button type="button" class="approve" @click="approve(video.id)">
            Approve
          </button>
          <button type="button" class="reject" @click="reject(video.id)">
            Reject
          </button>
        </div>
      </article>
    </div>

    <TelegramVideoLightbox
      :video="lightboxVideo"
      :show-moderation="true"
      @close="closeLightbox"
      @approve="onLightboxApprove"
      @reject="onLightboxReject"
    />
  </section>
</template>

<style scoped>
.tg-video-queue {
  flex: none;
  position: sticky;
  top: 2.5rem;
  z-index: 1;
  margin: 0;
  padding: 12px calc(var(--spacing, 8px) * 0.75);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
}

.tg-video-obs-link {
  font-size: 0.8rem;
  color: #7eb6ff;
}

.tg-video-empty {
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: .8rem;
}

.tg-video-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.tg-video-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.tg-video-preview-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: zoom-in;
}

.tg-video-preview {
  display: block;
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 4px;
  background: #000;
  pointer-events: none;
}

.tg-video-caption {
  margin: 0;
  font-size: 0.85rem;
  word-break: break-word;
}

.tg-video-date {
  margin: 0;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.tg-video-actions {
  display: flex;
  gap: 6px;
}

.tg-video-actions button {
  flex: 1;
  border: none;
  border-radius: 4px;
  padding: 6px 8px;
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
}

.tg-video-actions .approve {
  background: #28a745;
}

.tg-video-actions .reject {
  background: #dc3545;
}
</style>
