const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });

/** วันที่ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function bangkokDate(now: Date): string {
  return fmt.format(now);
}
