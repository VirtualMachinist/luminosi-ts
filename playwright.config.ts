import { defineConfig, devices } from "@playwright/test";
import type { ConsoleOptions } from "./e2e/fixtures.js";

// Browser tests run against the built catalog and site (bun run build first), served by Playwright,
// or against running servers when E2E_CATALOG_URL and E2E_SITE_URL are set (bun run e2e:container).
// The WebGPU lane (bun run e2e:webgpu, see STACK.md) is a script for a machine with a GPU, never part of the default run or CI:
// it exists only when LTS_WEBGPU_LANE is set, and then it is the only project.
const webgpuLane = process.env["LTS_WEBGPU_LANE"] === "1";
// The still-frame rig (bun run stills, see STACK.md) is the same kind of lane: a GPU machine, never CI, only when LTS_STILLS is set, and then the only project.
const stillsLane = process.env["LTS_STILLS"] === "1";
// The golden images (see STACK.md) have two checks of one spec, e2e/golden.spec.ts. The strict one (bun run e2e:golden) draws on the real GPU
// and is a lane like the two above: never CI, only when LTS_GOLDEN is set, and then the only project. The loose one (bun run e2e:golden:loose)
// draws with software WebGL and is what CI runs, in a job of its own; it exists only when LTS_GOLDEN_LOOSE is set, and no run has both.
const goldenLane = process.env["LTS_GOLDEN"] === "1";
const goldenLoose = process.env["LTS_GOLDEN_LOOSE"] === "1";
const goldenAny = goldenLane || goldenLoose;
// The round trip of a scene document (e2e/scenes.spec.ts) is the same pair: strict on the GPU (bun run e2e:scenes), never CI, and loose on
// software WebGL (bun run e2e:scenes:loose), which CI runs in the golden job. Each exists only when its variable is set, and then is the only project.
const scenesLane = process.env["LTS_SCENES"] === "1";
const scenesLoose = process.env["LTS_SCENES_LOOSE"] === "1";
const scenesAny = scenesLane || scenesLoose;
// Every lane that draws still frames serves the built catalog on one port of its own.
const framesAny = goldenAny || scenesAny;
// The lanes need only the catalog, so a catalog URL alone (a tailnet HTTPS address, say) is an external run for them.
const external = process.env["E2E_CATALOG_URL"] !== undefined && (webgpuLane || stillsLane || framesAny || process.env["E2E_SITE_URL"] !== undefined);

export default defineConfig<ConsoleOptions>({
  testDir: "e2e",
  // Against a deployed container only the served pages are under test; the image-to-object review
  // runs local tooling on the local build, so it stays with the normal run. So does the render spec: it runs
  // `lumin scene render`, which serves the local build to a browser of its own, so it never sees the container.
  testIgnore: [...(external ? ["**/review.spec.ts", "**/scenes/*.spec.ts", "**/render.spec.ts"] : []), ...(webgpuLane ? [] : ["**/webgpu.spec.ts"]), ...(goldenAny ? [] : ["**/golden.spec.ts"]), ...(scenesAny ? [] : ["**/scenes.spec.ts"])],
  // Tests, not files, are what workers and CI shards divide: catalog.spec.ts alone is over half the suite.
  fullyParallel: true,
  // Locally every test draws with software WebGL, and each browser's GPU process takes one to three cores, so the default
  // (half the cores) overloads a machine shared with other work and first-frame tests miss the expect timeout.
  // CI keeps the default: one shard per runner, with the longer timeouts below.
  ...(process.env["CI"] === undefined ? { workers: 2 } : {}),
  // One worker for the still-frame rig and the strict golden check: their frames are compared byte for byte, and two browsers sharing one GPU is a variable they need not carry.
  ...(stillsLane || goldenLane || scenesLane ? { workers: 1 } : {}),
  forbidOnly: process.env["CI"] !== undefined,
  // On CI the 3D tests draw with software WebGL on shared runners: the first frame of a viewport
  // (three.js loaded, the studio environment baked) can take longer than the 5 s default, and did,
  // intermittently, from Hedronite/luminosi-ts#26 on. A local run draws with software WebGL as well, on a machine shared with other work, so it has the same expect ceiling.
  expect: { timeout: 15_000 },
  ...(process.env["CI"] === undefined ? {} : { timeout: 60_000 }),
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env["E2E_CATALOG_URL"] ?? (stillsLane ? "http://localhost:4176" : framesAny ? "http://localhost:4177" : webgpuLane ? "http://localhost:4175" : "http://localhost:4173"),
    // Console warnings a test may see; any other warning fails it (see e2e/fixtures.ts). Each entry is a message
    // the app does not cause: nothing in apps/ or packages/ builds a THREE.Clock or sets a shadow map type.
    consoleAllow: [
      // three.js, through @react-three/fiber's render loop.
      /^THREE\.Clock: This module has been deprecated/,
      // @react-three/fiber asks for its default soft shadow map; WebGPURenderer swaps it for PCFShadowMap and says so.
      /^THREE\.WebGPURenderer: PCFSoftShadowMap has been removed/,
      // The runners and the test browser have no WebGPU: the renderer says so and draws through WebGL2 (swiftshader).
      /^THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./,
      /^No available adapters\.$/,
      // Chromium's own performance note when a test reads pixels back from the canvas.
      /GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/,
      // The software GL driver (ANGLE on swiftshader) ending a render pass early on a heavy frame.
      /GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): Running out of reserved outsideRenderPass queueSerial/,
    ],
  },
  projects: scenesLane
    ? [
        {
          name: "scenes",
          testMatch: "scenes.spec.ts",
          // The real GPU through Metal, in the rig's fixed viewport at device pixel ratio 1, like the strict golden check.
          use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal"] } },
        },
      ]
    : scenesLoose
    ? [
        {
          name: "scenes-loose",
          testMatch: "scenes.spec.ts",
          // Software WebGL, as CI draws everything: a coarse comparison against goldens a GPU made.
          use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
        },
      ]
    : goldenLane
    ? [
        {
          name: "golden",
          testMatch: "golden.spec.ts",
          // The real GPU through Metal, as the rig that made the goldens drew them, in the same fixed viewport at device pixel ratio 1.
          use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal"] } },
        },
      ]
    : goldenLoose
    ? [
        {
          name: "golden-loose",
          testMatch: "golden.spec.ts",
          // Software WebGL, as CI draws everything: no GPU, so a coarse comparison against goldens a GPU made.
          use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
        },
      ]
    : stillsLane
    ? [
        {
          name: "stills",
          // The rig's capture lives with its tool, not under e2e/, so the default run and CI never see it.
          testDir: "tools/stills/src",
          testMatch: "stills.spec.ts",
          // The real GPU through Metal, as the WebGPU lane has it. A fixed viewport and device pixel ratio 1: the rig's stage is a fixed square at the top left of the page.
          use: { ...devices["Desktop Chrome"], viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal"] } },
        },
      ]
    : webgpuLane
    ? [
        {
          name: "webgpu",
          // The WebGPU spec, the playground memory guard, which holds the renderer's own counts, render targets among them, flat, and the scene element's spec, which must see `webgpu` on it here.
          testMatch: ["webgpu.spec.ts", "memory.spec.ts", "element.spec.ts", "site.spec.ts"],
          // The real GPU through Metal, with WebGPU switched on: three's WebGPU renderer must find an adapter, not fall back to WebGL 2.
          // Not the software path the default project uses: a SwiftShader adapter would pass for the wrong reason, so the spec also
          // refuses a software adapter (SwiftShader, LLVM, or one that reports itself as a fallback).
          use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal"] } },
        },
      ]
    : [
        {
          name: "chromium",
          // Software WebGL, so 3D tests run the same on GPU-less CI runners.
          use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
        },
      ],
  webServer: external
    ? []
    : framesAny
      ? [
          // The built catalog on its own port, never a reused server: the frames must come from the build the run just made.
          { command: "bunx vite preview --port 4177 --strictPort", cwd: "apps/catalog", url: "http://localhost:4177", reuseExistingServer: false },
        ]
    : stillsLane
      ? [
          // The built catalog on its own port, never a reused server: the frames must come from the build the lane just made.
          { command: "bunx vite preview --port 4176 --strictPort", cwd: "apps/catalog", url: "http://localhost:4176", reuseExistingServer: false },
        ]
    : webgpuLane
      ? [
          // The built catalog on localhost, which is a secure context (navigator.gpu needs one). Its own port and never a reused
          // server, so the lane always runs against the build it just made.
          { command: "bunx vite preview --port 4175 --strictPort", cwd: "apps/catalog", url: "http://localhost:4175", reuseExistingServer: false },
          // The site's element spec (R22.5) needs its page: the lane serves the built site too.
          { command: "bunx astro preview --port 4174", cwd: "apps/site", url: "http://localhost:4174", reuseExistingServer: false },
        ]
      : [
    {
      command: "bunx vite preview --port 4173 --strictPort",
      cwd: "apps/catalog",
      url: "http://localhost:4173",
      reuseExistingServer: process.env["CI"] === undefined,
    },
    {
      command: "bunx astro preview --port 4174",
      cwd: "apps/site",
      url: "http://localhost:4174",
      reuseExistingServer: process.env["CI"] === undefined,
    },
  ],
});
