import { useAuth } from "@/_core/hooks/useAuth";
import { RouteGuard } from "@/components/RouteGuard";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import SignIn from "@/pages/auth/SignIn";
import SignUp from "@/pages/auth/SignUp";
import VerifyEmail from "@/pages/auth/VerifyEmail";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import NotFound from "@/pages/NotFound";
import Upgrade from "@/pages/Upgrade";
import Profile from "@/pages/Profile";
import AdminDashboard from "@/pages/AdminDashboard";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import { Privacy, Terms } from "./pages/Legal";
import DataDeletionStatus from "./pages/DataDeletionStatus";

function PublicRouter() {
  return (
    <Switch>
      <Route path="/auth/signin">
        <PublicAuthRoute>
          <SignIn />
        </PublicAuthRoute>
      </Route>
      <Route path="/auth/signup">
        <PublicAuthRoute>
          <SignUp />
        </PublicAuthRoute>
      </Route>
      <Route path="/auth/verify-email">
        <VerifyEmail />
      </Route>
      <Route path="/auth/forgot-password">
        <PublicAuthRoute>
          <ForgotPassword />
        </PublicAuthRoute>
      </Route>
      <Route path="/auth/reset-password">
        <ResetPassword />
      </Route>
      <Route>
        <ProtectedRouter />
      </Route>
    </Switch>
  );
}

/**
 * Wrapper for routes that should only be reachable by signed-out visitors.
 * Authenticated users are redirected to `/` (active) or `/upgrade` (!active),
 * per contracts/route-guard.md C2.
 */
function PublicAuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isActive } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (loading || !user) return;
    const target = isActive ? "/" : "/upgrade";
    navigate(target, { replace: true });
  }, [loading, user, isActive, navigate]);

  if (loading) return null;
  if (user) return null;
  return <>{children}</>;
}

function ProtectedRouter() {
  return (
    <RouteGuard>
      <Switch>
        <Route path="/upgrade" component={Upgrade} />
        <Route path="/" component={Home} />
        <Route path="/dashboard/:accountId" component={Dashboard} />
        <Route path="/settings/:accountId" component={Settings} />
        <Route path="/profile" component={Profile} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/data-deletion-status" component={DataDeletionStatus} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </RouteGuard>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <PublicRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
