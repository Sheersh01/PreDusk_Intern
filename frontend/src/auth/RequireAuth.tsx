import { Navigate, useLocation } from "react-router-dom";
import { isAuthenticated } from "./auth";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
