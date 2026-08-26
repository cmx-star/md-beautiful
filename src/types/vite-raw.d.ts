// Vite's `?raw` query returns a string.  Declared here so .ts files
// outside Vite's own typecheck (e.g. `npm run typecheck`) still see the
// import.
declare module '*?raw' {
  const content: string;
  export default content;
}
