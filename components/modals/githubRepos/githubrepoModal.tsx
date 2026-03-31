import React, { useEffect, useState } from 'react'
import "./githubrepo.css"
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Github } from 'lucide-react';



interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const GithubRepoModal = ({ isOpen, onClose }: GithubRepoModalProps) => {

    const { status } = useSession({
        required: true,
        onUnauthenticated() {
          redirect("/");
        },
      });

      const[repos, setRepos] = useState([]);
      const[loading, setLoading] = useState(false);


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

    useEffect(() => {
      if (isOpen && status === "authenticated") {
        setLoading(true);
        fetch("/api/github/repos")
          .then(async (response) => {
            const data = await response.json();
            setRepos(data);
            setLoading(false);
          })
          .catch(err => {
            console.error("Error fetching repos:", err);
            setLoading(false);
          });
      } else if (isOpen) {
        setRepos([]);
        setLoading(false);
      }
    }, [isOpen, status]);
    
    if (!isOpen) return null;
  return (
    <div className="modal backdrop-blur-md">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          ×
        </span>
        <div className="p-6 w-full h-full">
        <div className="flex flex-col items-center gap-3 mb-6 w-full h-full">
          <h2 className='font-bold text-xl'>Choose Github Repo you want to containerise</h2>
         <input placeholder="Search repositories..." className="outline-none rounded p-2 mb-4 border-b-2 border-b-black mt-5" />
          <div className="flex flex-col scrollbtn overflow-y-auto w-full h-full p-2 ">
            {
              loading ? (
                <p className="text-gray-600 animate-pulse">Loading repositories...</p>
              ) : (
                repos.length > 0 ? (
                  repos.map((repo: any) => (

                  <div key={repo.id} className="py-4 px-5 border rounded mb-2 cursor-pointer hover:bg-gray-100 cardShadow flex flex-row gap-3 items-center">
                    <Github size={24} />
                    <h3 className="text-lg font-semibold">{repo.name}</h3>
                    {/* <p className="text-sm text-gray-600">{repo.description}</p> */}
                  </div>
                ))
              ) : (
                <p>No repositories found.</p>
              )
              )
            }
         
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

export default GithubRepoModal;