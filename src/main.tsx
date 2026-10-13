import React, { type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

class AppErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RentalPS render error:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <main style={pageStyle}>
          <h1 style={{ margin: '0 0 10px' }}>RentalPS Manager gagal ditampilkan</h1>
          <p style={{ margin: '0 0 12px' }}>React mengalami error saat merender halaman. Detail untuk diagnosis:</p>
          <pre style={errorStyle}>{this.state.error.message}</pre>
          <button style={buttonStyle} onClick={() => window.location.reload()}>Muat ulang</button>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

function showStartupError(reason: unknown) {
  if (!rootElement) return;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('RentalPS startup error:', reason);
  rootElement.replaceChildren();
  const panel = document.createElement('main');
  panel.style.cssText = 'max-width:720px;margin:10vh auto;padding:28px;font:15px/1.6 system-ui,sans-serif;color:#182033;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 12px 35px rgba(15,23,42,.08)';
  const title = document.createElement('h1');
  title.textContent = 'RentalPS Manager gagal dimuat';
  title.style.cssText = 'font-size:24px;margin:0 0 10px';
  const description = document.createElement('p');
  description.textContent = 'Aplikasi gagal memuat modul JavaScript. Detail error:';
  const details = document.createElement('pre');
  details.textContent = message;
  details.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f8fafc;border-radius:8px;color:#991b1b';
  const help = document.createElement('p');
  help.textContent = 'Periksa koneksi asset di Vercel dan konfigurasi environment variables, lalu muat ulang halaman.';
  const retry = document.createElement('button');
  retry.textContent = 'Muat ulang';
  retry.style.cssText = 'border:0;border-radius:8px;background:#4f46e5;color:white;padding:10px 16px;font-weight:600;cursor:pointer';
  retry.addEventListener('click', () => window.location.reload());
  panel.append(title, description, details, help, retry);
  rootElement.append(panel);
}

if (!rootElement) throw new Error('Elemen #root tidak ditemukan di index.html.');
const root = ReactDOM.createRoot(rootElement);
void import('./App')
  .then(({ default: App }) => {
    root.render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
  })
  .catch(showStartupError);

const pageStyle: React.CSSProperties = {
  maxWidth: 720, margin: '10vh auto', padding: 28, font: '15px/1.6 system-ui, sans-serif',
  color: '#182033', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16,
  boxShadow: '0 12px 35px rgba(15,23,42,.08)',
};
const errorStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12, background: '#fef2f2',
  borderRadius: 8, color: '#991b1b',
};
const buttonStyle: React.CSSProperties = {
  border: 0, borderRadius: 8, background: '#4f46e5', color: '#fff', padding: '10px 16px',
  fontWeight: 600, cursor: 'pointer',
};
