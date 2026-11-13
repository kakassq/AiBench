import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  FONT_STACK,
  MONO_STACK,
  resolveStoryboard,
  wrapCaption,
  type BnParams,
  type Script,
  type Shot,
  type Storyboard,
} from './storyboard';
import { alpha, labelStyle, makeTheme, type Theme } from './theme';

/* ------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------ */

export type AiClipProps = {
  brief?: string;
  params?: BnParams;
  storyboard?: Storyboard;
  script?: Script;
  seed?: number;
};

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/* ------------------------------------------------------------------ *
 * Title fitting — deterministic, no measurement, no DOM.
 *
 * A 19-character Chinese headline at a fixed 0.13·h size wraps into three
 * lines and strands its last character on a line of its own. Since nothing in
 * this pipeline can measure text at plan time, approximate the advance width
 * per character (CJK ≈ 1em, Latin ≈ 0.55em) and pick the largest size that
 * still fits the allowed line count, then break the lines evenly so no line
 * is left with a single orphan character.
 * ------------------------------------------------------------------ */

/** Approximate advance width in em units. */
function emWidth(char: string): number {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.55;
}

function textEm(text: string): number {
  let total = 0;
  for (const char of text) total += emWidth(char);
  return total;
}

type FittedTitle = { fontSize: number; lines: string[] };

/**
 * Balance `text` into at most `maxLines` lines within `maxWidthPx`, shrinking
 * the font below `baseSize` when needed, never below `minSize`.
 */
function fitTitle(text: string, baseSize: number, minSize: number, maxWidthPx: number, maxLines: number): FittedTitle {
  const source = String(text ?? '').trim();
  if (!source) return { fontSize: baseSize, lines: [] };

  const totalEm = textEm(source);
  // Largest size whose wrapping fits: lines needed ≈ totalEm / (maxWidth/size).
  let size = baseSize;
  while (size > minSize && totalEm * size > maxWidthPx * maxLines) size -= Math.max(1, baseSize * 0.02);

  // Even break: characters per line such that no trailing orphan remains.
  const perLine = Math.max(1, Math.floor(maxWidthPx / size));
  const needed = Math.ceil(totalEm / perLine);
  const lineChars = Math.ceil(source.length / Math.min(maxLines, Math.max(1, needed)));

  const lines: string[] = [];
  for (let i = 0; i < source.length; i += lineChars) {
    lines.push(source.slice(i, i + lineChars));
  }
  // A single stray character on the last line looks broken; merge it back.
  if (lines.length > 1 && lines[lines.length - 1].length === 1) {
    const last = lines.pop() as string;
    lines[lines.length - 1] += last;
  }
  return { fontSize: size, lines };
}

/* ------------------------------------------------------------------ *
 * Look decorations — each look owns one background signature.
 * All are pure functions of the frame, so a render is reproducible.
 * ------------------------------------------------------------------ */

function SwissDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const { w, h, palette } = theme;
  const rules = [0.333, 0.667];
  const grow = interpolate(frame, [0, 18], [0, 1], CLAMP);
  return (
    <AbsoluteFill>
      {rules.map((r) => (
        <div
          key={r}
          style={{
            position: 'absolute',
            left: `${r * 100}%`,
            top: 0,
            width: 1,
            height: `${grow * 100}%`,
            background: theme.rule,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          right: theme.pad,
          top: theme.pad,
          fontFamily: theme.mono,
          fontSize: w * 0.016,
          letterSpacing: w * 0.004,
          color: theme.dim,
        }}
      >
        {`SWISS / ${String(theme.palette.name)}`}
      </div>
      <div
        style={{
          position: 'absolute',
          left: `${33.3}%`,
          top: h * 0.14,
          width: `${grow * (w / 3) * 0.42}px`,
          height: h * 0.006,
          background: palette.accent,
        }}
      />
    </AbsoluteFill>
  );
}

function BlueprintDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const { w, h } = theme;
  const step = w / 24;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= 24; i += 1) {
    lines.push(
      <div
        key={`v${i}`}
        style={{
          position: 'absolute',
          left: i * step,
          top: 0,
          width: 1,
          height: h,
          background: theme.rule,
          opacity: i % 4 === 0 ? 1 : 0.45,
        }}
      />,
    );
  }
  const vstep = h / 12;
  for (let i = 0; i <= 12; i += 1) {
    lines.push(
      <div
        key={`h${i}`}
        style={{
          position: 'absolute',
          top: i * vstep,
          left: 0,
          height: 1,
          width: w,
          background: theme.rule,
          opacity: i % 3 === 0 ? 1 : 0.45,
        }}
      />,
    );
  }
  const sweep = (frame % 90) / 90;
  return (
    <AbsoluteFill>
      {lines}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: `${sweep * 100}%`,
          width: w * 0.06,
          height: h,
          background: `linear-gradient(90deg, ${alpha(theme.palette.accent, 0)}, ${alpha(
            theme.palette.accent,
            0.18,
          )}, ${alpha(theme.palette.accent, 0)})`,
        }}
      />
    </AbsoluteFill>
  );
}

function CrtDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const { w, h } = theme;
  const flicker = 0.03 + Math.abs(Math.sin(frame * 0.7)) * 0.03;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `repeating-linear-gradient(180deg, ${alpha(
            theme.palette.fg,
            0.06,
          )} 0px, ${alpha(theme.palette.fg, 0.06)} 1px, transparent 1px, transparent 3px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, transparent 52%, ${alpha(
            theme.palette.bg,
            0.85,
          )} 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: alpha(theme.palette.fg, flicker),
          mixBlendMode: 'overlay',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: theme.pad,
          top: theme.pad,
          fontFamily: theme.mono,
          fontSize: w * 0.015,
          letterSpacing: w * 0.003,
          color: theme.palette.accent,
        }}
      >
        {`> aibench :: ${String(Math.floor(frame / 30)).padStart(2, '0')}s`}
      </div>
    </AbsoluteFill>
  );
}

function HalftoneDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const { w } = theme;
  const dot = Math.max(2, w * 0.0055);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(${alpha(theme.palette.fg, 0.22)} ${dot * 0.5}px, transparent ${
            dot * 0.5
          }px)`,
          backgroundSize: `${dot * 3}px ${dot * 3}px`,
          opacity: 0.55,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${interpolate(frame, [0, 20], [0, 26], CLAMP)}%`,
          background: alpha(theme.palette.fg, 0.05),
        }}
      />
    </AbsoluteFill>
  );
}

function OneLineDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const { w, h } = theme;
  const grow = interpolate(frame, [0, 26], [0, 1], CLAMP);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: theme.pad,
          top: h * 0.5,
          height: Math.max(1, h * 0.0018),
          width: (w - theme.pad * 2) * grow,
          background: theme.rule,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: theme.pad,
          top: h * 0.5 - h * 0.002,
          width: Math.max(6, w * 0.006),
          height: Math.max(6, w * 0.006),
          borderRadius: '50%',
          background: theme.palette.accent,
          transform: `translateX(${(w - theme.pad * 2) * grow}px)`,
        }}
      />
    </AbsoluteFill>
  );
}

function LookDecor({ theme, frame }: { theme: Theme; frame: number }) {
  const kind = theme.look.kind;
  if (kind === 'swiss') return <SwissDecor theme={theme} frame={frame} />;
  if (kind === 'blueprint') return <BlueprintDecor theme={theme} frame={frame} />;
  if (kind === 'crt') return <CrtDecor theme={theme} frame={frame} />;
  if (kind === 'halftone') return <HalftoneDecor theme={theme} frame={frame} />;
  return <OneLineDecor theme={theme} frame={frame} />;
}

/* ------------------------------------------------------------------ *
 * Layout metrics
 *
 * "Sparse" is a layout defect, so the layout is a single measured system
 * rather than three independent slides. Every shot is composed inside the same
 * safe area — a top rail (brand + shot counter), a content block, a caption
 * band, and a progress bar — so the eye always finds something holding the
 * right-hand side of the frame. On 16:9 the content block is a two-column grid
 * (statement | evidence) because a single left-aligned column leaves ~70% of a
 * landscape frame empty, which reads as an unfinished draft.
 * ------------------------------------------------------------------ */

type Metrics = {
  /** false for 9:16, where the two-column grid is replaced by a stack */
  wide: boolean;
  railTop: number;
  contentTop: number;
  contentBottom: number;
  gutter: number;
  railWidth: number;
};

function metricsFor(theme: Theme): Metrics {
  const { w, h, pad } = theme;
  const wide = !theme.vertical;
  return {
    wide,
    railTop: Math.round(pad * 0.58),
    // On 9:16 the top rail already sits close to the edge, so the content block
    // starts well below it; on 16:9 the rail is thin and the block can follow
    // immediately.
    contentTop: Math.round(pad * (wide ? 1.06 : 2.1)),
    // The caption band and the progress bar own the bottom of the canvas, so the
    // content block must stop above them instead of drifting down.
    contentBottom: Math.round(h - pad * (wide ? 2.1 : 3.1)),
    gutter: Math.round(w * (wide ? 0.028 : 0.05)),
    railWidth: Math.round(Math.min(w * 0.33, pad * 5)),
  };
}

/* ------------------------------------------------------------------ *
 * Scene chrome — the parts of the frame that are always present
 * ------------------------------------------------------------------ */

function Corners({ theme }: { theme: Theme }) {
  const { pad } = theme;
  const inset = Math.round(pad * 0.34);
  const len = Math.round(pad * 0.28);
  const thick = Math.max(1, Math.round(theme.h * 0.0016));
  const common = { position: 'absolute' as const, width: len, height: len, borderColor: theme.rule };
  return (
    <AbsoluteFill>
      <div style={{ ...common, left: inset, top: inset, borderLeft: `${thick}px solid`, borderTop: `${thick}px solid` }} />
      <div style={{ ...common, right: inset, top: inset, borderRight: `${thick}px solid`, borderTop: `${thick}px solid` }} />
      <div style={{ ...common, left: inset, bottom: inset, borderLeft: `${thick}px solid`, borderBottom: `${thick}px solid` }} />
      <div style={{ ...common, right: inset, bottom: inset, borderRight: `${thick}px solid`, borderBottom: `${thick}px solid` }} />
    </AbsoluteFill>
  );
}

function TopRail({ storyboard, shot, theme, frame }: FramePart) {
  const { w } = theme;
  const m = metricsFor(theme);
  const appear = interpolate(frame, [0, 14], [0, 1], CLAMP);
  const size = Math.round(w * 0.0105);
  return (
    <div
      style={{
        position: 'absolute',
        left: theme.pad,
        right: theme.pad,
        top: m.railTop,
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(w * 0.012),
        opacity: appear,
      }}
    >
      <div style={{ ...labelStyle(theme, size), color: theme.palette.accent }}>AIBENCH</div>
      <div
        style={{
          flex: '1 1 auto',
          height: 1,
          background: theme.rule,
          maskImage: 'linear-gradient(90deg, rgba(0,0,0,1), rgba(0,0,0,0.15))',
          WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,1), rgba(0,0,0,0.15))',
        }}
      />
      <div style={{ ...labelStyle(theme, size), color: theme.dim, maxWidth: m.railWidth }}>
        {String(shot.index).padStart(2, '0')} / {String(storyboard.shots.length).padStart(2, '0')}
      </div>
    </div>
  );
}

function ProgressBar({ storyboard, shot, theme, frame }: FramePart) {
  const { w } = theme;
  const total = Math.max(1, storyboard.totalFrames);
  const at = Math.min(1, (shot.from + Math.min(frame, shot.durationFrames)) / total);
  const y = theme.h - Math.round(theme.pad * 0.46);
  const thick = Math.max(2, Math.round(theme.h * 0.0028));
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: theme.pad, right: theme.pad, top: y, height: thick, background: theme.rule }} />
      <div
        style={{
          position: 'absolute',
          left: theme.pad,
          top: y,
          height: thick,
          width: (w - theme.pad * 2) * at,
          background: theme.palette.accent,
        }}
      />
      {storyboard.shots.map((row) => (
        <div
          key={row.index}
          style={{
            position: 'absolute',
            left: theme.pad + (w - theme.pad * 2) * (row.from / total),
            top: y - thick,
            width: 1,
            height: thick * 3,
            background: theme.rule,
          }}
        />
      ))}
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ *
 * Chapter rail — the right-hand column
 *
 * Fills the empty half of a landscape frame with something that earns its
 * place: the viewer's position in the argument. It is not decoration, it is
 * navigation, and it doubles as the only element on screen that tells the
 * viewer how many beats are left.
 * ------------------------------------------------------------------ */

function ChapterRail({ storyboard, shot, theme, frame }: FramePart) {
  const { w, h } = theme;
  const m = metricsFor(theme);
  const appear = interpolate(frame, [5, 21], [0, 1], CLAMP);
  return (
    <div
      style={{
        width: m.railWidth,
        flex: `0 0 ${m.railWidth}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        opacity: appear,
        transform: `translateY(${(1 - appear) * h * 0.02}px)`,
      }}
    >
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0102)), color: theme.dim, marginBottom: Math.round(h * 0.016) }}>
        {'\u7ae0\u8282'}
      </div>
      {storyboard.shots.map((row) => {
        const on = row.index === shot.index;
        return (
          <div
            key={row.index}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: Math.round(w * 0.011),
              paddingTop: Math.round(h * 0.012),
              paddingBottom: Math.round(h * 0.012),
              borderTop: `1px solid ${theme.rule}`,
              opacity: on ? 1 : 0.46,
            }}
          >
            <span
              style={{
                fontFamily: theme.mono,
                fontSize: Math.round(w * 0.0118),
                color: on ? theme.palette.accent : theme.dim,
                minWidth: Math.round(w * 0.024),
              }}
            >
              {String(row.index).padStart(2, '0')}
            </span>
            <span
              style={{
                fontFamily: FONT_STACK,
                fontSize: Math.round(w * 0.0142),
                fontWeight: on ? 700 : 500,
                lineHeight: 1.35,
                color: theme.palette.fg,
              }}
            >
              {row.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact replacement for the rail on 9:16, where a column has no room. */
function ChapterStrip({ storyboard, shot, theme }: Omit<FramePart, 'frame'>) {
  const { w, h } = theme;
  return (
    <div
      style={{
        position: 'absolute',
        left: theme.pad,
        right: theme.pad,
        bottom: Math.round(h - theme.pad * 2.5) + Math.round(h * 0.012),
        display: 'flex',
        gap: Math.round(w * 0.014),
      }}
    >
      {storyboard.shots.map((row) => {
        const on = row.index === shot.index;
        return (
          <div
            key={row.index}
            style={{
              flex: '1 1 0',
              height: Math.max(3, Math.round(h * 0.0035)),
              background: on ? theme.palette.accent : theme.rule,
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Caption band
 * ------------------------------------------------------------------ */

/**
 * The subtitle band.
 *
 * A subtitle is narration, not a second copy of the headline: the only source
 * is `shot.caption`, which the script layer fills in. When a shot has no
 * narration line the band stays empty rather than echoing the big title
 * underneath itself.
 */
function Captions({ storyboard, shot, theme, frame }: FramePart) {
  const mode = storyboard.subtitle;
  if (mode === 'none') return null;

  const zhSource = shot.caption ?? '';
  const enSource = zhSource ? shot.en ?? '' : '';
  if (!zhSource && !enSource) return null;

  const maxChars = theme.vertical ? 16 : 30;
  const zhLines = mode === 'zh' || mode === 'bilingual' ? wrapCaption(zhSource, maxChars, 2) : [];
  const enLines = mode === 'en' || mode === 'bilingual' ? wrapCaption(enSource, maxChars + 8, 2) : [];
  if (zhLines.length === 0 && enLines.length === 0) return null;

  const appear = interpolate(frame, [2, 12], [0, 1], CLAMP);
  const boxed = theme.look.caption !== 'bar';
  const size = (theme.vertical ? theme.w : theme.h) * 0.04;

  return (
    <div
      style={{
        position: 'absolute',
        left: theme.pad,
        right: theme.pad,
        bottom: theme.vertical ? theme.pad * 1.5 : theme.pad * 1.02,
        display: 'flex',
        flexDirection: theme.vertical ? 'column' : 'row',
        alignItems: theme.vertical ? 'center' : 'flex-end',
        justifyContent: 'space-between',
        gap: theme.w * 0.02,
        opacity: appear,
        transform: `translateY(${(1 - appear) * theme.h * 0.012}px)`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.vertical ? theme.h * 0.004 : theme.h * 0.006, minWidth: 0 }}>
        {zhLines.length > 0 ? (
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: size,
              lineHeight: 1.3,
              color: theme.palette.fg,
              textAlign: theme.vertical ? 'center' : 'left',
              background: boxed ? alpha(theme.palette.bg, theme.light ? 0.82 : 0.72) : 'transparent',
              padding: boxed ? `${theme.h * 0.008}px ${theme.w * 0.011}px` : 0,
              borderLeft: boxed ? `${Math.max(2, theme.w * 0.003)}px solid ${theme.palette.accent}` : undefined,
            }}
          >
            {zhLines.join('\n')}
          </div>
        ) : null}
        {enLines.length > 0 ? (
          <div
            style={{
              ...labelStyle(theme, Math.round((theme.vertical ? theme.w : theme.h) * 0.017), theme.dim),
              textTransform: 'none',
              letterSpacing: 0,
              lineHeight: 1.35,
              textAlign: theme.vertical ? 'center' : 'left',
            }}
          >
            {enLines.join('\n')}
          </div>
        ) : null}
      </div>
      {theme.vertical ? null : (
        <div
          style={{
            ...labelStyle(theme, Math.round(theme.w * 0.0098)),
            color: theme.dim,
            textAlign: 'right',
            flex: '0 0 auto',
            paddingBottom: theme.h * 0.006,
          }}
        >
          {`${storyboard.look.name} \u00b7 ${String(shot.kind).toUpperCase()}`}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Evidence panel — the right-hand column of a process shot
 * ------------------------------------------------------------------ */

function EvidencePanel({ shot, theme, frame }: { shot: Shot; theme: Theme; frame: number }) {
  const { w, h } = theme;
  const steps = shot.steps ?? [];
  const appear = interpolate(frame, [6, 22], [0, 1], CLAMP);
  return (
    <div
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: `${Math.round(h * 0.032)}px ${Math.round(w * 0.019)}px`,
        border: `1px solid ${theme.rule}`,
        borderLeft: `${Math.max(3, Math.round(w * 0.0024))}px solid ${theme.palette.accent}`,
        background: alpha(theme.palette.fg, theme.light ? 0.035 : 0.05),
        opacity: appear,
        transform: `translateX(${(1 - appear) * w * 0.02}px)`,
      }}
    >
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0102)), color: theme.dim, marginBottom: Math.round(h * 0.02) }}>
        {`${String(steps.length).padStart(2, '0')} \u00b7 NOTES`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.018) }}>
        {steps.map((step, index) => {
          const on = interpolate(frame, [step.at, step.at + 12], [0, 1], CLAMP);
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: Math.round(w * 0.012),
                opacity: on,
                transform: `translateX(${(1 - on) * -w * 0.012}px)`,
                borderTop: index === 0 ? undefined : `1px solid ${theme.rule}`,
                paddingTop: index === 0 ? 0 : Math.round(h * 0.016),
              }}
            >
              <span
                style={{
                  fontFamily: MONO_STACK,
                  fontSize: Math.round(w * 0.0135),
                  color: theme.palette.accent,
                  minWidth: Math.round(w * 0.023),
                }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: h * 0.006, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: Math.round((theme.vertical ? w : h) * 0.031),
                    lineHeight: 1.32,
                    color: theme.palette.fg,
                  }}
                >
                  {step.zh}
                </span>
                {step.en ? (
                  <span style={{ fontFamily: MONO_STACK, fontSize: Math.round(w * 0.0108), color: theme.dim, lineHeight: 1.3 }}>
                    {step.en}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Spec panel — the right-hand column of the opening shot
 *
 * A title card earns its space by answering the viewer's first question
 * ("what am I about to watch, and how long is it?"). Four facts, laid out as a
 * definition grid, plus the look's name: the panel is a promise the rest of the
 * video has to keep, and it stops the opening frame from being one line of type
 * stranded in a landscape canvas.
 * ------------------------------------------------------------------ */

function SpecPanel({ storyboard, theme, frame }: { storyboard: Storyboard; theme: Theme; frame: number }) {
  const { w, h } = theme;
  const appear = interpolate(frame, [4, 20], [0, 1], CLAMP);
  const rows: Array<[string, string]> = [
    ['\u65f6\u957f', `${Math.round(storyboard.durationSec)}s`],
    ['\u955c\u5934', String(storyboard.shots.length).padStart(2, '0')],
    ['\u753b\u5e45', theme.vertical ? '9:16' : w === h ? '1:1' : '16:9'],
    ['\u8282\u62cd', `${Math.round(storyboard.beatBpm)} BPM`],
  ];
  return (
    <div
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: `${Math.round(h * 0.036)}px ${Math.round(w * 0.02)}px`,
        border: `1px solid ${theme.rule}`,
        background: alpha(theme.palette.fg, theme.light ? 0.03 : 0.045),
        opacity: appear,
        transform: `translateX(${(1 - appear) * w * 0.02}px)`,
      }}
    >
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0102)), color: theme.dim, marginBottom: Math.round(h * 0.018) }}>
        {'\u672c\u6b21\u5185\u5bb9'}
      </div>
      <div
        style={{
          fontFamily: FONT_STACK,
          fontSize: Math.round(w * 0.0225),
          fontWeight: 700,
          lineHeight: 1.24,
          color: theme.palette.fg,
          marginBottom: Math.round(h * 0.026),
          borderBottom: `1px solid ${theme.rule}`,
          paddingBottom: Math.round(h * 0.022),
        }}
      >
        {storyboard.title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${h * 0.016}px ${w * 0.016}px` }}>
        {rows.map(([key, value]) => (
          <React.Fragment key={key}>
            <div style={{ fontFamily: MONO_STACK, fontSize: Math.round(w * 0.0105), color: theme.dim, letterSpacing: w * 0.001 }}>
              {key}
            </div>
            <div
              style={{
                fontFamily: MONO_STACK,
                fontSize: Math.round(w * 0.0132),
                color: theme.palette.fg,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {value}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0095)), color: theme.palette.accent, marginTop: Math.round(h * 0.026) }}>
        {storyboard.look.name}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recap panel — the right-hand column of the closing shot
 *
 * An end card that only repeats the thesis gives the viewer nothing to keep.
 * This one recaps the argument the process shots just made, in order, with the
 * last step marked: it is the slide a viewer screenshots.
 * ------------------------------------------------------------------ */

function RecapPanel({ storyboard, theme, frame }: { storyboard: Storyboard; theme: Theme; frame: number }) {
  const { w, h } = theme;
  const appear = interpolate(frame, [4, 20], [0, 1], CLAMP);
  const rows = storyboard.shots.filter((row) => row.kind === 'process');
  return (
    <div
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: `${Math.round(h * 0.036)}px ${Math.round(w * 0.02)}px`,
        border: `1px solid ${theme.rule}`,
        borderLeft: `${Math.max(3, Math.round(w * 0.0024))}px solid ${theme.palette.accent}`,
        background: alpha(theme.palette.fg, theme.light ? 0.035 : 0.05),
        opacity: appear,
        transform: `translateX(${(1 - appear) * w * 0.02}px)`,
      }}
    >
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0102)), color: theme.dim, marginBottom: Math.round(h * 0.02) }}>
        {`\u56de\u987e \u00b7 ${String(rows.length).padStart(2, '0')}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.014) }}>
        {rows.map((row, index) => {
          const last = index === rows.length - 1;
          const on = interpolate(frame, [8 + index * 6, 20 + index * 6], [0, 1], CLAMP);
          return (
            <div
              key={row.index}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: Math.round(w * 0.011),
                opacity: on * (last ? 1 : 0.82),
                borderTop: index === 0 ? undefined : `1px solid ${theme.rule}`,
                paddingTop: index === 0 ? 0 : Math.round(h * 0.014),
              }}
            >
              <span
                style={{
                  fontFamily: MONO_STACK,
                  fontSize: Math.round(w * 0.0118),
                  color: last ? theme.palette.accent : theme.dim,
                  minWidth: Math.round(w * 0.023),
                }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span
                style={{
                  fontFamily: FONT_STACK,
                  fontSize: Math.round(w * 0.0142),
                  fontWeight: last ? 700 : 500,
                  lineHeight: 1.34,
                  color: theme.palette.fg,
                }}
              >
                {row.name}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ ...labelStyle(theme, Math.round(w * 0.0095)), color: theme.dim, marginTop: Math.round(h * 0.024) }}>
        {`${storyboard.look.name} \u00b7 ${Math.round(storyboard.durationSec)}s`}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One shot
 * ------------------------------------------------------------------ */

type FramePart = { storyboard: Storyboard; shot: Shot; theme: Theme; frame: number };

function ShotView({ storyboard, shot, theme }: { storyboard: Storyboard; shot: Shot; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { w, h, palette } = theme;
  const m = metricsFor(theme);

  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 }, durationInFrames: 22 });
  const rise = (1 - enter) * h * 0.03;

  const block: React.CSSProperties = {
    position: 'absolute',
    left: theme.pad,
    right: theme.pad,
    top: m.contentTop,
    height: Math.max(0, m.contentBottom - m.contentTop),
    display: 'flex',
    flexDirection: m.wide ? 'row' : 'column',
    alignItems: 'stretch',
    gap: m.gutter,
  };

  const lead: React.CSSProperties = {
    flex: m.wide ? '0 0 46%' : '1 1 auto',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: Math.round(h * 0.022),
    opacity: enter,
    transform: `translateY(${rise}px)`,
  };

  const gloss = shot.en ? (
    <div
      style={{
        fontFamily: MONO_STACK,
        fontSize: Math.round(w * (theme.vertical ? 0.026 : 0.0135)),
        lineHeight: 1.35,
        color: theme.dim,
        maxWidth: '100%',
      }}
    >
      {shot.en}
    </div>
  ) : null;

  if (shot.kind === 'hook') {
    const titleMaxWidth = m.wide ? (w - theme.pad * 2) * 0.46 - m.gutter : w - theme.pad * 2;
    const fitted = fitTitle(
      shot.copy,
      (theme.vertical ? w : h) * 0.125,
      (theme.vertical ? w : h) * 0.068,
      titleMaxWidth,
      3,
    );
    return (
      <AbsoluteFill>
        <Corners theme={theme} />
        <TopRail storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
        <div style={block}>
          <div style={lead}>
            <div style={labelStyle(theme, Math.round(w * 0.0135))}>{shot.name}</div>
            <div
              style={{
                fontFamily: theme.look.titleFont === 'mono' ? MONO_STACK : FONT_STACK,
                fontSize: fitted.fontSize,
                lineHeight: 1.06,
                fontWeight: 800,
                letterSpacing: theme.vertical ? -1 : -(h * 0.0022),
                color: palette.fg,
              }}
            >
              {fitted.lines.map((line, index) => (
                <div key={index} style={{ whiteSpace: 'nowrap' }}>
                  {line}
                </div>
              ))}
            </div>
            <div
              style={{
                width: `${enter * 26}%`,
                height: Math.max(3, h * 0.005),
                background: palette.accent,
              }}
            />
            {gloss}
          </div>
          <SpecPanel storyboard={storyboard} theme={theme} frame={frame} />
        </div>
        {m.wide ? null : <ChapterStrip storyboard={storyboard} shot={shot} theme={theme} />}
        <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
        <ProgressBar storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      </AbsoluteFill>
    );
  }

  if (shot.kind === 'process') {
    const steps = shot.steps ?? [];
    return (
      <AbsoluteFill>
        <Corners theme={theme} />
        <TopRail storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
        <div style={block}>
          <div style={lead}>
            <div style={labelStyle(theme, Math.round(w * 0.0125))}>{shot.name}</div>
            <div
              style={{
                fontFamily: FONT_STACK,
                fontSize: (theme.vertical ? w : h) * 0.055,
                fontWeight: 700,
                lineHeight: 1.16,
                color: palette.fg,
              }}
            >
              {shot.copy}
            </div>
            <div
              style={{
                width: `${enter * 22}%`,
                height: Math.max(3, h * 0.0045),
                background: palette.accent,
              }}
            />
            {gloss}
          </div>
          {steps.length > 0 ? (
            <EvidencePanel shot={shot} theme={theme} frame={frame} />
          ) : m.wide ? (
            <ChapterRail storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
          ) : null}
        </div>
        {m.wide ? null : <ChapterStrip storyboard={storyboard} shot={shot} theme={theme} />}
        <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
        <ProgressBar storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      </AbsoluteFill>
    );
  }

  // cta
  const landingMax = m.wide ? (w - theme.pad * 2) * 0.46 - m.gutter : w - theme.pad * 2;
  const landing = fitTitle(shot.copy, (theme.vertical ? w : h) * 0.09, (theme.vertical ? w : h) * 0.05, landingMax, 3);
  return (
    <AbsoluteFill>
      <Corners theme={theme} />
      <TopRail storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      <div style={block}>
        <div style={lead}>
          <div style={labelStyle(theme, Math.round(w * 0.0125), palette.accent)}>{shot.name}</div>
          <div
            style={{
              fontFamily: theme.look.titleFont === 'mono' ? MONO_STACK : FONT_STACK,
              fontSize: landing.fontSize,
              fontWeight: 800,
              lineHeight: 1.08,
              color: palette.fg,
            }}
          >
            {landing.lines.map((line, index) => (
              <div key={index} style={{ whiteSpace: 'nowrap' }}>
                {line}
              </div>
            ))}
          </div>
          <div style={{ width: `${enter * 34}%`, height: Math.max(3, h * 0.0045), background: palette.accent }} />
          {gloss}
        </div>
        <RecapPanel storyboard={storyboard} theme={theme} frame={frame} />
      </div>
      {m.wide ? null : <ChapterStrip storyboard={storyboard} shot={shot} theme={theme} />}
      <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      <ProgressBar storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

export function AiClip(props: AiClipProps) {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const storyboard = React.useMemo(() => resolveStoryboard(props as never), [props]);
  const theme = makeTheme(storyboard.palette, storyboard.look, width, height);

  return (
    <AbsoluteFill style={{ background: theme.palette.bg, fontFamily: FONT_STACK }}>
      <LookDecor theme={theme} frame={frame} />
      {storyboard.shots.map((shot) => (
        <Sequence
          key={`${shot.index}-${shot.kind}`}
          from={shot.from}
          durationInFrames={Math.max(1, shot.durationFrames)}
          name={`${shot.index}. ${shot.name}`}
        >
          <ShotView storyboard={storyboard} shot={shot} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
