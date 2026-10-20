/** Resolve only bundled resources. Dots inside hashed filenames are valid. */
export function localResourcePath(input: string, origin: string): string {
  if (!input.startsWith(`${origin}/`)) throw new Error('External resource rejected');
  let path = input.slice(origin.length).split('?')[0].split('#')[0];
  if (/[%\\]/.test(path) || path.includes('//') ||
    path.split('/').some((segment: string) => segment === '..' || segment === '.')) {
    throw new Error('Invalid path');
  }
  if (path.endsWith('/')) path += 'index.html';
  return `www${path}`;
}
