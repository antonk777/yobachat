<script setup lang="ts">
import { ref, watch, computed } from 'vue';

import type { ChatSettings } from '@shared/shared-types';

import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';

const
  settingsStore = useSettingsStore(),
  globalStore = useUIStore()

const
  localSettings = ref<ChatSettings | null>(null),
  newBadWord = ref('');

const
  isOpen = computed(() => globalStore.isSettingsOpen),
  badWords = computed(() => settingsStore.badWords);

watch(() => settingsStore.settings, value => {
  localSettings.value = value ? { ...value } : null;
}, { immediate: true });

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
</script>

<template>
  <div
    v-if="isOpen && localSettings"
    class="settings-modal-backdrop"
    @click.self="handleClose"
  >
    <div class="settings-modal">
      <h2>Chat Settings</h2>

      <div class="settings-grid">
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

      <div class="bad-words-section">
        <h3>Bad Words Filter</h3>

        <div class="bad-words-input">
          <textarea
            v-model="newBadWord"
            @keydown.ctrl.enter="addBadWord"
            placeholder="Add bad words (comma-separated)..."
            class="input textarea"
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
            <span>{{ word }}</span>
            <button @click="() => settingsStore.removeBadWord(word)" class="btn-icon">
              ❌
            </button>
          </div>
          <div v-if="badWords.length === 0" class="empty-state">
            No bad words configured
          </div>
        </div>
      </div>

      <div class="settings-actions">
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
  background: var(--bg-color);
  border-radius: .5rem;
  padding: 1.5rem;
  max-width: 480px;
  max-height: 90vh;
  width: 100%;
  border: 1px solid var(--border-color);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.settings-modal h2 {
  margin: 0 0 1rem 0;
}

.settings-grid {
  display: grid;
  gap: .5rem;
  margin-bottom: 1rem;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: .5rem;
  font-size: .95rem;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: .5rem;
}

.bad-words-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.bad-words-section h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
}

.bad-words-input {
  display: flex;
  gap: .5rem;
  margin-bottom: 1rem;
}

.input {
  flex: 1;
  padding: .5rem;
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
  min-height: 3.75rem;
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
  gap: .5rem;
  max-height: 200px;
  overflow-y: auto;
}

.bad-word-item {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .5rem .75rem;
  background-color: var(--bg-color-dark);
  border-radius: .25rem;
  border: 1px solid var(--border-color);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--error-color);
  padding: 0;
  width: 1.25rem;
  height: 1.25rem;
  line-height: 1;
  font-size: 1.25rem;
  cursor: pointer;

  &:hover {
    color: color-mix(in srgb, var(--error-color) 80%, white 20%);
  }
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: 1rem;
  font-size: .9rem;
}
</style>


