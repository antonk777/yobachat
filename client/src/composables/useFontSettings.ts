import { watch, onMounted, onUnmounted } from 'vue';
import type { ChatSettings, WidgetType } from '@shared/shared-types';

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
    return;
  }

  // Determine which font settings to use
  const fontFamily = widgetType === 'user' ? settings.userFontFamily : settings.adminFontFamily;

  const fontWeight = widgetType === 'user' ? settings.userFontWeight : settings.adminFontWeight;

  const googleFontsCssUrl = widgetType === 'user'
    ? settings.userGoogleFontsCssUrl
    : settings.adminGoogleFontsCssUrl;

  // Apply font family
  if (fontFamily) {
    root.style.setProperty('--font-family', `'${fontFamily}', sans-serif`);
  } else {
    root.style.removeProperty('--font-family');
  }

  // Apply font weight (already validated as number)
  if (fontWeight !== undefined) {
    root.style.setProperty('--font-weight', String(fontWeight));
  } else {
    root.style.removeProperty('--font-weight');
  }

  // Load Google Fonts CSS if URL is provided
  if (googleFontsCssUrl) {
    loadGoogleFontsCss(googleFontsCssUrl);
  } else if (loadedFontLinkId) {
    // Remove font link if no URL is provided
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

