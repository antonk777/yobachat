import { ref, onMounted } from 'vue';

import type { FontFamily, FontOption, FontStyle, FontWeight } from '@shared/shared-types';

const
  fonts = ref<FontFamily[]>([]),
  isLoading = ref(false),
  error = ref<string | null>(null);

/**
 * Convert font style names to FontStyle
 */
function styleNameToFontStyle(style: string): FontStyle {
  const normalized = style.toLowerCase();

  return {
    weight: parseInt(normalized) as FontWeight,
    style: normalized.includes('i') ? 'italic' : 'normal'
  };
}

/**
 * Fetch Google Fonts list from the public API
 * Uses the Google Fonts metadata endpoint which doesn't require an API key
 */
async function fetchGoogleFonts(): Promise<void> {
  isLoading.value = true;
  error.value = null;

  try {
    // Using the public Google Fonts metadata endpoint
    // This endpoint doesn't require an API key and returns all available fonts
    const response = await fetch('https://fonts.google.com/metadata/fonts');

    if (!response.ok) {
      throw new Error(`Failed to fetch fonts: ${response.statusText}`);
    }

    const data = await response.json();

    // The metadata endpoint returns fonts in a different format
    // It's an object with a "familyMetadataList" array
    if (!data.familyMetadataList || !Array.isArray(data.familyMetadataList)) {
      throw new Error('Google Fonts metadata endpoint failed');
    }

    fonts.value = data.familyMetadataList.map((font: any): FontFamily => ({
      type: 'google',
      family: font.family,
      styles: Object.keys(font.fonts).map(variant => styleNameToFontStyle(variant)),
      subsets: font.subsets || [],
      googlePopularity: font.popularity
    }));
  } catch (err) {
    console.error('Failed to fetch Google Fonts:', err);
    error.value = err instanceof Error ? err.message : 'Unknown error';

    // Fallback: return empty array, user can still type font names manually
    fonts.value = [];
  } finally {
    isLoading.value = false;
  }
}

/**
 * Generate Google Fonts CSS URL for a selected style of a font that looks like this:
 * https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap
 */
export function generateGoogleFontsCssUrl(font: FontOption): string {
  // Replace spaces with + for URL encoding
  const familyNameUrl = font.family.replace(/\s+/g, '+');

  const { weight, style } = font.selectedStyle;

  const isItalic = style === 'italic';

  const familyArg = `${familyNameUrl}:${isItalic ? 'ital,' : ''}wght@${isItalic ? '1,' : ''}${weight}`

  return `https://fonts.googleapis.com/css2?family=${familyArg}&display=swap`;
}

/**
 * Composable to use Google Fonts
 */
export function useGoogleFonts() {
  onMounted(() => {
    if (fonts.value.length === 0) {
      fetchGoogleFonts();
    }
  });

  return {
    fonts,
    isLoading,
    error,
    fetchGoogleFonts,
    generateGoogleFontsCssUrl
  };
}
