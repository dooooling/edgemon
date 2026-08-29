import React, { useState } from 'react';
import { NodeItem } from '../api/client';
import { useTranslation } from '../i18n/I18nContext';
import { Globe3D } from './Globe3D';

interface WorldMapProps {
  nodes: NodeItem[];
}

export const WorldMap: React.FC<WorldMapProps> = ({ nodes }) => {
  const [mapMode, setMapMode] = useState<'3d' | '2d'>('3d');
  const { t } = useTranslation();

  const geoNodes = nodes.filter(
    (n) => n.geo?.lat != null && n.geo?.lon != null && !isNaN(n.geo.lat) && !isNaN(n.geo.lon)
  );

  return (
    <div className="map-band">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
        <div>
          <span className="eyebrow-cap">GLOBAL ORBITAL CONSTELLATION</span>
          <h2 className="display-lg" style={{ fontSize: '24px', marginTop: '4px' }}>
            {t('map_title')}
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span className="eyebrow-cap">{geoNodes.length} {t('nav_active_count')}</span>
        </div>
      </div>

      {/* Single Continuous Canvas with Unfolding Morph Animation and Internal Corner Controls */}
      <Globe3D
        nodes={nodes}
        mode={mapMode}
        onToggleMode={() => setMapMode((prev) => (prev === '3d' ? '2d' : '3d'))}
      />
    </div>
  );
};
