// Job-circular helpers: guess whether an article is a circular, whether it looks
// government or private, which field it is in, and whether it matches a person's
// preferences. Everything here is a keyword guess over titles/summaries from
// publisher feeds; the UI says so. DOM-free so it can be unit tested.
import { haystack } from './classify.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rule(words) {
  const latin = words.filter((w) => /^[a-z][a-z .-]*$/i.test(w));
  const other = words.filter((w) => !/^[a-z][a-z .-]*$/i.test(w));
  return { re: latin.length ? new RegExp(`\\b(?:${latin.map(escapeRe).join('|')})\\b`, 'i') : null, other };
}
const hit = (r, text, lower) => (r.re && r.re.test(text)) || r.other.some((w) => lower.includes(w));

// An actual opening or application call (not "unemployment rises").
const CIRCULAR = rule(['recruit', 'recruits', 'recruiting', 'recruitment', 'vacancy', 'vacancies', 'circular', 'job circular', 'hiring', 'job opening', 'job openings', 'apply now', 'application deadline', 'applications invited', 'to hire', 'নিয়োগ', 'চাকরি', 'আবেদন', 'নিয়োগ বিজ্ঞপ্তি']);
const JOBISH = rule(['job', 'jobs', 'employment', 'unemployment', 'career', 'careers', 'workforce', 'কর্মসংস্থান', 'বেকার']);

const GOVT = rule(['government', 'govt', 'ministry', 'bpsc', 'public service commission', 'bcs', 'directorate', 'department', 'bangladesh bank', 'sonali bank', 'janata bank', 'agrani bank', 'rupali bank', 'bangladesh railway', 'bangladesh police', 'bangladesh army', 'bangladesh navy', 'air force', 'ansar', 'public university', 'teletalk', 'সরকারি', 'মন্ত্রণালয়', 'অধিদপ্তর', 'অধিদফতর', 'পিএসসি', 'বিসিএস', 'পুলিশ', 'সেনাবাহিনী', 'নৌবাহিনী', 'বিমান বাহিনী', 'আনসার', 'রেলওয়ে']);
const PRIVATE = rule(['private', 'ngo', 'ngos', 'brac', 'company', 'ltd', 'limited', 'multinational', 'bank ltd', 'startup', 'বেসরকারি', 'এনজিও', 'ব্র্যাক', 'কোম্পানি', 'লিমিটেড']);

export const FIELDS = [
  { id: 'teaching', name: 'Teaching & education', rule: rule(['teacher', 'teachers', 'lecturer', 'professor', 'school', 'college', 'university', 'education', 'primary school', 'শিক্ষক', 'প্রভাষক', 'শিক্ষা', 'বিশ্ববিদ্যালয়', 'স্কুল', 'কলেজ']) },
  { id: 'it', name: 'IT & technology', rule: rule(['software', 'developer', 'programmer', 'it officer', 'ict', 'data', 'engineer', 'cyber', 'digital', 'technology', 'প্রযুক্তি', 'আইসিটি', 'সফটওয়্যার']) },
  { id: 'health', name: 'Health & medical', rule: rule(['doctor', 'doctors', 'nurse', 'nurses', 'medical', 'hospital', 'health', 'pharmacist', 'ডাক্তার', 'নার্স', 'স্বাস্থ্য', 'হাসপাতাল', 'চিকিৎসক']) },
  { id: 'banking', name: 'Banking & finance', rule: rule(['bank', 'banks', 'banking', 'finance', 'financial', 'accountant', 'audit', 'insurance', 'ব্যাংক', 'অর্থ', 'হিসাব']) },
  { id: 'agri', name: 'Agriculture & fisheries', rule: rule(['agriculture', 'agricultural', 'agronomist', 'fisheries', 'livestock', 'veterinary', 'কৃষি', 'মৎস্য', 'প্রাণিসম্পদ']) },
  { id: 'engineering', name: 'Engineering & construction', rule: rule(['engineer', 'engineers', 'engineering', 'construction', 'sub-assistant engineer', 'civil', 'electrical', 'প্রকৌশলী', 'প্রকৌশল', 'নির্মাণ']) },
  { id: 'security', name: 'Police, defence & security', rule: rule(['police', 'army', 'navy', 'air force', 'ansar', 'bgb', 'rab', 'constable', 'sub-inspector', 'পুলিশ', 'সেনা', 'নৌবাহিনী', 'বিমান বাহিনী', 'আনসার', 'কনস্টেবল']) },
  { id: 'ngo', name: 'NGO & development', rule: rule(['ngo', 'ngos', 'brac', 'development', 'unicef', 'undp', 'un women', 'এনজিও', 'ব্র্যাক', 'উন্নয়ন']) },
];

// -> { circular: bool, jobish: bool, sector: 'govt'|'private'|'unknown', fields: [ids] }
export function classifyJob(item) {
  const text = haystack(item);
  const lower = text.toLowerCase();
  const circular = item.cat === 'jobs' || hit(CIRCULAR, text, lower);
  const jobish = circular || hit(JOBISH, text, lower);
  const g = hit(GOVT, text, lower);
  const p = hit(PRIVATE, text, lower);
  const sector = g && !p ? 'govt' : p && !g ? 'private' : 'unknown';
  const fields = FIELDS.filter((f) => hit(f.rule, text, lower)).map((f) => f.id);
  return { circular, jobish, sector, fields };
}

export const DEFAULT_PREFS = { sector: 'any', fields: [], keywords: [], notify: false };

export function normalisePrefs(raw) {
  let r = raw;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
  if (!r || typeof r !== 'object') return { ...DEFAULT_PREFS };
  const valid = new Set(FIELDS.map((f) => f.id));
  return {
    sector: ['any', 'govt', 'private'].includes(r.sector) ? r.sector : 'any',
    fields: Array.isArray(r.fields) ? r.fields.filter((f) => valid.has(f)) : [],
    keywords: Array.isArray(r.keywords) ? r.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 20) : [],
    notify: !!r.notify,
  };
}

export function parseKeywords(text) {
  return [...new Set(String(text || '').split(/[,\n،]/).map((k) => k.trim()).filter(Boolean))].slice(0, 20);
}

// Does this article fit the person's preferences?
export function matchesPrefs(item, prefs, cls = classifyJob(item)) {
  if (!cls.circular) return false;
  if (prefs.sector === 'govt' && cls.sector === 'private') return false;
  if (prefs.sector === 'private' && cls.sector === 'govt') return false;
  const wantsSomething = prefs.fields.length || prefs.keywords.length;
  if (!wantsSomething) return true;
  const lower = haystack(item).toLowerCase();
  return prefs.fields.some((f) => cls.fields.includes(f)) || prefs.keywords.some((k) => lower.includes(k.toLowerCase()));
}

// Which items are worth a notification: match preferences, not already announced,
// and published after `since` (ms). Returns the new announced-id list (capped).
export function pickFresh(items, prefs, announced, since) {
  const seen = new Set(announced);
  const fresh = items.filter((it) => {
    if (seen.has(it.id)) return false;
    const t = it.published ? Date.parse(it.published) : NaN;
    if (!(t > since)) return false;
    return matchesPrefs(it, prefs);
  });
  return { fresh, announced: [...announced, ...fresh.map((f) => f.id)].slice(-300) };
}
