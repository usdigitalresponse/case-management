// The sign-in page for people sending invoices: just the code sign-in, under
// the portal's own top bar, without the staff sign-in beside it.
import { PortalTopBar } from './PortalTopBar';
import { CodeSignIn } from './CodeSignIn';

export default function PortalSignIn() {
  return (
    <>
      <PortalTopBar />
      <main id="main-content" className="portal-sign-in" tabIndex={-1}>
        <div className="portal-sign-in__card">
          <CodeSignIn />
        </div>
        <p className="portal-sign-in__note">Not on file yet? Ask the billing office to add your email.</p>
      </main>
    </>
  );
}
