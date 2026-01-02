<script setup lang="ts">
import { ref, watch, computed, useTemplateRef, watchEffect } from 'vue';

import type { ChatSettings } from '@shared/shared-types';

import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { clamp, useDebounceFn } from '@vueuse/core';

import FontSettings from '@/components/FontSettings.vue';


const
  settingsStore = useSettingsStore(),
  globalStore = useUIStore();

const
  localSettings = ref<ChatSettings | null>(null),
  newBadWord = ref('');

const
  isOpen = computed(() => globalStore.isSettingsOpen),
  badWords = computed(() => settingsStore.badWords),
  dialogRef = useTemplateRef<HTMLDialogElement>('dialog');

const
  kChatScaleFactor = 100,
  kDefaultChatScale = 100,
  kChatScaleMin = 50,
  kChatScaleMax = 150,
  kAdminScaleFactor = 100,
  kDefaultAdminScale = 100,
  kAdminScaleMin = 50,
  kAdminScaleMax = 150;

const handleClose = () => {
  globalStore.isSettingsOpen = false;
};

const handleBackdropClick = (event: MouseEvent) => {
  // If the click target is the dialog itself (backdrop), close it
  if (event.target === event.currentTarget) {
    handleClose();
  }
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

function clampChatScale(value: number): number {
  if (!Number.isFinite(value)) {
    return kDefaultChatScale;
  }

  return clamp(value, kChatScaleMin, kChatScaleMax);
}

function updateChatScale(value: number): void {
  if (!localSettings.value) {
    return;
  }

  const normalizedValue = clampChatScale(value) / kChatScaleFactor;

  if (isNaN(normalizedValue)) {
    return;
  }

  localSettings.value = {
    ...localSettings.value,
    chatScale: normalizedValue
  };
}

const debouncedUpdateChatScale = useDebounceFn((
  value: number
): void => {
  updateChatScale(value);
}, 300);

function handleChatScaleInput(event: Event): void {
  const input = event.target as HTMLInputElement | null;

  if (!input) {
    return;
  }

  const value = parseInt(input.value, 10);

  if (!isNaN(value)) {
    debouncedUpdateChatScale(value);
  }
}

function clampAdminScale(value: number): number {
  if (!Number.isFinite(value)) {
    return kDefaultAdminScale;
  }

  return clamp(value, kAdminScaleMin, kAdminScaleMax);
}

function updateAdminScale(value: number): void {
  if (!localSettings.value) {
    return;
  }

  const normalizedValue = clampAdminScale(value) / kAdminScaleFactor;

  if (isNaN(normalizedValue)) {
    return;
  }

  localSettings.value = {
    ...localSettings.value,
    adminScale: normalizedValue
  };
}

const debouncedUpdateAdminScale = useDebounceFn((
  value: number
): void => {
  updateAdminScale(value);
}, 300);

function handleAdminScaleInput(event: Event): void {
  const input = event.target as HTMLInputElement | null;

  if (!input) {
    return;
  }

  const value = parseInt(input.value, 10);

  if (!isNaN(value)) {
    debouncedUpdateAdminScale(value);
  }
}

watchEffect(() => {
  if (isOpen.value && localSettings.value) {
    dialogRef.value?.showModal();
  } else {
    dialogRef.value?.close();
  }
});
</script>

<template>
  <dialog
    v-if="isOpen && localSettings"
    ref="dialog"
    class="settings-modal"
    @close="handleClose"
    @click="handleBackdropClick"
  >
    <div class="settings-modal-header">
      <h2 class="settings-modal-title">Chat Settings</h2>
      <button
        class="settings-modal-close"
        @click.prevent="handleClose"
        autofocus
        title="Close"
      >
        ✕
      </button>
    </div>

    <div class="settings-modal-content">
      <div class="settings-section settings-grid">
        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showAvatars"
            type="checkbox"
          />
          Show avatars
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showEmotes"
            type="checkbox"
          />
          Show emotes
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showReplyTo"
            type="checkbox"
          />
          Show reply quotes
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showBadges"
            type="checkbox"
          />
          Show user badges
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showModeratorBadges"
            type="checkbox"
          />
          Show moderator badge
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showEditedBadges"
            type="checkbox"
          />
          Show a badge on edited messages
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showSubscriberBadges"
            type="checkbox"
          />
          Show subscriber badges
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.showVipBadges"
            type="checkbox"
          />
          Show VIP badges
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.filterLinks"
            type="checkbox"
          />
          Filter links
        </label>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.makeLinksClickable"
            type="checkbox"
          />
          Make links clickable
        </label>
      </div>

      <div class="settings-scale-section">
        <div class="settings-section">
          <h4 class="settings-section-title">Chat scale</h4>
          <div class="numeric-control">
            Scale
            <input
              type="number"
              :min="kChatScaleMin"
              :max="kChatScaleMax"
              :step="1"
              :value="(localSettings.chatScale ?? kDefaultChatScale / kChatScaleFactor) * kChatScaleFactor"
              @input="handleChatScaleInput"
            />
            %
          </div>
        </div>

        <div class="settings-section">
          <h4 class="settings-section-title">Admin scale</h4>
          <div class="numeric-control">
            Scale
            <input
              type="number"
              :min="kAdminScaleMin"
              :max="kAdminScaleMax"
              :step="1"
              :value="(localSettings.adminScale ?? kDefaultAdminScale / kAdminScaleFactor) * kAdminScaleFactor"
              @input="handleAdminScaleInput"
            />
            %
          </div>
        </div>
      </div>

      <FontSettings
        v-if="localSettings"
        v-model="localSettings"
        class="settings-section font-settings"
      />

      <div class="settings-section bad-words-section">
        <h3>Bad Words Filter</h3>

        <label class="settings-checkbox-item">
          <input
            v-model="localSettings.filterBadWords"
            type="checkbox"
          />
          Filter bad words
        </label>

        <div class="bad-words-input">
          <input
            v-model="newBadWord"
            @keydown.ctrl.enter="addBadWord"
            placeholder="Add bad words (comma-separated)..."
            class="bad-words-input-field"
            minlength="3"
          />
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
  </dialog>
</template>

<style scoped>
.settings-modal {
  display: flex;
  flex-direction: column;

  width: min(520px, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  margin: auto;
  overflow: hidden;

  border: 1px solid var(--border-color);
  background: var(--bg-color-modal);
  border-radius: .5rem;
  backdrop-filter: blur(10px);

  &::backdrop {
    background-color: var(--bg-color-modal-backdrop);
  }
}

.settings-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing);
  border-bottom: 1px solid var(--border-color);
}

.settings-modal-title {
  font-size: 1rem;
  font-weight: 500;
}

.settings-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 1.5rem;
  height: 1.5rem;
  line-height: 1;

  color: var(--text-color);

  font-size: 1.25rem;
  cursor: pointer;
  opacity: .7;
  transition: opacity .2s;

  &:hover {
    opacity: 1;
  }
}

.settings-modal-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color);
}

.settings-grid {
  display: grid;
  gap: var(--spacing);
}

.settings-checkbox-item {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
  font-size: .95rem;
  color: var(--text-muted);
  transition: color .2s;
  user-select: none;
  cursor: pointer;

  &:has(input:checked),
  &:hover {
    color: var(--text-color);
  }
}

.settings-section {
  border-top: 1px solid var(--border-color);
  padding: var(--spacing);
}

.settings-section-title {
  margin-bottom: calc(var(--spacing) * .75);
  font-weight: 500;
}

.settings-scale-section {
  display: grid;
  grid-template-columns: 1fr 1fr;


  .settings-section:not(:first-child) {
    border-left: 1px solid var(--border-color);
  }
}

.settings-actions {
  display: flex;
  justify-content: center;
  gap: calc(var(--spacing) * .75);
}

.font-settings {
  display: contents;
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
  display: flex;
  gap: calc(var(--spacing) * .5);
  overflow: hidden;

  .btn {
    flex: none;
    width: fit-content;
    align-self: stretch;
    align-content: center;
  }
}

.bad-words-input-field {
  flex: 1;
  field-sizing: content;
  padding: var(--spacing);

  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: .25rem;
  color: var(--text-color);

  font-size: .75rem;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
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

input[type="checkbox"] {
  width: 1.25ex;
  height: 1.25ex;
}
</style>
