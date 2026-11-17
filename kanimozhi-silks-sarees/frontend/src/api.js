const configuredApiOrigin = import.meta.env.VITE_API_URL;
const apiOrigin = (configuredApiOrigin || (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin))
  .replace(/\/+$/, '');

export const apiUrl = `${apiOrigin}/api`;
