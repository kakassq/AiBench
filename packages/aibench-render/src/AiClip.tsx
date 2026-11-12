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
 * Caption band
 * ------------------------------------------------------------------ */

/**
 * The subtitle band.
 *
 * A subtitle is narration, not a second copy of the headline: the only source
 * is `shot.caption`, which the script layer fills in. When a shot has no
 * narration line (S0 has no script layer yet) the band stays empty rather than
 * echoing the big title underneath itself.
 */
function Captions({ storyboard, shot, theme, frame }: { storyboard: Storyboard; shot: Shot; theme: Theme; frame: number }) {
  const mode = storyboard.subtitle;
  if (mode === 'none') return null;

  const zhSource = shot.caption ?? '';
  const enSource = zhSource ? shot.en ?? '' : '';
  if (!zhSource && !enSource) return null;

  const maxChars = theme.vertical ? 16 : 24;
  const zhLines = mode === 'zh' || mode === 'bilingual' ? wrapCaption(zhSource, maxChars, 2) : [];
  const enLines = mode === 'en' || mode === 'bilingual' ? wrapCaption(enSource, maxChars + 8, 2) : [];
  if (zhLines.length === 0 && enLines.length === 0) return null;

  const appear = interpolate(frame, [2, 12], [0, 1], CLAMP);
  const boxed = theme.look.caption !== 'bar';

  return (
    <div
      style={{
        position: 'absolute',
        left: theme.pad,
        right: theme.pad,
        bottom: theme.vertical ? theme.pad * 1.4 : theme.pad,
        display: 'flex',
        flexDirection: 'column',
        alignItems: theme.vertical ? 'center' : 'flex-start',
        gap: theme.vertical ? theme.h * 0.004 : theme.h * 0.006,
        opacity: appear,
        transform: `translateY(${(1 - appear) * theme.h * 0.012}px)`,
      }}
    >
      {zhLines.length > 0 ? (
        <div
          style={{
            fontFamily: FONT_STACK,
            fontSize: (theme.vertical ? theme.w : theme.h) * 0.038,
            lineHeight: 1.32,
            color: theme.palette.fg,
            textAlign: theme.vertical ? 'center' : 'left',
            background: boxed ? alpha(theme.palette.bg, theme.light ? 0.82 : 0.72) : 'transparent',
            padding: boxed ? `${theme.h * 0.008}px ${theme.w * 0.012}px` : 0,
            borderLeft: boxed ? `${Math.max(2, theme.w * 0.003)}px solid ${theme.palette.accent}` : undefined,
            maxWidth: theme.vertical ? '100%' : '72%',
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
            lineHeight: 1.4,
            textAlign: theme.vertical ? 'center' : 'left',
            maxWidth: theme.vertical ? '100%' : '72%',
          }}
        >
          {enLines.join('\n')}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One shot
 * ------------------------------------------------------------------ */

function ShotView({ storyboard, shot, theme }: { storyboard: Storyboard; shot: Shot; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { w, h, palette } = theme;

  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 }, durationInFrames: 22 });
  const rise = (1 - enter) * h * 0.03;

  if (shot.kind === 'hook') {
    const kicker = shot.name;
    const titleMaxWidth = (theme.vertical ? w - theme.pad * 2 : (w - theme.pad * 2) * 0.82);
    const fitted = fitTitle(
      shot.copy,
      (theme.vertical ? w : h) * 0.13,
      (theme.vertical ? w : h) * 0.072,
      titleMaxWidth,
      3,
    );
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: theme.pad,
            right: theme.pad,
            top: h * 0.24,
            display: 'flex',
            flexDirection: 'column',
            gap: h * 0.022,
            transform: `translateY(${rise}px)`,
            opacity: enter,
          }}
        >
          <div style={labelStyle(theme, Math.round(w * 0.014))}>{kicker}</div>
          <div
            style={{
              fontFamily: theme.look.titleFont === 'mono' ? MONO_STACK : FONT_STACK,
              fontSize: fitted.fontSize,
              lineHeight: 1.08,
              fontWeight: 800,
              letterSpacing: theme.vertical ? -1 : -(h * 0.0022),
              color: palette.fg,
              maxWidth: theme.vertical ? '100%' : '82%',
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
              width: `${enter * (theme.vertical ? 34 : 22)}%`,
              height: Math.max(2, h * 0.004),
              background: palette.accent,
            }}
          />
        </div>
        <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      </AbsoluteFill>
    );
  }

  if (shot.kind === 'process') {
    const steps = shot.steps ?? [];
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: theme.pad,
            right: theme.pad,
            top: h * 0.14,
            bottom: h * 0.2,
            display: 'flex',
            flexDirection: 'column',
            gap: h * 0.024,
          }}
        >
          <div style={labelStyle(theme, Math.round(w * 0.013))}>{shot.name}</div>
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: (theme.vertical ? w : h) * 0.056,
              fontWeight: 700,
              lineHeight: 1.14,
              color: palette.fg,
              maxWidth: theme.vertical ? '100%' : '74%',
            }}
          >
            {shot.copy}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: h * 0.014, marginTop: h * 0.01 }}>
            {steps.map((step, index) => {
              const on = interpolate(frame, [step.at, step.at + 12], [0, 1], CLAMP);
              return (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: w * 0.012,
                    opacity: on,
                    transform: `translateX(${(1 - on) * -w * 0.012}px)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO_STACK,
                      fontSize: w * 0.014,
                      color: palette.accent,
                      minWidth: w * 0.024,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_STACK,
                      fontSize: (theme.vertical ? w : h) * 0.036,
                      lineHeight: 1.35,
                      color: palette.fg,
                      opacity: 0.94,
                    }}
                  >
                    {step.zh}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO_STACK,
                      fontSize: (theme.vertical ? w : h) * 0.019,
                      color: theme.dim,
                    }}
                  >
                    {step.en}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
      </AbsoluteFill>
    );
  }

  // cta
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: h * 0.026,
          padding: theme.pad,
          transform: `scale(${0.98 + enter * 0.02})`,
          opacity: enter,
        }}
      >
        <div style={labelStyle(theme, Math.round(w * 0.013), palette.accent)}>{shot.name}</div>
        <div
          style={{
            fontFamily: theme.look.titleFont === 'mono' ? MONO_STACK : FONT_STACK,
            fontSize: (theme.vertical ? w : h) * 0.078,
            fontWeight: 800,
            lineHeight: 1.1,
            color: palette.fg,
            textAlign: 'center',
            maxWidth: theme.vertical ? '100%' : '76%',
          }}
        >
          {shot.copy}
        </div>
        <div
          style={{
            width: `${enter * Math.min(60, 40)}%`,
            height: Math.max(2, h * 0.0035),
            background: palette.accent,
          }}
        />
      </div>
      <Captions storyboard={storyboard} shot={shot} theme={theme} frame={frame} />
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
