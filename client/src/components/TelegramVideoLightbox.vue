<script setup lang="ts">
import { watch } from 'vue';
import { onKeyStroke } from '@vueuse/core';

export type TelegramVideoLightboxSource = {
  fileUrl: string;
  caption?: string;
  queueId?: number;
};

const props = withDefaults(defineProps<{
  video: TelegramVideoLightboxSource | null;
  showModeration?: boolean;
}>(), {
  showModeration: false,
});

const emit = defineEmits<{
  close: [];
  approve: [queueId: number];
  reject: [queueId: number];
}>();

function close(): void {
  emit('close');
}

function approve(): void {
  const queueId = props.video?.queueId;

  if (queueId == null) {
    return;
  }

  emit('approve', queueId);
}

function reject(): void {
  const queueId = props.video?.queueId;

  if (queueId == null) {
    return;
  }

  if (!confirm('Reject this video? It will not be shown again.')) {
    return;
  }

  emit('reject', queueId);
}

onKeyStroke('Escape', () => {
  if (props.video) {
    close();
  }
});

watch(() => props.video, (video) => {
  if (video) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="video"
      class="tg-video-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Video preview"
      @click.self="close"
    >
      <button
        type="button"
        class="tg-video-lightbox-close"
        title="Close"
        @click="close"
      >
        ×
      </button>

      <video
        class="tg-video-lightbox-player"
        :src="video.fileUrl"
        controls
        autoplay
        muted
        playsinline
        loop
      />

      <p v-if="video.caption" class="tg-video-lightbox-caption">
        {{ video.caption }}
      </p>

      <div v-if="showModeration && video.queueId != null" class="tg-video-lightbox-actions">
        <button type="button" class="approve" @click="approve">
          Approve
        </button>
        <button type="button" class="reject" @click="reject">
          Reject
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tg-video-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.88);
}

.tg-video-lightbox-close {
  position: absolute;
  top: 0.75rem;
  right: 1rem;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.8;
}

.tg-video-lightbox-close:hover {
  opacity: 1;
}

.tg-video-lightbox-player {
  max-width: min(96vw, 68.75rem);
  max-height: min(70vh, 50rem);
  width: auto;
  height: auto;
  object-fit: contain;
  background: #000;
  border-radius: 0.375rem;
}

.tg-video-lightbox-caption {
  margin: 0;
  max-width: min(96vw, 40rem);
  color: #e0e0e0;
  text-align: center;
  word-break: break-word;
}

.tg-video-lightbox-actions {
  display: flex;
  gap: 0.625rem;
  width: min(96vw, 22.5rem);
}

.tg-video-lightbox-actions button {
  flex: 1;
  border: none;
  border-radius: 0.25rem;
  padding: 0.625rem 0.875rem;
  color: #fff;
  cursor: pointer;
  font-size: 1rem;
  text-align: center;
}

.tg-video-lightbox-actions .approve {
  background: #28a745;
}

.tg-video-lightbox-actions .reject {
  background: #dc3545;
}
</style>
