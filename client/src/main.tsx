import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './cesium/ionConfig'; // set Cesium ion token before any ion asset loads
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
