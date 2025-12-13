<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { ref, computed, watch } from 'vue';


export interface FontOption {
  value: string;
  label: string;
  style?: Record<string, string>;
}

interface Props {
  modelValue?: string;
  options: FontOption[];
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select...',
  disabled: false
});

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined];
}>();

const
  isOpen = ref(false),
  search = ref(''),
  dropdownRef = ref<HTMLElement | null>(null),
  searchInputRef = ref<HTMLInputElement | null>(null);

// Filter options based on search query
const filteredOptions = computed(() => {
  if (!search.value.trim()) {
    return props.options;
  }

  const query = search.value.toLowerCase().trim();

  return props.options.filter(option =>
    option.label.toLowerCase().includes(query)
  );
});

// Get display value for selected option
const displayValue = computed(() => {
  if (!props.modelValue) {
    return props.placeholder;
  }

  const selected = props.options.find(opt => opt.value === props.modelValue);

  return selected?.label || props.placeholder;
});

function selectOption(option: FontOption) {
  emit('update:modelValue', option.value);
  isOpen.value = false;
  search.value = '';
}

function toggleDropdown() {
  if (props.disabled) {
    return;
  }

  isOpen.value = !isOpen.value;

  if (isOpen.value && searchInputRef.value) {
    // Focus search input when opening
    searchInputRef.value.focus();
  } else {
    search.value = '';
  }
}

function closeDropdown() {
  isOpen.value = false;
  search.value = '';
}

// Handle keyboard navigation
function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleDropdown();
    }
    return;
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      closeDropdown();
      break;
    case 'Enter':
      event.preventDefault();

      if (filteredOptions.value.length > 0) {
        selectOption(filteredOptions.value[0]);
      }

      break;
  }
}

onClickOutside(dropdownRef, () => {
  closeDropdown();
});

// Close dropdown when disabled
watch(() => props.disabled, (disabled) => {
  if (disabled) {
    closeDropdown();
  }
});
</script>

<template>
  <div
    ref="dropdownRef"
    class="font-family-dropdown"
    :class="{ 'is-open': isOpen, 'is-disabled': disabled }"
  >
    <button
      type="button"
      class="dropdown-trigger"
      :disabled="disabled"
      @click="toggleDropdown"
      @keydown="handleKeydown"
    >
      <span class="dropdown-value" :style="options.find(opt => opt.value === modelValue)?.style">
        {{ displayValue }}
      </span>
      <span class="dropdown-arrow">▼</span>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu">
        <div class="dropdown-search">
          <input
            ref="searchInputRef"
            v-model="search"
            type="text"
            class="search-input"
            placeholder="Search fonts..."
            @keydown.escape="closeDropdown"
          />
        </div>

        <div class="dropdown-options">
          <button
            v-if="!modelValue"
            type="button"
            class="dropdown-option selected"
            @click="selectOption({ value: '', label: placeholder })"
          >
            {{ placeholder }}
          </button>

          <button
            v-for="option in filteredOptions"
            :key="option.value"
            type="button"
            class="dropdown-option"
            :class="{ selected: option.value === modelValue }"
            :style="option.style"
            @click="selectOption(option)"
          >
            {{ option.label }}
          </button>

          <div v-if="filteredOptions.length === 0" class="dropdown-empty">
            No fonts found
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.font-family-dropdown {
  position: relative;
  width: 100%;
}

.dropdown-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  color: var(--text-color);
  font-size: 1rem;
  cursor: pointer;
  transition: border-color 0.2s;

  &:hover:not(:disabled) {
    border-color: var(--primary-color);
  }

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }

  &:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
}

.dropdown-value {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-arrow {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  transition: transform 0.2s;

  .is-open & {
    transform: rotate(180deg);
  }
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dropdown-search {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border-color);
}

.search-input {
  width: 100%;
  padding: 0.5rem;
  background-color: var(--bg-color-dark);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  color: var(--text-color);
  font-size: 0.9rem;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}

.dropdown-options {
  flex: 1;
  overflow-y: auto;
  max-height: 250px;
  padding: 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-color-dark);
}

.dropdown-option {
  width: 100%;
  padding: 0.5rem;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 0.95rem;
  cursor: pointer;
  border-radius: 0.25rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--bg-color-dark);
  }

  &.selected {
    background-color: var(--primary-color);
    color: var(--text-color);
  }
}

.dropdown-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Transition animations */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-0.5rem);
}

.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}
</style>
