import React from 'react';
import styled from 'styled-components';

const GlobalLoader = () => {
  return (
    <StyledWrapper>
      <div className="stage">
        <div className="grid">
          <div className="strip">
            <div className="tip delay-18" />
            <div className="tip reverse delay-17" />
            <div className="tip delay-16" />
            <div className="tip reverse delay-15" />
            <div className="tip delay-14" />
          </div>
          <div className="strip">
            <div className="tip delay-01" />
            <div className="tip reverse delay-02" />
            <div className="tip delay-f" />
            <div className="tip reverse delay-e" />
            <div className="tip delay-d" />
            <div className="tip reverse delay-13" />
            <div className="tip delay-12" />
          </div>
          <div className="strip">
            <div className="tip reverse delay-03" />
            <div className="tip delay-04" />
            <div className="tip reverse delay-a" />
            <div className="tip delay-b" />
            <div className="tip reverse delay-c" />
            <div className="tip delay-11" />
            <div className="tip reverse delay-10" />
          </div>
          <div className="strip">
            <div className="tip reverse delay-05" />
            <div className="tip delay-06" />
            <div className="tip reverse delay-07" />
            <div className="tip delay-08" />
            <div className="tip reverse delay-09" />
          </div>
        </div>
      </div>
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;

  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .grid {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .strip {
    display: flex;
  }
  .tip {
    width: 0;
    height: 0;
    margin: 0 -6px;
    border-left: 12px solid transparent;
    border-right: 12px solid transparent;
    border-bottom: 22px solid white;
    filter: drop-shadow(0 0 18px white);
    animation: pulse 1s infinite;
  }
  .tip.reverse {
    transform: rotate(180deg);
  }
  .delay-01 {
    animation-delay: -0.05s;
  }
  .delay-02 {
    animation-delay: -0.1s;
  }
  .delay-03 {
    animation-delay: -0.15s;
  }
  .delay-04 {
    animation-delay: -0.2s;
  }
  .delay-05 {
    animation-delay: -0.25s;
  }
  .delay-06 {
    animation-delay: -0.3s;
  }
  .delay-07 {
    animation-delay: -0.35s;
  }
  .delay-08 {
    animation-delay: -0.4s;
  }
  .delay-09 {
    animation-delay: -0.45s;
  }
  .delay-10 {
    animation-delay: -0.5s;
  }
  .delay-11 {
    animation-delay: -0.55s;
  }
  .delay-12 {
    animation-delay: -0.6s;
  }
  .delay-13 {
    animation-delay: -0.65s;
  }
  .delay-14 {
    animation-delay: -0.7s;
  }
  .delay-15 {
    animation-delay: -0.75s;
  }
  .delay-16 {
    animation-delay: -0.8s;
  }
  .delay-17 {
    animation-delay: -0.85s;
  }
  .delay-18 {
    animation-delay: -0.9s;
  }
  .delay-19 {
    animation-delay: -0.95s;
  }
  .delay-20 {
    animation-delay: -1s;
  }

  .delay-a {
    animation-delay: -0.17s;
  }
  .delay-b {
    animation-delay: -0.33s;
  }
  .delay-c {
    animation-delay: -0.5s;
  }
  .delay-d {
    animation-delay: -0.67s;
  }
  .delay-e {
    animation-delay: -0.83s;
  }
  .delay-f {
    animation-delay: -1s;
  }

  @keyframes pulse {
    0% {
      opacity: 0.1;
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0.1;
    }
  }`;

export default GlobalLoader;
