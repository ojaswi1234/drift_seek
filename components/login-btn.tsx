"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Github, X } from "lucide-react";

export default function AuthModal() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="border border-black bg-black text-white px-8 py-3 font-orbitron uppercase cursor-pointer text-xs md:text-sm tracking-widest hover:bg-zinc-800 transition-colors w-full sm:w-auto"
      >
        Sign in
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div 
            className="absolute inset-0 bg-white/60 backdrop-blur-md"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal: Removed fixed height, added max-h for small screens */}
          <div className="relative w-full max-w-lg bg-white border-[3px] border-black p-6 md:p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in duration-300 overflow-y-auto max-h-[90vh]">
            
            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-black hover:rotate-90 transition-transform p-2"
            >
              <X size={24} />
            </button>

            <div className="font-orbitron">
              <h2 className="text-2xl md:text-4xl font-black uppercase mb-2 tracking-tighter text-black leading-none">
                Identity <br /> Check
              </h2>
              <p className="text-[10px] md:text-xs text-zinc-500 uppercase tracking-[0.2em] mb-10">
                Authorization required to proceed
              </p>

              <button
                onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
                className="w-full flex items-center justify-center gap-4 border border-black bg-black text-white px-6 py-4 font-orbitron uppercase text-xs md:text-sm tracking-widest hover:bg-zinc-800 transition-all active:translate-x-1 active:translate-y-1 active:shadow-none"
              >
                <Github size={20} />
                Sign in with GitHub
              </button>

              <div className="mt-12 pt-4 border-t border-zinc-100 flex justify-between items-center text-[9px] text-zinc-400 uppercase tracking-widest">
                <span>Node_Auth_v2</span>
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  System Online
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}