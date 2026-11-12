// Shared by the portal and staff; each billing function checks who may act.
import express, { Router, type Request } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireAuth } from '../auth/session';
import { NotFoundError, UnauthenticatedError } from '../errors';
import { isStaffAccount, resolvePortalActor, type PortalActor } from '../portal/portalActor';
import { documentStore } from '../imports/documentStore';
import { addDocument, addProviderServiceRate, MAX_DOCUMENT_BYTES, providerDocumentStatus, readLinkedDocument } from '../billing/preauthorizationRequests/providerRecords';
import { answerRequestQuestion, askRequestQuestion, decidePreauthorizationRequest, matchPreauthorizationRequest, withdrawPreauthorizationRequest } from '../billing/preauthorizationRequests/decide';
import { createPreauthorizationRequest, listRequestableProviders, previewRequest } from '../billing/preauthorizationRequests/submit';
import { getPreauthorizationRequest, listOwnPreauthorizationRequests, listPreauthorizationRequests } from '../billing/preauthorizationRequests/read';
import { preauthorizationUsageByCounty } from '../billing/preauthorizationUsage';
import { asyncHandler } from './asyncHandler';
import { batchRequest } from '../lists/batches';
import { sendFileDownload } from './sendUploadedFile';
import { tagTourRecord } from '../demoTour/tourRuns';

const router = Router();
router.use(requireAuth);

async function sessionActor(req: Request): Promise<PortalActor> {
  const user = getSessionUser(req);
  if (!user) throw new UnauthenticatedError();
  return resolvePortalActor(db, user.userAccountId);
}

function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' && value ? value : undefined;
}

// Staff see every request (filtered); a requester sees their own; latest first, a batch at a time.
router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const batch = batchRequest(req.query);
    res.json(
      (await isStaffAccount(db, actor.userAccountId))
        ? await listPreauthorizationRequests(
            db,
            actor.userAccountId,
            { status: query(req, 'status'), countyId: query(req, 'countyId'), caseId: query(req, 'caseId'), from: query(req, 'from'), to: query(req, 'to') },
            batch,
          )
        : await listOwnPreauthorizationRequests(db, actor, query(req, 'caseId'), batch),
    );
  }),
);

router.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const created = await createPreauthorizationRequest(db, await sessionActor(req), req.body);
    await tagTourRecord(req, 'preauthorization_request', created.preauthorizationRequestId);
    res.status(201).json(created);
  }),
);

router.post(
  '/requests/preview',
  asyncHandler(async (req, res) => {
    res.json(await previewRequest(db, await sessionActor(req), req.body));
  }),
);

router.get(
  '/providers',
  asyncHandler(async (req, res) => {
    res.json({ providers: await listRequestableProviders(db, await sessionActor(req)) });
  }),
);

router.get(
  '/usage-by-county',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const year = new Date().getUTCFullYear();
    res.json(await preauthorizationUsageByCounty(db, actor.userAccountId, { from: query(req, 'from') ?? `${year}-01-01`, to: query(req, 'to') ?? `${year}-12-31` }));
  }),
);

router.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    res.json(await getPreauthorizationRequest(db, (await sessionActor(req)).userAccountId, req.params.id as string));
  }),
);

router.post(
  '/requests/:id/questions',
  asyncHandler(async (req, res) => {
    res.json(await askRequestQuestion(db, (await sessionActor(req)).userAccountId, req.params.id as string, req.body));
  }),
);

router.post(
  '/requests/:id/questions/:questionId/answer',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    res.json(await answerRequestQuestion(db, actor.userAccountId, req.params.id as string, req.params.questionId as string, req.body));
  }),
);

router.post(
  '/requests/:id/match',
  asyncHandler(async (req, res) => {
    res.json(await matchPreauthorizationRequest(db, (await sessionActor(req)).userAccountId, req.params.id as string, req.body));
  }),
);

router.post(
  '/requests/:id/decision',
  asyncHandler(async (req, res) => {
    res.json(await decidePreauthorizationRequest(db, (await sessionActor(req)).userAccountId, req.params.id as string, req.body));
  }),
);

router.post(
  '/requests/:id/withdraw',
  asyncHandler(async (req, res) => {
    res.json(await withdrawPreauthorizationRequest(db, (await sessionActor(req)).userAccountId, req.params.id as string));
  }),
);

// The raw body is the file; X-File-Name is for display only, ?purpose= says what it is.
const rawFile = express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES });
function uploaded(req: Request) {
  const fileName = req.get('X-File-Name');
  return {
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    fileName: fileName ? decodeURIComponent(fileName) : undefined,
    purpose: query(req, 'purpose'),
  };
}

router.post(
  '/requests/:id/documents',
  rawFile,
  asyncHandler(async (req, res) => {
    const documents = await addDocument(db, documentStore, await sessionActor(req), { preauthorizationRequestId: req.params.id as string }, uploaded(req));
    res.status(201).json({ documents });
  }),
);

router.get(
  '/providers/:id/documents',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const professionalId = req.params.id as string;
    const mayRead =
      (await isStaffAccount(db, actor.userAccountId)) ||
      (await listRequestableProviders(db, actor)).some((row) => row.professionalId === professionalId);
    if (!mayRead) throw new NotFoundError('Provider not found.');
    res.json(await providerDocumentStatus(db, professionalId));
  }),
);

router.post(
  '/providers/:id/documents',
  rawFile,
  asyncHandler(async (req, res) => {
    res.status(201).json(await addDocument(db, documentStore, await sessionActor(req), { professionalId: req.params.id as string }, uploaded(req)));
  }),
);

router.post(
  '/providers/:id/service-rates',
  asyncHandler(async (req, res) => {
    res.status(201).json(await addProviderServiceRate(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    sendFileDownload(res, await readLinkedDocument(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

export default router;
