import React from 'react';

export interface OsIconProps {
  os?: string | null;
  osVersion?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
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
  const combined = `${os || ''} ${osVersion || ''}`.toLowerCase().trim();
  if (!combined) return 'unknown';

  // 1. Check Darwin / macOS first to prevent 'darwin' matching 'win'
  if (combined.includes('darwin') || combined.includes('macos') || combined.includes('os x') || combined.includes('apple')) return 'macos';

  // 2. Check Windows
  if (combined.includes('windows') || combined.includes('win32') || combined.includes('win64') || /\bwin\b/.test(combined)) return 'windows';

  // 3. Specific Linux distributions
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
  if (combined.includes('bsd')) return 'freebsd';
  if (combined.includes('linux')) return 'linux';

  return 'unknown';
}

export const OsIcon: React.FC<OsIconProps> = ({
  os,
  osVersion,
  size = 16,
  className,
  style,
  title,
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
    color: '#ffffff', // High-contrast crisp white default, decoupled from parent muted styles
    ...style,
  };

  const defaultTitle =
    title ||
    [osVersion, os].filter(Boolean).join(' ') ||
    (osType !== 'unknown' ? osType.toUpperCase() : 'UNKNOWN SYSTEM');

  switch (osType) {
    case 'windows':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
          </svg>
        </span>
      );

    case 'ubuntu':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.4a9.6 9.6 0 0 1 8.314 4.8 2.4 2.4 0 0 0-3.376 1.948 7.2 7.2 0 0 0-4.938-1.948 7.2 7.2 0 0 0-6.235 3.6 2.4 2.4 0 0 0-2.379-.8A9.6 9.6 0 0 1 12 2.4zm-7.614 7.2a2.4 2.4 0 0 0 1.214 2.078 7.2 7.2 0 0 0 0 .644 2.4 2.4 0 0 0-1.214 2.078 9.6 9.6 0 0 1 0-4.8zm1.379 6.8a2.4 2.4 0 0 0 2.379-.8 7.2 7.2 0 0 0 6.235 3.6 7.2 7.2 0 0 0 4.938-1.948 2.4 2.4 0 0 0 3.376 1.948A9.6 9.6 0 0 1 12 21.6a9.6 9.6 0 0 1-6.235-2.4zm12.47-2.078a2.4 2.4 0 1 0 0-4.644 2.4 2.4 0 0 0 0 4.644zM3.6 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM12 4.8a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z" />
          </svg>
        </span>
      );

    case 'debian':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.001 0a12 12 0 1 0 .002 24 12 12 0 0 0-.002-24zm.172 2.164c4.37.037 8.01 3.003 8.766 7.156.91 5.01-2.46 9.77-7.443 10.603-4.86.812-9.492-2.316-10.49-7.057C2.062 8.44 4.898 3.91 9.49 2.705c.877-.23 1.777-.373 2.683-.377v-.164zm-.188 1.967c-.672.005-1.342.115-1.996.287-3.47.91-5.614 4.336-4.814 7.84.8 3.503 4.29 5.86 7.965 5.246 3.676-.615 6.166-4.13 5.494-7.83-.56-3.08-3.21-5.32-6.417-5.543l-.232.002v.002zm.176 1.834c2.26.155 4.14 1.737 4.535 3.91.474 2.614-1.285 5.093-3.878 5.527-2.593.434-5.06-1.228-5.625-3.7-.563-2.47 1.05-4.89 3.54-5.52.47-.12.946-.197 1.428-.217zm-.127 1.834c-.295.014-.59.06-.88.135-1.55.392-2.556 1.902-2.205 3.443.35 1.54 1.89 2.574 3.508 2.303 1.62-.27 2.716-1.82 2.42-3.45-.246-1.356-1.423-2.34-2.843-2.433z" />
          </svg>
        </span>
      );

    case 'centos':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.5l2.25 4.5H9.75L12 2.5zm0 19l-2.25-4.5h4.5L12 21.5zM2.5 12l4.5-2.25v4.5L2.5 12zm19 0l-4.5 2.25v-4.5L21.5 12zM7.25 7.25l3.5 1.25-1.25 3.5-3.5-1.25 1.25-3.5zm9.5 0l1.25 3.5-3.5 1.25-1.25-3.5 3.5-1.25zm0 9.5l-3.5 1.25 1.25-3.5 3.5 1.25-1.25 3.5zm-9.5 0l-1.25-3.5 3.5-1.25 1.25 3.5-3.5 1.25z" />
          </svg>
        </span>
      );

    case 'rocky':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.004 0C5.372 0 0 5.372 0 12.004c0 6.632 5.372 12.004 12.004 12.004 6.632 0 12.004-5.372 12.004-12.004C24.008 5.372 18.636 0 12.004 0Zm6.28 17.656-5.834-6.046-2.583 2.583 2.158 2.158-1.554 1.554-3.712-3.712 5.69-5.69 7.424 7.697a9.77 9.77 0 0 1-1.589 1.456ZM4.237 13.9a9.8 9.8 0 0 1-.033-3.666l5.228 5.228-1.554 1.554-3.641-3.116Zm15.534-1.896a9.78 9.78 0 0 1-.225 2.17l-3.32-3.44 1.554-1.554 1.991 2.824ZM6.028 6.028a9.8 9.8 0 0 1 11.948 0l-5.974 5.974-5.974-5.974Z" />
          </svg>
        </span>
      );

    case 'almalinux':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm-.12 3.12c1.7 0 3.32.55 4.66 1.54l-2.02 2.42a4.4 4.4 0 0 0-2.64-.86c-2.45 0-4.44 1.99-4.44 4.44 0 .93.29 1.8.78 2.51L6.16 15A7.54 7.54 0 0 1 4.44 12c0-4.17 3.39-7.56 7.44-7.56v-1.32Zm6.42 3.12a7.55 7.55 0 0 1 1.26 4.32c0 4.17-3.39 7.56-7.56 7.56-1.7 0-3.32-.55-4.66-1.54l2.02-2.42c.75.54 1.66.86 2.64.86 2.45 0 4.44-1.99 4.44-4.44 0-.93-.29-1.8-.78-2.51l2.06-1.83h.58Z" />
          </svg>
        </span>
      );

    case 'rhel':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.72 2.05c2.95 0 5.48 1.57 6.48 4.02.63.15 1.23.4 1.77.74.88.55 1.47 1.42 1.63 2.45.26 1.7-.75 3.32-2.38 3.82-1.84.57-3.8.92-5.83 1.05-1.39.09-2.78.13-4.18.13-1.47 0-2.93-.04-4.38-.13-1.97-.13-3.87-.47-5.65-1.02C2.65 12.63 1.69 11.08 1.9 9.4c.14-.98.71-1.81 1.53-2.35.53-.35 1.12-.6 1.74-.75 1-2.42 3.5-3.97 6.42-4.22.37-.03.75-.03 1.13-.03zm-.4 1.6c-2.32.06-4.3 1.34-5.07 3.32 1.5.3 2.92.93 4.17 1.84 1.23-.9 2.63-1.53 4.12-1.83-.8-1.94-2.73-3.23-5.02-3.32-.07 0-.14-.01-.2-.01z" />
          </svg>
        </span>
      );

    case 'alpine':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="m11.277 3.233-8.83 15.3A2.43 2.43 0 0 0 4.55 22.2h8.016l-3.34-5.815 3.86-6.732 3.859 6.732-2.023 3.522h4.528a2.43 2.43 0 0 0 2.103-3.667l-7.794-13.5a2.43 2.43 0 0 0-4.282.593zm.723 3.267 2.222 3.872-2.222 3.872-2.222-3.872z" />
          </svg>
        </span>
      );

    case 'arch':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.996 2.148c-.463 1.135-1.04 2.547-1.704 4.148 1.055 1.11 2.33 2.13 3.81 2.97-1.02-1.62-1.705-3.69-2.106-7.118zm-8.81 16.71c-.72 1.03-1.186 2.05-1.186 3.142h20c0-1.092-.466-2.112-1.186-3.142-2.083-2.983-5.385-4.88-8.814-7.858-3.43 2.978-6.73 4.875-8.814 7.858z" />
          </svg>
        </span>
      );

    case 'fedora':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm3.48 8.64h-2.02v2.02a1.46 1.46 0 0 1-2.92 0v-2.02H8.52a1.46 1.46 0 1 1 0-2.92h2.02V5.7a3.48 3.48 0 0 1 6.96 0v2.02h-2.02V5.7a1.46 1.46 0 0 0-2.92 0v2.02h2.92a1.46 1.46 0 1 1 0 2.92Z" />
          </svg>
        </span>
      );

    case 'opensuse':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.25c-5.38 0-9.75 4.37-9.75 9.75 0 3.86 2.25 7.2 5.51 8.78v-3.14c-1.84-.97-3.1-2.88-3.1-5.1 0-3.29 2.67-5.96 5.96-5.96 2.31 0 4.31 1.32 5.3 3.23.51-.25 1.08-.39 1.68-.39 2.21 0 4 1.79 4 4 0 1.39-.71 2.61-1.79 3.34v3.23c3.26-1.58 5.51-4.92 5.51-8.78 0-5.38-4.37-9.75-9.75-9.75zm1.38 8.16c.92 0 1.66.74 1.66 1.66s-.74 1.66-1.66 1.66-1.66-.74-1.66-1.66.74-1.66 1.66-1.66z" />
          </svg>
        </span>
      );

    case 'macos':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.85.94-2.93-.93.04-2.03.63-2.68 1.4-.58.67-1.09 1.77-.95 2.82 1.03.08 2.06-.52 2.69-1.29z" />
          </svg>
        </span>
      );

    case 'freebsd':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.6 2.4C4.1 2.9 3.5 4.3 4.2 6.8c.7 2.5 2.2 4.4 3.7 5.1-1.2 2-1.8 4.3-1.8 6.7 0 4.1 3.3 5.4 5.9 5.4 2.6 0 5.9-1.3 5.9-5.4 0-2.4-.6-4.7-1.8-6.7 1.5-.7 3-2.6 3.7-5.1.7-2.5.1-3.9-.4-4.4-.5-.5-1.8-.7-3.9.7-2.1 1.4-3.3 3.6-3.5 5-.2-1.4-1.4-3.6-3.5-5-2.1-1.4-3.4-1.2-3.9-.7z" />
          </svg>
        </span>
      );

    case 'linux':
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2c-2.2 0-3.6 1.7-3.6 4.1 0 .9.2 2 .5 2.9-.6.4-1.4 1.1-1.8 2-.5 1-.6 2.1-.3 3.2-.8.5-1.4 1.4-1.6 2.4-.3 1.2.1 2.4 1 3.1-.2.8.2 1.6.9 2 1 .5 2.3.3 3.2-.4.6.4 1.3.7 2 .7.8 0 1.5-.3 2.1-.7.9.7 2.2.9 3.2.4.7-.4 1.1-1.2.9-2 .9-.7 1.3-1.9 1-3.1-.2-1-.8-1.9-1.6-2.4.3-1.1.2-2.2-.3-3.2-.4-.9-1.2-1.6-1.8-2 .3-.9.5-2 .5-2.9C15.6 3.7 14.2 2 12 2zm-1.5 5.5c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm3 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm-1.5 2c.8 0 1.5.3 1.5.8s-.7.8-1.5.8-1.5-.3-1.5-.8.7-.8 1.5-.8zm0 2.5c1.7 0 3 1.8 3 4s-1.3 4-3 4-3-1.8-3-4 1.3-4 3-4z" />
          </svg>
        </span>
      );

    case 'unknown':
    default:
      return (
        <span className={className} style={containerStyle} title={defaultTitle}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 3h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 10h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm2-7v2h2V6H6zm0 10v2h2v-2H6zm11-10v2h1V6h-1zm0 10v2h1v-2h-1z" />
          </svg>
        </span>
      );
  }
};
