import { feature } from 'topojson-client';
import topologyJson from './countries-110m.json';

// Minimal structural types for the vendored 110m topology (avoids depending
// on the transitive topojson-specification package directly).
interface TopologyGeometry {
  type: string;
  arcs?: unknown;
  id?: string;
  properties?: { name?: string };
}
interface TopologyFile {
  type: 'Topology';
  objects: Record<string, { type: string; geometries: TopologyGeometry[] }>;
  arcs: number[][][];
}

// Natural Earth 110m country boundaries, vendored offline (world-atlas).
// Single source of truth for country strokes + labels on both globe modes.

export interface CountryRing {
  name: string;
  /** [lon, lat] points, one outer ring per entry (holes dropped at 110m). */
  points: Array<[number, number]>;
  bbox: [number, number, number, number];
}

let ringCache: CountryRing[] | null = null;

export function getCountryRings(): CountryRing[] {
  if (ringCache) return ringCache;
  const topology = topologyJson as unknown as TopologyFile;
  const fc = feature(
    topology as never,
    topology.objects.countries as never
  ) as unknown as {
    features: Array<{
      properties: { name: string };
      geometry:
        | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
        | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> }
        | null;
    }>;
  };

  const rings: CountryRing[] = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 3) continue;
      let minLon = 180;
      let maxLon = -180;
      let minLat = 90;
      let maxLat = -90;
      for (const [lon, lat] of outer) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      rings.push({ name: f.properties.name, points: outer, bbox: [minLon, minLat, maxLon, maxLat] });
    }
  }
  ringCache = rings;
  return rings;
}

/** Ray-casting country lookup for node coordinates. Returns null outside land. */
export function findCountry(lon: number, lat: number): string | null {
  for (const ring of getCountryRings()) {
    const [minLon, minLat, maxLon, maxLat] = ring.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    let inside = false;
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[j][0];
      const yj = pts[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return ring.name;
  }
  return null;
}

export interface CountryLabel {
  name: string;
  short: string;
  lon: number;
  lat: number;
}

const displayNamesCache = new Map<string, Intl.DisplayNames>();

/**
 * Localized country name from an ISO alpha-2 code (or a display short like
 * 'UK'), backed by the browser's built-in CLDR data — no translation table.
 * Falls back to the code itself when the runtime lacks the locale data.
 */
export function regionName(codeOrShort: string, lang: string): string {
  const code = codeOrShort === 'UK' ? 'GB' : codeOrShort;
  const locale = lang === 'zh' ? 'zh-CN' : 'en';
  try {
    let dn = displayNamesCache.get(locale);
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: 'region' });
      displayNamesCache.set(locale, dn);
    }
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Curated major-country labels (centroids hand-picked, avoids algorithmic mislabeling). */
export const MAJOR_COUNTRY_LABELS: CountryLabel[] = [
  { name: 'United States of America', short: 'US', lon: -100, lat: 40 },
  { name: 'Canada', short: 'CA', lon: -106, lat: 56 },
  { name: 'Mexico', short: 'MX', lon: -102, lat: 23 },
  { name: 'Brazil', short: 'BR', lon: -52, lat: -10 },
  { name: 'Argentina', short: 'AR', lon: -64, lat: -35 },
  { name: 'United Kingdom', short: 'UK', lon: -2, lat: 54 },
  { name: 'France', short: 'FR', lon: 2, lat: 47 },
  { name: 'Germany', short: 'DE', lon: 10, lat: 51 },
  { name: 'Spain', short: 'ES', lon: -4, lat: 40 },
  { name: 'Italy', short: 'IT', lon: 13, lat: 43 },
  { name: 'Netherlands', short: 'NL', lon: 5.5, lat: 52 },
  { name: 'Sweden', short: 'SE', lon: 17, lat: 62 },
  { name: 'Russia', short: 'RU', lon: 90, lat: 60 },
  { name: 'Kazakhstan', short: 'KZ', lon: 67, lat: 48 },
  { name: 'Turkey', short: 'TR', lon: 35, lat: 39 },
  { name: 'Saudi Arabia', short: 'SA', lon: 45, lat: 24 },
  { name: 'Egypt', short: 'EG', lon: 30, lat: 27 },
  { name: 'South Africa', short: 'ZA', lon: 25, lat: -29 },
  { name: 'China', short: 'CN', lon: 104, lat: 35 },
  { name: 'India', short: 'IN', lon: 78, lat: 21 },
  { name: 'Japan', short: 'JP', lon: 138, lat: 37 },
  { name: 'South Korea', short: 'KR', lon: 128, lat: 36 },
  { name: 'Indonesia', short: 'ID', lon: 114, lat: -2 },
  { name: 'Singapore', short: 'SG', lon: 104, lat: 1.4 },
  { name: 'Australia', short: 'AU', lon: 134, lat: -25 },
  { name: 'New Zealand', short: 'NZ', lon: 172, lat: -42 },
];
