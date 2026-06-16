import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './AppContext.jsx';

// CSS load order matches the original vanilla project so cascading specificity
// stays identical. base → layout → components → per-page overrides.
import './css/base.css';
import './css/layout.css';
import './css/components.css';
import './css/pages/dashboard.css';
import './css/pages/ingest.css';
import './css/pages/query.css';
import './css/pages/profile.css';
import './css/pages/projects.css';
import './css/pages/history.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
