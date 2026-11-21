import type { ScreenEffectConfig } from "@hedronite/lts-postfx";
import { applyPalette, ScreenEffects, stackStructure, stackValues } from "@hedronite/lts-postfx/three";
import { neutral, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { Canvas, useFrame, useThree, type CanvasProps } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useReducedMotion } from "./motion.js";
import { WebGPURenderer } from "three/webgpu";
import { rendererReadout } from "@hedronite/lts-scene/renderer";

/**
 * A React Three Fiber canvas on three's WebGPURenderer: WebGPU where the browser has it, WebGL 2 where
 * it doesn't. TSL surface shaders (`@hedronite/lts-shaders`) and screen effects need it; material
 * presets and every other adapter work on it too. Once the renderer has started the canvas carries `data-renderer`, `webgpu` or `webgl2`,
 * read from the renderer (`rendererReadout`), so a test can tell which backend drew it. Pair it with `WebGPUStudioEnvironment`, which lights
 * a scene with the studio room the library shares (`studioRoom.ts`).
 */
export function WebGPUCanvas(props: Omit<CanvasProps, "gl">) {
  return (
    <Canvas
      {...props}
      gl={async ({ canvas }) => {
        // In the browser R3F hands over a DOM canvas; its OffscreenCanvas type differs from three's.
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("WebGPUCanvas needs a DOM canvas");
        const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
        await renderer.init();
        rendererReadout(renderer);
        return renderer;
      }}
    />
  );
}

export interface ScreenEffectsPassProps {
  /**
   * The stack, in any order (it runs smoke behind, prints, then grain). A new array with the same effects and
   * ASCII ramps only writes its parameters into the running passes; add, remove or reorder an effect, or change a ramp, and the passes are rebuilt.
   */
  readonly effects: readonly ScreenEffectConfig[];
  /** Scene colors the inks come from. Default: the neutral token preset. */
  readonly palette?: ScenePalette;
  /** Print in one ink only. */
  readonly monochrome?: Hex;
  /**
   * Skip the intro and the sweep, and open and close the lens at once. Pair it with frameloop="demand" for a still stage.
   * Default: the viewer's reduced-motion setting (`useReducedMotion`).
   */
  readonly reducedMotion?: boolean;
  /**
   * Called each time a pipeline is built (when the pass mounts, and when a change of structure builds another), with the `uuid` of every
   * render-target texture that pipeline holds, and again with the same ones when the function itself changes. A counter that keeps what it
   * is given counts builds. Read-only: it changes nothing.
   */
  readonly onPipeline?: (targets: readonly string[]) => void;
}

/**
 * Renders the canvas through screen effects (`@hedronite/lts-postfx`). Use it inside `WebGPUCanvas`:
 * the effects are TSL passes on the WebGPU renderer. It takes over rendering from React Three Fiber, follows the pointer for the lens (a tap opens it for a moment on touch), and frees
 * its passes when the stack's structure changes or it unmounts. Parameters and the look's inks move in place.
 */
export function ScreenEffectsPass({ effects, palette = neutral.scene, monochrome, reducedMotion, onPipeline }: ScreenEffectsPassProps) {
  const preferred = useReducedMotion();
  const still = reducedMotion ?? preferred;
  const gl: unknown = useThree((state) => state.gl);
  if (!(gl instanceof WebGPURenderer)) throw new Error("ScreenEffectsPass runs on the WebGPU renderer: put it inside <WebGPUCanvas>");
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  // Under frameloop="demand" (a still stage for reduced motion) the pointer asks for each lens frame.
  const invalidate = useThree((state) => state.invalidate);
  // Rebuild on structure, not on the identity of `effects`: a parameter, a palette or a monochrome ink is written below.
  const structure = stackStructure(effects, still);
  const runner = useMemo(
    () => new ScreenEffects(gl, scene, camera, effects, { palette, reducedMotion: still, ...(monochrome === undefined ? {} : { monochrome }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `structure` stands for `effects` (and `still`); the palette and ink are written by the effect below
    [gl, scene, camera, structure],
  );
  useEffect(() => {
    runner.setParams(stackValues(effects));
    applyPalette(runner, palette, monochrome === undefined ? {} : { monochrome });
  }, [runner, effects, palette, monochrome]);
  useEffect(() => {
    onPipeline?.(runner.targetIds);
  }, [runner, onPipeline]);
  useEffect(
    () => () => {
      runner.dispose();
    },
    [runner],
  );
  useEffect(() => {
    runner.setSize();
  }, [runner, size]);

  useEffect(() => {
    const element = gl.domElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      runner.setPointer({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
      invalidate();
    };
    const leave = (): void => {
      runner.setPointer(null);
      invalidate();
    };
    // Touch has no hover: a tap opens the lens where it lands, then it closes.
    const up = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") return;
      clearTimeout(timer);
      timer = setTimeout(leave, 1600);
    };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerdown", move, { passive: true });
    element.addEventListener("pointerup", up, { passive: true });
    element.addEventListener("pointerleave", leave);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerdown", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointerleave", leave);
    };
  }, [gl, runner, invalidate]);

  // A positive priority takes over rendering from React Three Fiber.
  useFrame((_, delta) => {
    // A long gap (a hidden tab, a paused stage) is one short step, not a jump through the intro and the sweep.
    runner.render(Math.min(delta, 0.1));
  }, 1);
  return null;
}
