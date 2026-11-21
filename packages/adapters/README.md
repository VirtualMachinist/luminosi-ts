# @hedronite/lts-adapters

React Three Fiber components over the libraries. Each owns its GPU resources and frees them on change or unmount. React and R3F are optional peers; every other package works without this one.

```tsx
import { PrimitiveMesh, StudioLights, CrystalCluster } from "@hedronite/lts-adapters";

<Canvas>
  <StudioLights />
  <PrimitiveMesh primitive="platonic-icosahedron" material="glass" />
  <CrystalCluster count={9} seed={3} position={[1.5, 0, 0]} />
</Canvas>
```

## One renderer: `@hedronite/lts-adapters/webgpu`

What needs three's `WebGPURenderer` (WebGPU where the browser has it, WebGL 2 where it does not) is in its own entry, so the root entry never loads `three/webgpu`.

- `WebGPUCanvas`: a React Three Fiber `Canvas` on `WebGPURenderer`. Once the renderer has started, its `<canvas>` carries `data-renderer="webgpu"` or `data-renderer="webgl2"`, read from the renderer after `init()` (`renderer.backend`), never from `navigator.gpu`: a browser can offer WebGPU and still fall back.
- `rendererReadout(renderer)` (it lives in `@hedronite/lts-scene/renderer`, which imports nothing, and is re-exported here unchanged): the same readout for a renderer you build by hand. Call it right after `await renderer.init()`; it writes `data-renderer` on the renderer's canvas and returns the backend. It throws before `init()` has finished and for a backend that is neither three's WebGPU nor its WebGL 2 backend, rather than guess. `backendOf(renderer)` reads without writing.
- `whenDrawn(renderer)`: resolves once the backend has finished the frame it was given (`device.queue.onSubmittedWorkDone()` on WebGPU, `gl.finish()` on the WebGL 2 backend). Await it after the render call, before a ready flag says the picture is there; no timer wait.
- `WebGPUStudioEnvironment`: the studio room as the scene's environment, baked by the WebGPU renderer's own generator (the room, its blur and the intensity are in `studioRoom.ts`).
- `ScreenEffectsPass`: screen effects as TSL passes.

```tsx
import { WebGPUCanvas, WebGPUStudioEnvironment } from "@hedronite/lts-adapters/webgpu";

<WebGPUCanvas>
  <WebGPUStudioEnvironment />
  <PrimitiveMesh primitive="platonic-icosahedron" material="glass" />
</WebGPUCanvas>
```
