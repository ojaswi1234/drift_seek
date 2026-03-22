"use client";
import React from "react";
import {
  Container,
  Users,
  Activity, // Uptime Monitor
 // Drift / Automated Fixes
  Terminal, // Web Shell
  ShieldCheck, // Security
  Zap, // Redis Speed
  Bot, // Automated Fixes (Jenkins) alternative
  Search, // Drift Detection
} from "lucide-react";
import LoginBtn from "@/components/login-btn";
import { useSession } from "next-auth/react";

export default function Home() {
  
  const text = "DriftSeeker: DevOps Guardian";
  // Animation delay calculation logic
  const getDelay = (index: number) => index * 0.05;



  const {data: session} = useSession()


  const cardsData = [
    {
      icon: <Activity size={28} strokeWidth={1.5} />,
      title: "Live Uptime Monitor",
      content:
        "Instantly detects when critical services go offline. Powered by Node.js & Nodemailer to alert admins the second a heartbeat is missed.",
    },
    {
      icon: <Search size={28} strokeWidth={1.5} />,
      title: "Drift Detection Engine",
      content:
        "Automatically compares live Docker containers against the official GitHub repository to flag unauthorized configuration changes.",
    },
    {
      icon: <Terminal size={28} strokeWidth={1.5} />,
      title: "Integrated Web Shell",
      content:
        "Secure, in-browser terminal access (via xterm.js) allowing immediate remediation of server issues without external SSH clients.",
    },
    {
      icon: <Zap size={28} strokeWidth={1.5} />,
      title: "Redis Speed Layer",
      content:
        "High-performance caching and WebSocket pushes ensure real-time dashboard updates without hitting GitHub API rate limits.",
    },
    {
      icon: <Bot size={28} strokeWidth={1.5} />,
      title: "Automated Fixes",
      content:
        "Jenkins-powered stress testing validates manual hotfixes before committing them back to the source code repository.",
    },
    {
      icon: <ShieldCheck size={28} strokeWidth={1.5} />,
      title: "Auth & Security",
      content:
        "Enterprise-grade access control via NextAuth, securing the dashboard and API endpoints for authorized DevOps personnel only.",
    },
  ];
  
  return (
    // Added padding-left to account for the absolute Sidebar width
    <div className="w-screen min-h-screen bg-white flex pl-12 sm:pl-16 md:pl-24">
      
      <main className="w-full flex flex-col items-center overflow-x-hidden p-6 md:p-12 lg:p-20">
        <style>{`
          @keyframes reveal {
            from {
              opacity: 0;
              transform: translateY(100%);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .animate-reveal {
            animation: reveal 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }
        `}</style>
        <h1 className="mt-10 md:mt-14 text-2xl sm:text-4xl md:text-6xl lg:text-7xl text-black font-orbitron font-semibold md:font-extrabold text-center leading-tight">
          {text.split(" ").map((word, wordIndex) => (
            <span key={wordIndex} className="inline-block whitespace-nowrap overflow-hidden align-bottom">
              {word.split("").map((char, charIndex) => (
                <span
                  key={charIndex}
                  className="inline-block opacity-0 animate-reveal"
                  style={{
                    animationDelay: `${getDelay(wordIndex * 10 + charIndex)}s`,
                  }}
                >
                  {char}
                </span>
              ))}
              <span className="inline-block">&nbsp;</span>
            </span>
          ))}
        </h1>
        
        <p className="mt-6 text-zinc-600 font-mono text-xs sm:text-sm md:text-base max-w-xl text-center">
          Initializing search protocols. Access top-tier developer modules, CLI
          extensions, and system architectures below.
        </p>

        
          { 
          (session) ?  (
            <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full sm:w-auto text-black">
              <h3>Welcome back, <b>{session.user?.name}</b></h3>
            </div>
            ) : 
            (
            <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <LoginBtn />
          <button className="border border-black cursor-pointer bg-transparent text-black px-6 py-3 font-orbitron uppercase text-xs md:text-sm tracking-widest hover:bg-black hover:text-white transition-all">
            Guest Sandbox
          </button>
          </div>
        )
}
        

        <div className="w-full max-w-7xl mx-auto mt-16 mb-4 border-b border-zinc-300"></div>

        <section className="w-full max-w-7xl mx-auto mb-20">
          {/* Responsive Grid: 1 col on mobile, 2 on tablet, 3 on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full p-4 sm:p-8 bg-zinc-100 mt-10">
            {cardsData.map((card, index) => (
              <div
                key={index}
                className="group relative flex flex-col justify-between border border-zinc-800 bg-zinc-950 p-6 md:p-8 hover:bg-zinc-900 transition-colors duration-300 cursor-pointer min-h-80"
              >
                <div className="absolute top-0 left-0 h-0.5 w-12 bg-zinc-100 transition-all duration-300 group-hover:w-full" />

                <div className="flex justify-between items-start mb-8">
                  <span className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400">
                    SYS.{String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-zinc-700 group-hover:text-zinc-300 transition-colors duration-300 text-lg">
                    &#x2197;
                  </span>
                </div>

                <div className="mb-5 text-zinc-500 group-hover:text-zinc-100 transition-colors duration-300">
                  {card.icon}
                </div>
                
                <div className="mt-auto">
                  <h2 className="text-xl sm:text-2xl text-zinc-100 font-orbitron font-bold tracking-wider uppercase mb-3">
                    {card.title}
                  </h2>
                  <p className="text-sm text-zinc-500 font-sans leading-relaxed group-hover:text-zinc-400">
                    {card.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="w-full max-w-7xl mx-auto py-8 border-t border-zinc-200 flex flex-col md:flex-row justify-between items-center gap-6 mt-auto">
          <h3 className="font-orbitron font-bold text-xl text-black tracking-widest">
            DriftSeeker
          </h3>
          <div className="flex gap-6 font-mono text-xs text-zinc-500 uppercase tracking-wider">
            <a href={session ? `https://github.com/${session.user.username}`  : "#"} className="hover:text-black transition-colors">GitHub</a>
            <a href="#" className="hover:text-black transition-colors">Terminal</a>
            <a href="#" className="hover:text-black transition-colors">Network</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
