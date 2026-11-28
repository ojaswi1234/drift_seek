import React from 'react';
import { Moon, SunMedium } from 'lucide-react';

export default function TerminalDropdown({
  currentMode,
  onModeChange,
}: {
  currentMode: 'dark' | 'light';
  onModeChange: (mode: 'dark' | 'light') => void;
}) {
  const isDark = currentMode === 'dark';
  const nextMode = isDark ? 'light' : 'dark';
  const ActiveIcon = isDark ? Moon : SunMedium;

  return (
    <div
      className={`flex items-center border-r shrink-0 ${
        isDark ? 'border-zinc-800/60' : 'border-zinc-200'
      }`}
    >
      <button
        type="button"
        onClick={() => onModeChange(nextMode)}
        aria-pressed={isDark}
        className={`flex items-center gap-2 px-4 py-1.5 text-xs font-mono bg-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer ${
          isDark
            ? 'text-zinc-300 hover:bg-zinc-800/40'
            : 'text-zinc-800 hover:bg-zinc-100'
        }`}
      >
        <ActiveIcon size={14} className={isDark ? 'text-cyan-400' : 'text-amber-500'} />
        <span>{isDark ? 'Dark Mode' : 'Light Mode'}</span>
      </button>
    </div>
  );
}
