"use client";

import React, { useState, useEffect, useRef } from 'react';
import { GitFork, Star, Lock, X, GitBranch, Play, RefreshCw } from 'lucide-react';

export interface GitHubRepo {
  id: number;
  name: string;
  owner: { login: string };
  html_url: string;
  private: boolean;
  stargazers_count: number;
  forks_count: number;
}

interface GitHubBranch {
  name: string;
}

interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunTest: (githubUrl: string, branches: string[]) => Promise<void> | void;
  repos: GitHubRepo[];
  isLoading: boolean;
  error?: string | null;
}

export default function GithubRepoModal({
  isOpen,
  onClose,
  onRunTest,
  repos,
  isLoading,
  error,
}: GithubRepoModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [branchSearch, setBranchSearch] = useState('');
  const [selectedRepoRef, setSelectedRepoRef] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const backdropPointerDownRef = useRef(false);
  const branchFetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      branchFetchAbortRef.current?.abort();
      setSearchTerm('');
      setBranchSearch('');
      setSelectedRepoRef(null);
      setBranches([]);
      setBranchError(null);
      setSelectedBranches([]);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const loadBranchesForRepo = async (repo: GitHubRepo) => {
    branchFetchAbortRef.current?.abort();
    const controller = new AbortController();
    branchFetchAbortRef.current = controller;

    setBranches([]);
    setBranchError(null);
    setSelectedBranches([]);
    setBranchSearch('');
    setIsLoadingBranches(true);

    try {
      const res = await fetch(
        `/api/gitbranch?owner=${encodeURIComponent(repo.owner.login)}&repo=${encodeURIComponent(repo.name)}`,
        { signal: controller.signal, cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to fetch branches (${res.status})`);
      }
      const list = Array.isArray(data) ? (data as GitHubBranch[]) : [];
      setBranches(list);
      if (list.length === 0) {
        setBranchError('No branches found for this repository.');
      } else if (list.length === 1) {
        setSelectedBranches([list[0].name]);
        setBranchError('Repository must have at least 2 branches for A/B comparison.');
      } else {
        setSelectedBranches([list[0].name, list[1].name]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setBranchError(err instanceof Error ? err.message : 'Unable to fetch branches');
    } finally {
      if (branchFetchAbortRef.current === controller) {
        setIsLoadingBranches(false);
      }
    }
  };

  const handleRepoSelect = (repo: GitHubRepo) => {
    setSelectedRepoRef(repo);
    loadBranchesForRepo(repo);
  };

  const returnToRepoList = () => {
    branchFetchAbortRef.current?.abort();
    setSelectedRepoRef(null);
    setBranches([]);
    setBranchError(null);
    setSelectedBranches([]);
    setBranchSearch('');
  };

  const handleBranchClick = (branchName: string) => {
    setBranchError(null);
    setSelectedBranches((prev) => {
      if (prev.includes(branchName)) {
        return prev.filter((b) => b !== branchName);
      }
      if (prev.length < 2) {
        return [...prev, branchName];
      }
      // Replace the candidate branch when 2 are already selected
      return [prev[0], branchName];
    });
  };

  const handleStartTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoRef) return;
    if (selectedBranches.length !== 2) {
      setBranchError('Select 2 branches (Baseline A and Candidate B) to run the A/B test.');
      return;
    }
    setIsSubmitting(true);
    setBranchError(null);
    try {
      await onRunTest(selectedRepoRef.html_url, selectedBranches);
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'Failed to start A/B test');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredRepos = repos.filter((repo) =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(branchSearch.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onPointerDown={(e) => {
        backdropPointerDownRef.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        if (backdropPointerDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-repo-modal-title"
        className="relative bg-white border border-gray-200 p-6 rounded-xl w-full max-w-xl shadow-2xl font-sans text-black flex flex-col max-h-[90vh]"
      >
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-4 shrink-0">
          <div className="min-w-0 pr-4">
            <h2
              id="github-repo-modal-title"
              className="text-xl font-bold font-orbitron tracking-wide text-black truncate"
            >
              {selectedRepoRef ? `Select Branches: ${selectedRepoRef.name}` : 'Select Repository'}
            </h2>
            {selectedRepoRef && (
              <p className="text-xs font-mono text-gray-500 mt-1 truncate">
                {selectedRepoRef.owner.login}/{selectedRepoRef.name}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close repository dialog"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-all cursor-pointer shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {selectedRepoRef ? (
          <form onSubmit={handleStartTest} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <p className="text-xs text-gray-600">
                Click 2 branches below to compare ({selectedBranches.length}/2 selected).
              </p>
              <button
                type="button"
                onClick={() => loadBranchesForRepo(selectedRepoRef)}
                disabled={isLoadingBranches}
                className="text-xs font-mono text-gray-600 hover:text-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={isLoadingBranches ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {selectedBranches.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3 shrink-0">
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 min-w-0">
                  <span className="block text-[10px] font-mono uppercase text-blue-600">
                    Branch A (Baseline)
                  </span>
                  <span className="block text-xs font-mono font-bold text-black truncate">
                    {selectedBranches[0] || 'Not selected'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 min-w-0">
                  <span className="block text-[10px] font-mono uppercase text-emerald-600">
                    Branch B (Candidate)
                  </span>
                  <span className="block text-xs font-mono font-bold text-black truncate">
                    {selectedBranches[1] || 'Click a 2nd branch'}
                  </span>
                </div>
              </div>
            )}

            {branchError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700 shrink-0">
                {branchError}
              </div>
            )}

            {branches.length > 5 && (
              <input
                type="text"
                aria-label="Filter branches"
                placeholder="Filter branches..."
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                className="w-full mb-3 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none text-black bg-white shrink-0"
              />
            )}

            <div className="flex-1 min-h-[180px] overflow-y-auto overscroll-contain space-y-2 pr-1 scrollbtn">
              {isLoadingBranches ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin mb-3" />
                  <span className="text-xs font-mono uppercase tracking-wider">Loading branches...</span>
                </div>
              ) : filteredBranches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                  <GitBranch className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No branches available</p>
                </div>
              ) : (
                filteredBranches.map((branch) => {
                  const idx = selectedBranches.indexOf(branch.name);
                  const isBaseline = idx === 0;
                  const isCandidate = idx === 1;
                  const isSelected = idx !== -1;

                  return (
                    <button
                      type="button"
                      key={branch.name}
                      onClick={() => handleBranchClick(branch.name)}
                      className={`w-full p-3 border rounded-lg transition-all text-left flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'border-black bg-zinc-50 font-semibold'
                          : 'border-gray-200 hover:border-gray-400 bg-white'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <GitBranch
                          size={16}
                          className={isSelected ? 'text-black shrink-0' : 'text-gray-400 shrink-0'}
                        />
                        <span className="font-mono text-sm text-black truncate">{branch.name}</span>
                      </span>
                      {isBaseline && (
                        <span className="px-2 py-0.5 text-[10px] font-mono uppercase bg-blue-100 text-blue-700 rounded shrink-0">
                          Baseline (A)
                        </span>
                      )}
                      {isCandidate && (
                        <span className="px-2 py-0.5 text-[10px] font-mono uppercase bg-emerald-100 text-emerald-700 rounded shrink-0">
                          Candidate (B)
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={returnToRepoList}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-xs uppercase tracking-widest transition-colors font-bold rounded-lg cursor-pointer"
              >
                Back to Repos
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-xs uppercase tracking-widest transition-colors font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoadingBranches || isSubmitting || selectedBranches.length !== 2}
                  className="px-5 py-2.5 bg-black hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs uppercase tracking-widest transition-colors font-bold rounded-lg flex items-center gap-2 cursor-pointer"
                >
                  <Play size={14} /> {isSubmitting ? 'Starting...' : 'Run A/B Test'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700 shrink-0">
                {error}
              </div>
            )}

            <label htmlFor="repo-search-input" className="sr-only">
              Search repositories
            </label>
            <input
              id="repo-search-input"
              type="text"
              placeholder="Search repositories..."
              className="w-full mb-4 px-4 py-2 border border-gray-200 rounded-lg outline-none text-black bg-white shrink-0"
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
              <div className="overflow-y-auto overscroll-contain space-y-2 pr-2 scrollbtn flex-1">
                {filteredRepos.map((repo) => (
                  <button
                    type="button"
                    key={repo.id}
                    onClick={() => handleRepoSelect(repo)}
                    className="w-full p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all text-left flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                        {repo.private ? (
                          <Lock className="w-5 h-5 text-gray-500" />
                        ) : (
                          <GitFork className="w-5 h-5 text-gray-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{repo.name}</p>
                        <p className="text-xs text-gray-500 truncate">{repo.owner.login}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 font-mono shrink-0">
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3" /> {repo.stargazers_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3 h-3" /> {repo.forks_count}
                      </span>
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
