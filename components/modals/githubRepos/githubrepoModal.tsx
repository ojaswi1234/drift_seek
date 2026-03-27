import React, { useEffect } from 'react'
import "../webserver/webserver.css"

interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const GithubRepoModal = ({ isOpen, onClose }: GithubRepoModalProps) => {
     useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            onClose();
          }
        };
    
        if (isOpen) {
          document.addEventListener("keydown", handleEscape);
        }
    
        return () => {
          document.removeEventListener("keydown", handleEscape);
        };
      }, [isOpen, onClose]);
    
    if (!isOpen) return null;
  return (
    <div className="modal backdrop-blur-md">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          ×
        </span>
        <div className="p-6">
         
        </div>
      </div>
    </div>
  )
}

export default GithubRepoModal;