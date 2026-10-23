// Bangladesh revised Bangla calendar (Bangla Academy revision), DOM-free.
// Rule: Pohela Boishakh is 14 April. Boishakh–Ashwin have 31 days, Kartik–Chaitra
// 30 days, except Falgun which has 29 days (30 in a Gregorian leap year). That is
// equivalent to the fixed Gregorian start dates below, so leap years fall out of
// real date arithmetic and never need special-casing.

// [gregorianMonth, gregorianDay] on which each Bangla month begins, Boishakh → Chaitra.
const STARTS = [[4, 14], [5, 15], [6, 15], [7, 16], [8, 16], [9, 16], [10, 17], [11, 16], [12, 16], [1, 15], [2, 14], [3, 15]];

export const MONTHS_EN = ['Boishakh', 'Joishtho', 'Asharh', 'Srabon', 'Bhadro', 'Ashwin', 'Kartik', 'Agrahayan', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
export const MONTHS_BN = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
export const WEEKDAYS_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

export function bnDigits(n) {
  return String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

// y, m (1-12), d -> {year, monthIndex (0 = Boishakh), day}
export function toBangla(y, m, d) {
  const year = m > 4 || (m === 4 && d >= 14) ? y - 593 : y - 594;
  const date = Date.UTC(y, m - 1, d);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const [sm, sd] = STARTS[i];
    for (const sy of [y - 1, y]) {
      const s = Date.UTC(sy, sm - 1, sd);
      if (s <= date && (best === null || s > best.s)) best = { i, s };
    }
  }
  return { year, monthIndex: best.i, day: Math.round((date - best.s) / 864e5) + 1 };
}

export function formatBangla(date = new Date()) {
  const b = toBangla(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return {
    bn: `${bnDigits(b.day)} ${MONTHS_BN[b.monthIndex]} ${bnDigits(b.year)}`,
    en: `${b.day} ${MONTHS_EN[b.monthIndex]} ${b.year}`,
    weekdayBn: WEEKDAYS_BN[date.getDay()],
    ...b,
  };
}
