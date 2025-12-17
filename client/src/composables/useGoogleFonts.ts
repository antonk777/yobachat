import { ref, onMounted } from 'vue';

import type { FontFamily, FontOption } from '@shared/shared-types';

import { kSharedConfig } from '@/config';

const
  fonts = ref<FontFamily[]>([]),
  isLoading = ref(false),
  error = ref<string | null>(null);

/**
 * Fetch Google Fonts list from the backend API
 * The backend fetches from Google Fonts to circumvent CORS restrictions
 */
async function fetchGoogleFonts(): Promise<void> {
  isLoading.value = true;
  error.value = null;

  try {
    const apiUrl = `https://${kSharedConfig.apiHost}${kSharedConfig.basePath}fonts`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch fonts: ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Fonts API returned unexpected data');
    }

    fonts.value = data;
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
