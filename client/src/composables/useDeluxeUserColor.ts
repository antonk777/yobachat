import { onMounted, onUnmounted, ref } from 'vue';


// OKLCH color type: [L, C, H] where L is lightness (0-1), C is chroma, H is hue (0-360)
type OklchColor = [number, number, number];


const colorCycleDuration = 90000; // 90 seconds per cycle

// Convert RGB colors to OKLCH
const deluxeUserColors: OklchColor[] = [
  rgbToOklch(107, 248, 213), // #6bf8d5
  rgbToOklch(186, 146, 255), // #ba92ff
  rgbToOklch(255, 136, 196)  // #ff88c4
];

// Convert sRGB to linear RGB
function srgbToLinear(c: number): number {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Convert RGB to OKLab
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  // Convert to linear RGB
  const rLinear = srgbToLinear(r);
  const gLinear = srgbToLinear(g);
  const bLinear = srgbToLinear(b);

  // Convert to OKLab
  const l = 0.4122214708 * rLinear + 0.5363325363 * gLinear + 0.0514459929 * bLinear;
  const m = 0.2119034982 * rLinear + 0.6806995451 * gLinear + 0.1073969566 * bLinear;
  const s = 0.0883024619 * rLinear + 0.2817188376 * gLinear + 0.6299787005 * bLinear;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  ];
}

// Convert OKLab to OKLCH
function oklabToOklch(lab: [number, number, number]): OklchColor {
  const [l, a, b] = lab;
  const c = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [l, c, h];
}

// Convert RGB to OKLCH
function rgbToOklch(r: number, g: number, b: number): OklchColor {
  const lab = rgbToOklab(r, g, b);
  return oklabToOklch(lab);
}

// Format OKLCH as CSS oklch() string
function oklchToString(oklch: OklchColor): string {
  const [l, c, h] = oklch;
  return `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)})`;
}

// Interpolate between two OKLCH colors
function interpolateColor(color1: OklchColor, color2: OklchColor, t: number): string {
  const [l1, c1, h1] = color1;
  const [l2, c2, h2] = color2;

  // Interpolate lightness and chroma linearly
  const l = l1 + (l2 - l1) * t;
  const c = c1 + (c2 - c1) * t;

  // Interpolate hue with shortest path
  let h = h1;
  const hDiff = h2 - h1;
  if (Math.abs(hDiff) > 180) {
    // Take the shorter path around the circle
    h += hDiff > 0 ? hDiff - 360 : hDiff + 360;
    h = h1 + (h - h1) * t;
    if (h < 0) h += 360;
    else if (h >= 360) h -= 360;
  } else {
    h = h1 + hDiff * t;
  }

  return oklchToString([l, c, h]);
}

/**
 * Composable to animate deluxe user color and set it on root element
 */
export function useDeluxeUserColor() {
  const colorAnimationStartTime = ref(0);
  let colorIntervalId: ReturnType<typeof setInterval> | null = null;

  function updateColor() {
    const elapsed = Date.now() - colorAnimationStartTime.value;
    const cycleProgress = (elapsed % colorCycleDuration) / colorCycleDuration;

    // Determine which two colors to interpolate between
    const colorIndex = Math.floor(cycleProgress * deluxeUserColors.length);
    const nextColorIndex = (colorIndex + 1) % deluxeUserColors.length;

    // Calculate interpolation factor (0 to 1) for current color pair
    const segmentProgress = (cycleProgress * deluxeUserColors.length) % 1;

    const color1 = deluxeUserColors[colorIndex];
    const color2 = deluxeUserColors[nextColorIndex];

    const color = interpolateColor(color1, color2, segmentProgress);
    document.documentElement.style.setProperty('--deluxe-user-color', color);
  }

  onMounted(() => {
    colorAnimationStartTime.value = Date.now();
    colorIntervalId = setInterval(updateColor, 500);
    // Update immediately on mount
    updateColor();
  });

  onUnmounted(() => {
    if (colorIntervalId) {
      clearInterval(colorIntervalId);
      colorIntervalId = null;
    }
    // Clean up CSS variable on unmount
    document.documentElement.style.removeProperty('--deluxe-user-color');
  });
}

