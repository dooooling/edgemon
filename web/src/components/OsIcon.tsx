import React from 'react';

interface OsIconProps {
  os?: string | null;
  osVersion?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export type OsType =
  | 'windows'
  | 'ubuntu'
  | 'debian'
  | 'centos'
  | 'rocky'
  | 'almalinux'
  | 'rhel'
  | 'alpine'
  | 'arch'
  | 'fedora'
  | 'opensuse'
  | 'macos'
  | 'freebsd'
  | 'linux'
  | 'unknown';

export function detectOsType(os?: string | null, osVersion?: string | null): OsType {
  const combined = `${os || ''} ${osVersion || ''}`.toLowerCase();

  if (combined.includes('win')) return 'windows';
  if (combined.includes('ubuntu')) return 'ubuntu';
  if (combined.includes('debian')) return 'debian';
  if (combined.includes('alpine')) return 'alpine';
  if (combined.includes('arch')) return 'arch';
  if (combined.includes('fedora')) return 'fedora';
  if (combined.includes('centos')) return 'centos';
  if (combined.includes('rocky')) return 'rocky';
  if (combined.includes('alma')) return 'almalinux';
  if (combined.includes('rhel') || combined.includes('red hat') || combined.includes('redhat')) return 'rhel';
  if (combined.includes('suse') || combined.includes('opensuse')) return 'opensuse';
  if (combined.includes('darwin') || combined.includes('macos') || combined.includes('os x') || combined.includes('apple')) return 'macos';
  if (combined.includes('bsd')) return 'freebsd';
  if (combined.includes('linux')) return 'linux';

  return 'linux';
}

export const OsIcon: React.FC<OsIconProps> = ({
  os,
  osVersion,
  size = 16,
  className,
  style,
}) => {
  const osType = detectOsType(os, osVersion);

  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${size}px`,
    height: `${size}px`,
    verticalAlign: 'middle',
    flexShrink: 0,
    ...style,
  };

  switch (osType) {
    case 'windows':
      return (
        <span className={className} style={containerStyle} title="Windows">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
          </svg>
        </span>
      );

    case 'ubuntu':
      return (
        <span className={className} style={containerStyle} title="Ubuntu">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="4.5" r="1.5" />
            <circle cx="5.5" cy="15.5" r="1.5" />
            <circle cx="18.5" cy="15.5" r="1.5" />
            <path d="M12 7v3m-4.5 4.5l2.5-1.5m4.5 1.5l-2.5-1.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      );

    case 'debian':
      return (
        <span className={className} style={containerStyle} title="Debian">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c-2.48 0-4.5-2.02-4.5-4.5 0-1.86 1.13-3.46 2.76-4.14-.14.4-.26.83-.26 1.28 0 1.93 1.57 3.5 3.5 3.5.45 0 .88-.08 1.28-.22-.68 2.37-2.73 4.08-5.28 4.08z" />
          </svg>
        </span>
      );

    case 'alpine':
      return (
        <span className={className} style={containerStyle} title="Alpine Linux">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 20h20L12 2zm0 4.5l6.5 11.5h-13L12 6.5zm-2.5 7l2.5 4.5h-5l2.5-4.5z" />
          </svg>
        </span>
      );

    case 'arch':
      return (
        <span className={className} style={containerStyle} title="Arch Linux">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L3 21l3-1 6-13 6 13 3 1L12 2zm0 7.5L8.5 17h7L12 9.5z" />
          </svg>
        </span>
      );

    case 'fedora':
      return (
        <span className={className} style={containerStyle} title="Fedora">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm3.5 9h-2v2a1.5 1.5 0 01-3 0v-2h-1a1.5 1.5 0 010-3h1V6.5a3.5 3.5 0 017 0V8h-2V6.5a1.5 1.5 0 00-3 0V8h3.5a1.5 1.5 0 010 3z" />
          </svg>
        </span>
      );

    case 'centos':
    case 'rocky':
    case 'almalinux':
    case 'rhel':
      return (
        <span className={className} style={containerStyle} title="Enterprise Linux">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </span>
      );

    case 'opensuse':
      return (
        <span className={className} style={containerStyle} title="openSUSE">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3c-4.97 0-9 4.03-9 9 0 3.53 2.04 6.58 5 8.05V17c-1.66-.89-2.8-2.61-2.8-4.6 0-2.98 2.42-5.4 5.4-5.4 2.09 0 3.89 1.19 4.79 2.91.46-.22.97-.35 1.51-.35 1.99 0 3.6 1.61 3.6 3.6 0 1.25-.64 2.35-1.61 3v2.89C19.96 17.58 22 14.53 22 11c0-4.97-4.03-9-10-8z" />
          </svg>
        </span>
      );

    case 'macos':
      return (
        <span className={className} style={containerStyle} title="macOS">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.85.94-2.93-.93.04-2.03.63-2.68 1.4-.58.67-1.09 1.77-.95 2.82 1.03.08 2.06-.52 2.69-1.29z" />
          </svg>
        </span>
      );

    case 'freebsd':
      return (
        <span className={className} style={containerStyle} title="FreeBSD">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14.5L12 14l-4.5 2.5 1-5.5L4 7.5l5.5-.5L12 2l2.5 5 5.5.5-4.5 3.5 1 5.5z" />
          </svg>
        </span>
      );

    case 'linux':
    default:
      return (
        <span className={className} style={containerStyle} title="Linux">
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a4.5 4.5 0 00-4.5 4.5c0 .7.17 1.36.47 1.95L4.5 17.5A2.5 2.5 0 007 20h10a2.5 2.5 0 002.5-2.5l-3.47-9.05c.3-.59.47-1.25.47-1.95A4.5 4.5 0 0012 2zm0 2a2.5 2.5 0 012.5 2.5c0 .34-.07.67-.2.96L12 8.5l-2.3-1.04A2.5 2.5 0 0112 4z" />
          </svg>
        </span>
      );
  }
};
