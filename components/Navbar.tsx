"use client";
import { Workflow, LogOut, User, Activity, Terminal, LayoutDashboard, Bot, Search } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const Navbar = () => {
  const { data: session } = useSession();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen]);

  const navItems = [
    { id: 'dashboard', icon: <LayoutDashboard size={24} strokeWidth={1.5} />, label: 'DASHBOARD', url: '/dashboard' },
    { id: 'monitor', icon: <Activity size={24} strokeWidth={1.5} />, label: 'UPTIME_MONITOR', url: '/monitors' },
    { id: 'drift', icon: <Search size={24} strokeWidth={1.5} />, label: 'DRIFT_ENGINE', url: '/drift' },
    { id: 'console', icon: <Terminal size={24} strokeWidth={1.5} />, label: 'WEB_SHELL', url: '/console' },
    { id: 'pipelines', icon: <Bot size={24} strokeWidth={1.5} />, label: 'A/B_PIPELINES', url: '/pipelines' },
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed left-0 z-40 bg-zinc-950 w-12 sm:w-16 md:w-16 lg:w-18 h-screen py-6 flex flex-col items-center border-r border-zinc-800"
    >
      <Link
        href="/"
        aria-label="DriftSeeker Home"
        className="cursor-pointer hover:scale-110 transition-transform mb-6"
      >
        <Workflow className="w-8 h-8 text-white" />
      </Link>

      <div className="w-full border-t border-zinc-800 pt-8 flex flex-col items-center h-full justify-between">
        {session ? (
          <>
            <div className="flex flex-col gap-8 w-full items-center">
              {navItems.map((item) => {
                const isActive = pathname === item.url || pathname?.startsWith(`${item.url}/`);
                return (
                  <Link
                    key={item.id}
                    href={item.url}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group relative flex items-center justify-center w-full transition-colors duration-200 focus:outline-none ${
                      isActive ? 'text-white' : 'text-zinc-500 hover:text-white focus-visible:text-white'
                    }`}
                  >
                    {item.icon}

                    <span className="absolute left-14 sm:left-18 lg:left-20 hidden group-hover:block group-focus-visible:block bg-zinc-900 border border-zinc-700 px-3 py-1 text-[10px] font-mono text-white tracking-widest whitespace-nowrap z-50">
                      {item.label}
                    </span>

                    <div
                      className={`absolute left-0 w-0.5 bg-white transition-all duration-300 ${
                        isActive ? 'h-6' : 'h-0 group-hover:h-6 group-focus-visible:h-6'
                      }`}
                    />
                  </Link>
                );
              })}
            </div>

            <div className="pb-4 relative">
              <button
                type="button"
                aria-label="User menu"
                aria-expanded={isModalOpen}
                className={`flex items-center justify-center cursor-pointer transition-all p-1 border-2 ${
                  isModalOpen ? 'border-white' : 'border-transparent'
                }`}
                onClick={() => setIsModalOpen(!isModalOpen)}
              >
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    className="grayscale hover:grayscale-0 transition-all"
                    alt="Profile"
                    width={32}
                    height={32}
                    loading="eager"
                  />
                ) : (
                  <div className="w-8 h-8 bg-zinc-800 text-zinc-200 flex items-center justify-center">
                    <User size={18} />
                  </div>
                )}
              </button>

              {isModalOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setIsModalOpen(false)} />
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Account menu"
                    className="fixed bottom-6 left-14 sm:left-20 z-50 w-64 max-w-[calc(100vw-4.5rem)] bg-zinc-950 border border-zinc-800 p-5"
                  >
                    <div className="mb-4 border-b border-zinc-800 pb-4">
                      <p className="font-orbitron text-[9px] text-zinc-500 uppercase tracking-widest mb-1">
                        Authenticated_User
                      </p>
                      <h3 className="text-zinc-100 font-bold truncate text-sm">{session.user?.name}</h3>
                      <p className="text-[10px] font-mono text-zinc-500 truncate">{session.user?.email}</p>
                    </div>

                    <div className="flex flex-col gap-1">
                      <Link
                        href="/dashboard"
                        onClick={() => setIsModalOpen(false)}
                        className="flex items-center gap-3 w-full p-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors font-mono uppercase"
                      >
                        <User size={14} /> Dashboard
                      </Link>
                      <button
                        type="button"
                        onClick={() => signOut()}
                        className="flex items-center gap-3 w-full p-2 text-xs text-red-500 hover:bg-red-950/20 transition-colors font-mono uppercase cursor-pointer"
                      >
                        <LogOut size={14} /> Terminate_Session
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1 items-center font-bold font-orbitron text-[10px] text-zinc-100 select-none tracking-tighter opacity-40">
            {'WELCOME'.split('').map((char, i) => (
              <span key={i} className="leading-none">
                {char}
              </span>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
