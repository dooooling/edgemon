import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { OverviewPage } from '../pages/OverviewPage';

const NodeDetailPage = lazy(() => import('../pages/NodeDetailPage').then(m => ({ default: m.NodeDetailPage })));
const AdminPage = lazy(() => import('../pages/AdminPage').then(m => ({ default: m.AdminPage })));

export const AppRoutes: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
          <span className="eyebrow-cap">LOADING...</span>
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/node/:id" element={<NodeDetailPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </Suspense>
  );
};
