// Keyword-based topic matching for Bangladesh news. This is a convenience filter, not
// editorial judgement: the UI says so. Latin keywords match whole words; Bangla
// keywords match as substrings (Bangla has no word-boundary-friendly regex). DOM-free.

const KEYWORDS = {
  education: ['education', 'school', 'schools', 'student', 'students', 'university', 'universities', 'college', 'exam', 'exams', 'hsc', 'ssc', 'teacher', 'teachers', 'admission', 'curriculum', 'শিক্ষা', 'শিক্ষার্থী', 'বিশ্ববিদ্যালয়', 'স্কুল', 'কলেজ', 'পরীক্ষা', 'ভর্তি', 'শিক্ষক', 'এইচএসসি', 'এসএসসি'],
  jobs: ['job', 'jobs', 'recruitment', 'vacancy', 'vacancies', 'circular', 'hiring', 'employment', 'unemployment', 'চাকরি', 'নিয়োগ', 'বিজ্ঞপ্তি', 'কর্মসংস্থান'],
  technology: ['technology', 'tech', 'internet', 'software', 'startup', 'startups', 'digital', 'ai', 'artificial', 'mobile', 'app', 'cyber', 'broadband', 'প্রযুক্তি', 'ইন্টারনেট', 'সাইবার', 'ডিজিটাল', 'কৃত্রিম বুদ্ধিমত্তা'],
  science: ['science', 'scientist', 'scientists', 'research', 'researchers', 'space', 'nasa', 'climate', 'vaccine', 'discovery', 'বিজ্ঞান', 'বিজ্ঞানী', 'গবেষণা', 'মহাকাশ'],
  sports: ['cricket', 'football', 'bpl', 'match', 'tournament', 'tigers', 'sports', 'athlete', 'olympic', 'olympics', 'tennis', 'খেলা', 'ক্রিকেট', 'ফুটবল', 'বিপিএল', 'ম্যাচ', 'টাইগার'],
  agriculture: ['agriculture', 'agricultural', 'farmer', 'farmers', 'crop', 'crops', 'paddy', 'rice', 'harvest', 'fisheries', 'fishery', 'livestock', 'irrigation', 'fertiliser', 'fertilizer', 'কৃষি', 'কৃষক', 'ধান', 'ফসল', 'মৎস্য', 'সেচ', 'সার'],
};

export const BD_CATEGORIES = [
  { id: 'national', name: 'National' },
  { id: 'education', name: 'Education' },
  { id: 'jobs', name: 'Jobs' },
  { id: 'technology', name: 'Technology' },
  { id: 'science', name: 'Science' },
  { id: 'sports', name: 'Sports' },
  { id: 'agriculture', name: 'Agriculture' },
  { id: 'local', name: 'Local' },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES = Object.fromEntries(Object.entries(KEYWORDS).map(([cat, words]) => {
  const latin = words.filter((w) => /^[a-z]+$/i.test(w));
  const other = words.filter((w) => !/^[a-z]+$/i.test(w));
  return [cat, { re: latin.length ? new RegExp(`\\b(?:${latin.map(escapeRe).join('|')})\\b`, 'i') : null, other }];
}));

export function haystack(item) {
  return [item.title, item.summary, (item.categories || []).join(' ')].join(' \n ');
}

// Returns the specific categories an article matches (may be empty).
export function matchCategories(item) {
  const text = haystack(item);
  const lower = text.toLowerCase();
  const out = [];
  for (const [cat, rule] of Object.entries(RULES)) {
    if ((rule.re && rule.re.test(text)) || rule.other.some((w) => lower.includes(w))) out.push(cat);
  }
  return out;
}

// Names of places (districts/divisions) mentioned in the article.
export function matchPlaces(item, placeNames) {
  const text = haystack(item).toLowerCase();
  return placeNames.filter((n) => text.includes(n.toLowerCase()));
}

// National = anything that did not match a more specific topic.
export function inCategory(item, cat, { place = '' } = {}) {
  if (cat === 'all') return true;
  if (cat === 'local') return place ? haystack(item).toLowerCase().includes(place.toLowerCase()) : false;
  const matched = matchCategories(item);
  if (cat === 'national') return matched.length === 0;
  return matched.includes(cat);
}
