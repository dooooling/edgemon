/**
 * EdgeMon 统一时间格式化工具库
 * 严格遵循 24 小时制 北京时间 (Asia/Shanghai, UTC+8)，彻底杜绝 AM/PM
 */

const BEIJING_TIMEZONE = 'Asia/Shanghai';

const beijingDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const beijingDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour12: false,
});

const beijingTimeSecFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const beijingTimeMinFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const beijingMonthDayHourMinFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIMEZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * 格式化为完整的北京时间字符串: "YYYY-MM-DD HH:mm:ss" (24小时制)
 */
export function formatBeijingDateTime(ts: number | Date | null | undefined): string {
  if (!ts) return '-';
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return '-';
  return beijingDateTimeFormatter.format(d).replace(/\//g, '-');
}

/**
 * 格式化为北京时间日期: "YYYY-MM-DD"
 */
export function formatBeijingDate(ts: number | Date | null | undefined): string {
  if (!ts) return '-';
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return '-';
  return beijingDateFormatter.format(d).replace(/\//g, '-');
}

/**
 * 格式化为 24 小时制时间: "HH:mm:ss" 或 "HH:mm" (无 AM/PM)
 */
export function formatBeijingTimeOnly(ts: number | Date | null | undefined, withSeconds = true): string {
  if (!ts) return withSeconds ? '--:--:--' : '--:--';
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return withSeconds ? '--:--:--' : '--:--';
  return withSeconds
    ? beijingTimeSecFormatter.format(d)
    : beijingTimeMinFormatter.format(d);
}

/**
 * 图表 X 轴时间刻度格式化 (24小时制 北京时间)
 */
export function formatBeijingAxis(tsSec: number, range: string): string {
  if (!tsSec || isNaN(tsSec)) return '';
  const d = new Date(tsSec * 1000);
  if (range === '7d' || range === '30d') {
    return beijingMonthDayHourMinFormatter.format(d).replace(/\//g, '-');
  }
  if (range === '10m') {
    return beijingTimeSecFormatter.format(d);
  }
  return beijingTimeMinFormatter.format(d);
}
