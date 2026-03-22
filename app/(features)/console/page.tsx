"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Terminal } from "lucide-react";
import GlobalLoader from "@/components/GlobalLoader";

function Page() {
  // Combined the destructuring to keep it clean
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  if (status === "loading") {
    return <GlobalLoader text="LOADING_CONSOLE..." />;
  }

  // Format the user's name for a more technical look (e.g., "John Doe" -> "JOHN_DOE")
  const sysName = session?.user?.name 
    ? session.user.name.toUpperCase().replace(/\s+/g, '_') 
    : "ROOT_USER";

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 md:p-8">
      
      {/* Main Console Window */}
      <div className="w-full max-w-5xl h-[80vh] bg-zinc-950 border border-zinc-800 shadow-2xl flex flex-col transition-all">
        
        {/* Window Header */}
        <div className="flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-4 py-2">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-zinc-500" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
              DRIFTSEEKER_SHELL // {sysName}
            </span>
          </div>
          
          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[9px] font-mono text-zinc-500 uppercase">SECURE_CONNECT</span>
          </div>
        </div>

        {/* Console Body */}
        <div className="flex-1 p-6 overflow-y-auto font-mono text-sm">
          {/* Welcome Message */}
          <div className="text-zinc-500 mb-6 space-y-1">
            <p>DriftSeeker Secure Shell v2.1.0 [Encrypted]</p>
            <p>Target: Standard_Node_Cluster_01</p>
            <p>User: {session?.user?.name || "Admin"}</p>
            <p className="pt-2">Type &apos;drift scan&apos; to check for configuration anomalies.</p>
            <p>Type &apos;fix --auto&apos; to apply remediation patches via Jenkins.</p>
          </div>
          
          {/* Mock Command Prompt */}
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="text-green-500">
              drift@{sysName.toLowerCase()}
            </span>
            <span className="text-blue-400">~</span>
            <span className="text-zinc-500">$</span>
            {/* Blinking Cursor */}
            <span className="animate-pulse w-2 h-4 bg-zinc-400 inline-block align-middle" />
          </div>
        </div>

      </div>
    </div>
  );
}

export default Page;