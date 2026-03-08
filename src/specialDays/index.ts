export interface SpecialDayEffect {
  name: string;
  apply: (app: HTMLElement) => void;
  cleanup: () => void;
}

// Lantern Festival dates (元宵节 - 15th day of 1st lunar month)
const LANTERN_FESTIVAL_DATES = [
  '2026-03-03', '2027-02-20', '2028-02-09', '2029-02-27', '2030-02-17',
  '2031-02-06', '2032-02-25', '2033-02-14', '2034-03-05', '2035-02-22',
  '2036-02-11'
];

export async function checkSpecialDay(): Promise<SpecialDayEffect | null> {
  const today = new Date().toISOString().slice(0, 10);

  const monthDay = today.slice(5); // "MM-DD"
  if (monthDay === '03-08') {
    const module = await import('./womensDay');
    return module.default;
  }
  if (monthDay === '03-21' || monthDay === '10-29') {
    const module = await import('./anniversaryDay');
    return module.default;
  }

  if (LANTERN_FESTIVAL_DATES.includes(today)) {
    const module = await import('./lanternFestival');
    return module.default;
  }

  return null;
}
