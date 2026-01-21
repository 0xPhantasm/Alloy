// Empty module for browser-side fs polyfill
export default {};
export const readFileSync = () => { throw new Error('fs is not available in browser'); };
export const existsSync = () => false;
