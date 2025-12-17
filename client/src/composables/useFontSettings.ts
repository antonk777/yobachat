import { watch, onMounted, onUnmounted } from 'vue';

import type { ChatSettings, WidgetType } from '@shared/shared-types';

import { generateGoogleFontsCssUrl } from '@/composables/useGoogleFonts';

let loadedFontLinkId: string | null = null;

/**
 * Load Google Fonts CSS dynamically
 */
function loadGoogleFontsCss(url: string): void {
  // Remove previously loaded font link if exists
  if (loadedFontLinkId) {
    const existingLink = document.getElementById(loadedFontLinkId);

    if (existingLink) {
      existingLink.remove();
    }

    loadedFontLinkId = null;
  }

  if (!url) {
    return;
  }

  // Check if link already exists
  const existingLink = document.querySelector(`link[href="${url}"]`);

  if (existingLink) {
    loadedFontLinkId = existingLink.id || `google-font-${Date.now()}`;
    return;
  }

  // Create and append link element
  const link = document.createElement('link');
  link.id = `google-font-${Date.now()}`;
  link.rel = 'stylesheet';
  link.href = url;
  link.crossOrigin = 'anonymous';

  document.head.appendChild(link);
  loadedFontLinkId = link.id;
}

/**
 * Apply font settings to CSS variables
 */
function updateFontSettings(settings: ChatSettings | null, widgetType: WidgetType = 'user'): void {
  const root = document.documentElement;

  if (!settings) {
    // Reset to defaults
    root.style.removeProperty('--font-family');
    root.style.removeProperty('--font-weight');
    root.style.removeProperty('--chat-line-height');
    return;
  }

  // Determine which font settings to use
  const fontOption = widgetType === 'user' ? settings.userFont : settings.adminFont;

  // Apply font family
  if (fontOption?.family) {
    root.style.setProperty('--font-family', `'${fontOption.family}', sans-serif`);
  } else {
    root.style.removeProperty('--font-family');
  }

  // Apply font weight
  if (fontOption?.selectedStyle?.weight !== undefined) {
    root.style.setProperty('--font-weight', String(fontOption.selectedStyle.weight));
  } else {
    root.style.removeProperty('--font-weight');
  }

  // Apply font style
  if (fontOption?.selectedStyle?.style !== undefined) {
    root.style.setProperty('--font-style', String(fontOption.selectedStyle.style));
  } else {
    root.style.removeProperty('--font-style');
  }

  // Apply line height
  if (settings.userLineHeight !== undefined) {
    const lineHeight = widgetType === 'user' ? settings.userLineHeight : settings.adminLineHeight;
    root.style.setProperty('--chat-line-height', `${lineHeight}rem`);
  } else {
    root.style.removeProperty('--chat-line-height');
  }

  // Load Google Fonts CSS if it's a Google font
  if (fontOption?.type === 'google') {
    const googleFontsCssUrl = generateGoogleFontsCssUrl(fontOption);
    loadGoogleFontsCss(googleFontsCssUrl);
  } else if (loadedFontLinkId) {
    // Remove font link if no Google font is selected
    const existingLink = document.getElementById(loadedFontLinkId);

    if (existingLink) {
      existingLink.remove();
    }

    loadedFontLinkId = null;
  }
}

/**
 * Composable to apply font settings
 */
export function useFontSettings(settings: () => ChatSettings | null, widgetType: WidgetType = 'user') {
  // Apply settings initially and when they change
  watch(settings, (newSettings) => {
    updateFontSettings(newSettings, widgetType);
  }, { immediate: true });

  // Apply on mount
  onMounted(() => {
    updateFontSettings(settings(), widgetType);
  });

  // Cleanup on unmount
  onUnmounted(() => {
    if (loadedFontLinkId) {
      const existingLink = document.getElementById(loadedFontLinkId);

      if (existingLink) {
        existingLink.remove();
      }

      loadedFontLinkId = null;
    }
  });
}

