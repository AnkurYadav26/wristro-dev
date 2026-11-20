import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page center">
      <h1>404</h1>
      <p className="muted">We could not find that page.</p>
      <Link to="/" className="btn">Back to home</Link>
    </div>
  );
}
