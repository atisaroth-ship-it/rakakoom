const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function baht(satang: number): string {
  const whole = Math.floor(satang / 100);
  const frac = satang % 100;
  return `฿${whole.toLocaleString('en-US')}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

export function thaiDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}
