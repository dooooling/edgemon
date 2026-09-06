// Dot-matrix mesh, night city lights and starfield for SpaceX / Mission Control Aesthetic.
// Country boundaries and labels now come from Natural Earth 110m
// (see world-countries.ts); the hand-drawn continent blobs are retired.

export const LAND_POINTS: Array<[number, number]> = [
  // North America
  [65, -150], [62, -155], [60, -145], [58, -135], [55, -125], [52, -120], [50, -110], [48, -100],
  [48, -90], [45, -80], [45, -70], [42, -75], [40, -85], [38, -95], [38, -105], [38, -115],
  [35, -120], [33, -115], [33, -100], [33, -85], [30, -90], [28, -98], [25, -80], [24, -102],
  [20, -100], [18, -95], [15, -90], [12, -85], [60, -110], [60, -95], [55, -105], [55, -90],
  [52, -70], [50, -65], [68, -130], [65, -120], [65, -100], [70, -90], [72, -80], [75, -100],
  // Greenland
  [75, -45], [72, -40], [70, -35], [68, -50], [65, -45], [80, -40], [78, -30],
  // South America
  [10, -75], [8, -65], [5, -60], [2, -50], [0, -70], [-2, -60], [-5, -75], [-5, -40],
  [-8, -78], [-10, -60], [-10, -40], [-15, -70], [-15, -50], [-15, -40], [-20, -65], [-20, -50],
  [-22, -45], [-25, -60], [-25, -50], [-30, -65], [-30, -55], [-35, -70], [-35, -60], [-40, -70],
  [-40, -65], [-45, -70], [-45, -65], [-50, -72], [-52, -68],
  // Europe
  [65, 15], [63, 20], [60, 10], [60, 25], [58, 15], [55, 5], [55, 15], [55, 25], [55, 35],
  [52, 0], [52, 10], [52, 20], [50, 5], [50, 15], [50, 30], [48, 2], [48, 12], [48, 25],
  [45, 0], [45, 10], [45, 20], [45, 30], [42, -5], [42, 5], [42, 15], [40, -5], [40, 20],
  [38, -5], [38, 15], [38, 23], [36, -3],
  // Africa
  [35, 0], [35, 10], [32, 20], [30, 30], [28, -5], [28, 15], [25, 5], [25, 25], [22, -10],
  [22, 10], [22, 30], [18, 0], [18, 20], [18, 38], [15, -15], [15, 5], [15, 25], [15, 40],
  [10, -10], [10, 10], [10, 30], [10, 42], [5, 0], [5, 20], [5, 35], [0, 15], [0, 25],
  [0, 38], [-5, 15], [-5, 25], [-5, 35], [-10, 15], [-10, 25], [-10, 35], [-15, 15], [-15, 25],
  [-15, 35], [-20, 18], [-20, 28], [-20, 45], [-25, 20], [-25, 30], [-30, 20], [-30, 28],
  // Middle East & West Asia
  [32, 40], [30, 45], [28, 40], [25, 45], [22, 50], [20, 55], [35, 45], [35, 55], [38, 60],
  [40, 45], [40, 60], [45, 50], [45, 65],
  // India & South Asia
  [28, 75], [26, 80], [24, 72], [24, 85], [20, 75], [20, 82], [16, 75], [16, 80], [12, 78],
  [8, 78], [7, 80],
  // East Asia & Siberia
  [70, 70], [70, 90], [70, 120], [70, 150], [65, 80], [65, 100], [65, 125], [65, 160],
  [60, 70], [60, 90], [60, 110], [60, 130], [60, 150], [55, 60], [55, 80], [55, 100],
  [55, 120], [55, 140], [50, 70], [50, 90], [50, 110], [50, 130], [45, 80], [45, 100],
  [45, 120], [45, 130], [42, 115], [42, 125], [40, 85], [40, 95], [40, 110], [40, 118],
  [38, 128], [35, 105], [35, 115], [35, 135], [32, 110], [32, 120], [30, 100], [30, 115],
  [28, 105], [28, 115], [25, 102], [25, 112], [25, 121], [22, 110], [22, 114], [36, 138],
  [35, 136], [43, 142],
  // Southeast Asia & Oceania
  [18, 102], [15, 100], [15, 108], [12, 105], [5, 102], [2, 103], [0, 100], [-3, 102],
  [-7, 110], [-3, 114], [2, 115], [0, 122], [-4, 120], [14, 121], [8, 124], [-3, 140],
  [-5, 145],
  // Australia & New Zealand
  [-15, 130], [-18, 125], [-18, 135], [-18, 145], [-22, 120], [-22, 135], [-22, 145],
  [-26, 120], [-26, 130], [-26, 140], [-26, 150], [-30, 120], [-30, 130], [-30, 140],
  [-30, 150], [-34, 118], [-34, 138], [-34, 150], [-37, 145], [-42, 172], [-45, 169],
];

// Major Global Metropolitan Clusters & Urban Centers (Night City Lights)
export const CITY_LIGHTS: Array<{ lat: number; lon: number; intensity: number; size: number }> = [
  // East Asia
  { lat: 35.68, lon: 139.76, intensity: 1.0, size: 2.2 }, // Tokyo
  { lat: 34.69, lon: 135.50, intensity: 0.85, size: 1.8 }, // Osaka
  { lat: 37.56, lon: 126.97, intensity: 0.95, size: 2.0 }, // Seoul
  { lat: 31.23, lon: 121.47, intensity: 1.0, size: 2.2 }, // Shanghai
  { lat: 39.90, lon: 116.40, intensity: 0.95, size: 2.0 }, // Beijing
  { lat: 22.31, lon: 114.17, intensity: 1.0, size: 2.2 }, // Hong Kong / Shenzhen
  { lat: 23.12, lon: 113.26, intensity: 0.9, size: 2.0 }, // Guangzhou
  { lat: 25.03, lon: 121.56, intensity: 0.9, size: 1.8 }, // Taipei
  { lat: 30.57, lon: 104.06, intensity: 0.8, size: 1.6 }, // Chengdu
  { lat: 30.59, lon: 114.30, intensity: 0.8, size: 1.6 }, // Wuhan
  // Southeast Asia
  { lat: 1.35, lon: 103.82, intensity: 0.95, size: 2.0 }, // Singapore
  { lat: 13.75, lon: 100.50, intensity: 0.85, size: 1.8 }, // Bangkok
  { lat: 14.59, lon: 120.98, intensity: 0.85, size: 1.8 }, // Manila
  { lat: -6.20, lon: 106.84, intensity: 0.85, size: 1.8 }, // Jakarta
  { lat: 3.13, lon: 101.68, intensity: 0.8, size: 1.6 }, // Kuala Lumpur
  // South Asia
  { lat: 28.61, lon: 77.20, intensity: 0.9, size: 2.0 }, // Delhi
  { lat: 19.07, lon: 72.87, intensity: 0.9, size: 2.0 }, // Mumbai
  { lat: 12.97, lon: 77.59, intensity: 0.85, size: 1.8 }, // Bangalore
  // Europe
  { lat: 51.50, lon: -0.12, intensity: 1.0, size: 2.2 }, // London
  { lat: 48.85, lon: 2.35, intensity: 0.95, size: 2.0 }, // Paris
  { lat: 50.11, lon: 8.68, intensity: 0.9, size: 1.8 }, // Frankfurt / Rhine-Ruhr
  { lat: 52.52, lon: 13.40, intensity: 0.85, size: 1.8 }, // Berlin
  { lat: 52.36, lon: 4.90, intensity: 0.9, size: 1.8 }, // Amsterdam
  { lat: 40.41, lon: -3.70, intensity: 0.85, size: 1.8 }, // Madrid
  { lat: 41.90, lon: 12.49, intensity: 0.85, size: 1.8 }, // Rome
  { lat: 55.75, lon: 37.61, intensity: 0.9, size: 2.0 }, // Moscow
  // Middle East
  { lat: 25.20, lon: 55.27, intensity: 0.95, size: 2.0 }, // Dubai
  { lat: 24.71, lon: 46.67, intensity: 0.8, size: 1.6 }, // Riyadh
  { lat: 32.08, lon: 34.78, intensity: 0.85, size: 1.6 }, // Tel Aviv
  { lat: 30.04, lon: 31.23, intensity: 0.9, size: 2.0 }, // Cairo
  // North America
  { lat: 40.71, lon: -74.00, intensity: 1.0, size: 2.2 }, // New York
  { lat: 34.05, lon: -118.24, intensity: 0.95, size: 2.0 }, // Los Angeles
  { lat: 37.77, lon: -122.41, intensity: 0.95, size: 2.0 }, // San Francisco / Silicon Valley
  { lat: 41.87, lon: -87.62, intensity: 0.9, size: 1.8 }, // Chicago
  { lat: 47.60, lon: -122.33, intensity: 0.85, size: 1.8 }, // Seattle
  { lat: 29.76, lon: -95.36, intensity: 0.85, size: 1.8 }, // Houston
  { lat: 43.65, lon: -79.38, intensity: 0.85, size: 1.8 }, // Toronto
  { lat: 19.43, lon: -99.13, intensity: 0.9, size: 2.0 }, // Mexico City
  // South America
  { lat: -23.55, lon: -46.63, intensity: 0.95, size: 2.0 }, // Sao Paulo
  { lat: -22.90, lon: -43.17, intensity: 0.85, size: 1.8 }, // Rio de Janeiro
  { lat: -34.60, lon: -58.38, intensity: 0.85, size: 1.8 }, // Buenos Aires
  { lat: -33.44, lon: -70.66, intensity: 0.8, size: 1.6 }, // Santiago
  // Oceania
  { lat: -33.86, lon: 151.20, intensity: 0.9, size: 1.8 }, // Sydney
  { lat: -37.81, lon: 144.96, intensity: 0.85, size: 1.8 }, // Melbourne
  // Africa
  { lat: -26.20, lon: 28.04, intensity: 0.8, size: 1.6 }, // Johannesburg
  { lat: 6.52, lon: 3.37, intensity: 0.8, size: 1.6 }, // Lagos
];

// Deep Space Procedural Starfield Coordinates
export const STARFIELD: Array<{ x: number; y: number; r: number; alpha: number; pulseSpeed: number }> = Array.from(
  { length: 80 },
  (_, i) => ({
    x: ((i * 137.5) % 1000) / 1000,
    y: (((i + 17) * 223.7) % 1000) / 1000,
    r: 0.6 + ((i % 3) * 0.4),
    alpha: 0.25 + ((i % 5) * 0.12),
    pulseSpeed: 0.02 + ((i % 4) * 0.015),
  })
);
