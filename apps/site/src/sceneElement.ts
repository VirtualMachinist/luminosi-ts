import { defineSceneElement } from "@hedronite/lts-scene/element";

// The site's 3D section is `<lts-scene>` (`@hedronite/lts-scene/element`, STACK.md "Scene element"): a
// poster at once, three and the scene builder loaded only when the element is about to be seen, no React.
// This script registers the element (nothing registers itself on import) and mirrors the page's look —
// its theme CSS answers to `data-preset` on the root element — onto each scene's `look` attribute, so a
// change of look recolours the solids in place, with no rebuild.
defineSceneElement();

const LOOK_ATTRIBUTE = "look";

const currentLook = (): string | null => {
  const preset = document.documentElement.dataset["preset"];
  return preset === undefined || preset === "" ? null : preset;
};

const applyLook = (scene: Element): void => {
  const look = currentLook();
  if (look === null) scene.removeAttribute(LOOK_ATTRIBUTE);
  else scene.setAttribute(LOOK_ATTRIBUTE, look);
};

for (const scene of document.querySelectorAll("lts-scene")) applyLook(scene);

const observer = new MutationObserver(() => {
  for (const scene of document.querySelectorAll("lts-scene")) applyLook(scene);
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-preset"] });
