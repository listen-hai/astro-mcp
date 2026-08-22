/**
 * Chinese/English term tables for chart output (spec 9.1).
 *
 * JSON field NAMES stay in English always -- they're part of a language-
 * neutral API. Only the astrology-term string VALUES (signs, bodies,
 * aspects) and the prose diagnostic messages get translated here, switched
 * by the `lang` input ('zh' default, 'en' opt-in).
 */

export type Lang = 'zh' | 'en';

const SIGNS_ZH = [
  '白羊', '金牛', '双子', '巨蟹', '狮子', '处女',
  '天秤', '天蝎', '射手', '摩羯', '水瓶', '双鱼',
] as const;

const SIGNS_EN = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

/** Zodiac sign index (0 = Aries .. 11 = Pisces) for an ecliptic longitude. */
export function signIndexOf(longitude: number): number {
  return Math.floor(((longitude % 360) + 360) % 360 / 30);
}

export function signNameByIndex(index: number, lang: Lang): string {
  return lang === 'zh' ? SIGNS_ZH[index] : SIGNS_EN[index];
}

export function signOfLongitude(longitude: number, lang: Lang): string {
  return signNameByIndex(signIndexOf(longitude), lang);
}

/** Internal (astronomy-engine) body identifiers -> display names. */
const BODY_ZH: Record<string, string> = {
  Sun: '太阳', Moon: '月亮', Mercury: '水星', Venus: '金星', Mars: '火星',
  Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星', Pluto: '冥王星',
  Chiron: '凯龙', Ceres: '谷神', Pallas: '智神', Juno: '婚神', Vesta: '灶神',
  NorthNode: '北交点', SouthNode: '南交点', Lilith: '莉莉丝',
};

const BODY_EN: Record<string, string> = {
  Sun: 'Sun', Moon: 'Moon', Mercury: 'Mercury', Venus: 'Venus', Mars: 'Mars',
  Jupiter: 'Jupiter', Saturn: 'Saturn', Uranus: 'Uranus', Neptune: 'Neptune', Pluto: 'Pluto',
  Chiron: 'Chiron', Ceres: 'Ceres', Pallas: 'Pallas', Juno: 'Juno', Vesta: 'Vesta',
  NorthNode: 'North Node', SouthNode: 'South Node', Lilith: 'Lilith',
};

export function bodyName(internal: string, lang: Lang): string {
  const table = lang === 'zh' ? BODY_ZH : BODY_EN;
  return table[internal] ?? internal;
}

/**
 * Display names for the two angles (v2: synastry/transits aspect the
 * Ascendant/Midheaven directly, which calculate_natal's own aspect list
 * never needed to name since it never includes them).
 */
const ANGLE_ZH: Record<'Ascendant' | 'Midheaven', string> = { Ascendant: '上升', Midheaven: '天顶' };

export function angleName(internal: 'Ascendant' | 'Midheaven', lang: Lang): string {
  return lang === 'zh' ? ANGLE_ZH[internal] : internal;
}

/** Aspect names are already Chinese at the source (src/core/aspects.ts); map back to English on request. */
const ASPECT_EN: Record<string, string> = {
  合: 'Conjunction', 六合: 'Sextile', 刑: 'Square', 拱: 'Trine', 冲: 'Opposition',
  半六合: 'Semisextile', 八分之三: 'Semisquare', 五分相: 'Quintile', 补十二: 'Quincunx',
  平行: 'Parallel', 反平行: 'Contraparallel',
};

export function aspectName(zhName: string, lang: Lang): string {
  return lang === 'zh' ? zhName : (ASPECT_EN[zhName] ?? zhName);
}

/** Essential-dignity kind (spec 7.4); null passes through unchanged. */
const DIGNITY_EN: Record<string, string> = {
  庙: 'Domicile', 旺: 'Exaltation', 陷: 'Detriment', 落: 'Fall',
};

export function dignityDisplay(kind: string | null, lang: Lang): string | null {
  if (kind === null) return null;
  return lang === 'zh' ? kind : (DIGNITY_EN[kind] ?? kind);
}

/**
 * Why a field is missing in modes B/C (spec 4.3/9.3). Bilingual since this is
 * user-facing prose in the same output the `lang` switch already governs.
 */
export const OMISSION_REASONS: Record<string, { zh: string; en: string }> = {
  angles: {
    zh: '上升与天顶需要精确出生时间（上升每 4 分钟走 1°）',
    en: 'The Ascendant and Midheaven need an exact birth time (the Ascendant moves about 1 degree every 4 minutes).',
  },
  houses: {
    zh: '十二宫位全部由上升与天顶导出',
    en: 'The houses are derived from the Ascendant and Midheaven.',
  },
  'positions[].house': {
    zh: '同上：宫位由上升与天顶导出',
    en: 'Same as above: the houses are derived from the Ascendant and Midheaven.',
  },
  partOfFortune: {
    zh: '福点公式依赖上升与日夜盘判定，两者均需精确时间',
    en: 'The Part of Fortune formula depends on the Ascendant and on the day/night (sect) determination, both of which need an exact birth time.',
  },
  'aspects[].applying': {
    zh: '入相位判定需要精确时刻的相对速度',
    en: 'Determining whether an aspect is applying needs the relative speed at a precise moment.',
  },
  'overlays.aInB': {
    zh: 'A 的天体落宫需要 B 的十二宫位，而 B 出生时间未知',
    en: "Placing A's bodies into B's houses needs B's twelve houses, and B's birth time is unknown.",
  },
  'overlays.bInA': {
    zh: 'B 的天体落宫需要 A 的十二宫位，而 A 出生时间未知',
    en: "Placing B's bodies into A's houses needs A's twelve houses, and A's birth time is unknown.",
  },
  'transiting[].natalHouse': {
    zh: '行运天体落入本命第几宫需要本命的十二宫位，而本命出生时间未知',
    en: 'Which natal house a transiting body falls in needs the natal twelve houses, and the natal birth time is unknown.',
  },
};

export function omissionReason(field: string, lang: Lang): string {
  const entry = OMISSION_REASONS[field];
  return lang === 'zh' ? entry.zh : entry.en;
}

export const ACCURACY_NOTE: { zh: string; en: string } = {
  zh: '主星与交点 ≤1′；小天体（凯龙/谷神/智神/婚神/灶神）≤1.5′（对 JPL Horizons，1900-2100，含光行时修正）',
  en: 'Major bodies and lunar nodes are accurate to <=1 arcminute; small bodies (Chiron/Ceres/Pallas/Juno/Vesta) to <=1.5 arcminutes, measured against JPL Horizons across 1900-2100 with light-time correction applied.',
};
