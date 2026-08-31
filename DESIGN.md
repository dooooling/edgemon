# EdgeMon UI & Design System Specification

## 1. Design Language & Visual Identity

**EdgeMon** adopts the **SpaceX Aerospace & Mission Control Aesthetic** — an ultra-dark, high-density, mission-critical interface engineered for telemetry monitoring, immediate situational awareness, and industrial precision.

### 1.1 Pure Black Chassis & Surfaces
- **Canvas Floor** (`#000000` / `#050505`): Pure black backdrop maximizing OLED contrast and eliminating visual fatigue.
- **Card Surface** (`#0a0a0c`): Slightly elevated midnight chassis with 1px hairline border (`#27272a`).
- **Hairlines & Dividers** (`#27272a` / `#3f3f46`): 1px razor-sharp borders separating telemetry modules without dropshadow blur.

### 1.2 Industrial Typography & Metrics
- **Font Stack**: `D-DIN`, `Inter`, `-apple-system`, `monospace`.
- **All-Caps Display Headers**: Uppercase tracking with `+1.6px` letter-spacing for terminal status indicators (`ONLINE`, `DISCONNECTED`, `CF EDGE · 28 MS`).
- **Tabular Numerics**: Fixed-width digits for CPU %, Memory GB, Network bps, and ping latencies to eliminate jitter during real-time updates.

### 1.3 Ghost Pill CTAs & Interactive Chrome
- **Ghost Outlined Pills**: Pill-shaped action buttons (`border: 1px solid #3f3f46; border-radius: 9999px; font-weight: 600; text-transform: uppercase`).
- **Active Accents**:
  - **Online / Normal**: High-visibility Green (`#22c55e` / `#4ade80`).
  - **Warning / Degraded**: Precision Amber (`#f59e0b`).
  - **Critical / Offline**: Emergency Red (`#ef4444`).
  - **Cloudflare Edge**: Vivid Orange (`#f97316`).

### 1.4 Telemetry Visualizations
- **Radar Heatmap & Latency Sparkbars**: Continuous 18-tick sparkline matrix rendering latency distribution and packet loss across China Telecom, China Unicom, China Mobile, and Alibaba DNS.
- **World Orbital Map**: Equirectangular SVG radar projection with pulsing node beacons, Colo tags, and geographic pins.
- **uPlot Telemetry Charts**: Zero-overhead Canvas charts rendering CPU, memory, IO throughput, and network rates with instant time-range switching (1H / 6H / 24H / 7D / 30D).
