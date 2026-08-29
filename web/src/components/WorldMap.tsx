import React, { useState } from 'react';
import { NodeItem } from '../api/client';
import { useTranslation } from '../i18n/I18nContext';
import { Globe3D } from './Globe3D';

interface WorldMapProps {
  nodes: NodeItem[];
}

export const WorldMap: React.FC<WorldMapProps> = ({ nodes }) => {
  const [mapMode, setMapMode] = useState<'3d' | '2d'>('3d');

  return (
    <div style={{ width: '100%' }}>
      {/* Single Continuous Canvas with Unfolding Morph Animation and Internal Corner Controls */}
      <Globe3D
        nodes={nodes}
        mode={mapMode}
        onToggleMode={() => setMapMode((prev) => (prev === '3d' ? '2d' : '3d'))}
      />
    </div>
  );
};
