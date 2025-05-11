import '@testing-library/jest-dom';

// Mock scrollIntoView as it's not implemented in JSDOM
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// You can add other global setup configurations here if needed.
// For example, if you need to mock a global object or function for all tests. 