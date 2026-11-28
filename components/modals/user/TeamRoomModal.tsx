"use client";

import React, { useEffect, useState } from "react";
import { Users, X, Trash2 } from "lucide-react";

interface TeamMember {
  _id?: string;
  userId: string;
  role: string;
  roomId?: string;
}

interface TeamRoomModalProps {
  isOpen: boolean;
  memberIdInput: string;
  onMemberIdChange: (value: string) => void;
  memberRoleInput: string;
  onMemberRoleChange: (value: string) => void;
  onRoomConnected?: (roomId: string) => void;
  onCancel: () => void;
}

export default function TeamRoomModal({
  isOpen,
  memberIdInput,
  onMemberIdChange,
  memberRoleInput,
  onMemberRoleChange,
  onRoomConnected,
  onCancel,
}: TeamRoomModalProps) {
  const [users, setUsers] = useState<TeamMember[]>([]);
  const [roomName, setRoomName] = useState("default");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`/api/database/userdatabase?roomId=${encodeURIComponent(roomName || "default")}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load team members");
        return res.json();
      })
      .then((data) => {
        setUsers(Array.isArray(data?.users) ? data.users : []);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setError("Unable to load team members");
        }
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [isOpen, roomName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUser = memberIdInput.trim();
    const selectedRole = memberRoleInput || "Viewer";

    if (!trimmedUser) {
      setError("Please enter a GitHub username.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/database/userdatabase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: trimmedUser,
          role: selectedRole,
          roomId: roomName.trim() || "default",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Failed to add team member");
      }

      if (data?.user) {
        setUsers((prev) => {
          const filtered = prev.filter((u) => u.userId !== data.user.userId);
          return [data.user, ...filtered];
        });
      }
      onMemberIdChange("");
      onMemberRoleChange("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save member");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveMember = async (memberId?: string) => {
    if (!memberId) return;
    try {
      const res = await fetch(`/api/database/userdatabase?id=${encodeURIComponent(memberId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u._id !== memberId));
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-room-modal-title"
        className="relative bg-zinc-950 text-zinc-200 border border-zinc-800 rounded-xl p-6 w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-emerald-500 via-cyan-500 to-blue-500" />

        <div className="flex items-start justify-between mb-2">
          <h3
            id="team-room-modal-title"
            className="text-lg font-mono text-zinc-200 flex items-center gap-2"
          >
            <Users size={18} className="text-emerald-500" />
            Join Team Room
          </h3>
          <button
            type="button"
            aria-label="Close team room modal"
            onClick={onCancel}
            className="p-1 text-zinc-500 hover:text-zinc-200 rounded transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-5">
          Add a team member&apos;s GitHub username and role, or connect to the collaborative room.
        </p>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs font-mono text-red-400">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label
            htmlFor="team-room-id-input"
            className="block text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-1"
          >
            Room Name
          </label>
          <input
            id="team-room-id-input"
            className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 font-mono text-xs outline-none focus:border-emerald-500/50"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="default"
          />
        </div>

        {isLoading ? (
          <p className="text-xs font-mono text-zinc-500 mb-4">Loading members...</p>
        ) : users.length > 0 ? (
          <ul className="mb-4 max-h-32 overflow-y-auto overscroll-contain space-y-1.5">
            {users.map((member) => (
              <li
                key={member._id || member.userId}
                className="flex items-center justify-between text-xs text-zinc-300 bg-zinc-900/60 px-3 py-1.5 rounded border border-zinc-800/60"
              >
                <span>
                  <span className="font-semibold text-emerald-400">{member.userId}</span> -{" "}
                  <span className="text-cyan-400">{member.role}</span>
                </span>
                {member._id && (
                  <button
                    type="button"
                    aria-label={`Remove ${member.userId}`}
                    onClick={() => handleRemoveMember(member._id)}
                    className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="team-member-username" className="sr-only">
            GitHub Username
          </label>
          <input
            id="team-member-username"
            autoFocus
            className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-lg px-4 py-2.5 text-zinc-200 font-mono text-sm mb-4 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-zinc-600"
            placeholder="Enter GitHub Username..."
            value={memberIdInput}
            onChange={(e) => onMemberIdChange(e.target.value)}
          />

          <label htmlFor="team-member-role" className="sr-only">
            Member Role
          </label>
          <select
            id="team-member-role"
            className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-lg px-4 py-2.5 text-zinc-200 font-mono text-sm mb-6 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
            value={memberRoleInput}
            onChange={(e) => onMemberRoleChange(e.target.value)}
          >
            <option value="" disabled>
              Select Role...
            </option>
            <option value="Editor">Editor</option>
            <option value="Viewer">Viewer</option>
          </select>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-xs font-mono text-zinc-400 hover:bg-zinc-900 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!memberIdInput.trim() || !memberRoleInput || isSaving}
              className="px-4 py-2 rounded-lg text-xs font-mono bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold cursor-pointer"
            >
              {isSaving ? "Adding..." : "Add Member"}
            </button>
            <button
              type="button"
              onClick={() => onRoomConnected?.(roomName.trim() || "default")}
              className="px-4 py-2 rounded-lg text-xs font-mono bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition-colors font-semibold cursor-pointer"
            >
              Connect to Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
