"use client";

import React, {useState, useEffect, useRef} from 'react';
import { GitFork, Star, Lock, X } from 'lucide-react';


export interface GitHubRepo {
  id: number;
  name: string;
  owner: { login: string };
  html_url: string;
  private: boolean;
  stargazers_count: number;
  forks_count: number;
}

interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunTest: (githubUrl: string, branches?: string[]) => void; 
  repos: GitHubRepo[]; 
  isLoading: boolean;
}

export default function GithubRepoModal({ isOpen, onClose, onRunTest, repos, isLoading }: GithubRepoModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedRepoRef, setSelectedRepoRef] = useState<GitHubRepo | null>(null);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSelectedRepoRef(null);
      setIsBranchModalOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRepoSelect = async (repo: GitHubRepo) => {
    setSelectedRepoRef(repo);
    setIsBranchModalOpen(true);
  };

  const returnToRepoList = () => {
    setIsBranchModalOpen(false);
    setSelectedRepoRef(null);
  };

  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-200 p-6 rounded-xl w-full max-w-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans text-black flex flex-col max-h-[90vh]">
        
        {/* Header matched to Monitor Page theme */}
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4 shrink-0">
          <h2 className="text-xl font-bold font-orbitron tracking-wide text-black">
            {selectedRepoRef ? `Select Branches: ${selectedRepoRef.name}` : `Select Repository`}
          </h2>
          <button 
            onClick={onClose} 
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {selectedRepoRef ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            <p className="text-sm text-gray-600 mb-4 shrink-0">
              Select a repository to continue into the nested branch selection modal.
            </p>

            <div className="overflow-y-auto space-y-3 pr-2 scrollbtn flex-1 min-h-[40vh]">
              <button
                onClick={() => setIsBranchModalOpen(true)}
                className="w-full p-4 bg-black text-white rounded-lg font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors"
              >
                Open Branch Selection
              </button>
              <button
                onClick={returnToRepoList}
                className="w-full p-4 bg-gray-100 text-black rounded-lg font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
              >
                Choose Another Repository
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-sm uppercase tracking-widest transition-colors font-bold rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <input 
              type="text" 
              placeholder="Search repositories..." 
              className="w-full mb-4 px-4 py-2 border border-gray-200 rounded-lg outline-none shrink-0" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)} 
            />
            
            {isLoading ? (
              <div className="flex justify-center items-center py-8">
                <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 flex-1">
                <GitFork className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm">No repositories found</p>
              </div>
            ) : (
              <div className="overflow-y-auto space-y-2 pr-2 scrollbtn flex-1">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => handleRepoSelect(repo)}
                    className="w-full p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all text-left flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        {repo.private ? <Lock className="w-5 h-5 text-gray-500" /> : <GitFork className="w-5 h-5 text-gray-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{repo.name}</p>
                        <p className="text-xs text-gray-500 truncate">{repo.owner.login} / {repo.html_url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 font-mono flex-shrink-0">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3" /> {repo.stargazers_count}</span>
                      <span className="flex items-center gap-1"><GitFork className="w-3 h-3" /> {repo.forks_count}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}