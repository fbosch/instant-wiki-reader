'use client';

import { Menu, MenuButton, MenuItems } from '@headlessui/react';
import { Type, AlignCenter, RectangleHorizontal } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { 
  themeStore, 
  setFontFamily, 
  setFontSize, 
  setLineHeight, 
  setColorTheme,
  setContentWidth,
  setCenterContent,
  colorThemes,
  type ColorTheme,
  type ContentWidth,
} from '@/store/theme-store';

export function ThemeSettings() {
  const { fontFamily, fontSize, lineHeight, colorTheme, contentWidth, centerContent } = useSnapshot(themeStore);
  const theme = colorThemes[colorTheme];

  return (
    <Menu>
      {({ open }) => (
        <>
          <MenuButton 
            className="p-2 rounded transition-colors flex-shrink-0 hover:opacity-70"
            style={{ color: theme.text }}
          >
            <Type className="w-4 h-4" />
          </MenuButton>

          <MenuItems
            anchor="bottom start"
            className="w-80 rounded-lg shadow-xl focus:outline-none z-50 origin-top-left transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
            style={{ 
              maxHeight: 'calc(100vh - 100px)', 
              overflowY: 'auto',
              backgroundColor: theme.bg,
              borderColor: theme.border,
              border: `1px solid ${theme.border}`,
              marginTop: '8px',
            }}
          >
          {/* Header */}
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${theme.border}` }}>
            <h3 className="text-sm font-semibold" style={{ color: theme.text }}>
              Reader Settings
            </h3>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Font Family */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: theme.text }}>
                Font
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFontFamily('sans')}
                  className="p-3 rounded-lg border-2 transition-all"
                  style={{
                    borderColor: fontFamily === 'sans' ? '#3b82f6' : theme.border,
                    backgroundColor: fontFamily === 'sans' ? (colorTheme === 'light' ? '#eff6ff' : colorTheme === 'sepia' ? '#f0e8d8' : '#1e3a8a20') : 'transparent'
                  }}
                >
                  <div className="font-sans text-3xl" style={{ color: theme.text }}>Aa</div>
                  <div className="mt-1 text-xs font-medium" style={{ color: theme.secondary }}>Sans</div>
                </button>
                <button
                  onClick={() => setFontFamily('serif')}
                  className="p-3 rounded-lg border-2 transition-all"
                  style={{
                    borderColor: fontFamily === 'serif' ? '#3b82f6' : theme.border,
                    backgroundColor: fontFamily === 'serif' ? (colorTheme === 'light' ? '#eff6ff' : colorTheme === 'sepia' ? '#f0e8d8' : '#1e3a8a20') : 'transparent'
                  }}
                >
                  <div className="font-serif text-3xl" style={{ color: theme.text }}>Aa</div>
                  <div className="mt-1 text-xs font-medium" style={{ color: theme.secondary }}>Serif</div>
                </button>
              </div>
            </div>

            {/* Font Size */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium mb-2" style={{ color: theme.text }}>
                <span>Font Size</span>
                <span style={{ color: theme.secondary }}>{Math.round(fontSize * 100)}%</span>
              </label>
              <div className="flex items-center gap-3">
                <Type className="w-3 h-3 flex-shrink-0" style={{ color: theme.secondary }} />
                <input
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.05"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseFloat(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  style={{ backgroundColor: theme.code }}
                />
                <Type className="w-5 h-5 flex-shrink-0" style={{ color: theme.secondary }} />
              </div>
            </div>

            {/* Line Height */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium mb-2" style={{ color: theme.text }}>
                <span>Line Spacing</span>
                <span style={{ color: theme.secondary }}>{lineHeight.toFixed(1)}</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                </div>
                <input
                  type="range"
                  min="1.4"
                  max="2.0"
                  step="0.1"
                  value={lineHeight}
                  onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  style={{ backgroundColor: theme.code }}
                />
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: theme.secondary }}></div>
                </div>
              </div>
            </div>

            {/* Color Theme */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: theme.text }}>
                Color Theme
              </label>
              <div className="flex gap-2">
                {(['light', 'sepia', 'dark', 'black'] as ColorTheme[]).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => setColorTheme(theme)}
                    className={`
                      w-10 h-10 rounded-full border-2 transition-all
                      ${colorTheme === theme
                        ? 'border-blue-500 scale-110'
                        : 'border-slate-200 dark:border-slate-700 hover:scale-105'
                      }
                    `}
                    style={{
                      backgroundColor: 
                        theme === 'light' ? '#ffffff' :
                        theme === 'sepia' ? '#f4ecd8' :
                        theme === 'dark' ? '#334155' :
                        '#000000'
                    }}
                    title={theme.charAt(0).toUpperCase() + theme.slice(1)}
                  />
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="h-px" style={{ backgroundColor: theme.border }} />

            {/* Content Width */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium mb-2" style={{ color: theme.text }}>
                <span>Content Width</span>
                <span style={{ color: theme.secondary }}>
                  {contentWidth.charAt(0).toUpperCase() + contentWidth.slice(1)}
                </span>
              </label>
              <div className="flex items-center gap-3">
                <RectangleHorizontal className="w-3 h-3 flex-shrink-0" style={{ color: theme.secondary }} />
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="1"
                  value={
                    contentWidth === 'narrow' ? 0 :
                    contentWidth === 'medium' ? 1 :
                    contentWidth === 'wide' ? 2 : 3
                  }
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    const widths: ContentWidth[] = ['narrow', 'medium', 'wide', 'full'];
                    setContentWidth(widths[value]);
                  }}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  style={{ backgroundColor: theme.code }}
                />
                <RectangleHorizontal className="w-5 h-5 flex-shrink-0" style={{ color: theme.secondary }} />
              </div>
            </div>

            {/* Center Content */}
            <div>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-medium" style={{ color: theme.text }}>
                  Center Content
                </span>
                <button
                  onClick={() => setCenterContent(!centerContent)}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                  style={{ backgroundColor: centerContent ? '#3b82f6' : theme.border }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      centerContent ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
              <p className="text-xs mt-1" style={{ color: theme.secondary }}>
                Centers the content horizontally when enabled
              </p>
            </div>
          </div>
        </MenuItems>
        </>
      )}
    </Menu>
  );
}
