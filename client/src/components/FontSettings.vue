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

  // Find matching style with the new weight, prefer current style (normal/italic) and width if available
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

  // Find matching style with current weight and new style, preserve width if possible
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

function updateFontWidth(width: number | undefined, targetField: FontField): void {
  const currentFont = props.modelValue[targetField];

  if (!currentFont) {
    return;
  }

  // Create updated style with the new width directly from current style
  const updatedStyle = {
    weight: currentFont.selectedStyle.weight,
    style: currentFont.selectedStyle.style,
    width
  }

  emit('update:modelValue', {
    ...props.modelValue,
    [targetField]: {
      ...currentFont,
      selectedStyle: updatedStyle
    }
  });
}

function updateFontWidthFromNumber(value: number | null, targetField: FontField): void {
  if (value === null) {
    updateFontWidth(undefined, targetField);
    return;
  }

  // Clamp value between 50 and 200
  const clampedValue = clamp(value, 50, 200);

  updateFontWidth(clampedValue, targetField);
}

function getFontWidthNumber(font: FontOption | null): number {
  return font?.selectedStyle.width ?? 100;
}

const debouncedUpdateFontWidth = useDebounceFn((
  value: number | null,
  targetField: FontField
): void => {
  updateFontWidthFromNumber(value, targetField);
}, 300);

function handleFontWidthInput(
  event: Event,
  targetField: FontField
): void {
  const input = event.target as HTMLInputElement | null;

  if (!input) {
    return;
  }

  const value = input.value === '' ? null : parseInt(input.value, 10);

  if (value === null || !isNaN(value)) {
    debouncedUpdateFontWidth(value, targetField);
  }
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
        <div class="switch-group" v-if="availableUserWeights.length > 0">
          <button
            v-for="weight in availableUserWeights"
            :key="weight"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.userFont.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'userFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="switch-group" v-if="availableUserStyles.length > 0">
          <button
            v-if="availableUserStyles.includes('normal')"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.userFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'userFont')"
          >
            Normal
          </button>
          <button
            v-if="availableUserStyles.includes('italic')"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.userFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'userFont')"
          >
            Italic
          </button>
        </div>

        <label v-if="modelValue.userFont" class="numeric-control">
          Font Width
          <input
            type="number"
            :min="50"
            :max="200"
            :step="1"
            :value="getFontWidthNumber(modelValue.userFont)"
            @input="(event: Event) => handleFontWidthInput(event, 'userFont')"
          />
          %
        </label>
      </template>

      <label class="numeric-control">
        Line height
        <input
          type="number"
          :min="kLineHeightMin"
          :max="kLineHeightMax"
          :step="1"
          :value="(modelValue.userLineHeight ?? kDefaultLineHeight) * kLineHeightFactor"
          @input="(event: Event) => handleLineHeightInput(event, 'userLineHeight')"
        />
        %
      </label>
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
            class="switch-option"
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
            class="switch-option"
            :class="{ active: modelValue.usernameFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'usernameFont')"
          >
            Normal
          </button>
          <button
            v-if="availableUsernameStyles.includes('italic')"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.usernameFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'usernameFont')"
          >
            Italic
          </button>
        </div>

        <label v-if="modelValue.usernameFont" class="numeric-control">
          Font Width
          <input
            type="number"
            :min="50"
            :max="200"
            :step="1"
            :value="getFontWidthNumber(modelValue.usernameFont)"
            @input="(event: Event) => handleFontWidthInput(event, 'usernameFont')"
          />
          %
        </label>
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
        <div class="switch-group" v-if="availableAdminWeights.length > 0">
          <button
            v-for="weight in availableAdminWeights"
            :key="weight"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.adminFont.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'adminFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="switch-group" v-if="availableAdminStyles.length > 0">
          <button
            v-if="availableAdminStyles.includes('normal')"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.adminFont.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'adminFont')"
          >
            Normal
          </button>
          <button
            v-if="availableAdminStyles.includes('italic')"
            type="button"
            class="switch-option"
            :class="{ active: modelValue.adminFont.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'adminFont')"
          >
            Italic
          </button>
        </div>

        <label v-if="modelValue.adminFont" class="numeric-control">
          Font Width
          <input
            type="number"
            :min="50"
            :max="200"
            :step="1"
            :value="getFontWidthNumber(modelValue.adminFont)"
            @input="(event: Event) => handleFontWidthInput(event, 'adminFont')"
          />
          %
        </label>
      </template>

      <label class="numeric-control">
        Line height
        <input
          type="number"
          :min="kLineHeightMin"
          :max="kLineHeightMax"
          :step="1"
          :value="(modelValue.adminLineHeight ?? kDefaultLineHeight) * kLineHeightFactor"
          @input="(event: Event) => handleLineHeightInput(event, 'adminLineHeight')"
        />
        %
      </label>
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
.font-widget-section {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * .75);
  padding: var(--spacing);
  border-top: 1px solid var(--border-color);

  h4 {
    font-weight: 500;
  }
}

.font-control-label {
  font-size: .9rem;
  color: var(--text-muted);
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
