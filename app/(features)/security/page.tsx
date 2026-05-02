"use client";
import React, { useState, useRef, useEffect } from 'react';
import { GitFork, Star, Lock, X, Fingerprint, ShieldCheck, Upload, FileText, Terminal, Key } from 'lucide-react';
import { GitHubRepo } from '@/components/modals/githubRepos/githubrepoModal';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

export default function Page() {
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isFetchingRepos, setIsFetchingRepos] = useState(false);
  
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [caseFile, setCaseFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // BYOK State Management
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  // Load API key from local storage on mount
  useEffect(() => {
    const storedKey = localStorage.getItem('driftseek_genai_key');
    if (storedKey) {
      setApiKey(storedKey);
    } else {
      // Force popup if no key is found
      setIsApiModalOpen(true);
    }
  }, []);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCaseFile(file);
  };

  const handleExecuteScan = () => {
    if (!apiKey) {
      setIsApiModalOpen(true);
      return;
    }
    // For demonstration, we'll just log the inputs. In a real implementation, this would trigger the audit process.
    console.log("Executing scan with the following parameters:");
    console.log("Selected Repository:", selectedRepo);
    console.log("Case File:", caseFile);
    console.log("API Key Present:", !!apiKey);
    
    // Here you would typically make a POST request to your audit API endpoint, passing the selectedRepo, caseFile (if any), and ensuring the apiKey is included in the request headers for authentication.
    const formData = new FormData();
    if (selectedRepo) formData.append('repoUrl', selectedRepo);
    if (caseFile) formData.append('caseFile', caseFile);

    fetch('/api/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    })
    .then(res => res.json())
    .then(data => {
      console.log("Audit Result:", data);
      // You can add logic here to display the audit results in the UI
    })
    .catch(err => {
      console.error("Audit Execution Failed:", err);
      // Optionally display an error message to the user
    });
    
  };

  return (
    <div className='flex flex-col h-screen bg-white py-10 px-6 md:px-12 lg:px-44 font-orbitron text-black overflow-hidden'>
      <div className="flex justify-between items-end mb-4 shrink-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl md:text-4xl font-bold tracking-wide">
            Security Console
          </h1>
          {selectedRepo && (
            <span className="text-sm font-mono bg-gray-100 text-gray-600 px-3 py-1 rounded-md border border-gray-200 truncate max-w-xs flex items-center gap-2 mt-2 w-fit">
              <GitFork size={14} /> {selectedRepo.split('/').slice(-2).join('/')}
              <button onClick={() => {setSelectedRepo(null); setCaseFile(null);}} className="ml-2 text-black hover:text-red-600">
                <X size={14} />
              </button>
            </span>
          )}
        </div>

        {/* API Key Manager Button */}
        <button 
          onClick={() => setIsApiModalOpen(true)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono border rounded transition-colors ${apiKey ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
        >
          <Key size={14} />
          {apiKey ? 'KEY ACTIVE' : 'KEY REQUIRED'}
        </button>
      </div>

      <div className='flex flex-col lg:flex-row gap-6 w-full h-full mt-2'>
        {/* Section 1: Agentic Logic Auditor */}
        <aside className="w-full lg:w-1/2 h-full bg-gray-100 rounded-lg p-6 flex flex-col">
          <span className="w-full flex gap-2 h-fit justify-center items-center py-4 border-b border-gray-200 mb-6">
            <Fingerprint size={28} />
            <h2 className="font-sans text-xl font-bold">Agentic Logic Auditor / <span className="text-white bg-black p-1.5 text-sm font-medium rounded">Deep Scan</span></h2>
          </span>

          <div className="w-full h-full flex flex-col gap-4 justify-center items-center font-sans">
            {!selectedRepo ? (
              <button 
                className="bg-black text-white py-3 px-6 rounded-lg hover:bg-gray-800 flex flex-row items-center gap-2 cursor-pointer transition-colors duration-200 font-bold tracking-wide" 
                onClick={handleOpenGithubModal}
              >
                <GitFork size={18} /> Select Target Repository
              </button>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full px-8">
                <p className="text-sm text-gray-500 text-center">Deploys Genkit agents to trace remote data flows and evaluate architecture tradeoffs.</p>
                <button 
                  onClick={handleExecuteScan}
                  className="bg-black text-green-400 py-3 px-6 rounded-lg w-full hover:bg-gray-900 transition-colors font-mono font-bold flex justify-center items-center gap-2 border border-gray-800 shadow-lg shadow-black/10"
                >
                  <Terminal size={16} /> EXECUTE_AGENTIC_SCAN
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="hidden lg:block w-px bg-gray-200 self-stretch shrink-0"></div>
        <hr className="block lg:hidden border-gray-200 w-full shrink-0" />

        {/* Section 2: Static Intelligence Hub */}
        <aside className="w-full lg:w-1/2 h-full bg-gray-100 rounded-lg p-6 flex flex-col">
          <span className="w-full flex gap-2 h-fit justify-center items-center py-4 border-b border-gray-200 mb-6">
            <ShieldCheck size={28} />
            <h2 className="font-sans text-xl font-bold">Static Intelligence Hub / <span className="text-white bg-black p-1.5 text-sm font-medium rounded">Quick Scan</span></h2>
          </span>

          <div className="w-full h-full flex flex-col gap-4 justify-center items-center font-sans">
            {!selectedRepo ? (
              <p className="text-gray-400 text-sm italic text-center px-8">
                Awaiting target selection. Target a repository to enable static metadata and dependency analysis.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full px-8">
                <p className="text-sm text-gray-500 text-center">Fast pattern-matching for CVEs and hardcoded secrets.</p>
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept=".log,.txt,.json"
                />
                
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-white border-2 border-dashed border-gray-300 text-gray-600 py-2.5 px-4 rounded-lg hover:border-black hover:text-black transition-colors flex justify-center items-center gap-2 text-sm font-bold"
                >
                  {caseFile ? (
                    <><FileText size={16} className="text-blue-600" /> {caseFile.name}</>
                  ) : (
                    <><Upload size={16} /> Attach Case File (Optional Breakpoint)</>
                  )}
                </button>

                <button 
                  onClick={handleExecuteScan}
                  className="bg-white border-2 border-black text-black py-3 px-6 rounded-lg w-full hover:bg-gray-100 transition-colors font-mono font-bold flex justify-center items-center gap-2"
                >
                  <Terminal size={16} /> EXECUTE_STATIC_SCAN
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <GithubModal 
        isOpen={isGithubModalOpen} 
        onClose={() => setIsGithubModalOpen(false)}
        onSelectRepo={(url) => setSelectedRepo(url)}
        repos={repos}
        isLoading={isFetchingRepos}
      />

      <ApiKeyModal 
        isOpen={isApiModalOpen}
        onClose={() => {
          // Only allow closing if a key exists, otherwise they can't use the app
          if (apiKey) setIsApiModalOpen(false);
        }}
        currentKey={apiKey}
        onSave={(key) => {
          setApiKey(key);
          localStorage.setItem('driftseek_genai_key', key);
          setIsApiModalOpen(false);
        }}
        onRemove={() => {
          setApiKey(null);
          localStorage.removeItem('driftseek_genai_key');
        }}
      />
    </div>
  );
}

// --- Modals below ---

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  onRemove: () => void;
  currentKey: string | null;
}

function ApiKeyModal({ isOpen, onClose, onSave, onRemove, currentKey }: ApiKeyModalProps) {
  if (!isOpen) return null;
  const [inputKey, setInputKey] = useState(currentKey || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-200 p-8 rounded-xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans text-black">
        
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-black text-white rounded-lg"><Key size={20} /></div>
          <h2 className="text-xl font-bold font-orbitron tracking-wide">Bring Your Own Key</h2>
        </div>
        
        <p className="text-sm text-gray-500 mb-6">
          DriftSeek operates a zero-footprint architecture. We do not store, proxy, or log your API keys. Your key is saved locally in your browser and sent directly to the reasoning engine.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Google Gemini API Key</label>
            <input 
              type="password" 
              placeholder="AIzaSy..." 
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg outline-none focus:border-black focus:ring-1 focus:ring-black transition-all font-mono text-sm" 
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)} 
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              onClick={() => onSave(inputKey)}
              disabled={!inputKey.trim()}
              className="flex-1 bg-black text-white py-2.5 rounded-lg font-bold hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Save Key Locally
            </button>
            {currentKey && (
              <button 
                onClick={onClose}
                className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-black font-bold rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}
          </div>

          {currentKey && (
            <button 
              onClick={onRemove}
              className="w-full text-center text-xs text-red-500 hover:text-red-700 font-bold tracking-wide uppercase mt-4"
            >
              Revoke & Remove Key
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ... (GithubModal implementation remains the same as previously provided) ...
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
          className="w-full mb-4 px-4 py-2 border border-gray-200 rounded-lg outline-none focus:border-black transition-colors font-mono text-sm" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)} 
        />
        
        <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 scrollbtn">
          {isLoading ? (
             <div className="flex flex-col items-center justify-center py-12 text-gray-400 animate-pulse">
                <GitFork size={32} className="mb-3 opacity-50" />
                <span className="text-sm tracking-widest uppercase font-bold">Fetching Context...</span>
             </div>
          ) : filteredRepos.length === 0 ? (
             <div className="text-center py-12 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg font-mono">
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
                    <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
                       <span className="flex items-center gap-1">
                         <Star size={14} className="text-gray-400 group-hover:text-yellow-500 transition-colors"/> 
                         {repo.stargazers_count}
                       </span>
                       <span className="flex items-center gap-1">
                         <GitFork size={14} className="text-gray-400 group-hover:text-black transition-colors"/> 
                         {repo.forks_count}
                       </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 font-mono truncate w-full group-hover:text-black transition-colors">
                    {targetUrl}
                  </span>
                </button>
              );
            })
          )}
        </div>
        
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