'use client'
import { useSession } from 'next-auth/react';
import React, { useEffect, useRef, useState } from 'react'
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import GlobalLoader from '@/components/GlobalLoader';

// Define a type for the status object from the API
type StatusObject = { 
  statusCode: number;
  message: string;
};

function Page() {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [isstatus, setStatus] = useState<StatusObject | string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect('/');
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.trim() === '') {
      setStatus(null);
      setChecking(false); // Just in case they clear it while a check is running
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      checkStatus(e.currentTarget.value);
    }
  };

  const checkStatus = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;

    setChecking(true);
    setStatus(null);

    try {
      const res = await fetch(`/api/check_status?url=${encodeURIComponent(targetUrl)}`);
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to check status');
      }

      setStatus(result);
    } catch (e) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : "An unknown error occurred";
      setStatus(errorMessage);
    } finally {
      setChecking(false);
    }
  };
  

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/dashboard-api")
        .then(response => response.json())
        .then(apiData => { 
          setData(apiData.message);
        })
        .catch(e => {
          console.error(e.message);
        });
    }
    
  }, [status]);

  

  if (status === "loading") {
    return <GlobalLoader text="VERIFYING_SESSION..." />;
  }

  return (
    <div className="flex-1 min-h-screen bg-white py-10 px-6 md:px-12 lg:px-44">
        <div className="w-full border border-zinc-800 bg-zinc-950 p-6 md:p-10 shadow-2xl transition-all">
          <div className="w-full md:w-1/2 h-10 flex flex-row items-center">
            <Search className="text-zinc-400 mr-2" />
            <input 
              type="text" 
              placeholder="Type website url and press Enter..." 
              ref={urlRef} 
              onKeyDown={handleKeyDown} 
              onChange={handleInputChange}
              className="outline-none w-full h-full bg-zinc-950 text-zinc-100 p-4 border-b-2 border-b-zinc-800 font-consolas" 
            />
          </div>
          <div className="w-full h-full mt-5">
            <div>
              {checking  ? (
                <p className="text-sm font-mono text-zinc-400 animate-pulse">
                  &gt; CHECKING STATUS...
                </p>
              ) : isstatus !== null ? (
                typeof isstatus === 'object' ? (
                  <div className="flex flex-row items-center space-x-4 text-zinc-100 font-mono">
                    <div className={`w-3 h-3 rounded-full ${isstatus.statusCode >= 200 && isstatus.statusCode < 300 ? 'bg-green-400' : 'bg-red-500'}`}></div>
                    <h1 className={isstatus.statusCode >= 200 && isstatus.statusCode < 300 ? 'text-green-400' : 'text-red-400'}>
                      {isstatus.statusCode}
                    </h1>
                    <h1 className={isstatus.statusCode >= 200 && isstatus.statusCode < 300 ? 'text-green-400' : 'text-red-400'}>
                      {isstatus.message}
                    </h1>
                  </div>
                ) : (
                  <p className="text-sm font-mono text-red-400">Error: {isstatus}</p>
                )
              ) : (
                <p className="text-sm font-mono text-zinc-600">
                  &gt; WAITING_FOR_INPUT...
                </p>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}

export default Page;
