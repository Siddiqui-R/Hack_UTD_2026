import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings';
import { SPACETIMEDB_URI, MODULE_NAME } from './config';
import App from './App.tsx';

// Per-tab token: survives reload, but two tabs are two different identities.
const TOKEN_KEY = 'blackbox_token';
let savedToken: string | undefined;
try { savedToken = sessionStorage.getItem(TOKEN_KEY) ?? undefined; } catch { /* storage blocked */ }

const connectionBuilder = DbConnection.builder()
  .withUri(SPACETIMEDB_URI)
  .withDatabaseName(MODULE_NAME)
  .withToken(savedToken)
  .withAutomaticReconnect()
  .onConnect((_conn, identity, token) => {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked */ }
    console.log('connected', identity.toHexString());
  })
  .onConnectError((_ctx, err) => console.error('connect error', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
