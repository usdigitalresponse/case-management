// Shared by the portal and staff; each billing function checks who may act.
import express, { Router, type Request } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireAuth } from '../auth/session';
import { NotFoundError, UnauthenticatedError } from '../errors';
import { isStaffAccount, resolvePortalActor, type PortalActor } from '../portal/portalActor';
import { documentStore } from '../imports/documentStore';
import {
  addDocument,
  addProviderServiceRate,
  answerRequestQuestion,
  askRequestQuestion,
  createPreauthorizationRequest,
  decidePreauthorizationRequest,
  getPreauthorizationRequest,
  listOwnPreauthorizationRequests,
  listPreauthorizationRequests,
  listRequestableProviders,
  matchPreauthorizationRequest,
  MAX_DOCUMENT_BYTES,
  previewRequest,
  providerDocumentStatus,
  readLinkedDocument,
  withdrawPreauthorizationRequest,
} from '../billing/preauthorizationRequests';
import { preauthorizationUsageByCounty } from '../billing/preauthorizationUsage';
import { asyncHandler } from './asyncHandler';
import { sendFileDownload } from './sendUploadedFile';

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

// Staff see every request (filtered); a requester sees their own.
router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const requests = (await isStaffAccount(db, actor.userAccountId))
      ? await listPreauthorizationRequests(db, actor.userAccountId, {
          status: query(req, 'status'),
          countyId: query(req, 'countyId'),
          caseId: query(req, 'caseId'),
          from: query(req, 'from'),
          to: query(req, 'to'),
        })
      : await listOwnPreauthorizationRequests(db, actor, query(req, 'caseId'));
    res.json({ requests });
  }),
);

router.post(
  '/requests',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPreauthorizationRequest(db, await sessionActor(req), req.body));
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
