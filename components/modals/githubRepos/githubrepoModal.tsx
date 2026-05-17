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
  onSelectRepo: (url: string, branches?: string[]) => void; 
  repos: GitHubRepo[]; 
  isLoading: boolean;
}

export default function GithubRepoModal({ isOpen, onClose, onSelectRepo, repos, isLoading }: GithubRepoModalProps) {
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
            
            {/* Repository List */}
            <div className="overflow-y-auto space-y-3 pr-2 scrollbtn flex-1 min-h-[40vh]">
              {isLoading ? (
                 <div className="flex flex-col items-center justify-center py-12 text-gray-400 animate-pulse">
                    <GitFork size={32} className="mb-3 opacity-50" />
                    <span className="text-sm tracking-widest uppercase font-bold">Fetching GitHub Data...</span>
                 </div>
              ) : filteredRepos.length === 0 ? (
                 <div className="text-center py-12 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                    No repositories found matching your search.
                 </div>
              ) : (
                filteredRepos.map((repo) => {
                  const targetUrl = `https://github.com/${repo.owner.login}/${repo.name}`;

                  return (
                    <button
                      key={repo.id}
                      onClick={() => handleRepoSelect(repo)}
                      className="w-full flex flex-col text-left p-4 bg-white border border-gray-200 hover:border-black hover:shadow-md transition-all rounded-lg group"
                    >
                      <div className="flex justify-between items-start mb-1.5 w-full">
                        <span className="text-black font-bold text-sm flex items-center gap-2">
                          {repo.private && <Lock size={14} className="text-gray-400" />}
                          {repo.name}
                        </span>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                           <span className="flex items-center gap-1">
                             <Star size={14} className="text-gray-400 group-hover:text-yellow-500 transition-colors"/> 
                             {repo.stargazers_count}
                           </span>
                           <span className="flex items-center gap-1">
                             <GitFork size={14} className="text-gray-400"/> 
                             {repo.forks_count}
                           </span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 font-mono truncate w-full group-hover:text-gray-800 transition-colors">
                        {targetUrl}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            
            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end shrink-0">
                <button 
                  onClick={onClose}
                  className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-sm uppercase tracking-widest transition-colors font-bold rounded-lg"
                >
                  Cancel
                </button>
            </div>
          </div>
        )}
      </div>

      <GithubBranchSelectionModal
        isOpen={isBranchModalOpen && Boolean(selectedRepoRef)}
        repo={selectedRepoRef}
        onClose={() => setIsBranchModalOpen(false)}
        onBack={returnToRepoList}
        onConfirm={(branches) => {
          if (!selectedRepoRef) return;
          const targetUrl = `https://github.com/${selectedRepoRef.owner.login}/${selectedRepoRef.name}`;
          onSelectRepo(targetUrl, branches);
          onClose();
        }}
      />
    </div>
  );
}

function GithubBranchSelectionModal({
  isOpen,
  repo,
  onClose,
  onBack,
  onConfirm,
}: {
  isOpen: boolean;
  repo: GitHubRepo | null;
  onClose: () => void;
  onBack: () => void;
  onConfirm: (branches: string[]) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || !repo) return;

    let cancelled = false;

    const loadBranches = async () => {
      setIsFetchingBranches(true);
      setBranches([]);
      setSelectedBranches([]);

      try {
        const res = await fetch(`/api/gitbranch?owner=${repo.owner.login}&repo=${repo.name}`);
        if (!res.ok) {
          throw new Error("Failed to fetch branches");
        }

        const data = await res.json();
        if (!cancelled) {
          setBranches(data.map((branch: any) => branch.name));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error fetching branches:", error);
        }
      } finally {
        if (!cancelled) {
          setIsFetchingBranches(false);
        }
      }
    };

    loadBranches();

    return () => {
      cancelled = true;
    };
  }, [isOpen, repo]);

  useEffect(() => {
    if (!isOpen) {
      setBranches([]);
      setSelectedBranches([]);
      setIsFetchingBranches(false);
    }
  }, [isOpen]);

  if (!isOpen || !repo) return null;

  const handleBranchClick = (branch: string) => {
    if (selectedBranches.includes(branch)) {
      setSelectedBranches(selectedBranches.filter((selectedBranch) => selectedBranch !== branch));
      return;
    }

    if (selectedBranches.length < 2) {
      setSelectedBranches([...selectedBranches, branch]);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-200 p-6 rounded-2xl w-full max-w-4xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans text-black flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold font-orbitron tracking-wide text-black">
              Select Branches: {repo.name}
            </h2>
            <p className="text-xs text-gray-500 font-mono mt-1">{repo.owner.login}/{repo.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          <p className="text-sm text-gray-600 mb-4 shrink-0">
            Please choose exactly 2 branches to compare. ({selectedBranches.length}/2 selected)
          </p>

          <div className="overflow-y-auto space-y-2 pr-2 scrollbtn flex-1 min-h-0">
            {isFetchingBranches ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 animate-pulse">
                <span className="text-sm tracking-widest uppercase font-bold">Fetching Branches...</span>
              </div>
            ) : branches.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                No branches found for this repository.
              </div>
            ) : (
              branches.map((branch) => {
                const isSelected = selectedBranches.includes(branch);

                return (
                  <button
                    key={branch}
                    onClick={() => handleBranchClick(branch)}
                    className={`w-full text-left p-3 border rounded-lg transition-all ${
                      isSelected
                        ? 'border-black bg-gray-50 font-bold'
                        : 'border-gray-200 hover:border-black'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <GitFork size={16} className={isSelected ? 'text-black' : 'text-gray-400'} />
                      {branch}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between shrink-0">
            <button
              onClick={onBack}
              className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-sm uppercase tracking-widest transition-colors font-bold rounded-lg"
            >
              Back
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-6 py-2.5 text-gray-500 hover:text-black text-sm uppercase tracking-widest transition-colors font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(selectedBranches)}
                disabled={selectedBranches.length !== 2}
                className={`px-6 py-2.5 text-sm uppercase tracking-widest transition-colors font-bold rounded-lg ${
                  selectedBranches.length === 2
                    ? 'bg-black text-white hover:bg-gray-800'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}