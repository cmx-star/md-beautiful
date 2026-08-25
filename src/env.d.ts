// Type declarations for external libraries
interface MathJaxInstance {
  typesetPromise(elements?: HTMLElement[]): Promise<void>;
}

interface Window {
  MathJax?: MathJaxInstance;
}
