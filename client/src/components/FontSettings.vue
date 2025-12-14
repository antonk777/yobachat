<script setup lang="ts">
import { computed } from 'vue';

import type { ChatSettings, FontFamily, FontStyle, FontOption } from '@shared/shared-types';

import { useGoogleFonts } from '@/composables/useGoogleFonts';
import { useLocalFonts } from '@/composables/useLocalFonts';

import FontFamilyDropdown from '@/components/FontFamilyDropdown.vue';


interface Props {
  modelValue: ChatSettings;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: ChatSettings];
}>();

const
  { fonts: googleFonts, isLoading: googleFontsLoading, error: googleFontsError } = useGoogleFonts(),
  { fontOptions: localFonts, isLoading: localFontsLoading, error: localFontsError } = useLocalFonts();

// Convert Map to sorted array for dropdown component
const fontOptionsArray = computed<FontFamily[]>(() => {
  return [...googleFonts.value, ...localFonts.value]
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'google' ? -1 : 1;
      }

      return a.family.localeCompare(b.family);
    });
});

// Create unified font options Map keyed by family name
const fontOptionsMap = computed<Map<string, FontFamily>>(() => {
  const fontMap = new Map<string, FontFamily>();

  // Add all fonts to the map (later fonts with same name will overwrite earlier ones)
  for (const font of fontOptionsArray.value) {
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
      return selectedFont.styles.map(s => s.weight).sort((a, b) => a - b);
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
      return selectedFont.styles.map(s => s.weight).sort((a, b) => a - b);
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


// Helper function to create or update FontOption
function setFontWithStyle(
  family: string,
  selectedStyle: FontStyle | null,
  targetField: 'userFont' | 'adminFont'
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
function updateFontFamily(value: string | undefined, targetField: 'userFont' | 'adminFont'): void {
  if (!value) {
    emit('update:modelValue', { ...props.modelValue, [targetField]: null });
    return;
  }

  // Try to preserve current style if switching to same family, otherwise use first available
  const currentFont = props.modelValue[targetField];
  const currentStyle = currentFont?.selectedStyle || null;
  setFontWithStyle(value, currentStyle, targetField);
}

function updateFontWeight(weight: number, targetField: 'userFont' | 'adminFont'): void {
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

function updateFontStyle(style: 'normal' | 'italic', targetField: 'userFont' | 'adminFont'): void {
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
</script>

<template>
  <div class="font-section">
    <h3>Font Settings</h3>

    <div class="font-widget-section">
      <h4>Chat Widget</h4>

      <label class="font-control">
        <span class="font-control-label">Font Family</span>
        <FontFamilyDropdown
          :model-value="modelValue.userFont?.family"
          :options="fontOptionsArray"
          :disabled="googleFontsLoading || localFontsLoading"
          @update:model-value="(value: string | undefined) => updateFontFamily(value, 'userFont')"
        />
      </label>

      <div v-if="modelValue.userFont" class="font-style-controls">
        <div class="button-group">
          <button
            v-for="weight in availableUserWeights"
            :key="weight"
            type="button"
            class="style-button"
            :class="{ active: modelValue.userFont?.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'userFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="button-group">
          <button
            v-if="availableUserStyles.includes('normal')"
            type="button"
            class="style-button"
            :class="{ active: modelValue.userFont?.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'userFont')"
          >
            Normal
          </button>
          <button
            v-if="availableUserStyles.includes('italic')"
            type="button"
            class="style-button"
            :class="{ active: modelValue.userFont?.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'userFont')"
          >
            Italic
          </button>
        </div>
      </div>
    </div>

    <div class="font-widget-section">
      <h4>Admin Panel</h4>

      <label class="font-control">
        <span class="font-control-label">Font Family</span>
        <FontFamilyDropdown
          :model-value="modelValue.adminFont?.family"
          :options="fontOptionsArray"
          :disabled="googleFontsLoading || localFontsLoading"
          @update:model-value="(value: string | undefined) => updateFontFamily(value, 'adminFont')"
        />
      </label>

      <div v-if="modelValue.adminFont" class="font-style-controls">
        <div class="button-group">
          <button
            v-for="weight in availableAdminWeights"
            :key="weight"
            type="button"
            class="style-button"
            :class="{ active: modelValue.adminFont?.selectedStyle.weight === weight }"
            :style="{ '--weight': weight }"
            @click="updateFontWeight(weight, 'adminFont')"
          >
            {{ weight }}
          </button>
        </div>

        <div class="button-group">
          <button
            v-if="availableAdminStyles.includes('normal')"
            type="button"
            class="style-button"
            :class="{ active: modelValue.adminFont?.selectedStyle.style === 'normal' }"
            :style="{ '--style': 'normal' }"
            @click="updateFontStyle('normal', 'adminFont')"
          >
            Normal
          </button>
          <button
            v-if="availableAdminStyles.includes('italic')"
            type="button"
            class="style-button"
            :class="{ active: modelValue.adminFont?.selectedStyle.style === 'italic' }"
            :style="{ '--style': 'italic' }"
            @click="updateFontStyle('italic', 'adminFont')"
          >
            Italic
          </button>
        </div>
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
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

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

.font-style-controls {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
}

.button-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.style-button {
  padding: .375rem .75rem;
  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: .25rem;
  color: var(--text-color);
  font-size: .9rem;
  font-weight: var(--weight, 400);
  font-style: var(--style, normal);
  cursor: pointer;
  transition: all .2s;

  &:hover:not(:disabled) {
    border-color: var(--primary-color);
    background-color: var(--bg-color);
  }

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  &.active {
    background-color: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--text-color);
  }
}

.font-loading {
  font-size: .85rem;
  color: var(--text-muted);
  font-style: italic;
}

.font-error {
  font-size: .85rem;
  color: var(--error-color);
}
</style>
