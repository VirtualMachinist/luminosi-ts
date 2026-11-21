import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, expectRenderer, settledBuilds, test } from "./fixtures.js";
// The Astro dogfood page, served by `astro preview`. Its 3D section is `<lts-scene>` (`@hedronite/lts-scene/element`):
// a poster at once, three and the scene builder loaded only when the element is near the viewport, no React, and the
// page's look (its theme CSS answers to `data-preset` on the root) mirrored onto the element's `look` attribute.
test.use({ baseURL: process.env["E2E_SITE_URL"] ?? "http://localhost:4174" });

/** The island's element host: the custom element itself carries the poster, the counters and the canvas. */
const scene = (page: Page): Locator => page.getByTestId("island").locator("lts-scene");
/** The element's canvas, inside its shadow root. */
const canvasOf = (host: Locator): Locator => host.locator("canvas");

test("the page renders its icons and solids as static HTML", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS" })).toBeVisible();
  await expect(page.getByTestId("icons").getByRole("listitem")).toHaveCount(12);
  await expect(page.getByTestId("solids").getByRole("listitem")).toHaveCount(5);
});

test("the page ships one module script, the element's own, and no React island", async ({ request }) => {
  const html = await (await request.get("/")).text();
  // One processed script (the element's registration and the look mirror); no hydrated island at all.
  const scripts = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g) ?? [];
  expect(scripts.length, "one module script").toBe(1);
  expect(html).not.toContain("astro-island");
  expect(html).toContain("<lts-scene");
  // The document is inline in the HTML, so the scene is read without a fetch.
  expect(html).toMatch(/<script type="application\/json">{"format":"lts-scene"/);
  // What that one script holds: the element registration, no React, no R3F, no three, no zod — file names lie,
  // so the contents are read.
  const match = /<script\b[^>]*type="module"[^>]*src="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  const text = await (await request.get(match?.[1] ?? "")).text();
  expect(text).toMatch(/lts-scene/);
  expect(text).not.toMatch(/react|react-dom/i);
  expect(text).not.toMatch(/@react-three|isObject3D|isWebGPURenderer|ZodError/);
});

test("the scene shows its poster at load, and nothing 3D is loaded before the element is in view", async ({ page }) => {
  // A viewport short enough that the island (two sections down) is outside the element's 200px near-margin.
  await page.setViewportSize({ width: 1280, height: 480 });
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await page.goto("/");
  const host = scene(page);
  // The poster is the first paint: an image that has loaded, with no canvas yet.
  await expect
    .poll(async () => {
      const image = await host.locator("img").first().evaluate((node) => (node instanceof HTMLImageElement ? { complete: node.complete, width: node.naturalWidth } : { complete: false, width: 0 }));
      return image.complete && image.width > 0;
    })
    .toBe(true);
  await expect(canvasOf(host)).toHaveCount(0, { timeout: 5_000 });
  await expect(host).toHaveAttribute("data-state", "poster");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const scripts = urls.filter((url) => new URL(url).pathname.endsWith(".js"));
  expect(scripts.length, "the page's own scripts loaded").toBeGreaterThan(0);
  // No three, no zod, no scene builder before the element is near the viewport.
  expect(scripts.filter((url) => /three|zod|draw|builder/i.test(new URL(url).pathname)), "no 3D scripts at load").toEqual([]);
  expect(urls.filter((url) => url.endsWith(".glb") || url.endsWith(".json")), "no scene fetch: the document is inline").toEqual([]);
  // The page's own script carries no three either (read back over the network, as a visitor would).
  for (const url of scripts) {
    // eslint-disable-next-line no-await-in-loop -- one file, read once
    const text = await (await page.request.get(url)).text();
    expect(text, url).not.toMatch(/isWebGPURenderer|ZodError|@react-three/);
  }
  // Scrolling the element near the viewport brings the 3D set in and draws it. The trace above only saw
  // the page's own load, so the resource entries now tell what the scroll asked for.
  await host.scrollIntoViewIfNeeded();
  await expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const after = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(after.some((url) => /three/i.test(new URL(url).pathname)), "scrolling brought in three").toBe(true);
  expect(after.some((url) => new URL(url).pathname.endsWith(".js") && /draw/i.test(new URL(url).pathname)), "the builder came with it").toBe(true);
});

test("the element draws on the backend this run allows, and reports it", async ({ page }) => {
  await page.goto("/");
  const host = scene(page);
  await expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expectRenderer(canvasOf(host));
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15_000 });
  await expect(host).toHaveAttribute("data-builds", /^[1-9]\d*$/);
  await expect.poll(async () => Number(await host.getAttribute("data-geometries")), { message: "geometries in use" }).toBeGreaterThan(0);
});

test("the look switch recolours the scene in place", async ({ page }) => {
  await page.goto("/");
  const host = scene(page);
  await expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const built = await settledBuilds(host);
  const geometries = Number(await host.getAttribute("data-geometries"));
  const programs = Number(await host.getAttribute("data-programs"));
  const before = await canvasOf(host).screenshot();
  const frames = Number(await host.getAttribute("data-frames"));
  // The page's look changes; the element's `look` attribute follows it (the mirror in the page's script).
  await page.evaluate(() => {
    document.documentElement.dataset["preset"] = "hedronite";
  });
  await expect(host).toHaveAttribute("look", "hedronite");
  await expect.poll(async () => Number(await host.getAttribute("data-frames")), { message: "a frame after the look" }).toBeGreaterThan(frames);
  await page.waitForTimeout(600);
  expect(Number(await host.getAttribute("data-builds")), "builds after the look").toBe(built);
  expect(Number(await host.getAttribute("data-geometries")), "geometries after the look").toBe(geometries);
  expect(Number(await host.getAttribute("data-programs")), "programs after the look").toBe(programs);
  expect((await canvasOf(host).screenshot()).equals(before), "the picture after the look").toBe(false);
  // Back to the page's own look.
  await page.evaluate(() => {
    delete document.documentElement.dataset["preset"];
  });
  await expect(host).not.toHaveAttribute("look");
});

test("under reduced motion the scene holds its rest pose", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const host = scene(page);
  await expect(host).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expectRenderer(canvasOf(host));
  // The rest pose is drawn once; the frame counter then holds still.
  const frames = Number(await host.getAttribute("data-frames"));
  await page.waitForTimeout(1500);
  expect(Number(await host.getAttribute("data-frames")), "no frames under reduced motion").toBe(frames);
  // A later switch out of reduced motion draws again (the document has no effects, so no rebuild is needed).
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => Number(await host.getAttribute("data-frames")), { message: "frames after motion returns" }).toBeGreaterThan(frames);
});

test("the page has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
