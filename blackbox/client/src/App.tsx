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

  // Refresh the 15-minute session on real user activity, at most once a minute.
  useEffect(() => {
    if (!me) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch.current < TOUCH_EVERY_MS) return;
      lastTouch.current = now;
      touchSession().catch(err => console.error('touchSession', err));
    };
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [me, touchSession]);

  if (!teamReady && isActive) return <div className="h-full bg-[#07090b]" />;
  if (!me || holdLogin) return <Login onHold={setHoldLogin} />;
  return <Command me={me} team={team} />;
}
