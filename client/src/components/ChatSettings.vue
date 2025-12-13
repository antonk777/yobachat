<script setup lang="ts">
import { ref, watch, computed } from 'vue';

import type { ChatSettings } from '@shared/shared-types';

import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useGoogleFonts, generateGoogleFontsCssUrl } from '@/composables/useGoogleFonts';

import FontFamilyDropdown from '@/components/FontFamilyDropdown.vue';

const
  settingsStore = useSettingsStore(),
  globalStore = useUIStore(),
  { fonts: allFonts, isLoading: fontsLoading } = useGoogleFonts();

const
  localSettings = ref<ChatSettings | null>(null),
  newBadWord = ref('');

const
  isOpen = computed(() => globalStore.isSettingsOpen),
  badWords = computed(() => settingsStore.badWords);

// Font weight options
const fontWeights = [
  { label: 'Thin (100)', value: 100 },
  { label: 'Extra Light (200)', value: 200 },
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'Semi Bold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'Extra Bold (800)', value: 800 },
  { label: 'Black (900)', value: 900 },
];

// Get available font weights for the selected user font
const availableUserFontWeights = computed(() => {
  if (!localSettings.value?.userFontFamily) {
    return fontWeights; // Show all if no font selected
  }

  const selectedFont = allFonts.value.find(f => f.family === localSettings.value!.userFontFamily);

  if (!selectedFont || selectedFont.variants.length === 0) {
    return fontWeights; // Show all if font not found or has no variants
  }

  // Filter to only show weights that are available for this font
  return fontWeights.filter(weight => selectedFont.variants.includes(weight.value));
});

// Get available font weights for the selected admin font
const availableAdminFontWeights = computed(() => {
  if (!localSettings.value?.adminFontFamily) {
    return fontWeights; // Show all if no font selected
  }

  const selectedFont = allFonts.value.find(f => f.family === localSettings.value!.adminFontFamily);

  if (!selectedFont || selectedFont.variants.length === 0) {
    return fontWeights; // Show all if font not found or has no variants
  }

  // Filter to only show weights that are available for this font
  return fontWeights.filter(weight => selectedFont.variants.includes(weight.value));
});

// Prepare font options for dropdowns
const fontOptions = computed(() => {
  const defaultOption = { value: '', label: 'Default (sans-serif)', style: {} };

  const fontOpts = allFonts.value.map(font => ({
    value: font.family,
    label: font.family,
    style: { fontFamily: font.family }
  }));

  return [defaultOption, ...fontOpts];
});

// Helper function to update Google Fonts CSS URL
function updateGoogleFontsUrl(
  family: string | undefined,
  weight: number | undefined,
  targetField: 'userGoogleFontsCssUrl' | 'adminGoogleFontsCssUrl'
) {
  if (!localSettings.value) {
    return;
  }

  if (!family) {
    localSettings.value[targetField] = undefined;
    return;
  }

  // Use provided weight or default to 400
  const weightNum: number = weight ?? 400;

  // Only generate URL for Google Fonts (fonts that are in the list)
  const isGoogleFont = allFonts.value.some(f => f.family === family);

  if (isGoogleFont) {
    localSettings.value[targetField] = generateGoogleFontsCssUrl(family, weightNum);
  } else {
    // For non-Google fonts, clear the URL
    localSettings.value[targetField] = undefined;
  }
}

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

// Update Google Fonts CSS URL for user widget
watch([() => localSettings.value?.userFontFamily, () => localSettings.value?.userFontWeight], ([family, weight]) => {
  if (!localSettings.value) {
    return;
  }

  // Font weight is already a number from validation, just use it
  updateGoogleFontsUrl(family, weight, 'userGoogleFontsCssUrl');
}, { immediate: true });

// Update Google Fonts CSS URL for admin panel
watch([() => localSettings.value?.adminFontFamily, () => localSettings.value?.adminFontWeight], ([family, weight]) => {
  if (!localSettings.value) {
    return;
  }

  // Font weight is already a number from validation, just use it
  updateGoogleFontsUrl(family, weight, 'adminGoogleFontsCssUrl');
}, { immediate: true });
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

      <div class="font-section">
        <h3>Font Settings</h3>

        <div class="font-widget-section">
          <h4>User Widget</h4>

          <label class="font-control">
            <span class="font-control-label">Font Family</span>
            <FontFamilyDropdown
              v-model="localSettings.userFontFamily"
              :options="fontOptions"
              placeholder="Default (sans-serif)"
              :disabled="fontsLoading"
            />
          </label>

          <label class="font-control">
            <span class="font-control-label">Font Weight</span>
            <select
              v-model="localSettings.userFontWeight"
              class="input select"
            >
              <option
                v-for="weight in availableUserFontWeights"
                :key="weight.value"
                :value="weight.value"
              >
                {{ weight.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="font-widget-section">
          <h4>Admin Panel</h4>

          <label class="font-control">
            <span class="font-control-label">Font Family</span>
            <FontFamilyDropdown
              v-model="localSettings.adminFontFamily"
              :options="fontOptions"
              placeholder="Default (sans-serif)"
              :disabled="fontsLoading"
            />
          </label>

          <label class="font-control">
            <span class="font-control-label">Font Weight</span>
            <select
              v-model="localSettings.adminFontWeight"
              class="input select"
            >
              <option
                v-for="weight in availableAdminFontWeights"
                :key="weight.value"
                :value="weight.value"
              >
                {{ weight.label }}
              </option>
            </select>
          </label>
        </div>

        <span v-if="fontsLoading" class="font-loading">Loading fonts...</span>
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

.bad-words-section,
.font-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.bad-words-section h3,
.font-section h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
}

.font-widget-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;

  h4 {
    margin: 0 0 .75rem 0;
    font-size: .9rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  &:last-child {
    margin-bottom: 0;
  }
}

.font-control {
  display: flex;
  flex-direction: column;
  gap: .5rem;
}

.font-control-label {
  font-size: .9rem;
  color: var(--text-muted);
}

.select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right .5rem center;
  padding-right: 2rem;
  cursor: pointer;
}

.font-loading {
  font-size: .85rem;
  color: var(--text-muted);
  font-style: italic;
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


