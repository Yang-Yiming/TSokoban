export interface SpecialDayEffect {
  name: string;
  apply: (app: HTMLElement) => void;
  cleanup: () => void;
}

// Lantern Festival dates (元宵节 - 15th day of 1st lunar month)
const LANTERN_FESTIVAL_DATES = [
  '2026-02-12', '2026-03-03', '2027-03-03', '2028-02-20', '2029-02-08',
  '2030-01-28', '2031-02-16', '2032-02-05', '2033-01-24',
  '2034-02-12', '2035-02-01', '2036-02-20'
];

export async function checkSpecialDay(): Promise<SpecialDayEffect | null> {
  const today = new Date().toISOString().slice(0, 10);

  if (LANTERN_FESTIVAL_DATES.includes(today)) {
    const module = await import('./lanternFestival');
    return module.default;
  }

  return null;
}
