import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@uswds/uswds/css/uswds.min.css';
import '@trussworks/react-uswds/lib/index.css';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
