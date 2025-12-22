import { watch, onMounted, onUnmounted } from 'vue';

import type { ChatSettings, WidgetType } from '@shared/shared-types';

import { generateGoogleFontsCssUrl } from '@/composables/useGoogleFonts';

let loadedFontLinkId: string | null = null;
let loadedUsernameFontLinkId: string | null = null;

/**
 * Load Google Fonts CSS dynamically
 */
function loadGoogleFontsCss(url: string, targetLinkId: 'main' | 'username'): string | null {
  const linkIdVar = targetLinkId === 'main' ? loadedFontLinkId : loadedUsernameFontLinkId;

  // Remove previously loaded font link if exists
  if (linkIdVar) {
    const existingLink = document.getElementById(linkIdVar);

    if (existingLink) {
      existingLink.remove();
    }

    if (targetLinkId === 'main') {
      loadedFontLinkId = null;
    } else {
      loadedUsernameFontLinkId = null;
    }
  }

  if (!url) {
    return null;
  }

  // Check if link already exists
  const existingLink = document.querySelector(`link[href="${url}"]`) as HTMLLinkElement | null;

  if (existingLink) {
    const linkId = existingLink.id || `google-font-${Date.now()}`;
    if (!existingLink.id) {
      existingLink.id = linkId;
    }

    if (targetLinkId === 'main') {
      loadedFontLinkId = linkId;
    } else {
      loadedUsernameFontLinkId = linkId;
    }

    return linkId;
  }

  // Create and append link element
  const link = document.createElement('link');
  const linkId = `google-font-${Date.now()}`;
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = url;
  link.crossOrigin = 'anonymous';

  document.head.appendChild(link);

  if (targetLinkId === 'main') {
    loadedFontLinkId = linkId;
  } else {
    loadedUsernameFontLinkId = linkId;
  }

  return linkId;
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
    root.style.removeProperty('--font-style');
    root.style.removeProperty('--font-stretch');
    root.style.removeProperty('--chat-line-height');
    root.style.removeProperty('--username-font-family');
    root.style.removeProperty('--username-font-weight');
    root.style.removeProperty('--username-font-style');
    root.style.removeProperty('--username-font-stretch');
    root.style.removeProperty('--chat-scale');
    root.style.removeProperty('--admin-scale');
    return;
  }

  // Determine which font settings to use
  const fontOption = widgetType === 'user' ? settings.userFont : settings.adminFont;

  // Apply chat scale (for user widget)
  if (widgetType === 'user' && settings.chatScale !== undefined) {
    root.style.setProperty('--chat-scale', String(settings.chatScale));
  } else {
    root.style.removeProperty('--chat-scale');
  }

  // Apply admin scale (for admin panel)
  if (widgetType === 'admin' && settings.adminScale !== undefined) {
    root.style.setProperty('--admin-scale', String(settings.adminScale));
  } else {
    root.style.removeProperty('--admin-scale');
  }

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

  // Apply font stretch (width)
  if (fontOption?.selectedStyle?.width !== undefined) {
    root.style.setProperty('--font-stretch', `${fontOption.selectedStyle.width}%`);
  } else {
    root.style.removeProperty('--font-stretch');
  }

  // Apply line height
  if (settings.userLineHeight !== undefined) {
    const lineHeight = widgetType === 'user' ? settings.userLineHeight : settings.adminLineHeight;
    root.style.setProperty('--chat-line-height', `${lineHeight}rem`);
  } else {
    root.style.removeProperty('--chat-line-height');
  }

  // Apply username font settings (only for user widget)
  if (widgetType === 'user' && settings.usernameFont) {
    root.style.setProperty('--username-font-family', `'${settings.usernameFont.family}', sans-serif`);

    if (settings.usernameFont.selectedStyle?.weight !== undefined) {
      root.style.setProperty('--username-font-weight', String(settings.usernameFont.selectedStyle.weight));
    } else {
      root.style.removeProperty('--username-font-weight');
    }

    if (settings.usernameFont.selectedStyle?.style !== undefined) {
      root.style.setProperty('--username-font-style', String(settings.usernameFont.selectedStyle.style));
    } else {
      root.style.removeProperty('--username-font-style');
    }

    if (settings.usernameFont.selectedStyle?.width !== undefined) {
      root.style.setProperty('--username-font-stretch', `${settings.usernameFont.selectedStyle.width}%`);
    } else {
      root.style.removeProperty('--username-font-stretch');
    }

    // Load Google Fonts CSS if it's a Google font
    if (settings.usernameFont.type === 'google') {
      const googleFontsCssUrl = generateGoogleFontsCssUrl(settings.usernameFont);
      loadGoogleFontsCss(googleFontsCssUrl, 'username');
    } else if (loadedUsernameFontLinkId) {
      // Remove font link if no Google font is selected
      const existingLink = document.getElementById(loadedUsernameFontLinkId);

      if (existingLink) {
        existingLink.remove();
      }

      loadedUsernameFontLinkId = null;
    }
  } else {
    // Reset username font properties
    root.style.removeProperty('--username-font-family');
    root.style.removeProperty('--username-font-weight');
    root.style.removeProperty('--username-font-style');
    root.style.removeProperty('--username-font-stretch');
  }

  // Load Google Fonts CSS if it's a Google font
  if (fontOption?.type === 'google') {
    const googleFontsCssUrl = generateGoogleFontsCssUrl(fontOption);
    loadGoogleFontsCss(googleFontsCssUrl, 'main');
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

    if (loadedUsernameFontLinkId) {
      const existingLink = document.getElementById(loadedUsernameFontLinkId);

      if (existingLink) {
        existingLink.remove();
      }

      loadedUsernameFontLinkId = null;
    }
  });
}

