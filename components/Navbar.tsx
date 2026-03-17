"use client";
import { Workflow, LogOut, User, Activity, Container, GitBranch, Terminal, ShieldAlert, Library, LayoutDashboard } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import Image from 'next/image';

const Navbar = () => {
  const { data: session } = useSession();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Define nav items for cleaner mapping
  const navItems = [
    {id: 'github_repos', icon: <Library size={24} strokeWidth={1.5} />, label: 'GITHUB_REPOS'},
    { id: 'monitors', icon: <Activity size={24} strokeWidth={1.5} />, label: 'MONITORS' },
    { id: 'instances', icon: <Container size={24} strokeWidth={1.5} />, label: 'INSTANCES' },
    { id: 'pipelines', icon: <GitBranch size={24} strokeWidth={1.5} />, label: 'PIPELINES' },
    { id: 'console', icon: <Terminal size={24} strokeWidth={1.5} />, label: 'CONSOLE' },
    { id: 'security', icon: <ShieldAlert size={24} strokeWidth={1.5} />, label: 'SECURITY' },
  ];

  return (
    <nav className="fixed left-0 z-40 bg-zinc-950 w-12 sm:w-16 md:w-16 lg:w-18 h-screen py-6 flex flex-col items-center border-r border-zinc-800">
      {/* Brand Logo */}
      <button
        className="cursor-pointer hover:scale-110 transition-transform mb-6"
        onClick={() => session && (window.location.href = '/dashboard')}
      >
        {session ? <LayoutDashboard className="w-8 h-8 text-white" /> :
        <Workflow className="w-8 h-8 text-white" />
}
      </button>

      <div className="w-full border-t border-zinc-800 pt-8 flex flex-col items-center h-full justify-between">
        {session ? (
          <>
            {/* Functional Icons Group */}
            <div className="flex flex-col gap-8 w-full items-center">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className="group relative flex items-center justify-center w-full text-zinc-500 hover:text-white transition-colors duration-200"
                >
                  {item.icon}
                  
                  {/* Brutalist Tooltip */}
                  <span className="absolute left-16 hidden group-hover:block bg-zinc-900 border border-zinc-700 px-3 py-1 text-[10px] font-mono text-white tracking-widest whitespace-nowrap z-50">
                    {item.label}
                  </span>
                  
                  {/* Active Indicator Line */}
                  <div className="absolute left-0 w-0.5 h-0 bg-white transition-all duration-300 group-hover:h-6" />
                </button>
              ))}
            </div>

            {/* Profile Section */}
            <div className="pb-4 relative">
              <button 
                className={`flex cursor-pointer transition-all p-1 border-2 ${isModalOpen ? 'border-white' : 'border-transparent'}`} 
                onClick={() => setIsModalOpen(!isModalOpen)}
              >
                {session.user?.image && (
                  <Image
                    src={session.user.image}
                    className="grayscale hover:grayscale-0 transition-all"
                    alt="Profile"
                    width={32}
                    height={32}
                  />
                )}
              </button>

              {/* Modal Container */}
              {isModalOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setIsModalOpen(false)} />
                  <div className="fixed bottom-6 left-20 z-50 w-64 bg-zinc-950 border border-zinc-800 p-5 animate-in fade-in slide-in-from-left-2 duration-200">
                    <div className="mb-4 border-b border-zinc-800 pb-4">
                      <p className="font-orbitron text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Authenticated_User</p>
                      <h3 className="text-zinc-100 font-bold truncate text-sm">{session.user?.name}</h3>
                      <p className="text-[10px] font-mono text-zinc-600 truncate">{session.user?.email}</p>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <button className="flex items-center gap-3 w-full p-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors font-mono uppercase">
                        <User size={14} /> Profile_Settings
                      </button>
                      <button
                        onClick={() => signOut()}
                        className="flex items-center gap-3 w-full p-2 text-xs text-red-500 hover:bg-red-950/20 transition-colors font-mono uppercase"
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
          /* Welcome Text Vertically */
          <div className="flex flex-col gap-1 items-center font-bold font-orbitron text-[10px] text-zinc-100 select-none tracking-tighter opacity-40">
            {"WELCOME".split("").map((char, i) => (
              <span key={i} className="leading-none">{char}</span>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;