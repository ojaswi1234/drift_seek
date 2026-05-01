"use client";
import React, {useState, useEffect, useRef} from 'react';
import { GitFork, Star, Lock, X, GithubIcon, Github } from 'lucide-react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { GitHubRepo } from '@/components/modals/githubRepos/githubrepoModal';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

export default function Page() {
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isFetchingRepos, setIsFetchingRepos] = useState(false);
  const { status } = useSession({
      required: true,
      onUnauthenticated() {
        redirect("/");
      },
    });

  const handleOpenGithubModal = async () => {
    
    setIsGithubModalOpen(true);
    if (repos.length > 0) return;

    setIsFetchingRepos(true);
    try {
      const res = await fetch('/api/github/repos');
      if (!res.ok) throw new Error("Failed to fetch repositories");
      const data = await res.json();
      setRepos(data.repos || data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingRepos(false);
    }
  };
  return (
    <div className='flex flex-col h-screen bg-white py-10 px-6 md:px-12 lg:px-44 font-orbitron text-black overflow-hidden'>
        <h1 className="text-3xl md:text-4xl font-bold mb-4 tracking-wide shrink-0">
            Security Page
        </h1>
        <div className='flex flex-row gap-6 w-full h-full mt-6'>
        <aside className="w-1/2 h-full bg-gray-100 rounded-lg p-6">
        <span className="w-full flex gap-2 h-fit  justify-center items-center py-4 ">
          <Fingerprint size={32}/>
        <h2 className="font-sans text-xl font-bold">Agentic Logic Auditor / <span className="text-white bg-black p-2 font-medium">Deep Scan</span></h2>
        </span>

        <div className="w-full h-full flex flex-col gap-4 justify-center items-center ">
          <button className="bg-black text-white py-2 px-4 rounded-lg hover:bg-white hover:text-black  flex flex-row gap-2 cursor-pointer transition-colors duration-200" onClick={handleOpenGithubModal}><GitFork className=" p-0.5 " /> Import code from GitHub</button>
          </div>
        </aside>
    <div className="hidden lg:block w-0.5 bg-gray-300 self-stretch rounded-full shrink-0"></div>
        <hr className="block lg:hidden border-gray-100 w-full shrink-0" />
        <aside className="w-1/2 h-full bg-gray-100 rounded-lg p-6  ">
        <span className="w-full flex gap-2 h-fit justify-center items-center py-4 ">
          <ShieldCheck size={32} />
          <h2 className="font-sans text-xl font-bold">Static Intelligence Hub / <span className="text-white bg-black p-2 font-medium">Quick Scan</span></h2>
        </span>
        </aside>
       </div>

      <GithubModal 
        isOpen={isGithubModalOpen} 
        onClose={() => setIsGithubModalOpen(false)}
        onSelectRepo={(url) => console.log('Selected repo URL:', url)}
        repos={repos}
        isLoading={isFetchingRepos}
      />
    </div>
  )
}





interface GithubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRepo: (url: string) => void; 
  repos: GitHubRepo[]; 
  isLoading: boolean;
}

function GithubModal({ isOpen, onClose, onSelectRepo, repos, isLoading }: GithubModalProps) {
  if (!isOpen) return null;
  const [searchTerm, setSearchTerm] = useState('');

  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-200 p-6 rounded-xl w-full max-w-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans text-black">
        
        {/* Header matched to Monitor Page theme */}
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
          <h2 className="text-xl font-bold font-orbitron tracking-wide text-black">
            Select Repository
          </h2>
          <button 
            onClick={onClose} 
            className="p-1.5 text-gray-400 hover:text-black hover:bg-gray-100 rounded-md transition-all"
          >
            <X size={20} />
          </button>
        </div>
        <input 
          type="text" 
          placeholder="Search repositories..." 
          className="w-full mb-4 px-4 py-2 border border-gray-200 rounded-lg outline-none" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)} 
        />
        
        {/* Repository List */}
        <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 scrollbtn">
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
                  onClick={() => {
                    onSelectRepo(targetUrl);
                    onClose();
                  }}
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
        <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-black text-sm uppercase tracking-widest transition-colors font-bold"
            >
              Cancel
            </button>
        </div>
      </div>
    </div>
  );
}