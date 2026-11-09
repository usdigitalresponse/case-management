import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@uswds/uswds/css/uswds.min.css';
import '@trussworks/react-uswds/lib/index.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-serif/600.css';
import App from './App';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
