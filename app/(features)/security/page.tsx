import React from 'react'
import { Fingerprint, ShieldCheck } from 'lucide-react'
export default function Page() {
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
          <button className="bg-black text-white py-2 px-4 rounded-lg hover:bg-gray-800">Import code from GitHub</button>
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
    </div>
  )
}
