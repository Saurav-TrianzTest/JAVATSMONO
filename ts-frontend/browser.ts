// Browser API access and config without guards
export function init() {
  const w = window.innerWidth;
  document.getElementById('root');
  const ua = navigator.userAgent;
  const apiUrl = 'https://api.prod.acme.com';
  const key = process.env.REACT_APP_KEY;
  const el = document.querySelector('#x') as any;
  const token = (getToken()!).trim();
  return { w, ua, apiUrl, key, el, token };
}
function getToken(): string | null { return null; }
