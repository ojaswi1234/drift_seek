"use client";
import React from "react";
import Link from "next/link";
import {
  Activity,
  Terminal,
  ShieldCheck,
  Zap,
  Bot,
  Search,
} from "lucide-react";
import LoginBtn from "@/components/login-btn";
import { useSession } from "next-auth/react";

export default function Home() {
  const text = "DriftSeeker: DevOps Guardian";
  const getDelay = (index: number) => index * 0.05;
  const { data: session } = useSession();

  const cardsData = [
    {
      icon: <Activity size={28} strokeWidth={1.5} />,
      title: "Live Uptime Monitor",
      href: "/monitors",
      content:
        "Instantly detects when critical services go offline. Powered by Node.js, gRPC & Telegram alerts to notify admins the second a heartbeat is missed.",
    },
    {
      icon: <Search size={28} strokeWidth={1.5} />,
      title: "Drift Detection Engine",
      href: "/dashboard",
      content:
        "Inspects live endpoints with network timing traces and compares service readiness against surge traffic requirements.",
    },
    {
      icon: <Terminal size={28} strokeWidth={1.5} />,
      title: "Integrated Web Shell",
      href: "/console",
      content:
        "Secure, in-browser terminal access allowing immediate remediation of server issues without external SSH clients.",
    },
    {
      icon: <Zap size={28} strokeWidth={1.5} />,
      title: "Redis Speed Layer",
      href: "/monitors",
      content:
        "High-performance caching and WebSocket pushes ensure real-time dashboard updates without hitting API rate limits.",
    },
    {
      icon: <Bot size={28} strokeWidth={1.5} />,
      title: "Automated A/B Pipelines",
      href: "/pipelines",
      content:
        "GitHub Actions stress testing validates candidate branches against baseline throughput and latency gates.",
    },
    {
      icon: <ShieldCheck size={28} strokeWidth={1.5} />,
      title: "Auth & Security",
      href: "/dashboard",
      content:
        "Enterprise-grade access control via NextAuth, securing the dashboard and API endpoints for authorized DevOps personnel only.",
    },
  ];

  const scrollToArchitecture = () => {
    const el = document.getElementById("architecture");
    el?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="w-full min-h-screen bg-white text-black flex pl-12 sm:pl-16 md:pl-16 lg:pl-18">
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
          @media (prefers-reduced-motion: reduce) {
            .animate-reveal {
              animation: none;
              opacity: 1 !important;
              transform: none !important;
            }
          }
        `}</style>
        <h1
          aria-label={text}
          className="mt-10 md:mt-14 text-2xl sm:text-4xl md:text-6xl lg:text-7xl text-black font-orbitron font-semibold md:font-extrabold text-center leading-tight"
        >
          <span aria-hidden="true">
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
          </span>
        </h1>

        <p className="mt-6 text-zinc-600 font-mono text-xs sm:text-sm md:text-base max-w-xl text-center">
          Initializing search protocols. Access top-tier developer modules, CLI
          extensions, and system architectures below.
        </p>

        {session ? (
          <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto text-black">
            <h3>
              Welcome back, <b>{session.user?.name}</b>
            </h3>
            <Link
              href="/dashboard"
              className="border border-black bg-black text-white px-6 py-2.5 font-orbitron uppercase text-xs tracking-widest hover:bg-zinc-800 transition-colors"
            >
              Open Dashboard
            </Link>
          </div>
        ) : (
          <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <LoginBtn />
            <button
              type="button"
              onClick={scrollToArchitecture}
              className="border border-black cursor-pointer bg-transparent text-black px-6 py-3 font-orbitron uppercase text-xs md:text-sm tracking-widest hover:bg-black hover:text-white transition-all"
            >
              Explore Modules
            </button>
          </div>
        )}

        <div className="w-full max-w-7xl mx-auto mt-16 mb-4 border-b border-zinc-300" />

        <section id="architecture" className="w-full max-w-7xl mx-auto mb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full p-4 sm:p-8 bg-zinc-100 mt-10">
            {cardsData.map((card, index) => (
              <Link
                key={card.title}
                href={session ? card.href : "#architecture"}
                className="group relative flex flex-col justify-between border border-zinc-800 bg-zinc-950 p-6 md:p-8 hover:bg-zinc-900 transition-colors duration-300 min-h-80"
              >
                <div className="absolute top-0 left-0 h-0.5 w-12 bg-zinc-100 transition-all duration-300 group-hover:w-full" />

                <div className="flex justify-between items-start mb-8">
                  <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300">
                    SYS.{String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-zinc-600 group-hover:text-zinc-300 transition-colors duration-300 text-lg" aria-hidden="true">
                    &#x2197;
                  </span>
                </div>

                <div className="mb-5 text-zinc-400 group-hover:text-zinc-100 transition-colors duration-300">
                  {card.icon}
                </div>

                <div className="mt-auto">
                  <h2 className="text-xl sm:text-2xl text-zinc-100 font-orbitron font-bold tracking-wider uppercase mb-3">
                    {card.title}
                  </h2>
                  <p className="text-sm text-zinc-400 font-sans leading-relaxed group-hover:text-zinc-300">
                    {card.content}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <footer className="w-full max-w-7xl mx-auto py-8 border-t border-zinc-200 flex flex-col md:flex-row justify-between items-center gap-6 mt-auto">
          <h3 className="font-orbitron font-bold text-xl text-black tracking-widest">
            DriftSeeker
          </h3>
          <div className="flex gap-6 font-mono text-xs text-zinc-500 uppercase tracking-wider">
            {session?.user?.username && (
              <a
                href={`https://github.com/${encodeURIComponent(session.user.username)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-black transition-colors"
              >
                GitHub
              </a>
            )}
            <Link href="/console" className="hover:text-black transition-colors">
              Terminal
            </Link>
            <Link href="/monitors" className="hover:text-black transition-colors">
              Monitors
            </Link>
            <Link href="/pipelines" className="hover:text-black transition-colors">
              Pipelines
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
