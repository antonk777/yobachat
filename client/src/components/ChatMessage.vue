<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ChatMessageClient, ChatSettings, TelegramVideoMeta } from '@shared/shared-types.js';
import { useWSConnection } from '@/composables/useWSConnection';
import TelegramVideoLightbox, {
  type TelegramVideoLightboxSource,
} from '@/components/TelegramVideoLightbox.vue';

const props = withDefaults(defineProps<{
  message: ChatMessageClient;
  settings: ChatSettings;
  isQuote?: boolean;
  isInAdmin?: boolean;
}>(),
  {
    isQuote: false,
    isInAdmin: false
  }
);

const ws = useWSConnection();
const lightboxVideo = ref<TelegramVideoLightboxSource | null>(null);

const hasPlatformIcon = computed(() => {
  const platformId = props.message.platform.id;
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame'].includes(platformId);
});

const isDeluxe = computed(() => {
  return props.message.username.toLowerCase().includes('deluxe');
})

const replyTo = computed(() => props.message.replyTo);

const tgVideo = computed((): TelegramVideoMeta | null => {
  const meta = props.message.metadata?.tgVideo;

  if (!meta || typeof meta !== 'object') {
    return null;
  }

  const video = meta as TelegramVideoMeta;

  if (!video.fileUrl || !video.status) {
    return null;
  }

  return video;
});

const showTgVideo = computed(() => {
  if (!props.settings.showApprovedTgVideosInChat || !tgVideo.value || props.isQuote) {
    return false;
  }

  if (props.isInAdmin) {
    return tgVideo.value.status === 'pending' || tgVideo.value.status === 'approved';
  }

  // OBS chat widget: approved only
  return tgVideo.value.status === 'approved';
});

const showTgVideoModeration = computed(() => {
  return props.isInAdmin && showTgVideo.value && tgVideo.value?.status === 'pending';
});

function openLightbox(): void {
  const video = tgVideo.value;

  if (!video) {
    return;
  }

  lightboxVideo.value = {
    fileUrl: video.fileUrl,
    queueId: video.queueId,
  };
}

function closeLightbox(): void {
  lightboxVideo.value = null;
}

function approveVideo(queueId?: number): void {
  const id = queueId ?? tgVideo.value?.queueId;

  if (id == null) {
    return;
  }

  ws.approveTgVideo(id);
  closeLightbox();
}

function rejectVideo(): void {
  const id = tgVideo.value?.queueId;

  if (id == null) {
    return;
  }

  if (!confirm('Reject this video? It will not be shown again.')) {
    return;
  }

  ws.rejectTgVideo(id);
  closeLightbox();
}

function onLightboxReject(queueId: number): void {
  ws.rejectTgVideo(queueId);
  closeLightbox();
}
</script>

<template>
  <div
    class="chat-message"
    :class="[`platform-${message.platform.id}`, {
      'is-quote': isQuote,
      'is-deluxe': isDeluxe
    }]"
    :style="{
      '--user-color': message.color ?? null,
      '--platform-color': message.platform.color ?? null,
    }"
  >
    <ChatMessage
      v-if="settings.showReplyTo && replyTo && !isQuote"
      :message="replyTo"
      :settings="settings"
      :is-quote="true"
    />

    <div class="message-header">
      <div class="reply-icon" v-if="isQuote" />

      <div
        v-if="hasPlatformIcon && !isQuote"
        class="platform-icon"
        :class="`icon-${message.platform.id}`"
        :aria-label="message.platform.abbr"
      />

      <div
        v-if="settings.showModeratorBadges && message.isModerator && !isQuote"
        class="moderator-badge"
      />

      <div
        v-if="settings.showVipBadges && message.isVip && !isQuote"
        class="vip-badge"
      />

      <template v-if="settings.showBadges && message.badgeImages && Object.keys(message.badgeImages).length > 0 && !isQuote">
        <img
          v-for="(badge, badgeName) in message.badgeImages"
          :key="badgeName"
          :src="badge"
          :alt="badgeName"
          class="user-badge"
        />
      </template>

      <img
        class="avatar"
        v-if="settings.showAvatars && message.avatar && !isQuote"
        :src="message.avatar"
        :alt="message.usernameFiltered"
      />

      <div class="username">
        {{ message.usernameFiltered }}
      </div>

      <div
        v-if="settings.showEditedBadges && message.isEdited && !isQuote"
        class="edited-badge"
      />
    </div>

    <div v-if="showTgVideo && tgVideo" class="message-content message-content--video">
      <button
        type="button"
        class="tg-chat-video-btn"
        title="Open fullscreen preview"
        @click.stop="openLightbox"
      >
        <video
          class="tg-chat-video"
          :src="tgVideo.fileUrl"
          autoplay
          muted
          playsinline
          loop
        />
      </button>
      <div v-if="showTgVideoModeration" class="tg-video-actions">
        <button type="button" class="tg-video-approve" @click.stop="approveVideo()">
          Approve
        </button>
        <button type="button" class="tg-video-reject" @click.stop="rejectVideo">
          Reject
        </button>
      </div>

      <TelegramVideoLightbox
        :video="lightboxVideo"
        :show-moderation="showTgVideoModeration"
        @close="closeLightbox"
        @approve="approveVideo"
        @reject="onLightboxReject"
      />
    </div>
    <div v-else class="message-content">
      <template v-for="(segment, index) in message.segments" :key="index">
        <a
          v-if="segment.type === 'link' && props.isInAdmin && settings.makeLinksClickable"
          :href="segment.url"
          target="_blank"
          rel="noopener noreferrer"
          class="link"
        >
          {{ segment.content }}
        </a>
        <span v-else-if="segment.type === 'link'">
          {{ (settings.filterLinks && !message.isModerator) ? '🔗link filtered' : segment.content }}
        </span>
        <span v-else-if="segment.type === 'text'">{{ segment.content }}</span>
        <img
          v-else-if="segment.type === 'emote'"
          :src="segment.url"
          :alt="segment.content"
          loading="lazy"
          class="emote"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  display: block;
  flex: none;
  hyphens: auto;
  line-height: var(--chat-line-height, var(--line-height));

  &.deleted {
    opacity: .5;
  }

  &.is-quote {
    position: relative;
    margin-left: calc(var(--spacing) * .3);
    padding-bottom: calc(var(--spacing) * .25);
    padding-left: calc((var(--platform-icon-size) * .8) + var(--whitespace));
    line-height: calc(var(--chat-line-height, var(--line-height)) * .85);
    max-height: 1.5rem;
    mask: linear-gradient(#fff calc(100% - (var(--spacing) * .25)), transparent 100%);
    overflow: hidden;

    font-size: .75rem;
  }
}

.message-header {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  gap: var(--whitespace);
  flex-wrap: wrap;
  margin-right: var(--whitespace);

  .chat-message.is-quote & {
    gap: calc(var(--whitespace) * 1.5);
  }
}

.reply-icon {
  --src-color: var(--user-color, var(--platform-color));

  display: block;
  align-self: center;
  flex: none;

  position: absolute;
  top: 0;
  left: 0;

  width: calc(var(--platform-icon-size) * .8);
  aspect-ratio: 799.96 / 694.747;
  object-fit: contain;

  background-color: var(--src-color);
  background-color: hsl(from var(--src-color) h calc(s * .5) calc(l * .9));

  mask-image: url('@/assets/arrow-reply-5.svg');
  mask-position: center center;
  mask-repeat: no-repeat;
  mask-size: contain;
}

.platform-icon {
  display: block;
  align-self: center;
  flex: none;

  width: var(--platform-icon-size);
  height: var(--platform-icon-size);

  background-color: var(--platform-color);
  mask-position: center center;
  mask-repeat: no-repeat;
  mask-size: contain;

  &.icon-twitch {
    mask-image: url('@/assets/twitch.svg');
  }

  &.icon-youtube {
    mask-image: url('@/assets/youtube.svg');
  }

  &.icon-telegram {
    mask-image: url('@/assets/telegram.svg');
  }

  &.icon-vkvideo {
    mask-image: url('@/assets/vkvideo.svg');
  }

  &.icon-kick {
    mask-image: url('@/assets/kick.svg');
  }

  &.icon-goodgame {
    mask-image: url('@/assets/goodgame.png');
  }
}

.moderator-badge {
  display: block;
  align-self: center;
  flex: none;

  width: var(--moderator-badge-size);
  height: var(--moderator-badge-size);

  background-color: var(--moderator-color);
  mask: url('@/assets/all-seeing-eye.webp') center center / contain no-repeat;
}

.vip-badge {
  display: block;
  align-self: center;
  flex: none;

  width: var(--vip-badge-size);
  height: var(--vip-badge-size);

  background-color: var(--vip-color);
  mask: url('@/assets/vip.svg') center center / contain no-repeat;
}

.edited-badge {
  display: block;
  align-self: center;
  flex: none;
  width: var(--edited-badge-size);
  height: var(--edited-badge-size);
  mask: url('@/assets/edited.svg') center center / contain no-repeat;
  background-color: var(--text-muted);
}

.user-badges {
  display: contents;
}

.user-badge {
  display: block;
  align-self: center;
  flex: none;

  width: var(--user-badge-size);
  height: var(--user-badge-size);
}

.avatar {
  display: block;
  align-self: center;
  flex: none;
  width: var(--avatar-size);
  height: var(--avatar-size);
  object-fit: cover;
  border-radius: 50%;
}

.username {
  --src-color: var(--user-color, var(--platform-color));
  --username-color: lch(from var(--src-color) calc(l + 20) c h);

  color: var(--username-color, var(--src-color));

  font-family: var(--username-font-family, inherit);
  font-weight: var(--username-font-weight, bolder);
  font-style: var(--username-font-style, normal);
  font-stretch: var(--username-font-stretch, normal);

  .chat-message.is-deluxe > .message-header > & {
    color: var(--deluxe-user-color, var(--username-color, var(--src-color)));
  }

  .chat-message.is-quote & {
    color: hsl(from var(--src-color) h calc(s * .5) calc(l * .9));
  }

  .chat-message.deleted & {
    text-decoration: line-through;
  }
}

.message-content {
  display: inline;
  vertical-align: middle;
  color: var(--text-color);
  max-width: 100%;
  hyphens: auto;
  word-wrap: break-word;

  .chat-message.is-quote & {
    color: var(--text-muted);
  }
}

.message-content .emote {
  display: inline-block;
  width: auto;
  min-width: var(--emote-size);
  height: var(--emote-size);
  object-fit: contain;
  vertical-align: -0.4em;
}

.message-content .link {
  color: var(--primary-color);
  text-decoration: underline;
  text-decoration-thickness: .075em;
  text-underline-offset: .15em;
  transition: color .2s ease-in-out;
  cursor: pointer;

  &:hover {
    color: var(--text-color);
  }
}

.message-content--video {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * 0.35);
  margin-top: calc(var(--spacing) * 0.15);
}

.tg-chat-video-btn {
  display: block;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}

.tg-chat-video {
  display: block;
  max-width: min(100%, 20rem);
  max-height: 13.75rem;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 0.25rem;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.tg-video-actions {
  display: flex;
  gap: 0.25rem;
}

.tg-video-approve,
.tg-video-reject {
  border: none;
  border-radius: 0.1875rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.7rem;
  cursor: pointer;
  color: #fff;
  text-align: center;
}

.tg-video-approve {
  background: #28a745;
}

.tg-video-reject {
  background: #dc3545;
}
</style>

