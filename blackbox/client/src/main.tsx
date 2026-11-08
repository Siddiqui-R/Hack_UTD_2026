import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings';
import { SPACETIMEDB_URI, MODULE_NAME } from './config';
import { loadToken, saveToken } from './identity';
import { ToastProvider } from './components/Toast';
import App from './App.tsx';
import './index.css';

const connectionBuilder = DbConnection.builder()
  .withUri(SPACETIMEDB_URI)
  .withDatabaseName(MODULE_NAME)
  .withToken(loadToken())
  .withAutomaticReconnect()
  .onConnect((_conn, identity, token) => {
    saveToken(token);
    console.log('connected', identity.toHexString());
  })
  .onConnectError((_ctx, err) => console.error('connect error', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SpacetimeDBProvider>
  </StrictMode>,
);
