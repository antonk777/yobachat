import { ref, onMounted, computed } from 'vue';

import type { FontFamily, FontStyle, FontWeight } from '@shared/shared-types';

/**
 * Weight detection patterns ordered by specificity (most specific first)
 */
const kWeightPatterns: Array<{ patterns: string[]; weight: FontWeight }> = [
  {
    patterns: ['thin'],
    weight: 100
  },
  {
    patterns: ['extra light', 'extralight', 'ultra light', 'ultralight'],
    weight: 200
  },
  {
    patterns: ['light'],
    weight: 300
  },
  {
    patterns: ['regular', 'normal', 'book'],
    weight: 400
  },
  {
    patterns: ['medium'],
    weight: 500
  },
  {
    patterns: ['semi bold', 'semibold', 'demi bold', 'demibold'],
    weight: 600
  },
  {
    patterns: ['bold'],
    weight: 700
  },
  {
    patterns: ['extra bold', 'extrabold', 'ultra bold', 'ultrabold'],
    weight: 800
  },
  {
    patterns: ['black', 'heavy'],
    weight: 900
  }
];

/**
 * Convert font weight style names to FontStyle
 */
function styleNameToFontStyle(style: string): FontStyle {
  const normalized = style.toLowerCase();
  const isItalic = normalized.includes('italic') || normalized.includes('oblique');

  // Find matching weight pattern
  const weightMatch = kWeightPatterns.find(({ patterns }) =>
    patterns.some(pattern => normalized.includes(pattern))
  );

  const weight = weightMatch?.weight ?? 400; // Default to 400 if no match

  return {
    weight,
    style: isItalic ? 'italic' : 'normal'
  };
}

/**
 * Check if queryLocalFonts API is supported
 */
function checkSupport(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

/**
 * Composable to access local fonts
 */
export function useLocalFonts() {
  const
    allVariants = ref<Array<{ family: string; style: string }>>([]),
    isLoading = ref(false),
    error = ref<string | null>(null),
    isSupported = ref(checkSupport());

  // Convert allVariants to FontFamily[] format
  const fontFamilies = computed<FontFamily[]>(() => {
    if (allVariants.value.length === 0) {
      return [];
    }

    // Group variants by family and collect unique styles
    const familyMap = new Map<string, Map<string, FontStyle>>();

    for (const variant of allVariants.value) {
      const fontStyle = styleNameToFontStyle(variant.style);
      const styleKey = `${fontStyle.weight}-${fontStyle.style}`;

      if (!familyMap.has(variant.family)) {
        familyMap.set(variant.family, new Map());
      }

      // Store FontStyle object directly, using key for uniqueness
      familyMap.get(variant.family)!.set(styleKey, fontStyle);
    }

    // Convert to FontFamily[] and sort styles
    return Array.from(familyMap.entries())
      .map(([family, stylesMap]): FontFamily => {
        const styles = Array.from(stylesMap.values()).sort((a, b) => {
          // Sort by weight first, then by style (normal before italic)
          if (a.weight !== b.weight) return a.weight - b.weight;
          return a.style === 'normal' ? -1 : 1;
        });

        return {
          type: 'local',
          family,
          styles
        };
      })
      .sort((a, b) => a.family.localeCompare(b.family));
  });

  /**
   * Query local fonts from the user's system
   * Requires user permission on first use
   */
  async function queryLocalFonts(): Promise<void> {
    if (!checkSupport()) {
      error.value = 'Local Font Access API is not supported in this browser';
      isSupported.value = false;
      return;
    }

    isSupported.value = true;
    isLoading.value = true;
    error.value = null;

    try {
      // Type assertion needed as TypeScript may not have the types
      const fontDataArray = await (window as any).queryLocalFonts();

      // Store all variants
      allVariants.value = fontDataArray.map((fontData: any) => ({
        family: fontData.family,
        style: fontData.style
      }));
    } catch (err) {
      console.error('Failed to query local fonts:', err);
      error.value = err instanceof Error ? err.message : 'Unknown error';
      allVariants.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  onMounted(() => {
    // Only query if supported
    if (isSupported.value) {
      queryLocalFonts();
    }
  });

  return {
    fontOptions: fontFamilies,
    isLoading,
    error,
    queryLocalFonts
  };
}
