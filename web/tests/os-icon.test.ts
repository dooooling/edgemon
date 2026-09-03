import { describe, it, expect } from 'vitest';
import { detectOsType } from '../src/components/OsIcon';

describe('detectOsType recognition accuracy & fallbacks', () => {
  it('identifies major Linux distributions correctly', () => {
    expect(detectOsType('Linux', 'Ubuntu 24.04.1 LTS')).toBe('ubuntu');
    expect(detectOsType('Linux', 'Debian GNU/Linux 12 (bookworm)')).toBe('debian');
    expect(detectOsType('Linux', 'CentOS Linux 7 (Core)')).toBe('centos');
    expect(detectOsType('Linux', 'Rocky Linux 9.4 (Blue Onyx)')).toBe('rocky');
    expect(detectOsType('Linux', 'AlmaLinux 9.4 (Seafoam Ocelot)')).toBe('almalinux');
    expect(detectOsType('Linux', 'Red Hat Enterprise Linux 9.2')).toBe('rhel');
    expect(detectOsType('Linux', 'Alpine Linux v3.20')).toBe('alpine');
    expect(detectOsType('Linux', 'Arch Linux')).toBe('arch');
    expect(detectOsType('Linux', 'Fedora Linux 40 (Server Edition)')).toBe('fedora');
    expect(detectOsType('Linux', 'openSUSE Leap 15.6')).toBe('opensuse');
  });

  it('identifies non-Linux and BSD operating systems correctly', () => {
    expect(detectOsType('Windows', 'Windows Server 2022 Standard')).toBe('windows');
    expect(detectOsType('Darwin', 'macOS Sonoma 14.5')).toBe('macos');
    expect(detectOsType('FreeBSD', 'FreeBSD 14.1-RELEASE')).toBe('freebsd');
  });

  it('identifies generic Linux kernels when distro name is omitted', () => {
    expect(detectOsType('Linux', '6.8.0-31-generic')).toBe('linux');
    expect(detectOsType('linux', null)).toBe('linux');
  });

  it('safely returns unknown without falsely faking Linux', () => {
    expect(detectOsType(null, null)).toBe('unknown');
    expect(detectOsType('', '')).toBe('unknown');
    expect(detectOsType('Solaris', 'SunOS 5.11')).toBe('unknown');
    expect(detectOsType('CustomOS', 'v1.0')).toBe('unknown');
  });
});
