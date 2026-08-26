import React from 'react';

interface CountryFlagProps {
  countryCode?: string | null;
  className?: string;
  style?: React.CSSProperties;
  showCode?: boolean;
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
}) => {
  const flag = getCountryFlag(countryCode);
  const code = (countryCode || '').toUpperCase();

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
      <span style={{ fontSize: '15px' }}>{flag}</span>
      {showCode && code && <span style={{ fontSize: '11px', letterSpacing: '0.5px' }}>{code}</span>}
    </span>
  );
};
