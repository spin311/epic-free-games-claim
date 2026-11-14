import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './style.css';
import { applyDocumentLanguage } from '@/entrypoints/utils/i18n.ts';

// index.html says lang="en"; the served catalogue may be another language.
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
