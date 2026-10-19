import { Link, useLocation } from 'react-router-dom';

// Shown for any address that doesn't match a page, instead of a blank screen.
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="page active">
      <div className="empty-state" style={{ height: '60vh' }}>
        <div className="empty-icon">∅</div>
        <div className="empty-text">There's no page at <code>{pathname}</code></div>
        <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: 12, textDecoration: 'none' }}>Go to Dashboard</Link>
      </div>
    </div>
  );
}
