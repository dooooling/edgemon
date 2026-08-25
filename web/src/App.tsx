import React from 'react';
import { HeaderNav } from './components/HeaderNav';
import { AppRoutes } from './router';

export const App: React.FC = () => {
  return (
    <div className="app-wrapper">
      <HeaderNav />
      <main style={{ flex: 1 }}>
        <AppRoutes />
      </main>

      {/* SpaceX Dark Minimalist Mission Footer */}
      <footer className="global-footer-dark">
        <div className="footer-inner-dark">
          <span className="eyebrow-cap" style={{ fontSize: '11px' }}>
            EDGEMON TELEMETRY © {new Date().getFullYear()} // CLOUDFLARE NATIVE
          </span>
          <div className="eyebrow-cap" style={{ display: 'flex', gap: '20px', fontSize: '11px' }}>
            <span>ACCURACY FIRST</span>
            <span>//</span>
            <span>ZERO RCE</span>
            <span>//</span>
            <span>LOW OVERHEAD</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
