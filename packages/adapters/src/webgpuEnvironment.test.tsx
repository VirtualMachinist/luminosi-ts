import { ACESFilmicToneMapping, Scene, Texture } from "three";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The WebGPU studio environment, and what it must keep: the same room the root environment used to bake (see
// `studioRoom.ts`), a blur of 0.04, three's own intensity of 1 and React Three Fiber's ACES filmic tone mapping.
interface Bake {
  readonly from: string;
  readonly room: unknown;
  readonly sigma: number;
  readonly generatorDisposed: () => boolean;
  readonly targetDisposed: () => boolean;
  readonly texture: Texture;
}
const { bakes, recorder } = vi.hoisted(() => {
  const bakes: Bake[] = [];
  const recorder = (from: string) =>
  class {
    private gone = false;
    fromScene(room: unknown, sigma: number) {
      const texture = new Texture();
      let targetGone = false;
      bakes.push({ from, room, sigma, generatorDisposed: () => this.gone, targetDisposed: () => targetGone, texture });
      return {
        texture,
        dispose: () => {
          targetGone = true;
        },
      };
    }
    dispose() {
      this.gone = true;
    }
  };
  return { bakes, recorder };
});
vi.mock("three", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), PMREMGenerator: recorder("webgl") }));
vi.mock("three/webgpu", () => ({
  PMREMGenerator: recorder("webgpu"),
  // Every renderer is "the WebGPU renderer" here: the check it makes is the one under test elsewhere, in entry.test.ts and the lane.
  WebGPURenderer: { [Symbol.hasInstance]: () => true },
}));

const { WebGPUStudioEnvironment } = await import("./webgpuEnvironment.js");
const { STUDIO_BLUR } = await import("./studioRoom.js");
/** The look the root environment has always had, and what the WebGPU one must keep: React Three Fiber's ACES filmic, and three's own intensity of 1. */
const studioRoom = { blur: 0.04, intensity: 1, toneMapping: ACESFilmicToneMapping } as const;

beforeEach(() => {
  bakes.length = 0;
});

/** The scene and the tone mapping the renderer ended up with, as React Three Fiber configured it, read from inside the canvas. */
const mounted = async (element: React.ReactElement) => {
  let toneMapping: number | undefined;
  let scene: Scene | undefined;
  const Probe = () => {
    toneMapping = useThree((state) => state.gl.toneMapping);
    scene = useThree((state) => state.scene);
    return null;
  };
  const renderer = await ReactThreeTestRenderer.create(
    <>
      {element}
      <Probe />
    </>,
  );
  return { renderer, tone: () => toneMapping, scene: () => scene };
};

describe("the WebGPU studio environment", () => {
  it("pin the room's values: a blur of 0.04, three's own intensity of 1, and ACES filmic tone mapping", () => {
    expect(STUDIO_BLUR).toBe(studioRoom.blur);
    expect(new Scene().environmentIntensity).toBe(studioRoom.intensity);
  });

  it("bakes the room with that blur through the WebGPU renderer's generator, and frees the generator at once", async () => {
    const webgpu = await mounted(<WebGPUStudioEnvironment />);
    for (const bake of bakes) {
      expect(bake.room).toBeInstanceOf(RoomEnvironment);
      expect(bake.sigma).toBe(studioRoom.blur);
      expect(bake.generatorDisposed()).toBe(true);
    }
    expect(webgpu.scene()?.environment).toBe(bakes[0]?.texture);
    await webgpu.renderer.unmount();
    for (const bake of bakes) expect(bake.targetDisposed()).toBe(true);
  });

  it("leaves the scene's intensity alone, so the scene lights at three's default, and the renderer gets React Three Fiber's ACES filmic", async () => {
    const webgpu = await mounted(<WebGPUStudioEnvironment />);
    expect(webgpu.scene()?.environmentIntensity).toBe(studioRoom.intensity);
    expect(webgpu.tone()).toBe(studioRoom.toneMapping);
    await webgpu.renderer.unmount();
  });
});
