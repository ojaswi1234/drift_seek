import React from 'react';
import { Moon, SunMedium } from 'lucide-react';

export default function TerminalDropdown({ 
  currentMode,
  onModeChange
}: { 
  currentMode: 'dark' | 'light';
  onModeChange: (mode: 'dark' | 'light') => void;
}) {
  const isDark = currentMode === 'dark';
  const nextMode = isDark ? 'light' : 'dark';
  const ActiveIcon = isDark ? Moon : SunMedium;

  return (
    <div className="flex items-center border-r border-zinc-800/60 shrink-0">
      <button
        onClick={() => onModeChange(nextMode)}
        aria-pressed={isDark}
        className="flex items-center gap-2 px-4 py-1.5 text-xs font-mono bg-transparent hover:bg-zinc-800/40 transition-colors focus:outline-none"
      >
        <ActiveIcon size={14} className={isDark ? 'text-cyan-400' : 'text-amber-500'} />
        <span className="text-zinc-300">{isDark ? 'Dark Mode' : 'Light Mode'}</span>
      </button>
    </div>
  );
}