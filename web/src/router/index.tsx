import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { OverviewPage } from '../pages/OverviewPage';
import { NodeDetailPage } from '../pages/NodeDetailPage';
import { AdminPage } from '../pages/AdminPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<OverviewPage />} />
      <Route path="/node/:id" element={<NodeDetailPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
};
