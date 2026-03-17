import React from 'react';
import styled from 'styled-components';
import { Terminal, Box, GitMerge, Monitor, Database, Cloud, Activity, Cpu } from 'lucide-react';

type GlobalLoaderProps = {
  text?: string;
};

const GlobalLoader = ({ text = "AUTHENTICATING" }: GlobalLoaderProps) => {
  return (
    <StyledWrapper>
      <div className="loader-container">
        
        {/* Floating DevOps Icons forming the vortex */}
        <div className="floating-icon" style={{ '--start-x': '0px', '--start-y': '-140px', animationDelay: '0s' } as React.CSSProperties}>
          <Terminal size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '100px', '--start-y': '-100px', animationDelay: '0.4s' } as React.CSSProperties}>
          <Box size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '140px', '--start-y': '0px', animationDelay: '0.8s' } as React.CSSProperties}>
          <GitMerge size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '100px', '--start-y': '100px', animationDelay: '1.2s' } as React.CSSProperties}>
          <Monitor size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '0px', '--start-y': '140px', animationDelay: '1.6s' } as React.CSSProperties}>
          <Database size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '-100px', '--start-y': '100px', animationDelay: '2.0s' } as React.CSSProperties}>
          <Cloud size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '-140px', '--start-y': '0px', animationDelay: '2.4s' } as React.CSSProperties}>
          <Activity size={20} strokeWidth={1.5} />
        </div>
        <div className="floating-icon" style={{ '--start-x': '-100px', '--start-y': '-100px', animationDelay: '2.8s' } as React.CSSProperties}>
          <Cpu size={20} strokeWidth={1.5} />
        </div>

        {/* Your Original Black Hole */}
        <div className="hole">
          <i /> <i /> <i /> <i /> <i />
          <i /> <i /> <i /> <i /> <i />
        </div>
        
      </div>

      {/* Typography */}
      <div className="loading-text">
        <span>{text}</span>
        <span className="dot" style={{ animationDelay: '0s' }}>.</span>
        <span className="dot" style={{ animationDelay: '0.2s' }}>.</span>
        <span className="dot" style={{ animationDelay: '0.4s' }}>.</span>
      </div>
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  /* Global Overlay settings */
  position: fixed;
  inset: 0;
  z-index: 50;
  background-color: rgba(9, 9, 11, 0.9); /* Dark overlay to make white shadows visible */
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  .loader-container {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100px;
    height: 100px;
    margin-bottom: 2rem;
  }

  /* Black Hole Logic */
  .hole {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
  }

  i {
    display: block;
    position: absolute;
    width: 50px;
    height: 50px;
    border-radius: 140px;
    opacity: 0;
    animation-name: scale;
    animation-duration: 3s;
    animation-iteration-count: infinite;
    animation-timing-function: linear;
  }

  i:nth-child(1) { animation-delay: 0.3s; }
  i:nth-child(2) { animation-delay: 0.6s; }
  i:nth-child(3) { animation-delay: 0.9s; }
  i:nth-child(4) { animation-delay: 1.2s; }
  i:nth-child(5) { animation-delay: 1.5s; }
  i:nth-child(6) { animation-delay: 1.8s; }
  i:nth-child(7) { animation-delay: 2.1s; }
  i:nth-child(8) { animation-delay: 2.4s; }
  i:nth-child(9) { animation-delay: 2.7s; }
  i:nth-child(10) { animation-delay: 3s; }

  @keyframes scale {
    0% {
      transform: scale(2);
      opacity: 0;
      box-shadow: 0px 0px 50px rgba(255, 255, 255, 0.5);
    }
    50% {
      transform: scale(1) translate(0px, -5px);
      opacity: 1;
      box-shadow: 0px 8px 20px rgba(255, 255, 255, 0.5);
    }
    100% {
      transform: scale(0.1) translate(0px, 5px);
      opacity: 0;
      box-shadow: 0px 10px 20px rgba(255, 255, 255, 0);
    }
  }

  /* Floating Vortex Icons Logic */
  .floating-icon {
    position: absolute;
    color: #a1a1aa;
    animation: suck-in 3.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes suck-in {
    0% {
      transform: translate(var(--start-x), var(--start-y)) scale(1.2) rotate(0deg);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      transform: translate(0px, 0px) scale(0) rotate(360deg);
      opacity: 0;
    }
  }

  /* Typography Logic */
  .loading-text {
    display: flex;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-family: monospace;
    letter-spacing: 0.3em;
    color: #a1a1aa;
  }

  .dot {
    animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .5; }
  }
`;

export default GlobalLoader;