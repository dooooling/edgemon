import { describe, it, expect } from 'vitest';
import { getCountryRings, findCountry, MAJOR_COUNTRY_LABELS, regionName } from '../src/components/world-countries';

describe('Natural Earth country data (vendored 110m)', () => {
  it('extracts a full country ring set from the topology', () => {
    const rings = getCountryRings();
    expect(rings.length).toBeGreaterThan(150);
    const names = new Set(rings.map((r) => r.name));
    for (const expected of ['China', 'United States of America', 'Russia', 'Brazil', 'Australia']) {
      expect(names.has(expected)).toBe(true);
    }
    for (const ring of rings) {
      expect(ring.points.length).toBeGreaterThanOrEqual(3);
      const [minLon, minLat, maxLon, maxLat] = ring.bbox;
      expect(minLon).toBeLessThanOrEqual(maxLon);
      expect(minLat).toBeLessThanOrEqual(maxLat);
    }
  });

  it('locates node coordinates inside the right country', () => {
    expect(findCountry(116.4, 39.9)).toBe('China'); // Beijing
    expect(findCountry(-100, 40)).toBe('United States of America'); // Kansas (inland: 110m coasts are simplified)
    expect(findCountry(139.7, 35.7)).toBe('Japan'); // Tokyo
  });

  it('returns null for open ocean', () => {
    expect(findCountry(-150, 0)).toBeNull(); // Pacific
    expect(findCountry(-30, -50)).toBeNull(); // South Atlantic
  });

  it('ships curated major labels with sane coordinates', () => {
    expect(MAJOR_COUNTRY_LABELS.length).toBeGreaterThan(20);
    for (const label of MAJOR_COUNTRY_LABELS) {
      expect(label.short.length).toBeGreaterThan(0);
      expect(label.lon).toBeGreaterThanOrEqual(-180);
      expect(label.lon).toBeLessThanOrEqual(180);
      expect(label.lat).toBeGreaterThanOrEqual(-90);
      expect(label.lat).toBeLessThanOrEqual(90);
    }
  });

  it('localizes region names per UI language with code fallback', () => {
    expect(regionName('CN', 'zh')).toBe('中国');
    expect(regionName('US', 'en')).toBe('United States');
    expect(regionName('UK', 'en')).toBe('United Kingdom'); // display short maps to GB
    expect(regionName('XX', 'zh')).toBe('XX'); // unknown code falls back
  });
});
