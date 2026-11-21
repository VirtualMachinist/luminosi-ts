import { describe, expect, it, vi } from "vitest";

// Loading three's WebGPU build, or the shader builders that sit on it, is an error in this file. The
// root entry must load without either; ./webgpu is where they belong.
vi.mock("three/webgpu", () => {
  throw new Error("three/webgpu was loaded");
});
vi.mock("@hedronite/lts-shaders/three", () => {
  throw new Error("the shader builders were loaded");
});

describe("the adapters' entries", () => {
  it("loads the root entry without three's WebGPU build or the shader builders", async () => {
    const root = await import("./index.js");
    expect(Object.keys(root)).toEqual(expect.arrayContaining(["PrimitiveMesh", "StudioLights"]));
      // The root environment is gone (one renderer); its name must not come back here, and the WebGPU set stays in ./webgpu.
    for (const name of ["StudioEnvironment", "WebGPUCanvas", "ScreenEffectsPass", "WebGPUStudioEnvironment"]) expect(root).not.toHaveProperty(name);
  });

  it("keeps WebGPUCanvas, ScreenEffectsPass and the WebGPU environment in ./webgpu, which does need the WebGPU build", async () => {
    // The mock above makes this load fail, which shows the mock bites and where the WebGPU build is wanted.
    await expect(import("./webgpu.js")).rejects.toThrow();
  });
});
