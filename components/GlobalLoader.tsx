'use client'
import React, { useEffect, useState } from 'react';
import { Terminal, Box, GitMerge, Monitor, Database, Cloud, Activity, Cpu } from 'lucide-react';

type GlobalLoaderProps = {
  text?: string;
};

const GlobalLoader = ({ text = "AUTHENTICATING" }: GlobalLoaderProps) => {
  const [mounted, setMounted] = useState(false);

  // Ensure component only renders on client to prevent hydration errors
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-md overflow-hidden pointer-events-auto">
      <style>{`
        @keyframes scale-hole {
          0% { transform: scale(2); opacity: 0; box-shadow: 0px 0px 50px rgba(255, 255, 255, 0.5); }
          50% { transform: scale(1) translate(0px, -5px); opacity: 1; box-shadow: 0px 8px 20px rgba(255, 255, 255, 0.5); }
          100% { transform: scale(0.1) translate(0px, 5px); opacity: 0; box-shadow: 0px 10px 20px rgba(255, 255, 255, 0); }
        }

        @keyframes suck-in {
          0% { transform: translate(var(--start-x), var(--start-y)) scale(1.2) rotate(0deg); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translate(0px, 0px) scale(0) rotate(360deg); opacity: 0; }
        }

        .hole-ring {
          display: block;
          position: absolute;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          opacity: 0;
          animation: scale-hole 3s linear infinite;
        }

        .vortex-icon {
          position: absolute;
          color: #a1a1aa;
          animation: suck-in 3.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>

      <div className="relative w-24 h-24 mb-8 flex items-center justify-center">
        {/* Vortex Icons */}
        {[
          { icon: Terminal, x: '0px', y: '-140px', delay: '0s' },
          { icon: Box, x: '100px', y: '-100px', delay: '0.4s' },
          { icon: GitMerge, x: '140px', y: '0px', delay: '0.8s' },
          { icon: Monitor, x: '100px', y: '100px', delay: '1.2s' },
          { icon: Database, x: '0px', y: '140px', delay: '1.6s' },
          { icon: Cloud, x: '-100px', y: '100px', delay: '2.0s' },
          { icon: Activity, x: '-140px', y: '0px', delay: '2.4s' },
          { icon: Cpu, x: '-100px', y: '-100px', delay: '2.8s' },
        ].map((item, idx) => (
          <div 
            key={idx}
            className="vortex-icon"
            style={{ 
              '--start-x': item.x, 
              '--start-y': item.y, 
              animationDelay: item.delay 
            } as React.CSSProperties}
          >
            <item.icon size={20} strokeWidth={1.5} />
          </div>
        ))}

        {/* Black Hole Core */}
        <div className="relative flex items-center justify-center">
          {[...Array(10)].map((_, i) => (
            <i key={i} className="hole-ring" style={{ animationDelay: `${(i + 1) * 0.3}s` }} />
          ))}
        </div>
      </div>

      {/* Loading Text */}
      <div className="flex gap-1 text-[10px] font-mono tracking-[0.3em] text-zinc-400 uppercase">
        <span>{text}</span>
        <span className="animate-pulse" style={{ animationDelay: '0s' }}>.</span>
        <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
        <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
      </div>
    </div>
  );
};

export default GlobalLoader;