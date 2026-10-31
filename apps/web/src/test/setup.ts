import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement element scrolling.
Element.prototype.scrollTo ??= () => undefined;

afterEach(() => {
  cleanup();
  localStorage.clear();
});
