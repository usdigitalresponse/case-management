import { BrowserRouter, Routes, Route, Link as RouterLink } from 'react-router-dom';
import { GridContainer, Title, Header, Button } from '@trussworks/react-uswds';
import { AuthProvider, RequireAuth, useAuth } from './AuthContext';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';

// Deliberately not using Header's collapsible-nav/NavMenuButton pattern:
// that toggles USWDS's `.usa-nav` visibility below the desktop breakpoint,
// and there are no nav links yet to justify the responsive collapse — a
// half-wired toggle would just hide the sign-in controls on narrower
// windows for no benefit.
function TopBar() {
  const { user, loading, devLogin, logout } = useAuth();

  return (
    <Header basic>
      <div className="usa-nav-container display-flex flex-justify flex-align-center">
        <Title>
          <RouterLink to="/">Case Management</RouterLink>
        </Title>
        <div>
          {!loading && !user && (
            <Button type="button" onClick={() => void devLogin()}>
              Dev sign-in
            </Button>
          )}
          {!loading && user && (
            <>
              <RouterLink className="padding-right-2" to="/cases/new">
                New case
              </RouterLink>
              <span className="padding-right-2">{user.displayName}</span>
              <Button type="button" secondary onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </div>
    </Header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <TopBar />
        <GridContainer className="padding-y-4">
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <CaseList />
                </RequireAuth>
              }
            />
            <Route
              path="/cases/new"
              element={
                <RequireAuth>
                  <NewCaseIntake />
                </RequireAuth>
              }
            />
            <Route
              path="/cases/:caseId"
              element={
                <RequireAuth>
                  <CaseDetail />
                </RequireAuth>
              }
            />
          </Routes>
        </GridContainer>
      </BrowserRouter>
    </AuthProvider>
  );
}
