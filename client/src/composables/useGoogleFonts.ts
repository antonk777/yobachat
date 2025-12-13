import { ref, onMounted } from 'vue';

export interface GoogleFont {
  family: string;
  variants: number[];
  subsets: string[];
  category: string;
}

export interface GoogleFontsResponse {
  items: GoogleFont[];
}

const
  fonts = ref<GoogleFont[]>([]),
  isLoading = ref(false),
  error = ref<string | null>(null);

/**
 * Fetch Google Fonts list from the public API
 * Uses the Google Fonts metadata endpoint which doesn't require an API key
 */
async function fetchGoogleFonts(): Promise<void> {
  if (fonts.value.length > 0) {
    return; // Already loaded
  }

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
    if (data.familyMetadataList && Array.isArray(data.familyMetadataList)) {
      fonts.value = data.familyMetadataList.map((font: any) => ({
        family: font.family,
        variants: font.fonts
          ? Object.keys(font.fonts)
              .filter((variant: string) => /^\d+$/.test(variant))
              .map((variant: string) => parseInt(variant, 10))
          : [],
        subsets: font.subsets || [],
        category: font.category || 'sans-serif'
      }));
    } else {
      throw new Error('Google Fonts metadata endpoint failed');
    }
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
 * Generate Google Fonts CSS URL for a font family and weight
 */
export function generateGoogleFontsCssUrl(fontFamily: string, fontWeight: number = 400): string {
  // Replace spaces with + for URL encoding
  const familyParam = fontFamily.replace(/\s+/g, '+');
  const weightParam = fontWeight.toString();

  return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weightParam}&display=swap`;
}

/**
 * Composable to use Google Fonts
 */
export function useGoogleFonts() {
  onMounted(() => {
    fetchGoogleFonts();
  });

  return {
    fonts,
    isLoading,
    error,
    fetchGoogleFonts,
    generateGoogleFontsCssUrl
  };
}
