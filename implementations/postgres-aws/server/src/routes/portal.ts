// The external portal: time, invoices, exports and imports, for any
// authenticated session. Time and invoice routes also serve delegates, who
// may have no professional profile of their own.
import { Router } from 'express';
import { requireAuth } from '../auth/session';
import timeRouter from './portal/time';
import invoicesRouter from './portal/invoices';
import importsRouter from './portal/imports';

const router = Router();
router.use(requireAuth);
router.use(timeRouter);
router.use(invoicesRouter);
router.use(importsRouter);

export default router;
