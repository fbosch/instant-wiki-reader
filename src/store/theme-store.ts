import { proxy, subscribe } from 'valtio';

export type FontFamily = 'sans' | 'serif';
export type ColorTheme = 'light' | 'sepia' | 'dark' | 'black';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';

interface ThemeState {
  fontFamily: FontFamily;
  fontSize: number; // 0.8 to 1.4
  lineHeight: number; // 1.4 to 2.0
  colorTheme: ColorTheme;
  contentWidth: ContentWidth;
  centerContent: boolean;
}

// Load from localStorage
function loadThemeFromStorage(): ThemeState {
  if (typeof window === 'undefined') {
    return {
      fontFamily: 'sans',
      fontSize: 1.0,
      lineHeight: 1.6,
      colorTheme: 'dark',
      contentWidth: 'wide',
      centerContent: true,
    };
  }

  try {
    const stored = localStorage.getItem('theme-settings');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Provide defaults for new properties if not present
      return {
        fontFamily: parsed.fontFamily || 'sans',
        fontSize: parsed.fontSize || 1.0,
        lineHeight: parsed.lineHeight || 1.6,
        colorTheme: parsed.colorTheme || 'dark',
        contentWidth: parsed.contentWidth || 'wide',
        centerContent: parsed.centerContent !== undefined ? parsed.centerContent : true,
      };
    }
  } catch (error) {
    console.error('Failed to load theme settings:', error);
  }

  return {
    fontFamily: 'sans',
    fontSize: 1.0,
    lineHeight: 1.6,
    colorTheme: 'dark',
    contentWidth: 'wide',
    centerContent: true,
  };
}

// Create Valtio store
export const themeStore = proxy<ThemeState>(loadThemeFromStorage());

// Subscribe to changes and save to localStorage
if (typeof window !== 'undefined') {
  subscribe(themeStore, () => {
    try {
      localStorage.setItem('theme-settings', JSON.stringify(themeStore));
    } catch (error) {
      console.error('Failed to save theme settings:', error);
    }
  });
}

// Action functions
export function setFontFamily(family: FontFamily) {
  themeStore.fontFamily = family;
}

export function setFontSize(size: number) {
  themeStore.fontSize = size;
}

export function setLineHeight(height: number) {
  themeStore.lineHeight = height;
}

export function setColorTheme(theme: ColorTheme) {
  themeStore.colorTheme = theme;
}

export function setContentWidth(width: ContentWidth) {
  themeStore.contentWidth = width;
}

export function setCenterContent(center: boolean) {
  themeStore.centerContent = center;
}

// Content width values in pixels (max-width)
export const contentWidthValues = {
  narrow: '45rem',   // ~720px - optimal for reading
  medium: '65rem',   // ~1040px - comfortable
  wide: '90rem',     // ~1440px - spacious
  full: '100%',      // Full width
} as const;

// Theme configurations for different color themes
export const colorThemes = {
  light: {
    bg: '#ffffff',
    text: '#111827',      // Much darker for better contrast
    secondary: '#4b5563', // Darker gray for secondary text
    border: '#d1d5db',    // Slightly darker border
    code: '#f9fafb',      // Very light gray for inputs
    mermaid: 'default',
    highlight: 'github',
  },
  sepia: {
    bg: '#f4ecd8',
    text: '#3d2f1f',      // Much darker brown for better contrast
    secondary: '#6b5744', // Darker for better readability
    border: '#c9b896',    // Darker border
    code: '#ebe1d0',
    mermaid: 'neutral',
    highlight: 'a11y-light',
  },
  dark: {
    bg: '#1e293b',
    text: '#e2e8f0',
    secondary: '#94a3b8',
    border: '#334155',
    code: '#0f172a',
    mermaid: 'dark',
    highlight: 'github-dark',
  },
  black: {
    bg: '#000000',
    text: '#ffffff',
    secondary: '#a1a1a1',
    border: '#262626',
    code: '#0a0a0a',
    mermaid: 'dark',
    highlight: 'github-dark',
  },
} as const;
