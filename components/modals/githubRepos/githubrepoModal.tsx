"use client";

import React, { useState, useEffect } from 'react';
import { GitFork, Star, Lock, X, GitBranch, Play } from 'lucide-react';

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
  onRunTest: (githubUrl: string, branches: string[]) => void;
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
  const [selectedRepoRef, setSelectedRepoRef] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [baselineBranch, setBaselineBranch] = useState('');
  const [candidateBranch, setCandidateBranch] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSelectedRepoRef(null);
      setBranches([]);
      setBranchError(null);
      setBaselineBranch('');
      setCandidateBranch('');
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

  const handleRepoSelect = async (repo: GitHubRepo) => {
    setSelectedRepoRef(repo);
    setBranches([]);
    setBranchError(null);
    setBaselineBranch('');
    setCandidateBranch('');
    setIsLoadingBranches(true);

    try {
      const res = await fetch(
        `/api/gitbranch?owner=${encodeURIComponent(repo.owner.login)}&repo=${encodeURIComponent(repo.name)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch branches');
      }
      const list = Array.isArray(data) ? (data as GitHubBranch[]) : [];
      setBranches(list);
      if (list.length >= 2) {
        setBaselineBranch(list[0].name);
        setCandidateBranch(list[1].name);
      } else if (list.length === 1) {
        setBaselineBranch(list[0].name);
        setBranchError('Repository must have at least 2 branches for A/B comparison.');
      } else {
        setBranchError('No branches found for this repository.');
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'Unable to fetch branches');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const returnToRepoList = () => {
    setSelectedRepoRef(null);
    setBranches([]);
    setBranchError(null);
    setBaselineBranch('');
    setCandidateBranch('');
  };

  const handleStartTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoRef) return;
    if (!baselineBranch || !candidateBranch) {
      setBranchError('Select both a baseline and candidate branch.');
      return;
    }
    if (baselineBranch === candidateBranch) {
      setBranchError('Baseline and candidate branches must be different.');
      return;
    }
    onRunTest(selectedRepoRef.html_url, [baselineBranch, candidateBranch]);
  };

  const filteredRepos = repos.filter((repo) =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-repo-modal-title"
        className="relative bg-white border border-gray-200 p-6 rounded-xl w-full max-w-xl shadow-2xl font-sans text-black flex flex-col max-h-[90vh]"
      >
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4 shrink-0">
          <h2
            id="github-repo-modal-title"
            className="text-xl font-bold font-orbitron tracking-wide text-black truncate pr-4"
          >
            {selectedRepoRef ? `Select Branches: ${selectedRepoRef.name}` : 'Select Repository'}
          </h2>
          <button
            type="button"
            aria-label="Close repository dialog"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {selectedRepoRef ? (
          <form onSubmit={handleStartTest} className="flex flex-col flex-1 overflow-hidden">
            <p className="text-sm text-gray-600 mb-4 shrink-0">
              Choose the baseline branch (Branch A) and candidate branch (Branch B) to benchmark.
            </p>

            {branchError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700">
                {branchError}
              </div>
            )}

            {isLoadingBranches ? (
              <div className="flex justify-center items-center py-12 flex-1">
                <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4 overflow-y-auto overscroll-contain pr-1 flex-1">
                <div>
                  <label
                    htmlFor="baseline-branch-select"
                    className="block text-xs font-mono uppercase tracking-wider text-gray-600 mb-1"
                  >
                    Baseline Branch (A)
                  </label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                    <GitBranch size={16} className="text-gray-400 shrink-0" />
                    <select
                      id="baseline-branch-select"
                      value={baselineBranch}
                      onChange={(e) => {
                        setBaselineBranch(e.target.value);
                        setBranchError(null);
                      }}
                      className="w-full bg-white text-black text-sm font-mono outline-none"
                    >
                      <option value="">Select baseline branch...</option>
                      {branches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="candidate-branch-select"
                    className="block text-xs font-mono uppercase tracking-wider text-gray-600 mb-1"
                  >
                    Candidate Branch (B)
                  </label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                    <GitBranch size={16} className="text-gray-400 shrink-0" />
                    <select
                      id="candidate-branch-select"
                      value={candidateBranch}
                      onChange={(e) => {
                        setCandidateBranch(e.target.value);
                        setBranchError(null);
                      }}
                      className="w-full bg-white text-black text-sm font-mono outline-none"
                    >
                      <option value="">Select candidate branch...</option>
                      {branches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap justify-between gap-3 shrink-0">
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
                  disabled={
                    isLoadingBranches ||
                    !baselineBranch ||
                    !candidateBranch ||
                    baselineBranch === candidateBranch
                  }
                  className="px-5 py-2.5 bg-black hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs uppercase tracking-widest transition-colors font-bold rounded-lg flex items-center gap-2 cursor-pointer"
                >
                  <Play size={14} /> Run A/B Test
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700">
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
