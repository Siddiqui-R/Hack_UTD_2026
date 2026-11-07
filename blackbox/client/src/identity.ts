// Per-tab identity: the token lives in sessionStorage, so it survives reload but two tabs
// are two identities. Once an identity has been signed in and loses its session
// (expired or revoked), the tab discards it and reconnects as a fresh identity.
export const TOKEN_KEY = 'blackbox_token';
const MEMBER_KEY = 'blackbox_member';

function get(key: string) {
  try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; }
}
function set(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export const loadToken = () => get(TOKEN_KEY);
export const saveToken = (token: string) => set(TOKEN_KEY, token);
export const markMember = () => set(MEMBER_KEY, '1');
export const wasMember = () => get(MEMBER_KEY) === '1';

export function discardIdentity() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(MEMBER_KEY);
  } catch { /* storage blocked */ }
  location.reload();
}
