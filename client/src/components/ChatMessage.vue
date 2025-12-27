<script setup lang="ts">
import { computed } from 'vue';

import type { ChatMessageClient, ChatSettings } from '@shared/shared-types.js';

const props = withDefaults(defineProps<{
  message: ChatMessageClient;
    settings: ChatSettings;
    isQuote?: boolean;
  }>(),
  {
    isQuote: false
  }
);

const hasPlatformIcon = computed(() => {
  const platformId = props.message.platform.id;
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame'].includes(platformId);
});

const isDeluxe = computed(() => {
  return props.message.username.toLowerCase().includes('deluxe');
})

const replyTo = computed(() => props.message.replyTo);
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
        v-if="settings.showBadges && message.badgeImages && Object.keys(message.badgeImages).length > 0 && !isQuote"
        class="badges"
      >
        <img
          v-for="(badge, badgeName) in message.badgeImages"
          :key="badgeName"
          :src="badge"
          :alt="badgeName"
          class="badge"
        />
      </div>

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

    <div class="message-content">
      <template v-for="(segment, index) in message.segments" :key="index">
        <span v-if="segment.type === 'text'">{{ segment.content }}</span>
        <img
          v-else
          :src="segment.url"
          :alt="segment.content"
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
    line-height: calc(var(--chat-line-height, var(--line-height)) * .75);
    max-height: 1.5rem;
    mask: linear-gradient(#fff calc(100% - (var(--spacing) * .25)), transparent 100%);
    overflow: hidden;

    font-size: .75rem;
  }
}

.message-header {
  display: inline-flex;
  align-items: baseline;
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

  width: var(--badge-size);
  height: var(--badge-size);

  background-color: var(--moderator-color);
  mask: url('@/assets/all-seeing-eye.webp') center center / contain no-repeat;
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

@keyframes username-gradient-shift {
  0% {
    color: #6bf8d5;
  }
  33% {
    color: #ba92ff;
  }
  66% {
    color: #ff88c4;
  }
  100% {
    color: #6bf8d5;
  }
}

.username {
  --src-color: var(--user-color, var(--platform-color));

  color: var(--src-color);
  color: lch(from var(--src-color) calc(l + 20) c h);

  font-family: var(--username-font-family, inherit);
  font-weight: var(--username-font-weight, bolder);
  font-style: var(--username-font-style, normal);
  font-stretch: var(--username-font-stretch, normal);

  .chat-message.is-deluxe > .message-header > & {
    animation: username-gradient-shift 120s ease infinite;
  }

  .chat-message.is-quote & {
    color: hsl(from var(--src-color) h calc(s * .5) calc(l * .9));
  }

  .chat-message.deleted & {
    text-decoration: line-through;
  }
}

.edited-badge {
  display: block;
  align-self: center;
  flex: none;
  width: .9rem;
  height: .9rem;
  mask: url('@/assets/edited.svg') center center / contain no-repeat;
  background-color: var(--text-muted);
}

.badges {
  display: flex;
  gap: var(--whitespace);
  flex-wrap: wrap;
}

.message-content {
  display: inline;
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
</style>

