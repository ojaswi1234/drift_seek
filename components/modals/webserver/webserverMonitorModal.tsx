import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import "./webserver.css";

interface WebserverMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const WebserverMonitorModal = ({
  isOpen,
  onClose,
  onSuccess,
}: WebserverMonitorModalProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setUrl("");
      setError(null);
      setIsSubmitting(false);
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (!trimmedName || !trimmedUrl) {
      setError("Please fill in both monitor name and URL.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, url: trimmedUrl }),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : null;

      if (res.status === 409) {
        setError("This URL is already being monitored!");
        return;
      }

      if (!res.ok) {
        throw new Error(data?.details || data?.message || `Request failed (${res.status})`);
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while saving the monitor.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal backdrop-blur-md" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-monitor-title"
        className="modal-content text-black"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close modal"
          className="close p-1 text-gray-500 hover:text-black transition-colors"
          onClick={onClose}
        >
          <X size={20} />
        </button>

        <form onSubmit={handleSubmit} className="p-2 sm:p-4">
          <h2 id="add-monitor-title" className="text-2xl font-bold mb-2 text-black">
            Add New Monitor
          </h2>
          <p className="text-gray-600 text-sm mb-5">
            Enter the details of the website you want to track.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-xs font-mono text-red-700">
              {error}
            </div>
          )}

          <label htmlFor="monitor-name-input" className="block text-xs font-mono uppercase text-gray-600 mb-1">
            Monitor Name
          </label>
          <input
            id="monitor-name-input"
            type="text"
            placeholder="Primary API"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2.5 border border-gray-300 rounded mb-4 text-black bg-white outline-none focus:border-black"
          />

          <label htmlFor="monitor-url-input" className="block text-xs font-mono uppercase text-gray-600 mb-1">
            Target URL
          </label>
          <input
            id="monitor-url-input"
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full p-2.5 border border-gray-300 rounded mb-5 text-black bg-white outline-none focus:border-black"
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-black text-white py-2.5 rounded uppercase tracking-widest text-sm hover:bg-zinc-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isSubmitting ? "Saving..." : "Save Monitor"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default WebserverMonitorModal;
