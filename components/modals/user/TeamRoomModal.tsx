"use client";

import React, { useState, useEffect } from "react";
import { Users } from "lucide-react";

interface TeamRoomModalProps {
  isOpen: boolean;
  teamId: string;
  memberIdInput: string;
  onMemberIdChange: (value: string) => void;
  memberRoleInput: string,
  onMemberRoleChange: (value: string) => void;
  onCancel: () => void;
  onMemberAdded?: () => void;
}

export default function TeamRoomModal({
  isOpen,
  teamId,
  memberIdInput,
  onMemberIdChange,
  memberRoleInput,
  onMemberRoleChange,
  onCancel,
  onMemberAdded,
}: TeamRoomModalProps) {

  const [user, setUsers] = useState<{ id: string; role: string }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !teamId) return;

    const fetchMembers = async () => {
      try {
        const res = await fetch(`/api/database/userdatabase?teamId=${encodeURIComponent(teamId)}`);
        if (!res.ok) return;
        const data = await res.json();
        setUsers(
          (data.members || []).map((m: { userId: string; role: string }) => ({
            id: m.userId,
            role: m.role,
          })),
        );
      } catch (err) {
        console.error("Failed to load team members:", err);
      }
    };

    fetchMembers();
  }, [isOpen, teamId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberIdInput.trim() || !memberRoleInput) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/database/userdatabase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, userId: memberIdInput, role: memberRoleInput }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to add member");
      }

      setUsers((prev) => [...prev, { id: memberIdInput, role: memberRoleInput }]);
      onMemberIdChange("");
      onMemberRoleChange("");
      onMemberAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 w-95 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-emerald-500 via-cyan-500 to-blue-500" />

        <h3 className="text-lg font-mono text-zinc-200 mb-1 flex items-center gap-2">
          <Users size={18} className="text-emerald-500" />
          Join Team Room
        </h3>
        <p className="text-xs text-zinc-500 mb-6">
          Add Team member's github username & role to your workspace and collaborate in real-time.
        </p>

        <ul className="mb-4">
          {user.map((u, index) => (
            <li key={index} className="text-xs text-zinc-400 mb-1">
              <span className="font-semibold text-emerald-500">{u.id}</span> - <span className="text-cyan-500">{u.role}</span>
            </li>
          ))}
        </ul>

        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-lg px-4 py-2.5 text-zinc-200 font-mono text-sm mb-6 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-zinc-700"
            placeholder="Enter Github Username...."
            value={memberIdInput}
            onChange={(e) => onMemberIdChange(e.target.value)}
          />
          <select
            className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-lg px-4 py-2.5 text-zinc-200 font-mono text-sm mb-6 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-zinc-700"
            value={memberRoleInput}
            onChange={(e) => onMemberRoleChange(e.target.value)}
          >
            <option value="" disabled>Select Role....</option>
            <option value="Editor">Editor</option>
            <option value="Viewer">Viewer</option>
          </select>

          {error && <p className="text-xs text-red-400 mb-4 font-mono">{error}</p>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-xs font-mono text-zinc-400 hover:bg-zinc-900 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!memberIdInput.trim() || !memberRoleInput || isSaving}
              className="px-4 py-2 rounded-lg text-xs font-mono bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {isSaving ? "Adding..." : "Connect to Room"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}