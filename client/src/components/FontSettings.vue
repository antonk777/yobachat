<script setup lang="ts">
import { computed } from 'vue';

import type { ChatSettings, FontFamily, FontStyle, FontOption, FontStyleName } from '@shared/shared-types';

import { useGoogleFonts } from '@/composables/useGoogleFonts';
import { useLocalFonts } from '@/composables/useLocalFonts';

import FontFamilyDropdown from '@/components/FontFamilyDropdown.vue';
import { clamp, useDebounceFn } from '@vueuse/core';

type FontField = 'userFont' | 'adminFont' | 'usernameFont';

const
  kLineHeightFactor = 100,
  kDefaultLineHeight = 120,
  kLineHeightMin = 80,
  kLineHeightMax = 200;

interface Props {
  modelValue: ChatSettings;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: ChatSettings];
}>();

const {
  fonts: googleFonts,
  isLoading: googleFontsLoading,
  error: googleFontsError
} = useGoogleFonts()

const {
  fontOptions: localFonts,
  isLoading: localFontsLoading,
  error: localFontsError
} = useLocalFonts()

// Convert Map to sorted array for dropdown component
const fontOptionsArray = computed<FontFamily[]>(() => {
  return Array.from(fontOptionsMap.value.values()).sort((a, b) => {
    return a.family.localeCompare(b.family);
  });
});

// Create unified font options Map keyed by family name
const fontOptionsMap = computed<Map<string, FontFamily>>(() => {
  const fontMap = new Map<string, FontFamily>();

  // Add all fonts to the map (later fonts with same name will overwrite earlier ones)
  for (const font of [...googleFonts.value, ...localFonts.value]) {
    fontMap.set(font.family, font);
  }

  return fontMap;
});

// Get available weights for user font
const availableUserWeights = computed(() => {
  const { userFont } = props.modelValue;

  if (userFont) {
    const selectedFont = fontOptionsMap.value.get(userFont.family);

    if (selectedFont) {
      return Array.from(new Set(selectedFont.styles.map(s => s.weight)))
        .sort((a, b) => a - b);
    }
  }

  return [];
});

// Get available styles for user font at current weight
const availableUserStyles = computed(() => {
  const { userFont } = props.modelValue;

  if (userFont) {
    const selectedFont = fontOptionsMap.value.get(userFont.family);

    if (selectedFont) {
      return selectedFont.styles.map(s => s.style);
    }
  }

  return [];
});

// Get available weights for admin font
const availableAdminWeights = computed(() => {
  const { adminFont } = props.modelValue;

  if (adminFont) {
    const selectedFont = fontOptionsMap.value.get(adminFont.family);

    if (selectedFont) {
      return Array.from(new Set(selectedFont.styles.map(s => s.weight)))
        .sort((a, b) => a - b);
    }
  }

  return [];
});

// Get available styles for admin font at current weight
const availableAdminStyles = computed(() => {
  const { adminFont } = props.modelValue;

  if (adminFont) {
    const selectedFont = fontOptionsMap.value.get(adminFont.family);

    if (selectedFont) {
      return selectedFont.styles.map(s => s.style);
    }
  }

  return [];
});

// Get available weights for username font
const availableUsernameWeights = computed(() => {
  const { usernameFont } = props.modelValue;

  if (usernameFont) {
    const selectedFont = fontOptionsMap.value.get(usernameFont.family);

    if (selectedFont) {
      return Array.from(new Set(selectedFont.styles.map(s => s.weight)))
        .sort((a, b) => a - b);
    }
  }

  return [];
});

// Get available styles for username font at current weight
const availableUsernameStyles = computed(() => {
  const { usernameFont } = props.modelValue;

  if (usernameFont) {
    const selectedFont = fontOptionsMap.value.get(usernameFont.family);

    if (selectedFont) {
      return selectedFont.styles.map(s => s.style);
    }
  }

  return [];
});


// Helper function to create or update FontOption
function setFontWithStyle(
  family: string,
  selectedStyle: FontStyle | null,
  targetField: FontField
): void {

  const fontFamily = fontOptionsMap.value.get(family);

  if (!fontFamily) {
    // Clear font if family not found
    emit('update:modelValue', {
      ...props.modelValue,
      [targetField]: null
    });
    return;
  }

  // Use provided style or default to first available style
  const style = selectedStyle || fontFamily.styles[0];

  if (!style) {
    // No styles available, clear font
    emit('update:modelValue', {
      ...props.modelValue,
      [targetField]: null
    });
    return;
  }

  const fontOption: FontOption = {
    ...fontFamily,
    selectedStyle: style
  };

  emit('update:modelValue', {
    ...props.modelValue,
    [targetField]: fontOption
  });
}

// Handler methods for form inputs
function updateFontFamily(value: string | undefined, targetField: FontField): void {
  if (!value) {
    emit('update:modelValue', { ...props.modelValue, [targetField]: null });
    return;
  }

  // Try to preserve current style if switching to same family, otherwise use first available
  const currentFont = props.modelValue[targetField];
  const currentStyle = currentFont?.selectedStyle || null;
  setFontWithStyle(value, currentStyle, targetField);
}

function updateFontWeight(weight: number, targetField: FontField): void {
  const currentFont = props.modelValue[targetField];
  if (!currentFont) {
    return;
  }

  const fontFamily = fontOptionsMap.value.get(currentFont.family);
  if (!fontFamily) {
    return;
  }

  // Find matching style with the new weight, prefer current style (normal/italic) if available
  const currentStyle = currentFont.selectedStyle.style;
  const matchingStyle = fontFamily.styles.find(s => s.weight === weight && s.style === currentStyle)
    || fontFamily.styles.find(s => s.weight === weight)
    || fontFamily.styles[0];

  if (!matchingStyle) {
    return;
  }

  emit('update:modelValue', {
    ...props.modelValue,
    [targetField]: {
      ...currentFont,
      selectedStyle: matchingStyle
    }
  });
}

function updateFontStyle(style: FontStyleName, targetField: FontField): void {
  const currentFont = props.modelValue[targetField];
  if (!currentFont) {
    return;
  }

  const fontFamily = fontOptionsMap.value.get(currentFont.family);
  if (!fontFamily) {
    return;
  }

  // Find matching style with current weight and new style
  const currentWeight = currentFont.selectedStyle.weight;

  const matchingStyle = fontFamily.styles.find(s => s.weight === currentWeight && s.style === style);

  if (!matchingStyle) {
    return;
  }

  emit('update:modelValue', {
    ...props.modelValue,
    [targetField]: {
      ...currentFont,
      selectedStyle: matchingStyle
    }
  });
}

function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return kDefaultLineHeight;
  }

  return clamp(value, kLineHeightMin, kLineHeightMax);
}

function updateLineHeight(value: number, targetField: 'userLineHeight' | 'adminLineHeight'): void {
  const normalizedValue = clampLineHeight(value) / kLineHeightFactor;

  if (isNaN(normalizedValue)) {
    return;
  }

  emit('update:modelValue', {
    ...props.modelValue,
    [targetField]: normalizedValue
  });
}

const debouncedUpdateLineHeight = useDebounceFn((
  value: number,
  targetField: 'userLineHeight' | 'adminLineHeight'
): void => {
  updateLineHeight(value, targetField);
}, 300);

function handleLineHeightInput(
  event: Event,
  targetField: 'userLineHeight' | 'adminLineHeight'
): void {
  const input = event.target as HTMLInputElement | null;

  if (!input) {
    return;
  }

  const value = parseInt(input.value, 10);

  if (!isNaN(value)) {
    debouncedUpdateLineHeight(value, targetField);
  }
}
</script>

<template>
  <div class="font-section">
    <div class="font-widget-section">
      <h4>Chat Widget Font</h4>

      <FontFamilyDropdown
        class="font-control-dropdown"
        :model-value="modelValue.userFont?.family"
        :options="fontOptionsArray"
        :disabled="googleFontsLoading && localFontsLoading"
        @update:model-value="(value: string | undefined) => updateFontFamily(value, 'userFont')"
      />

      <template v-if="modelValue.userFont">
        <div class="switch-group">
          <button
            v-for="weight in availableUserWeights"
            :key="weight"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.userFont.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'userFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="switch-group">
          <button
            v-if="availableUserStyles.includes('normal')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.userFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'userFont')"
          >
            Normal
          </button>
          <button
            v-if="availableUserStyles.includes('italic')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.userFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'userFont')"
          >
            Italic
          </button>
        </div>
      </template>

      <div class="line-height-control">
        <label class="line-height-label" for="user-line-height">Line height</label>
        <input
          id="user-line-height"
          class="line-height-input"
          type="number"
          :min="kLineHeightMin"
          :max="kLineHeightMax"
          :step="1"
          :value="(modelValue.userLineHeight ?? kDefaultLineHeight) * kLineHeightFactor"
          @input="(event: Event) => handleLineHeightInput(event, 'userLineHeight')"
        />
        %
      </div>
    </div>

    <div class="font-widget-section">
      <h4>Chat Widget Username Font</h4>

      <FontFamilyDropdown
        class="font-control-dropdown"
        :model-value="modelValue.usernameFont?.family"
        :options="fontOptionsArray"
        :disabled="googleFontsLoading && localFontsLoading"
        @update:model-value="(value: string | undefined) => updateFontFamily(value, 'usernameFont')"
      />

      <template v-if="modelValue.usernameFont">
        <div class="switch-group">
          <button
            v-for="weight in availableUsernameWeights"
            :key="weight"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.usernameFont.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'usernameFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="switch-group">
          <button
            v-if="availableUsernameStyles.includes('normal')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.usernameFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'usernameFont')"
          >
            Normal
          </button>
          <button
            v-if="availableUsernameStyles.includes('italic')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.usernameFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'usernameFont')"
          >
            Italic
          </button>
        </div>
      </template>
    </div>

    <div class="font-widget-section">
      <h4>Admin Panel Font</h4>

      <FontFamilyDropdown
        class="font-control-dropdown"
        :model-value="modelValue.adminFont?.family"
        :options="fontOptionsArray"
        :disabled="googleFontsLoading && localFontsLoading"
        @update:model-value="(value: string | undefined) => updateFontFamily(value, 'adminFont')"
      />

      <template v-if="modelValue.adminFont">
        <div class="switch-group">
          <button
            v-for="weight in availableAdminWeights"
            :key="weight"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.adminFont.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'adminFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="switch-group">
          <button
            v-if="availableAdminStyles.includes('normal')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.adminFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'adminFont')"
          >
            Normal
          </button>
          <button
            v-if="availableAdminStyles.includes('italic')"
            type="button"
            class="style-switch"
            :class="{ active: modelValue.adminFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'adminFont')"
          >
            Italic
          </button>
        </div>
      </template>

      <div class="line-height-control">
        <label class="line-height-label" for="admin-line-height">Line height</label>
        <input
          id="admin-line-height"
          class="line-height-input"
          type="number"
          :min="kLineHeightMin"
          :max="kLineHeightMax"
          :step="1"
          :value="(modelValue.adminLineHeight ?? kDefaultLineHeight) * kLineHeightFactor"
          @input="(event: Event) => handleLineHeightInput(event, 'adminLineHeight')"
        />
        %
      </div>
    </div>

    <div v-if="googleFontsLoading" class="font-loading">
      Loading Google Fonts...
    </div>
    <div v-else-if="googleFontsError" class="font-error">
      Error loading Google Fonts: {{ googleFontsError }}
    </div>

    <div v-if="localFontsLoading" class="font-loading">
      Loading local fonts...
    </div>
    <div v-else-if="localFontsError" class="font-error">
      Error loading local fonts: {{ localFontsError }}
    </div>
  </div>
</template>

<style scoped>
.font-section {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * 1.5);
}

.font-widget-section {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * .75);

  h4 {
    font-weight: 700;
  }

  &:last-child {
    margin-bottom: 0;
  }
}

.font-control-label {
  font-size: .9rem;
  color: var(--text-muted);
}

.switch-group {
  display: flex;
  flex-wrap: wrap;
}

.style-switch {
  padding: .375rem .75rem;

  background-color: var(--bg-color-dark);
  color: var(--text-color);

  font-size: .9rem;
  font-weight: var(--weight, 400);
  font-style: var(--style, normal);

  cursor: pointer;
  transition: all .2s;

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    background-color: var(--primary-color);
  }

  &.active {
    background-color: var(--primary-color);
    color: var(--text-color);
  }

  &:first-child {
    border-top-left-radius: .25rem;
    border-bottom-left-radius: .25rem;
  }

  &:last-child {
    border-top-right-radius: .25rem;
    border-bottom-right-radius: .25rem;
  }
}

.line-height-control {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing) * .5);
}

.line-height-label {
  flex: none;
  color: var(--text-muted);
}

.line-height-input {
  width: auto;
  field-sizing: content;
  min-width: 4rem;
  max-width: 100%;
  padding: .375rem 0;
  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: .25rem;
  color: var(--text-color);
  font-size: 1rem;
  text-align: center;
}

.font-loading {
  margin-top: var(--spacing);
  font-size: .85rem;
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}

.font-error {
  font-size: .85rem;
  color: var(--error-color);
  text-align: center;
}
</style>
