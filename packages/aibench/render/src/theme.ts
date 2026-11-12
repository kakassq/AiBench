import {
  FONT_STACK,
  MONO_STACK,
  type Look,
  type Palette,
} from './storyboard';

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] {
  const h = String(hex ?? '').replace('#', '').trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length < 6) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Perceptual-ish luminance in 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** `hex` with an alpha channel applied. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

export type Theme = {
  palette: Palette;
  look: Look;
  /** canvas size */
  w: number;
  h: number;
  /** true for 1080×1920 */
  vertical: boolean;
  /** outer margin */
  pad: number;
  /** true when the background is light (captions invert) */
  light: boolean;
  /** display face */
  display: string;
  /** mono face */
  mono: string;
  /** hairline colour used for rules and grids */
  rule: string;
  /** secondary text colour */
  dim: string;
};

export function makeTheme(
  palette: Palette,
  look: Look,
  w: number,
  h: number,
): Theme {
  const vertical = h > w;
  const light = luminance(palette.bg) > 0.5;
  return {
    palette,
    look,
    w,
    h,
    vertical,
    pad: vertical ? Math.round(w * 0.075) : Math.round(w * 0.0625),
    light,
    display: FONT_STACK,
    mono: MONO_STACK,
    rule: light ? alpha(palette.fg, 0.22) : alpha(palette.fg, 0.18),
    dim: light ? alpha(palette.fg, 0.62) : alpha(palette.fg, 0.58),
  };
}

/** Uppercase letterspaced label style used by every look. */
export function labelStyle(theme: Theme, size: number, color?: string) {
  return {
    fontFamily: theme.mono,
    fontSize: size,
    letterSpacing: size * 0.18,
    textTransform: 'uppercase' as const,
    color: color ?? theme.dim,
    fontWeight: 500,
  };
}
