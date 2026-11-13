import React from 'react';
import { Composition } from 'remotion';

import { AiClip, type AiClipProps } from './AiClip';
import { DEFAULT_BRIEF, FPS, resolveStoryboard } from './storyboard';

/**
 * The composition's frame count is data-driven: `calculateMetadata` plans the
 * storyboard from the incoming props and returns its total length, so a Host
 * render never has to guess a duration. Same props → same length, always.
 */

const DEFAULT_PARAMS = {
  style: 0,
  palette: 0,
  durationSec: 20,
  beatBpm: 120,
  subtitle: 'bilingual' as const,
  transition: 0,
  effect: 0,
};

const baseProps: AiClipProps = {
  brief: DEFAULT_BRIEF,
  params: DEFAULT_PARAMS,
};

function measure(props: AiClipProps) {
  // Resolve, not plan: a scripted render's length is decided by the same
  // boundary maths as a planned one, and only `resolveStoryboard` runs the
  // script branch. Measuring with `planStoryboard` would report the archetype
  // length and cut the composition short.
  const storyboard = resolveStoryboard(props as never);
  return {
    durationInFrames: Math.max(1, storyboard.totalFrames),
    fps: FPS,
    props,
  };
}

export function RemotionRoot() {
  return (
    <>
      {/* 16:9 — launches, data stories, explainers */}
      <Composition
        id="AiClip"
        component={AiClip}
        durationInFrames={600}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={baseProps}
        calculateMetadata={({ props }) => measure(props as AiClipProps)}
      />
      {/* 9:16 — social beat-cuts, vertical shorts */}
      <Composition
        id="AiClipVertical"
        component={AiClip}
        durationInFrames={600}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={baseProps}
        calculateMetadata={({ props }) => measure(props as AiClipProps)}
      />
      {/* 1:1 — feed cards */}
      <Composition
        id="AiClipSquare"
        component={AiClip}
        durationInFrames={600}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={baseProps}
        calculateMetadata={({ props }) => measure(props as AiClipProps)}
      />
    </>
  );
}
