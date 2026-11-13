/**
 * bnpanel render engine — deterministic storyboard planner.
 *
 * This is a compatible-but-richer successor of
 * `D:\AI\Vibe\vibemotion-video\src\storyboard.ts`:
 *
 *  · same `hashText()` (bit-for-bit identical to the reference implementation),
 *  · same `PALETTES` (same four presets, same order, same hex values),
 *  · same `DURATIONS` weights (hook 90 / process 150 / cta 60 → 300 frames @30fps),
 *  · same `FLOW_ORDER` and the same `params → index` resolution rules.
 *
 * Everything added on top (duration scaling, beat grid, hex overrides,
 * subtitle modes, 5 style looks, per-shot locking) is still a PURE FUNCTION of
 * (brief, params). There is no `Date.now()` and no `Math.random()` anywhere in
 * this file — that is the product promise: same brief + same params ⇒ same video.
 */

export const FPS = 30;

/* ------------------------------------------------------------------ *
 * Colours
 * ------------------------------------------------------------------ */

export type Palette = {
  name: string;
  bg: string;
  fg: string;
  accent: string;
};

/** The four global palette presets — identical to vibemotion-video. */
export const PALETTES: Palette[] = [
  { name: '科技暗色', bg: '#0b1020', fg: '#e8ecff', accent: '#6d5efc' },
  { name: '终端绿', bg: '#07130d', fg: '#d8ffe6', accent: '#38d9a9' },
  { name: '霓虹紫', bg: '#14091f', fg: '#f6e8ff', accent: '#c56bff' },
  { name: '极简白', bg: '#f6f7fb', fg: '#14172b', accent: '#2f6bff' },
];

/** A look's own colour identity. */
export type LookTone = { bg: string; fg: string; accent: string };

export type LookKind = 'swiss' | 'blueprint' | 'crt' | 'halftone' | 'oneline';

export type Look = {
  /** stable key — this is what a template's `style.tokens[0]` should hold */
  id: string;
  name: string;
  kind: LookKind;
  /** the display face the big statement uses */
  titleFont: 'sans' | 'mono';
  /** the look's signature colours */
  tone: LookTone;
  /**
   * How much the look's own colour wins over the selected palette preset.
   * 1 = the look fully owns the colour, 0 = the preset wins. A middle value
   * keeps the palette choice visible while keeping the look coherent.
   */
  toneMix: { bg: number; fg: number; accent: number };
  /** how the caption band is drawn */
  caption: 'bar' | 'box' | 'band';
};

/** The five style looks. `params.style` is the index into this array. */
export const LOOKS: Look[] = [
  {
    id: 'swiss-dynamic-type',
    name: 'Swiss Dynamic Type',
    kind: 'swiss',
    titleFont: 'sans',
    tone: { bg: '#0c0c0e', fg: '#f5f5f7', accent: '#ff4d1c' },
    toneMix: { bg: 0.85, fg: 0.72, accent: 0.35 },
    caption: 'bar',
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    kind: 'blueprint',
    titleFont: 'mono',
    tone: { bg: '#0a2a4d', fg: '#eaf4ff', accent: '#7fd4ff' },
    toneMix: { bg: 0.85, fg: 0.75, accent: 0.6 },
    caption: 'box',
  },
  {
    id: 'terminal-crt',
    name: 'Terminal CRT',
    kind: 'crt',
    titleFont: 'mono',
    tone: { bg: '#050806', fg: '#b9ffcf', accent: '#3ddc84' },
    toneMix: { bg: 0.9, fg: 0.85, accent: 0.7 },
    caption: 'box',
  },
  {
    id: 'halftone-dossier',
    name: 'Halftone Dossier',
    kind: 'halftone',
    titleFont: 'mono',
    tone: { bg: '#efe8da', fg: '#1d1a15', accent: '#c0392b' },
    toneMix: { bg: 0.9, fg: 0.85, accent: 0.55 },
    caption: 'band',
  },
  {
    id: 'one-line',
    name: 'One Line',
    kind: 'oneline',
    titleFont: 'sans',
    tone: { bg: '#101014', fg: '#f2f2f4', accent: '#ff8a3d' },
    toneMix: { bg: 0.85, fg: 0.72, accent: 0.35 },
    caption: 'bar',
  },
];

export const LOOK_IDS = LOOKS.map((l) => l.id);

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

export type TypeCopy = {
  hookName: string;
  hookMotion: string;
  hookCard: string;
  hookEn: string;
  processCopy: string;
  processEn: string;
  processMotion: string;
  processCard: string;
  /** 4 progressive steps for the process shot (zh + en) */
  steps: { zh: string; en: string }[];
  ctaCopy: string;
  ctaEn: string;
  ctaMotion: string;
  ctaCard: string;
  ctaSub: string;
  codeLines: string[];
};

/**
 * Content archetypes. `params.type` is the index into this array.
 *
 * Each entry supplies the default copy for the three shots, so a render never
 * depends on a model having answered: the archetype is the guaranteed floor.
 * The three map 1:1 onto AiBench's first three tracks:
 *   0 科普解说 explainer · 1 品牌片头 ident · 2 数据故事 data
 */
export const TYPE_COPY: TypeCopy[] = [
  {
    hookName: '钩子 · 先给结论',
    hookMotion: '大字卡弹入 + 轻微缩放',
    hookCard: 'Explainer / Hook',
    hookEn: 'THE CLAIM',
    processCopy: '一件事，拆成三步讲',
    processEn: 'BREAK IT INTO THREE',
    processMotion: '步骤卡依次推进',
    processCard: 'Explainer / Steps',
    steps: [
      { zh: '先把问题问清楚', en: 'Name the question' },
      { zh: '拆出关键的那一层', en: 'Find the lever' },
      { zh: '用一条证据顶住', en: 'Back it with evidence' },
      { zh: '落到能行动的一句话', en: 'Land on one action' },
    ],
    ctaCopy: '记住这一句就够了。',
    ctaEn: 'One line is enough.',
    ctaMotion: '结论卡落版 + 强调色下划线',
    ctaCard: 'Explainer / Outro',
    ctaSub: 'AIBENCH · 科普解说',
    codeLines: [
      'const claim = "先给结论，再拆过程";',
      'const sb = planStoryboard(claim, params);',
      'for (const shot of sb.shots) {',
      '  await render(<Shot {...shot} />);',
      '}',
      'console.log(sb.totalFrames + " frames @ 30fps");',
    ],
  },
  {
    hookName: '片头 · 字标起手',
    hookMotion: '字标切入 + 网格展开',
    hookCard: 'Ident / Mark',
    hookEn: 'THE MARK',
    processCopy: '几何推进，卡在鼓点上',
    processEn: 'GEOMETRY ON THE BEAT',
    processMotion: '几何块逐拍拼合',
    processCard: 'Ident / Build',
    steps: [
      { zh: '字标落位', en: 'Set the mark' },
      { zh: '几何展开', en: 'Open the grid' },
      { zh: '鼓点推进', en: 'Cut on the beat' },
      { zh: '一秒落版', en: 'Lock the end card' },
    ],
    ctaCopy: '落版。',
    ctaEn: 'End card.',
    ctaMotion: '落版帧 + 强调色描边',
    ctaCard: 'Ident / End Card',
    ctaSub: 'AIBENCH · 品牌片头',
    codeLines: [
      'const bpm = 120;',
      'const beat = 60 / bpm; // 0.5s = 15 frames',
      'await renderIdent({ bpm, mark: "AIBENCH" });',
    ],
  },
  {
    hookName: '数据 · 抛一个数',
    hookMotion: '大数字滚动定格',
    hookCard: 'Data / Number',
    hookEn: 'THE NUMBER',
    processCopy: '三个数字，一句结论',
    processEn: 'THREE NUMBERS, ONE POINT',
    processMotion: '柱状逐根生长 + 峰值高亮',
    processCard: 'Data / Compare',
    steps: [
      { zh: '先看总量', en: 'See the total' },
      { zh: '再看结构', en: 'See the split' },
      { zh: '找那个异常值', en: 'Spot the outlier' },
      { zh: '给一句结论', en: 'Say what it means' },
    ],
    ctaCopy: '数据自己会说话。',
    ctaEn: 'Let the data speak.',
    ctaMotion: '结论卡 + 数据来源小字',
    ctaCard: 'Data / Outro',
    ctaSub: 'AIBENCH · 数据故事',
    codeLines: [
      'const series = [12, 28, 41, 67];',
      'const peak = Math.max(...series);',
      'await renderBars({ series, highlight: peak });',
    ],
  },
];

/** Shot durations per kind — the weights used to scale a longer timeline. */
export const DURATIONS: Record<ShotKind, number> = { hook: 90, process: 150, cta: 60 };

/** FLOW_OPTIONS in client.js: playback order of the three shot kinds. */
export const FLOW_ORDER: ShotKind[][] = [
  ['hook', 'process', 'cta'], // 钩子优先
  ['process', 'hook', 'cta'], // 过程优先
  ['cta', 'hook', 'process'], // 结果前置
];

/* ------------------------------------------------------------------ *
 * Params / storyboard shapes
 * ------------------------------------------------------------------ */

export type ShotKind = 'hook' | 'process' | 'cta';

export type SubtitleMode = 'none' | 'zh' | 'en' | 'bilingual';

/**
 * One shot of an authored script.
 *
 * The archetype copy in `TYPE_COPY` is a floor, not a script: it says the same
 * thing for every video ("一件事，拆成三步讲"). A script replaces the words while
 * keeping every timing rule — beat snapping, duration distribution, minimum shot
 * length — in this file, so an authored video is laid out exactly like a
 * planned one.
 */
export type ScriptShot = {
  kind: ShotKind;
  /** the big on-screen line */
  copy: string;
  /** the narration line under it; falls back to `copy` */
  caption?: string;
  /** small English gloss */
  en?: string;
  /** progressive items for a process shot */
  steps?: { zh: string; en: string }[];
  /** relative share of the timeline (defaults to `DURATIONS[kind]`) */
  weight?: number;
  /** overrides for the small labels */
  name?: string;
  card?: string;
  motion?: string;
  transition?: string;
};

export type Script = {
  title?: string;
  shots: ScriptShot[];
};

/** A script longer than this stops being a short video. */
export const MAX_SCRIPT_SHOTS = 8;
/** Below this a shot cannot animate in and out inside a 30fps timeline. */
export const MIN_SCRIPT_SHOT_FRAMES = 24;

export type BnParams = {
  /** 0 发布片 / 1 教程演示 / 2 引流混剪 */
  type?: number;
  /** index into LOOKS (0..4) */
  style?: number;
  /** 0 钩子优先 / 1 过程优先 / 2 结果前置 */
  flow?: number;
  /** index into PALETTES */
  palette?: number;
  /** index into the BGM bed table */
  bgm?: number;
  /** index into the SFX cue-set table */
  sfxSet?: number;
  /** 0 = muted, 1 = narration + captions */
  voice?: number;
  /** index into the curated transition table (0 = hard cut) */
  transition?: number;
  /** index into the curated effect table (0 = none) */
  effect?: number;
  /** total length in seconds (default 10 → 300 frames @30fps) */
  durationSec?: number;
  /** hex accent override */
  accent?: string;
  /** hex background override */
  bg?: string;
  /** hex foreground override */
  fg?: string;
  /** tempo of the beat grid (default 120) */
  beatBpm?: number;
  /** caption language mode */
  subtitle?: SubtitleMode;
  /** on-screen title (overrides the brief on the hook shot) */
  title?: string;
  /** fields the panel pinned — "hook.copy", "durationFrames", "palette", … */
  locked?: string[];
  /** explicit deterministic seed (default = hashText(brief)) */
  seed?: number;
};

export type BnProps = {
  brief: string;
  params?: BnParams;
  storyboard?: Storyboard;
  /** an authored script; replaces the archetype copy, keeps every timing rule */
  script?: Script;
  voiceLines?: string[];
  seed?: number;
};

export type ShotStep = {
  /** reveal offset inside the shot, in frames (snapped to the beat grid) */
  at: number;
  zh: string;
  en: string;
};

export type Shot = {
  /** 1-based position in playback order */
  index: number;
  kind: ShotKind;
  name: string;
  /** absolute start frame inside the composition */
  from: number;
  durationFrames: number;
  copy: string;
  motion: string;
  transition: string;
  card: string;
  /** the shot's start frame is an exact multiple of the beat grid */
  beat?: boolean;
  /** field names the panel pinned on this shot */
  locked?: string[];
  /** optional English gloss of `copy` */
  en?: string;
  /** progressive items for a process shot */
  steps?: ShotStep[];
  /**
   * The narration line shown as the subtitle. Defaults to `copy` when the
   * Host supplies its own storyboard.
   */
  caption?: string;
};

export type Storyboard = {
  /** the on-screen title */
  title: string;
  seed: number;
  fps: number;
  totalFrames: number;
  palette: Palette;
  paletteIndex: number;
  /** the resolved style look */
  look: Look;
  type: number;
  style: number;
  flow: number;
  bgmIndex: number;
  sfxSet: number;
  voiceIndex: number;
  transitionIndex: number;
  effectIndex: number;
  /** NEW — total length in seconds the plan was built for */
  durationSec: number;
  /** NEW — tempo of the beat grid */
  beatBpm: number;
  /** NEW — length of one beat in frames (float) */
  beatFrames: number;
  /** NEW — caption mode */
  subtitle: SubtitleMode;
  /** NEW — top level locked fields */
  locked: string[];
  shots: Shot[];
};

/* ------------------------------------------------------------------ *
 * Counts (kept in sync with the reference project)
 * ------------------------------------------------------------------ */

export const VOICE_OPTION_COUNT = 2;
export const TRANSITION_COUNT = 8;
export const EFFECT_COUNT = 8;
export const BGM_BED_COUNT = 3;
export const SFX_SET_COUNT = 3;

/* ------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------ */

/** Identical to vibemotion-video/src/storyboard.ts. */
export function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalizeIndex(value: number | undefined, length: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  if (int < 0 || int >= length) return fallback;
  return int;
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Parse "#rgb" / "#rrggbb" into [r,g,b]. Returns null when unparseable. */
export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return [r, g, b];
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return [r, g, b];
  }
  return null;
}

const toHex = (n: number) =>
  clampNum(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/** Blend two hex colours. `t` = 0 keeps `a`, `t` = 1 returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const k = clampNum(t, 0, 1);
  const mix = (i: number) => ca[i] + (cb[i] - ca[i]) * k;
  return `#${toHex(mix(0))}${toHex(mix(1))}${toHex(mix(2))}`;
}

/**
 * Apply the look's colour identity to the selected palette, then apply the
 * user's explicit hex overrides on top (a user pin always wins).
 */
export function resolvePalette(base: Palette, look: Look, params: BnParams): Palette {
  const t = look.tone;
  const m = look.toneMix;
  const out: Palette = {
    name: base.name,
    bg: mixHex(base.bg, t.bg, m.bg),
    fg: mixHex(base.fg, t.fg, m.fg),
    accent: mixHex(base.accent, t.accent, m.accent),
  };
  if (params.bg && parseHex(params.bg)) out.bg = params.bg;
  if (params.fg && parseHex(params.fg)) out.fg = params.fg;
  if (params.accent && parseHex(params.accent)) out.accent = params.accent;
  return out;
}

/* ------------------------------------------------------------------ *
 * Beat grid
 * ------------------------------------------------------------------ */

/** Length of one beat in frames: `60 / bpm * fps`. */
export function beatFrames(bpm: number, fps: number = FPS): number {
  const safe = typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return (60 / safe) * fps;
}

/** The frame of the n-th beat (0-based). */
export function beatFrame(n: number, bpm: number, fps: number = FPS): number {
  return Math.round(n * beatFrames(bpm, fps));
}

/**
 * Snap `frame` onto the beat grid (nearest multiple of the beat length).
 * The result is always an exact multiple of the grid, so a `beat: true` shot
 * provably starts on a beat.
 */
export function snapToBeat(frame: number, bpm: number, fps: number = FPS): number {
  const g = beatFrames(bpm, fps);
  if (g <= 0) return Math.round(frame);
  return Math.round(Math.round(frame / g) * g);
}

/** First grid point at or after `frame`. */
function snapUpToBeat(frame: number, bpm: number, fps: number = FPS): number {
  const g = beatFrames(bpm, fps);
  if (g <= 0) return Math.round(frame);
  return Math.ceil(frame / g) * g;
}

/* ------------------------------------------------------------------ *
 * Planner
 * ------------------------------------------------------------------ */

export const DEFAULT_BRIEF = '我的下一个 vibecoding 作品';

/** Minimum / maximum length in seconds. */
export const MIN_DURATION_SEC = 10;
export const MAX_DURATION_SEC = 300;
export const DEFAULT_DURATION_SEC = 10;

/** Distribute `total` frames over `weights` with an exact integer sum. */
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map((r) => Math.floor(r));
  let rest = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k++, rest--) base[order[k % order.length].i] += 1;
  return base;
}

/** Locked fields for a shot kind — "hook.copy" or a bare "copy" (all shots). */
function lockedFieldsFor(locked: string[], kind: ShotKind): string[] {
  const out: string[] = [];
  for (const entry of locked) {
    const [scope, field] = entry.includes('.') ? entry.split('.') : [null, entry];
    if (scope === null || scope === kind) out.push(field);
  }
  return out;
}

/**
 * The narration line for a shot.
 *
 * Kept separate from `copy` because the two serve different readers: the big
 * on-screen type is a headline (terse, truncated to fit), while a subtitle is
 * the full spoken sentence. Reusing the headline as the caption would put the
 * same words on screen twice, which is why `Captions` never falls back to
 * `shot.copy` and this must supply something.
 *
 * The hook is the one place where the headline and the narration are the same
 * idea: the headline is the brief truncated to fit the type, so the narration is
 * the untruncated brief. When the brief is already short enough to fit, the two
 * coincide — correct, not a bug.
 */
function narrationFor(
  kind: ShotKind,
  copy: TypeCopy,
  title: string,
  brief: string,
): { zh: string; en: string } {
  if (kind === 'hook') {
    return { zh: brief || title, en: copy.hookEn };
  }
  if (kind === 'process') {
    return { zh: copy.processCopy, en: copy.processEn };
  }
  return { zh: copy.ctaCopy, en: copy.ctaEn };
}

export function planStoryboard(brief: string, params: BnParams = {}): Storyboard {
  const text = String(brief ?? '').trim() || DEFAULT_BRIEF;
  const hash = hashText(text);
  const seed =
    typeof params.seed === 'number' && Number.isFinite(params.seed)
      ? Math.trunc(params.seed) >>> 0
      : hash;

  // Same resolution rules as the reference implementation.
  const paletteIndex = normalizeIndex(params.palette, PALETTES.length, seed % PALETTES.length);
  const typeIndex = normalizeIndex(params.type, TYPE_COPY.length, seed % TYPE_COPY.length);
  const styleIndex = normalizeIndex(params.style, LOOKS.length, (seed >>> 3) % LOOKS.length);
  const flowIndex = normalizeIndex(params.flow, FLOW_ORDER.length, (seed >>> 7) % FLOW_ORDER.length);
  const bgmIndex = normalizeIndex(params.bgm, BGM_BED_COUNT, styleIndex % BGM_BED_COUNT);
  const sfxSet = normalizeIndex(params.sfxSet, SFX_SET_COUNT, typeIndex % SFX_SET_COUNT);
  const voiceIndex = normalizeIndex(params.voice, VOICE_OPTION_COUNT, 1);
  const transitionIndex = normalizeIndex(params.transition, TRANSITION_COUNT, 0);
  const effectIndex = normalizeIndex(params.effect, EFFECT_COUNT, 0);

  const durationSec = clampNum(
    typeof params.durationSec === 'number' && Number.isFinite(params.durationSec)
      ? params.durationSec
      : DEFAULT_DURATION_SEC,
    MIN_DURATION_SEC,
    MAX_DURATION_SEC,
  );
  const totalFrames = Math.round(durationSec * FPS);
  const beatBpm =
    typeof params.beatBpm === 'number' && Number.isFinite(params.beatBpm) && params.beatBpm > 0
      ? params.beatBpm
      : 120;
  const grid = beatFrames(beatBpm, FPS);

  const subtitle: SubtitleMode =
    params.subtitle === 'none' ||
    params.subtitle === 'zh' ||
    params.subtitle === 'en' ||
    params.subtitle === 'bilingual'
      ? params.subtitle
      : 'bilingual';

  const locked = Array.isArray(params.locked) ? params.locked.filter((x) => typeof x === 'string') : [];
  const look = LOOKS[styleIndex];
  const copy = TYPE_COPY[typeIndex];
  const kinds = FLOW_ORDER[flowIndex];
  const cut = text.length > 26 ? text.slice(0, 26) + '…' : text;
  const title = params.title && params.title.trim() ? params.title.trim() : cut;

  /* --- durations ------------------------------------------------- */

  const kindsWeights = kinds.map((k) => DURATIONS[k]);
  let durations = distribute(totalFrames, kindsWeights);

  // A locked duration wins; the rest of the timeline is redistributed around it.
  const lockedDur = new Map<number, number>();
  kinds.forEach((kind, i) => {
    const fields = lockedFieldsFor(locked, kind);
    if (!fields.includes('durationFrames')) return;
    const proportional = Math.round((totalFrames * DURATIONS[kind]) / 300);
    lockedDur.set(i, proportional);
  });
  if (lockedDur.size > 0) {
    const fixed = [...lockedDur.values()].reduce((a, b) => a + b, 0);
    const freeIdx = kinds.map((_, i) => i).filter((i) => !lockedDur.has(i));
    const freeWeights = freeIdx.map((i) => kindsWeights[i]);
    const freeTotal = Math.max(0, totalFrames - fixed);
    const free = distribute(freeTotal, freeWeights);
    freeIdx.forEach((i, k) => (durations[i] = free[k]));
    lockedDur.forEach((v, i) => (durations[i] = v));
  }

  /* --- starts + beat snapping ------------------------------------ */

  // Snap the interior shot boundaries onto the beat grid first, then derive the
  // shot durations from those boundaries. Doing it in this order is what keeps
  // the three invariants true at once: no two shots overlap, no gap opens
  // between them, and the sum of the shot frames is exactly totalFrames.
  const boundaries: number[] = [0];
  {
    let cursor = 0;
    for (let i = 1; i < kinds.length; i++) {
      const prevLocked = lockedFieldsFor(locked, kinds[i - 1]);
      const selfLocked = lockedFieldsFor(locked, kinds[i]);
      const canSnap =
        !prevLocked.includes('durationFrames') &&
        !selfLocked.includes('durationFrames') &&
        !selfLocked.includes('from');
      cursor += durations[i - 1];
      if (canSnap) {
        const snapped = Math.round(snapUpToBeat(cursor, beatBpm, FPS));
        const delta = snapped - cursor;
        const room = Math.min(durations[i - 1], durations[i]) - 12;
        if (delta > 0 && delta <= room) cursor = snapped;
      }
      // Leave at least 12 frames for every shot still ahead of this boundary.
      const cap = totalFrames - 12 * (kinds.length - i);
      boundaries.push(Math.min(cursor, cap));
    }
  }

  const starts: number[] = boundaries.slice();
  for (let i = 0; i < kinds.length; i++) {
    const end = i === kinds.length - 1 ? totalFrames : boundaries[i + 1];
    durations[i] = end - boundaries[i];
  }

  /* --- build the shots ------------------------------------------- */

  const shots: Shot[] = kinds.map((kind, i) => {
    const fields = lockedFieldsFor(locked, kind);
    const durationFrames = durations[i];
    const from = starts[i];
    const isBeat =
      kind === 'hook' || kind === 'cta'
        ? !fields.includes('from')
        : false;

    let shotCopy = '';
    let en = '';
    let motion = '';
    let transition = '';
    let card = '';
    let name = '';
    let steps: ShotStep[] | undefined;

    if (kind === 'hook') {
      name = copy.hookName;
      shotCopy = title;
      en = copy.hookEn;
      motion = copy.hookMotion;
      transition = '硬切';
      card = copy.hookCard;
    } else if (kind === 'process') {
      name = '过程 · ' + copy.processCard.split(' / ')[0];
      shotCopy = copy.processCopy;
      en = copy.processEn;
      motion = copy.processMotion;
      transition = '推进';
      card = copy.processCard;
      const n = copy.steps.length;
      steps = copy.steps.map((s, k) => {
        const raw = Math.round((k * durationFrames) / n);
        const snapped = Math.round(snapUpToBeat(raw, beatBpm, FPS));
        const at = Math.min(Math.max(0, snapped), Math.max(0, durationFrames - 18));
        return { at, zh: s.zh, en: s.en };
      });
    } else {
      name = '收尾 · CTA';
      shotCopy = copy.ctaCopy;
      en = copy.ctaEn;
      motion = copy.ctaMotion;
      transition = '淡出';
      card = copy.ctaCard;
    }

    const shot: Shot = {
      index: i + 1,
      kind,
      name,
      from,
      durationFrames,
      copy: shotCopy,
      motion,
      transition,
      card,
    };
    if (isBeat) shot.beat = true;
    if (fields.length > 0) shot.locked = fields;
    if (en) shot.en = en;
    if (steps) shot.steps = steps;
    // Narration line. `Captions` renders `shot.caption` and nothing else, so a
    // shot without one silently renders no subtitle at all — the band stays
    // empty even when `subtitle` asks for 'zh'/'bilingual'. Derive it from the
    // shot's own copy so captions exist whenever the mode asks for them; the
    // script layer can still override per shot via a Host-supplied storyboard.
    if (subtitle !== 'none') {
      const narration = narrationFor(kind, copy, title, text);
      if (narration.zh) shot.caption = narration.zh;
      if (narration.en) shot.en = narration.en;
    }
    return shot;
  });

  const palette = resolvePalette(PALETTES[paletteIndex], look, params);

  return {
    title,
    seed,
    fps: FPS,
    totalFrames,
    palette,
    paletteIndex,
    look,
    type: typeIndex,
    style: styleIndex,
    flow: flowIndex,
    bgmIndex,
    sfxSet,
    voiceIndex,
    transitionIndex,
    effectIndex,
    durationSec,
    beatBpm,
    beatFrames: grid,
    subtitle,
    locked,
    shots,
  };
}

/* ------------------------------------------------------------------ *
 * Authored scripts
 * ------------------------------------------------------------------ */

/**
 * Lay out a hand-written script.
 *
 * The archetype planner exists so a render never depends on a model answering;
 * it is a floor, not a script. This function keeps that floor's *timing* — beat
 * snapping, boundary capping, minimum shot length, caption derivation — and
 * swaps only the words. That split is the whole point: an authored 30-second
 * piece and a planned 30-second piece must be indistinguishable structurally,
 * otherwise every layout fix has to be made twice.
 *
 * Weight, not duration, decides each shot's share. A script that says "hold on
 * this one" raises its weight and the rest shrink; nothing is hard-coded to
 * frames, so the same script renders correctly at any `durationSec`.
 */
export function planScriptedStoryboard(
  brief: string,
  params: BnParams = {},
  script?: Script,
): Storyboard {
  // The base plan supplies every non-shot decision (palette, look, beat grid,
  // subtitle mode, counts). Reusing it means a script can never disagree with
  // the theme system about what a palette index means.
  const base = planStoryboard(brief, params);
  const authored = (script?.shots ?? []).filter(
    (shot) => shot && typeof shot.copy === 'string' && shot.copy.trim(),
  );
  if (authored.length === 0) return base;

  const shotsIn = authored.slice(0, MAX_SCRIPT_SHOTS);
  const totalFrames = base.totalFrames;
  const beatBpm = base.beatBpm;

  // Refuse a script that cannot physically fit: N shots × MIN frames must fit
  // the timeline. Shrinking the minimum instead would silently produce
  // 6-frame shots that flash past and read as a glitch.
  const floor = shotsIn.length * MIN_SCRIPT_SHOT_FRAMES;
  if (floor > totalFrames) {
    const keep = Math.max(1, Math.floor(totalFrames / MIN_SCRIPT_SHOT_FRAMES));
    shotsIn.length = keep;
  }

  const weights = shotsIn.map((shot) =>
    typeof shot.weight === 'number' && Number.isFinite(shot.weight) && shot.weight > 0
      ? shot.weight
      : DURATIONS[shot.kind] ?? 90,
  );
  const durations = distribute(totalFrames, weights);

  // Same boundary-first snapping as `planStoryboard`: snap interior boundaries
  // onto the beat grid, then derive durations, which is what keeps "no overlap",
  // "no gap" and "sum === totalFrames" true simultaneously.
  const boundaries: number[] = [0];
  {
    let cursor = 0;
    for (let i = 1; i < shotsIn.length; i++) {
      cursor += durations[i - 1];
      const snapped = Math.round(snapUpToBeat(cursor, beatBpm, FPS));
      const delta = snapped - cursor;
      const room = Math.min(durations[i - 1], durations[i]) - MIN_SCRIPT_SHOT_FRAMES;
      if (delta > 0 && delta <= room) cursor = snapped;
      const cap = totalFrames - MIN_SCRIPT_SHOT_FRAMES * (shotsIn.length - i);
      boundaries.push(Math.min(cursor, cap));
    }
  }

  const shots: Shot[] = shotsIn.map((input, i) => {
    const from = boundaries[i];
    const end = i === shotsIn.length - 1 ? totalFrames : boundaries[i + 1];
    const durationFrames = end - from;
    const fallback = base.shots.find((shot) => shot.kind === input.kind) ?? base.shots[0];

    const shot: Shot = {
      index: i + 1,
      kind: input.kind,
      name: input.name ?? fallback?.name ?? input.kind,
      from,
      durationFrames,
      copy: input.copy.trim(),
      motion: input.motion ?? fallback?.motion ?? '',
      transition: input.transition ?? fallback?.transition ?? '硬切',
      card: input.card ?? fallback?.card ?? '',
    };

    if (input.en) shot.en = input.en;
    if (input.kind === 'hook' || input.kind === 'cta') shot.beat = true;

    const stepsIn = input.steps ?? (input.kind === 'process' ? fallback?.steps : undefined);
    if (stepsIn && stepsIn.length > 0) {
      const n = stepsIn.length;
      shot.steps = stepsIn.map((step, k) => {
        const raw = Math.round((k * durationFrames) / n);
        const snapped = Math.round(snapUpToBeat(raw, beatBpm, FPS));
        const at = Math.min(Math.max(0, snapped), Math.max(0, durationFrames - 18));
        return { at, zh: step.zh, en: step.en ?? '' };
      });
    }

    // `Captions` reads `shot.caption` and nothing else. An authored shot that
    // forgets one would render a silent band, so the copy is the default and a
    // real narration line overrides it.
    if (base.subtitle !== 'none') {
      shot.caption = (input.caption ?? input.copy).trim();
    }

    return shot;
  });

  return {
    ...base,
    title: script?.title?.trim() || base.title,
    shots,
  };
}

/* ------------------------------------------------------------------ *
 * Props → storyboard
 * ------------------------------------------------------------------ */

/**
 * Resolve the storyboard for a props object:
 *   · `props.storyboard` present → use it verbatim (shots, timing, copy);
 *   · otherwise plan deterministically from `brief` + `params`.
 *
 * The palette is re-resolved in both cases so that a look and the user's hex
 * overrides always win over a stale stored palette.
 */
export function resolveStoryboard(props: BnProps): Storyboard {
  const params: BnParams = { ...(props.params ?? {}) };
  if (typeof props.seed === 'number' && Number.isFinite(props.seed) && params.seed === undefined) {
    params.seed = props.seed;
  }
  const planned = props.script
    ? planScriptedStoryboard(props.brief ?? '', params, props.script)
    : planStoryboard(props.brief ?? '', params);
  const look = LOOKS[planned.style];
  const host = props.storyboard;

  if (!host || !Array.isArray(host.shots) || host.shots.length === 0) return planned;

  const shots = host.shots;
  const totalFrames =
    typeof host.totalFrames === 'number' && Number.isFinite(host.totalFrames) && host.totalFrames > 0
      ? Math.trunc(host.totalFrames)
      : shots.reduce((a, s) => a + (s.durationFrames ?? 0), 0);

  const base: Palette = host.palette && parseHex(host.palette.bg) ? host.palette : planned.palette;

  return {
    ...planned,
    ...host,
    title: params.title ?? host.title ?? planned.title,
    seed: typeof host.seed === 'number' ? host.seed : planned.seed,
    fps: host.fps ?? FPS,
    totalFrames,
    look,
    palette: resolvePalette(base, look, params),
    paletteIndex: typeof host.paletteIndex === 'number' ? host.paletteIndex : planned.paletteIndex,
    type: typeof host.type === 'number' ? host.type : planned.type,
    style: typeof host.style === 'number' ? host.style : planned.style,
    flow: typeof host.flow === 'number' ? host.flow : planned.flow,
    bgmIndex: typeof host.bgmIndex === 'number' ? host.bgmIndex : planned.bgmIndex,
    sfxSet: typeof host.sfxSet === 'number' ? host.sfxSet : planned.sfxSet,
    voiceIndex: typeof host.voiceIndex === 'number' ? host.voiceIndex : planned.voiceIndex,
    transitionIndex:
      typeof host.transitionIndex === 'number' ? host.transitionIndex : planned.transitionIndex,
    effectIndex: typeof host.effectIndex === 'number' ? host.effectIndex : planned.effectIndex,
    durationSec: planned.durationSec,
    beatBpm: planned.beatBpm,
    beatFrames: planned.beatFrames,
    subtitle: params.subtitle ?? planned.subtitle,
    locked: planned.locked,
    shots,
  };
}

/* ------------------------------------------------------------------ *
 * Caption text helpers
 * ------------------------------------------------------------------ */

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** True when the text contains CJK characters. */
export function hasCJK(text: string): boolean {
  return CJK.test(text);
}

/**
 * Wrap a caption line to at most `max` characters per line and `maxLines`
 * lines. CJK characters count as one, latin words are kept whole where
 * possible so an English line never breaks mid-word.
 */
export function wrapCaption(text: string, max: number, maxLines: number): string[] {
  const src = String(text ?? '').trim();
  if (!src) return [];
  if (hasCJK(src)) {
    const chars = [...src];
    const lines: string[] = [];
    for (let i = 0; i < chars.length && lines.length < maxLines; i += max) {
      lines.push(chars.slice(i, i + max).join(''));
    }
    const rest = chars.length - lines.join('').length;
    if (rest > 0 && lines.length === maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(0, max - 1)) + '…';
    }
    return lines;
  }
  // latin: greedy word wrap
  const words = src.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= max) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && lines.join(' ').length < src.length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(0, max - 1)) + '…';
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * Fonts
 * ------------------------------------------------------------------ */

/** Font stack: local-first so a render never needs the network. */
export const FONT_STACK =
  'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export const MONO_STACK =
  '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace';
