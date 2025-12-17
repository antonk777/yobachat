<script setup lang="ts">
import { ref, watch, computed } from 'vue';

import type { ChatSettings } from '@shared/shared-types';

import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';

import FontSettings from '@/components/FontSettings.vue';


const
  settingsStore = useSettingsStore(),
  globalStore = useUIStore();

const
  localSettings = ref<ChatSettings | null>(null),
  newBadWord = ref('');

const
  isOpen = computed(() => globalStore.isSettingsOpen),
  badWords = computed(() => settingsStore.badWords);

const handleClose = () => {
  globalStore.isSettingsOpen = false;
};

const handleApply = () => {
  if (!localSettings.value) {
    return;
  }

  settingsStore.updateChatSettings(localSettings.value);
};

const handleSave = () => {
  if (!localSettings.value) {
    return;
  }

  settingsStore.updateChatSettings(localSettings.value);
  globalStore.isSettingsOpen = false;
};

const addBadWord = () => {
  if (!localSettings.value) {
    return;
  }

  const result = settingsStore.addBadWord(newBadWord.value);

  if (result) {
    newBadWord.value = '';
  }
};

watch(() => settingsStore.settings, value => {
  localSettings.value = value ? { ...value } : null;
}, { immediate: true });
</script>

<template>
  <div
    v-if="isOpen && localSettings"
    class="settings-modal-backdrop"
    @mousedown.self="handleClose"
  >
    <div class="settings-modal">
      <h2 class="settings-modal-title">Chat Settings</h2>

      <div class="settings-section settings-grid">
        <label class="settings-item">
          <input
            v-model="localSettings.showAvatars"
            type="checkbox"
          />
          Show avatars
        </label>

        <label class="settings-item">
          <input
            v-model="localSettings.showEmotes"
            type="checkbox"
          />
          Show emotes
        </label>

        <label class="settings-item">
          <input
            v-model="localSettings.showModeratorBadges"
            type="checkbox"
          />
          Show moderator badge
        </label>

        <label class="settings-item">
          <input
            v-model="localSettings.showEditedBadges"
            type="checkbox"
          />
          Highlight edited messages
        </label>

        <label class="settings-item">
          <input
            v-model="localSettings.showSubscriberBadges"
            type="checkbox"
          />
          Show subscriber badges
        </label>

        <label class="settings-item">
          <input
            v-model="localSettings.showVipBadges"
            type="checkbox"
          />
          Show VIP badges
        </label>
      </div>

      <FontSettings
        v-if="localSettings"
        v-model="localSettings"
        class="settings-section font-settings"
      />

      <div class="settings-section bad-words-section">
        <h3>Bad Words Filter</h3>

        <label class="settings-item">
          <input
            v-model="localSettings.filterBadWords"
            type="checkbox"
          />
          Filter bad words
        </label>

        <div class="bad-words-input">
          <textarea
            v-model="newBadWord"
            @keydown.ctrl.enter="addBadWord"
            placeholder="Add bad words (comma-separated)..."
            class="input textarea bad-words-input-textarea"
            minlength="3"
            rows="3"
          ></textarea>
          <button @click="addBadWord" class="btn btn-primary">Add</button>
        </div>

        <div class="bad-words-list">
          <div
            v-for="word in badWords"
            :key="word"
            class="bad-word-item"
          >
            {{ word }}
            <button
              @click="() => settingsStore.removeBadWord(word)"
              class="btn-remove"
              title="Remove bad word"
            >
              ❌
            </button>
          </div>
          <div v-if="badWords.length === 0" class="no-bad-words">
            No bad words configured
          </div>
        </div>
      </div>

      <div class="settings-section settings-actions">
        <button class="btn btn-primary" @click="handleSave">
          Save
        </button>
        <button class="btn btn-secondary" @click="handleApply">
          Apply
        </button>
        <button class="btn btn-secondary" @click="handleClose">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  display: flex;
  flex-direction: column;
  width: min(480px, calc(100vw - 4rem));
  max-height: calc(100dvh - 4rem);
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color);
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  border-radius: .5rem;
}

.settings-modal-title {
  padding: var(--spacing);
}

.settings-grid {
  display: grid;
  gap: var(--spacing);
}

.settings-item {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  font-size: .95rem;
}

.settings-section {
  border-top: 1px solid var(--border-color);
  padding: var(--spacing);
}

.settings-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: .5rem;
  background: var(--bg-color-bright);
}

.bad-words-section {
  display: grid;
  gap: var(--spacing);
}

.bad-words-section h3 {
  font-size: 1rem;
  font-weight: 600;
}

.bad-words-input {
  display: grid;
  gap: var(--spacing);

  .btn {
    width: fit-content;
    align-self: end;
  }
}

.bad-words-input-textarea {
  field-sizing: content;
}

.input {
  flex: 1;
  padding: var(--spacing);
  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: .25rem;
  color: var(--text-color);
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}

.textarea {
  resize: vertical;
  font-family: inherit;
}

.btn {
  padding: .5rem 1rem;
  border: none;
  border-radius: .25rem;
  font-size: 1rem;
  font-weight: 500;
  transition: background-color .2s;
  cursor: pointer;
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-color);

  &:hover {
    background-color: color-mix(in srgb, var(--primary-color) 80%, white 20%);
  }
}

.bad-words-list {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--spacing) * .5);
  max-height: 200px;
  overflow-y: auto;
}

.bad-word-item {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  padding: calc(var(--spacing) * .5);
  background-color: var(--bg-color-dark);
  border-radius: .25rem;
  border: 1px solid var(--border-color);
}

.btn-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--error-color);
  padding: 0;
  width: 1rem;
  height: 1rem;
  line-height: 1;
  font-size: .65rem;
  cursor: pointer;

  &:hover {
    color: color-mix(in srgb, var(--error-color) 80%, white 20%);
  }
}

.no-bad-words {
  width: 100%;
  color: var(--text-muted);
  font-size: .9rem;
  text-align: center;
}
</style>


