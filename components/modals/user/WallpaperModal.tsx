"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Upload, Check, Trash2 } from "lucide-react";

interface Wallpaper {
  _id: string;
  image: string;
  isActive: boolean;
}

interface WallpaperModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onWallpaperUpdated: () => void;
}

export default function WallpaperModal({ isOpen, onCancel, onWallpaperUpdated }: WallpaperModalProps) {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchWallpapers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/wallpaper");
      if (res.ok) {
        const data = await res.json();
        setWallpapers(data.wallpapers || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchWallpapers();
    }
  }, [isOpen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result;
      if (typeof base64 === "string") {
        setIsLoading(true);
        try {
          const res = await fetch("/api/wallpaper", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64 }),
          });
          if (res.ok) {
            await fetchWallpapers();
            onWallpaperUpdated();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoading(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSetActive = async (id: string) => {
    try {
      const res = await fetch("/api/wallpaper", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "setActive" }),
      });
      if (res.ok) {
        await fetchWallpapers();
        onWallpaperUpdated();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/wallpaper", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchWallpapers();
        onWallpaperUpdated();
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0c0c0c] border border-zinc-800/80 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 bg-zinc-900/40">
          <div>
            <h2 className="text-sm font-mono text-zinc-200">Terminal Wallpapers</h2>
            <p className="text-xs text-zinc-500 mt-1">Manage global backgrounds for the terminal</p>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="mb-6 flex justify-between items-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono rounded border border-zinc-700 transition flex items-center gap-2"
            >
              <Upload size={14} /> Upload New Wallpaper
            </button>
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
            />
          </div>

          {isLoading && wallpapers.length === 0 ? (
            <p className="text-xs font-mono text-zinc-500 text-center py-8">Loading...</p>
          ) : wallpapers.length === 0 ? (
            <p className="text-xs font-mono text-zinc-500 text-center py-8">No wallpapers uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {wallpapers.map(wp => (
                <div key={wp._id} className={`relative group rounded-lg overflow-hidden border-2 transition-all ${wp.isActive ? 'border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'border-zinc-800 hover:border-zinc-600'}`}>
                  <div className="relative aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={wp.image} alt="Wallpaper" className="w-full h-full object-cover" />
                    
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      {!wp.isActive && (
                        <button 
                          onClick={() => handleSetActive(wp._id)}
                          className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-mono rounded flex items-center gap-1"
                        >
                          <Check size={12} /> Set Active
                        </button>
                      )}
                      <button 
                        onClick={() => handleDelete(wp._id)}
                        className="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-mono rounded flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>

                    {wp.isActive && (
                      <div className="absolute top-2 right-2 bg-emerald-500 text-white rounded-full p-1 shadow-md">
                        <Check size={12} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}