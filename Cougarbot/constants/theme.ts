/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Baby blue and beige color scheme
const babyBlue = '#B0E0E6';
const babyBlueDark = '#87CEEB';
const beige = '#F5E6D3';
const beigeDark = '#E8D5C4';
const tintColorLight = babyBlueDark;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#2C3E50',
    background: '#FFFFFF',
    tint: '#5FA8D3', // Slightly deeper blue for better contrast
    icon: '#8B7355', // Beige-brown
    tabIconDefault: '#A0A0A0',
    tabIconSelected: '#5FA8D3',
    primary: babyBlueDark,
    secondary: beige,
    accent: '#87CEEB',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    primary: babyBlue,
    secondary: beigeDark,
    accent: '#87CEEB',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
