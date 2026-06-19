import { RouteGuard } from "@/components/RouteGuard";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import SignIn from "@/pages/auth/SignIn";
import SignUp from "@/pages/auth/SignUp";
import NotFound from "@/pages/NotFound";
import Upgrade from "@/pages/Upgrade";
import { Route, Switch } from "wouter";
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
      <Route path="/auth/signin" component={SignIn} />
      <Route path="/auth/signup" component={SignUp} />
      <Route path="/upgrade" component={Upgrade} />
      <Route>
        <ProtectedRouter />
      </Route>
    </Switch>
  );
}

function ProtectedRouter() {
  return (
    <RouteGuard>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard/:accountId" component={Dashboard} />
        <Route path="/settings/:accountId" component={Settings} />
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
