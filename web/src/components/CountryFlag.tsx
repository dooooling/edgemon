import React from 'react';
import * as Flags from 'country-flag-icons/react/3x2';

interface CountryFlagProps {
  countryCode?: string | null;
  className?: string;
  style?: React.CSSProperties;
  showCode?: boolean;
  width?: number;
}

export function getCountryFlag(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '🌐';
  const code = countryCode.toUpperCase();
  const first = 0x1f1e6 + (code.charCodeAt(0) - 65);
  const second = 0x1f1e6 + (code.charCodeAt(1) - 65);
  if (first < 0x1f1e6 || first > 0x1f1ff || second < 0x1f1e6 || second > 0x1f1ff) {
    return '🌐';
  }
  return String.fromCodePoint(first, second);
}

export const CountryFlag: React.FC<CountryFlagProps> = ({
  countryCode,
  className,
  style,
  showCode = false,
  width = 18,
}) => {
  const code = (countryCode || '').toUpperCase();
  const FlagComponent = (Flags as Record<string, React.ComponentType<any>>)[code];
  const height = Math.round((width * 2) / 3);

  if (FlagComponent) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          verticalAlign: 'middle',
          ...style,
        }}
        title={`Country: ${code}`}
      >
        <span
          style={{
            display: 'inline-flex',
            width: `${width}px`,
            height: `${height}px`,
            borderRadius: '2px',
            overflow: 'hidden',
            boxShadow: '0 0 1px rgba(255, 255, 255, 0.4)',
            flexShrink: 0,
          }}
        >
          <FlagComponent style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </span>
        {showCode && code && <span style={{ fontSize: '11px', letterSpacing: '0.5px' }}>{code}</span>}
      </span>
    );
  }

  // Fallback to emoji or globe icon
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '14px',
        lineHeight: 1,
        verticalAlign: 'middle',
        ...style,
      }}
      title={code ? `Country: ${code}` : undefined}
    >
      <span style={{ fontSize: '14px' }}>🌐</span>
      {showCode && code && <span style={{ fontSize: '11px', letterSpacing: '0.5px' }}>{code}</span>}
    </span>
  );
};
