import { Link } from "react-router";
import { FullPageMessage } from "../components/StatusScreens";

export function NotFoundPage() {
  return (
    <FullPageMessage title="Page not found">
      <p>
        That page doesn't exist. It may have moved, or the link might be
        mistyped.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <Link to="/" className="btn btn-ghost">
          Home
        </Link>
        <Link to="/app" className="btn btn-primary">
          Go to market
        </Link>
      </div>
    </FullPageMessage>
  );
}
