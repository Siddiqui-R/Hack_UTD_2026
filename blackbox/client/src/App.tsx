import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { markMember, wasMember, discardIdentity } from './identity';
import { Login } from './components/Login';
import { Command } from './views/Command';

const TOUCH_EVERY_MS = 60_000;

export default function App() {
  const { isActive, identity } = useSpacetimeDB();
  const [team, teamReady] = useTable(tables.team);
  const touchSession = useReducer(reducers.touchSession);
  const [holdLogin, setHoldLogin] = useState(false);
  const lastTouch = useRef(0);

  const me = identity ? team.find(m => m.identity.isEqual(identity)) : undefined;

  // Signed in -> remember it. Signed in before but no session now (expired/revoked) -> fresh identity.
  useEffect(() => {
    if (me) markMember();
    else if (isActive && teamReady && wasMember()) discardIdentity();
  }, [me, isActive, teamReady]);

  // Refresh the 15-minute session at most once a minute: on user activity, and on a timer while the
  // tab is visible. A projected tab with nobody touching it (a presenter talking) stays signed in;
  // a hidden or closed tab still expires. Stolen tokens are handled by revocation, not idle expiry.
  const signedIn = !!me;
  useEffect(() => {
    if (!signedIn) return;
    const touch = () => {
      const now = Date.now();
      if (now - lastTouch.current < TOUCH_EVERY_MS) return;
      lastTouch.current = now;
      touchSession().catch(err => console.error('touchSession', err));
    };
    const whileVisible = () => { if (document.visibilityState === 'visible') touch(); };
    const timer = window.setInterval(whileVisible, TOUCH_EVERY_MS);
    window.addEventListener('keydown', touch);
    window.addEventListener('pointerdown', touch);
    document.addEventListener('visibilitychange', whileVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('pointerdown', touch);
      document.removeEventListener('visibilitychange', whileVisible);
    };
  }, [signedIn, touchSession]);

  if (!teamReady && isActive) return <div className="h-full bg-bg-deep" />;
  if (!me || holdLogin) return <Login onHold={setHoldLogin} />;
  return <Command me={me} team={team} />;
}
