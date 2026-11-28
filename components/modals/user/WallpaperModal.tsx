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

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // 1.5MB raw (~2MB base64)

export default function WallpaperModal({
  isOpen,
  onCancel,
  onWallpaperUpdated,
}: WallpaperModalProps) {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  const fetchWallpapers = async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallpaper", { signal });
      if (!res.ok) throw new Error("Failed to load wallpapers");
      const data = await res.json();
      setWallpapers(data.wallpapers || []);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.error(e);
      setError("Failed to fetch wallpapers");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetchWallpapers(controller.signal);
    return () => controller.abort();
  }, [isOpen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Only PNG, JPEG, WEBP, or GIF images are allowed.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Image file must be 1.5 MB or smaller.");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result;
      if (typeof base64 !== "string") return;
      setIsLoading(true);
      try {
        const res = await fetch("/api/wallpaper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "Failed to upload wallpaper");
        }
        await fetchWallpapers();
        onWallpaperUpdated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload wallpaper");
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSetActive = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/wallpaper", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "setActive" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to activate wallpaper");
      }
      await fetchWallpapers();
      onWallpaperUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update wallpaper");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/wallpaper", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to delete wallpaper");
      }
      await fetchWallpapers();
      onWallpaperUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete wallpaper");
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallpaper-modal-title"
        className="relative bg-[#0c0c0c] text-zinc-200 border border-zinc-800/80 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 bg-zinc-900/40">
          <div>
            <h2 id="wallpaper-modal-title" className="text-sm font-mono text-zinc-200">
              Terminal Wallpapers
            </h2>
            <p className="text-xs text-zinc-400 mt-1">Manage your private terminal backgrounds</p>
          </div>
          <button
            type="button"
            aria-label="Close wallpaper dialog"
            onClick={onCancel}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto overscroll-contain">
          {error && (
            <div className="mb-4 p-3 rounded bg-red-950/40 border border-red-800/60 text-xs font-mono text-red-400">
              {error}
            </div>
          )}

          <div className="mb-6 flex justify-between items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-mono rounded border border-zinc-700 transition flex items-center gap-2 cursor-pointer"
            >
              <Upload size={14} /> Upload New Wallpaper
            </button>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </div>

          {isLoading && wallpapers.length === 0 ? (
            <p className="text-xs font-mono text-zinc-500 text-center py-8">Loading...</p>
          ) : wallpapers.length === 0 ? (
            <p className="text-xs font-mono text-zinc-500 text-center py-8">
              No wallpapers uploaded yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {wallpapers.map((wp) => (
                <div
                  key={wp._id}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                    wp.isActive
                      ? "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="relative aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={wp.image} alt="Wallpaper" className="w-full h-full object-cover" />

                    <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      {!wp.isActive && (
                        <button
                          type="button"
                          disabled={busyId === wp._id}
                          onClick={() => handleSetActive(wp._id)}
                          className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-mono rounded flex items-center gap-1 cursor-pointer"
                        >
                          <Check size={12} /> Set Active
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === wp._id}
                        onClick={() => handleDelete(wp._id)}
                        className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-mono rounded flex items-center gap-1 cursor-pointer"
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
