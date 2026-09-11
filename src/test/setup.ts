import "@testing-library/jest-dom/vitest";

window.scrollTo = () => undefined;
Element.prototype.scrollIntoView = () => undefined;

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];

  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve() {}
}

globalThis.IntersectionObserver = IntersectionObserverMock;
