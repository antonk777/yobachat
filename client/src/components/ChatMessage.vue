<script setup lang="ts">
import { computed } from 'vue';

import type { ChatMessageWithSegments, ChatSettings } from '@shared/shared-types.js';

const props = defineProps<{
  message: ChatMessageWithSegments;
  settings: ChatSettings;
}>();

const hasPlatformIcon = computed(() => {
  const platformId = props.message.platform.id;
  return ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame'].includes(platformId);
});
</script>

<template>
  <div
    class="chat-message"
    :class="`platform-${message.platform.id}`"
    :style="{
      '--user-color': message.color ?? null,
      '--platform-color': message.platform.color ?? null,
    }"
  >
    <div class="message-header">
      <div
        v-if="hasPlatformIcon"
        class="platform-icon"
        :class="`icon-${message.platform.id}`"
        :aria-label="message.platform.abbr"
      />

      <div
        v-else
        class="platform-badge"
        :class="`badge-${message.platform.id}`"
      >
        {{ message.platform.abbr }}
      </div>

      <div
        v-if="settings.showModeratorBadges && message.isModerator"
        class="moderator-badge"
      />

      <div
        v-if="settings.showBadges && message.badgeImages && Object.keys(message.badgeImages).length > 0"
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
        v-if="settings.showAvatars && message.avatar"
        :src="message.avatar"
        :alt="message.usernameFiltered"
      />

      <div class="username">
        {{ message.usernameFiltered }}
      </div>

      <div
        v-if="settings.showEditedBadges && message.isEdited"
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
}

.message-header {
  display: inline-flex;
  align-items: baseline;
  gap: var(--whitespace);
  flex-wrap: wrap;
  margin-right: var(--whitespace);
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

.platform-badge {
  display: block;
  align-self: center;
  flex: none;

  min-width: var(--platform-icon-size);
  height: var(--platform-icon-size);
  line-height: var(--platform-icon-size);

  font-size: .55rem;
  font-weight: bolder;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: .05em;
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

.username {
  color: var(--user-color, var(--text-muted));
  font-family: var(--username-font-family, inherit);
  font-weight: var(--username-font-weight, bolder);
  font-style: var(--username-font-style, normal);

  .chat-message.deleted & {
    text-decoration: line-through;
  }
}

.edited-badge {
  display: block;
  align-self: center;
  flex: none;
  width: var(--badge-size);
  height: var(--badge-size);
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

  .chat-message.deleted & {
    text-decoration: line-through;
  }
}

.message-content .emote {
  display: inline-block;
  width: auto;
  min-width: var(--emote-size);
  height: var(--emote-size);
  object-fit: contain;
  vertical-align: middle;
}
</style>

