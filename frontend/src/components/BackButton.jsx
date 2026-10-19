import { useNavigate } from 'react-router-dom';

// Behaves like the browser's Back button while the user has been moving around
// inside Prism; when the page was opened directly (bookmark, refresh, new tab)
// there is nothing in-app to go back to, so it goes to `fallback` instead.
export default function BackButton({ fallback = '/dashboard' }) {
  const navigate = useNavigate();
  // React Router keeps a per-entry index in history.state; idx > 0 means an
  // earlier Prism page exists in this tab's history.
  const canGoBack = (window.history.state?.idx ?? 0) > 0;

  return (
    <button
      type="button"
      className="topbar-back"
      onClick={() => (canGoBack ? navigate(-1) : navigate(fallback))}
      title="Back"
      aria-label="Back"
    >
      ←
    </button>
  );
}
