// controllers/driver.controller.js
const PDFDocument = require('pdfkit');
const axios = require('axios');
const { Readable } = require('stream');
const prisma = require('../../lib/prisma');
const path = require('path');
const pino = require('pino');

// --- logger ---
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'driver-controller' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/* ---------------------- small utils ---------------------- */
function encodeDrivePath(rawPath) {
  return (rawPath || '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
function contentTypeFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
function nowTimestampAU() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}
function safeInvoiceId(id) {
  return String(id || 'NA').replace(/[^\w-]/g, '_');
}
function datedFolderPrefix() {
  const baseFolder = process.env.ONEDRIVE_FOLDER || 'FleetPODs';
  const day = new Date();
  const dd = String(day.getDate()).padStart(2, '0');
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const yyyy = day.getFullYear();
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  return `${baseFolder}/${dateFolder}`;
}
// NEW: sanitize description for filenames
function safeDesc(str) {
  return (str || 'NoDescription')
    .replace(/[^\w\s-]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

/* ---------------------- Graph auth ----------------------- */
let cachedToken = null;
let cachedExpiry = 0;

async function getGraphToken() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const tenant = process.env.ONEDRIVE_TENANT_ID;
  const now = Date.now();

  if (cachedToken && now < cachedExpiry) {
    logger.debug({ ttlMs: cachedExpiry - now }, 'Using cached Graph token');
    return cachedToken;
  }

  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;

  if (refreshToken) {
    if (!clientId || !clientSecret) {
      logger.error('ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET required for refresh flow');
      throw new Error('ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET required');
    }
    try {
      logger.info('Requesting Graph token via refresh_token (app user flow)');
      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);
      if (redirectUri) params.append('redirect_uri', redirectUri);
      params.append('scope', 'offline_access files.readwrite openid profile');

      const tokenRes = await axios.post(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 }
      );
      cachedToken = tokenRes.data.access_token;
      cachedExpiry = now + (tokenRes.data.expires_in - 180) * 1000;
      logger.info({ expiresIn: tokenRes.data.expires_in }, 'Obtained Graph token (refresh flow)');
      return cachedToken;
    } catch (e) {
      logger.error({ msg: 'Graph token (refresh) error', err: e?.message || e });
      throw e;
    }
  }

  if (!tenant || !clientId || !clientSecret) {
    logger.error('Missing OneDrive OAuth env for app-only flow');
    throw new Error('Missing OneDrive OAuth env for app-only flow');
  }

  try {
    logger.info('Requesting Graph token via client_credentials (app-only flow)');
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 }
    );
    cachedToken = tokenRes.data.access_token;
    cachedExpiry = now + (tokenRes.data.expires_in - 180) * 1000;
    logger.info({ expiresIn: tokenRes.data.expires_in }, 'Obtained Graph token (client_credentials)');
    return cachedToken;
  } catch (e) {
    logger.error({ msg: 'Graph token (client_credentials) error', err: e?.message || e });
    throw e;
  }
}

function driveRootBase() {
  if (process.env.ONEDRIVE_REFRESH_TOKEN) return 'https://graph.microsoft.com/v1.0/me/drive';
  const userId = process.env.ONEDRIVE_USER_ID;
  if (!userId) {
    logger.error('ONEDRIVE_USER_ID is required for app-only flow');
    throw new Error('ONEDRIVE_USER_ID is required for app-only flow');
  }
  return `https://graph.microsoft.com/v1.0/users/${userId}/drive`;
}

/* ------------------ OneDrive helpers ------------------ */
async function createUploadSessionForLogicalPath(logicalPath) {
  const accessToken = await getGraphToken();
  const root = driveRootBase();
  const pathPart = encodeDrivePath(logicalPath);
  const url = `${root}/root:/${pathPart}:/createUploadSession`;
  logger.info({ logicalPath }, 'Creating upload session');
  const res = await axios.post(
    url,
    { item: { '@microsoft.graph.conflictBehavior': 'replace', name: path.basename(logicalPath) } },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }
  );
  return { uploadUrl: res.data?.uploadUrl, itemPath: logicalPath, fileName: path.basename(logicalPath) };
}
async function getDriveItemByPath(logicalPath) {
  const accessToken = await getGraphToken();
  const root = driveRootBase();
  const pathPart = encodeDrivePath(logicalPath);
  const url = `${root}/root:/${pathPart}`;
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 });
  return res.data; // includes webUrl, id, etc
}
async function downloadContentByItemIdOrPath({ id, itemPath }) {
  const accessToken = await getGraphToken();
  const root = driveRootBase();
  let contentUrl;
  if (id) {
    contentUrl = `${root}/items/${encodeURIComponent(id)}/content`;
  } else if (itemPath) {
    const item = await getDriveItemByPath(itemPath);
    contentUrl = `${root}/items/${encodeURIComponent(item.id)}/content`;
  } else {
    throw new Error('downloadContentByItemIdOrPath requires id or itemPath');
  }
  const res = await axios.get(contentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'arraybuffer',
    timeout: 300000,
  });
  return Buffer.from(res.data);
}
async function uploadToOneDrive(buffer, logicalPath) {
  const accessToken = await getGraphToken();
  const root = driveRootBase();
  const pathPart = encodeDrivePath(logicalPath);
  const FOUR_MB = 4 * 1024 * 1024;

  if (buffer.length <= FOUR_MB) {
    logger.info({ logicalPath, size: buffer.length }, 'Uploading small file (direct PUT)');
    const res = await axios.put(
      `${root}/root:/${pathPart}:/content`,
      buffer,
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentTypeFromName(logicalPath) },
        maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000
      }
    );
    return res.data;
  }

  logger.info({ logicalPath, size: buffer.length }, 'Uploading large file (session)');
  // session upload for large files
  const session = await axios.post(
    `${root}/root:/${pathPart}:/createUploadSession`,
    { item: { '@microsoft.graph.conflictBehavior': 'replace', name: path.basename(logicalPath) } },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }
  );
  const uploadUrl = session.data.uploadUrl;
  const chunkSize = 5 * 1024 * 1024;
  let start = 0;
  while (start < buffer.length) {
    const end = Math.min(start + chunkSize, buffer.length);
    const chunk = buffer.slice(start, end);
    const contentRange = `bytes ${start}-${end - 1}/${buffer.length}`;
    logger.debug({ start, end, total: buffer.length }, 'Uploading chunk');
    await axios.put(uploadUrl, chunk, {
      headers: { 'Content-Length': chunk.length, 'Content-Range': contentRange },
      maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000
    });
    start = end;
  }
  return await getDriveItemByPath(logicalPath);
}
async function retryAsync(fn, attempts = 3, baseDelay = 1500, label = '') {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { 
      if (i > 0) logger.info({ label, attempt: i + 1 }, 'Retry attempt');
      return await fn(); 
    }
    catch (e) {
      lastErr = e;
      const wait = baseDelay * Math.pow(2, i);
      logger.warn({ label, attempt: i + 1, err: e?.response?.status || e?.code || e?.message }, 'Retry failed');
      await new Promise(r => setTimeout(r, wait));
    }
  }
  logger.error({ label, attempts, err: lastErr?.message || lastErr }, 'All retry attempts failed');
  throw lastErr;
}

/* -------------------- PDF helpers -------------------- */
function buildPdfBufferFromImages(podBuffers, invoiceBuffers, checklist) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const addImagePage = (buf, label) => {
      doc.addPage({ size: 'A4', margin: 40 });
      if (label) doc.fontSize(12).text(label, { underline: true });
      doc.moveDown(0.5);
      try { doc.image(buf, { fit: [520, 700], align: 'center', valign: 'center' }); }
      catch { doc.fontSize(10).fillColor('red').text('Image could not be embedded').fillColor('black'); }
    };

    (podBuffers?.length ? podBuffers : [null]).forEach((b, i) => {
      if (b) addImagePage(b, `POD ${i + 1}`); else doc.addPage({ size: 'A4', margin: 40 }).fontSize(12).text('No POD images provided');
    });
    (invoiceBuffers?.length ? invoiceBuffers : [null]).forEach((b, i) => {
      if (b) addImagePage(b, `Invoice ${i + 1}`); else doc.addPage({ size: 'A4', margin: 40 }).fontSize(12).text('No Invoice images provided');
    });

    doc.addPage({ size: 'A4', margin: 40 });
    doc.fontSize(12).text('Checklist / Comments:', { underline: true });
    doc.moveDown();

    try {
      if (Array.isArray(checklist)) checklist.forEach((x, i) => doc.fontSize(11).text(`${i + 1}. ${typeof x === 'string' ? x : JSON.stringify(x)}`));
      else if (typeof checklist === 'object' && checklist) Object.entries(checklist).forEach(([k, v]) => doc.fontSize(11).text(`${k}: ${v}`));
      else if (typeof checklist === 'string' && checklist.trim()) doc.fontSize(11).text(checklist);
      else doc.fontSize(11).text('No checklist provided');
    } catch { doc.fontSize(11).text('Checklist parsing error'); }

    doc.end();
  });
}

/* ---------------------- Core handlers ---------------------- */
async function startAssignment(req, res) {
  try {
    const { assignedTaskId, truckNo } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId required' });

    const data = { status: 'Started' };
    if (truckNo !== undefined) data.truckNo = Number(truckNo);

    const updated = await prisma.assignedTask_DB.update({
      where: { assignedTaskId: Number(assignedTaskId) },
      data,
    });
    logger.info({ assignedTaskId }, 'Assignment started');
    return res.status(200).json({ message: 'Assignment started', updated });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'startAssignment error');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Create OneDrive upload sessions for POD & Invoice.
 * Body: { assignedTaskId, invoiceId }
 * Returns: { pod: {uploadUrl,itemPath,fileName}, invoice:{...}, chunkHintBytes }
 */
async function createUploadSessions(req, res) {
  try {
    const { assignedTaskId, invoiceId } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId is required' });

    const atId = Number(assignedTaskId);
    logger.info({ assignedTaskId: atId, invoiceId: invoiceId || 'none' }, 'createUploadSessions called');

    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) {
      logger.warn({ assignedTaskId: atId }, 'Assigned task not found');
      return res.status(404).json({ error: 'Assigned task not found' });
    }

    const inv = safeInvoiceId(invoiceId || assigned.invoiceId);
    const ts = nowTimestampAU();
    const folderPrefix = `${datedFolderPrefix()}/images`;

    // NEW: include description in filenames
    const desc = safeDesc(assigned.description);

    const podFileName = `PodImage_${inv}_${ts}_${desc}.jpg`;
    const invoiceFileName = `InvoiceImage_${inv}_${ts}_${desc}.jpg`;

    logger.debug({ podFileName, invoiceFileName, folderPrefix }, 'Prepared logical file names');

    const [pod, invoice] = await Promise.all([
      retryAsync(() => createUploadSessionForLogicalPath(`${folderPrefix}/${podFileName}`), 3, 1500, 'createPodSession'),
      retryAsync(() => createUploadSessionForLogicalPath(`${folderPrefix}/${invoiceFileName}`), 3, 1500, 'createInvoiceSession'),
    ]);

    logger.info({ assignedTaskId: atId, podPath: pod.itemPath, invoicePath: invoice.itemPath }, 'Upload sessions created');
    return res.status(200).json({
      assignedTaskId: atId,
      pod,
      invoice,
      chunkHintBytes: 5 * 1024 * 1024,
    });
  } catch (e) {
    logger.error({ err: e?.response?.data || e?.message || e }, 'createUploadSessions error');
    return res.status(500).json({ error: 'Failed to create upload sessions' });
  }
}

/**
 * Finalize after client uploads.
 */
async function finalizeAssignmentUploads(req, res) {
  try {
    const {
      assignedTaskId,
      truckNo,
      driverName,
      invoiceId,
      podItems = [],
      invoiceItems = [],
      podItemPath,
      invoiceItemPath,
      checklist,
    } = req.body || {};

    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId is required' });

    const atId = Number(assignedTaskId);
    logger.info({ assignedTaskId: atId, truckNo: truckNo ?? null, driverName: driverName ?? null }, 'finalizeAssignmentUploads called');

    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) {
      logger.warn({ assignedTaskId: atId }, 'Assigned task not found');
      return res.status(404).json({ error: 'Assigned task not found' });
    }

    const podArray = Array.isArray(podItems) ? [...podItems] : [];
    if ((!podArray || podArray.length === 0) && podItemPath) {
      podArray.push({ itemPath: podItemPath });
    }
    const invArray = Array.isArray(invoiceItems) ? [...invoiceItems] : [];
    if ((!invArray || invArray.length === 0) && invoiceItemPath) {
      invArray.push({ itemPath: invoiceItemPath });
    }

    async function resolveItems(items) {
      const out = [];
      for (const it of items) {
        try {
          if (it?.webUrl && it?.id) { out.push({ webUrl: it.webUrl, id: it.id, itemPath: it.itemPath || null }); continue; }
          if (it?.webUrl && !it?.id) { out.push({ webUrl: it.webUrl, id: null, itemPath: it.itemPath || null }); continue; }
          if (it?.itemPath) {
            const d = await retryAsync(() => getDriveItemByPath(it.itemPath), 3, 1500, 'getByPath');
            out.push({ webUrl: d?.webUrl || null, id: d?.id || null, itemPath: it.itemPath });
          }
        } catch (e) {
          logger.warn({ item: it, err: e?.message || e }, 'resolveItems: skipping item after error');
        }
      }
      return out.filter(x => x.webUrl);
    }

    const podResolved = await resolveItems(podArray);
    const invResolved = await resolveItems(invArray);

    const podUrls = podResolved.map(x => x.webUrl);
    const invoiceUrls = invResolved.map(x => x.webUrl);

    const completedData = {
      taskId: assigned.taskId,
      orderCo: assigned.orderCo,
      orTy: assigned.orTy,
      orderNumber: assigned.orderNumber,
      branchPlant: assigned.branchPlant,
      customerPO: assigned.customerPO,
      suburbTown: assigned.suburbTown,
      name: assigned.name,
      description: assigned.description,
      quantityShipped: assigned.quantityShipped,
      itemNumber: assigned.itemNumber,
      postalCode: assigned.postalCode,
      revNbr: assigned.revNbr,
      revisionReason: assigned.revisionReason,
      routeCode: assigned.routeCode,
      schedPick: assigned.schedPick,
      truckId: assigned.truckId,
      location: assigned.location,
      scheduledPickTime: assigned.scheduledPickTime,
      requestDate: assigned.requestDate,
      soldTo: assigned.soldTo,
      shipTo: assigned.shipTo,
      deliverTo: assigned.deliverTo,
      stateCode: assigned.stateCode,
      lnTy: assigned.lnTy,
      descriptionLine2: assigned.descriptionLine2,
      zoneNo: assigned.zoneNo,
      stopCode: assigned.stopCode,
      nextStat: assigned.nextStat,
      lastStat: assigned.lastStat,
      priority: assigned.priority,
      futureQtyCommitted: assigned.futureQtyCommitted,
      quantityOrdered: assigned.quantityOrdered,
      reasonCode: assigned.reasonCode,
      lineNumber: assigned.lineNumber,
      truckNo: truckNo !== undefined ? Number(truckNo) : assigned.truckNo,
      driverName: driverName || assigned.driverName,
      assignedAt: assigned.assignedAt,
      invoiceId: invoiceId || assigned.invoiceId,
      manifestNo: assigned.manifestNo,
      POD: null,
      PodImage: podUrls[0] || null,
      InvoiceImage: invoiceUrls[0] || null,
      completedAt: new Date(),
    };

    logger.info({ assignedTaskId: atId, podFound: podUrls.length, invoiceFound: invoiceUrls.length }, 'Creating completed task record');

    const [created] = await prisma.$transaction([
      prisma.completedTask_DB.create({ data: completedData }),
      prisma.assignedTask_DB.delete({ where: { assignedTaskId: atId } }),
    ]);

    // Background PDF
    (async () => {
      try {
        logger.info({ assignedTaskId: atId }, 'Starting background PDF job');
        async function collectBuffers(resolvedArr) {
          const bufs = [];
          for (const r of resolvedArr) {
            try {
              const b = await retryAsync(
                () => downloadContentByItemIdOrPath({ id: r.id, itemPath: r.itemPath }),
                3, 1500, 'download'
              );
              if (b) bufs.push(b);
            } catch (e) {
              logger.warn({ assignedTaskId: atId, item: r, err: e?.message || e }, 'skip one file (download)');
            }
          }
          return bufs;
        }
        const podBuffers = await collectBuffers(podResolved);
        const invBuffers = await collectBuffers(invResolved);
        const pdfBuf = await buildPdfBufferFromImages(podBuffers, invBuffers, checklist);

        const inv = safeInvoiceId(invoiceId || assigned.invoiceId);
        const ts = nowTimestampAU();
        const desc = safeDesc(assigned.description);
        const pdfLogical = `${datedFolderPrefix()}/pdf/POD_${inv}_${ts}_${desc}.pdf`;

        const uploaded = await retryAsync(() => uploadToOneDrive(pdfBuf, pdfLogical), 3, 1500, 'uploadPDF');
        if (uploaded?.webUrl) {
          await prisma.completedTask_DB.update({
            where: { completedTaskId: created.completedTaskId },
            data: { POD: uploaded.webUrl },
          });
          logger.info({ assignedTaskId: atId, pdfUrl: uploaded.webUrl }, 'PDF created and attached');
        } else {
          logger.warn({ assignedTaskId: atId }, 'PDF uploaded but no webUrl returned');
        }
      } catch (e) {
        logger.error({ assignedTaskId: atId, err: e?.message || e }, 'Background PDF job failed');
      }
    })();

    logger.info({ assignedTaskId: atId }, 'Finalize completed successfully');
    return res.status(200).json({
      message: 'Assignment completed. Images uploaded; PDF will be attached shortly.',
      podImageUrls: podUrls,
      invoiceImageUrls: invoiceUrls,
    });
  } catch (e) {
    logger.error({ err: e?.response?.data || e?.message || e }, 'finalizeAssignmentUploads error');
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

/* ---------------------- Driver auth (kept) ---------------------- */
async function driverSignup(req, res) {
  const { truckNo, cubic, driverName, truckType, status, username, password } = req.body;
  try {
    const driver = await prisma.Driver_Db.create({
      data: {
        truckNo, cubic, driverName, truckType,
        status: status || 'available', username, password
      },
    });
    logger.info({ username, truckNo }, 'Driver created');
    return res.status(201).json({ message: 'Driver created successfully', driver });
  } catch (error) {
    logger.error({ err: error?.message || error }, 'driverSignup error');
    if (error.code === 'P2002') return res.status(400).json({ message: 'Username already exists' });
    return res.status(500).json({ message: 'Internal server error' });
  }
}
async function driverLogin(req, res) {
  const { username, password } = req.body;
  try {
    const driver = await prisma.Driver_Db.findUnique({ where: { username } });
    if (!driver) {
      logger.warn({ username }, 'Driver not found');
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (password != driver.password) {
      logger.warn({ username }, 'Invalid password attempt');
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    logger.info({ username, truckNo: driver.truckNo }, 'Driver login successful');
    return res.status(200).json({ message: 'Login successful', truckNo: driver.truckNo, driverName: driver.driverName });
  } catch (error) {
    logger.error({ err: error?.message || error }, 'driverLogin error');
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/* ---------------------- (Optional) test & oauth helpers ---------------------- */
function getOnedriveAuthUrl(req, res) {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    logger.warn('getOnedriveAuthUrl missing clientId/redirectUri');
    return res.status(400).json({ error: 'ONEDRIVE_CLIENT_ID and ONEDRIVE_REDIRECT_URI must be set' });
  }

  const scopes = ['offline_access', 'files.readwrite', 'openid', 'profile'];
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: scopes.join(' ')
  });
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  return res.json({ url });
}
async function exchangeOnedriveCode(req, res) {
  try {
    const { code } = req.body;
    const clientId = process.env.ONEDRIVE_CLIENT_ID;
    const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
    const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
    if (!code || !clientId || !clientSecret || !redirectUri) {
      logger.warn('exchangeOnedriveCode missing params');
      return res.status(400).json({ error: 'code, ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET and ONEDRIVE_REDIRECT_URI required' });
    }

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('scope', 'offline_access files.readwrite openid profile');

    const tokenRes = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    logger.info('Exchanged auth code for tokens (one-time)');
    return res.json({ tokens: tokenRes.data });
  } catch (e) {
    logger.error({ err: e?.response?.data || e?.message || e }, 'exchangeOnedriveCode error');
    return res.status(500).json({ error: 'Failed to exchange code', details: e?.response?.data || e.message });
  }
}
async function testOneDriveUpload(req, res) {
  try {
    const pdf = new PDFDocument({ autoFirstPage: true });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const logical = `${datedFolderPrefix()}/pdf/POD_test_${nowTimestampAU()}.pdf`;
      const uploaded = await uploadToOneDrive(buf, logical);
      logger.info({ logical }, 'Test PDF uploaded');
      res.json({ uploaded });
    });
    pdf.fontSize(16).text('Test ' + new Date().toISOString());
    pdf.end();
  } catch (e) {
    logger.error({ err: e?.response?.data || e?.message || e }, 'testOneDriveUpload error');
    res.status(500).json({ error: 'Upload failed', details: e?.response?.data || e.message });
  }
}

/* ---------------------- Deprecated multipart (kept for compatibility) ---------------------- */
async function completeAssignment(req, res) {
  try {
    const files = req.files || {};
    const podFile = files.podImage?.[0];
    const invFile = files.invoiceImage?.[0];

    const { assignedTaskId, truckNo, driverName, invoiceId } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId is required' });

    let checklist = null;
    try {
      const raw = req.body.checklist || req.body.checklistJson || req.body.checklistString;
      if (raw) checklist = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) { /* ignore */ }

    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: 'Assigned task not found' });

    const inv = safeInvoiceId(invoiceId || assigned.invoiceId);
    const ts = nowTimestampAU();
    const folder = `${datedFolderPrefix()}/images`;

    const desc = safeDesc(assigned.description);
    const podName = `PodImage_${inv}_${ts}_${desc}.jpg`;
    const invoiceName = `InvoiceImage_${inv}_${ts}_${desc}.jpg`;

    const podUpload = podFile
      ? await retryAsync(() => uploadToOneDrive(podFile.buffer, `${folder}/${podName}`), 3, 1500, 'upload pod')
      : null;
    const invUpload = invFile
      ? await retryAsync(() => uploadToOneDrive(invFile.buffer, `${folder}/${invoiceName}`), 3, 1500, 'upload invoice')
      : null;

    const completedData = {
      taskId: assigned.taskId,
      orderCo: assigned.orderCo,
      orTy: assigned.orTy,
      orderNumber: assigned.orderNumber,
      branchPlant: assigned.branchPlant,
      customerPO: assigned.customerPO,
      suburbTown: assigned.suburbTown,
      name: assigned.name,
      description: assigned.description,
      quantityShipped: assigned.quantityShipped,
      itemNumber: assigned.itemNumber,
      postalCode: assigned.postalCode,
      revNbr: assigned.revNbr,
      revisionReason: assigned.revisionReason,
      routeCode: assigned.routeCode,
      schedPick: assigned.schedPick,
      truckId: assigned.truckId,
      location: assigned.location,
      scheduledPickTime: assigned.scheduledPickTime,
      requestDate: assigned.requestDate,
      soldTo: assigned.soldTo,
      shipTo: assigned.shipTo,
      deliverTo: assigned.deliverTo,
      stateCode: assigned.stateCode,
      lnTy: assigned.lnTy,
      descriptionLine2: assigned.descriptionLine2,
      zoneNo: assigned.zoneNo,
      stopCode: assigned.stopCode,
      nextStat: assigned.nextStat,
      lastStat: assigned.lastStat,
      priority: assigned.priority,
      futureQtyCommitted: assigned.futureQtyCommitted,
      quantityOrdered: assigned.quantityOrdered,
      reasonCode: assigned.reasonCode,
      lineNumber: assigned.lineNumber,
      truckNo: truckNo !== undefined ? Number(truckNo) : assigned.truckNo,
      driverName: driverName || assigned.driverName,
      assignedAt: assigned.assignedAt,
      invoiceId: invoiceId || assigned.invoiceId,
      manifestNo: assigned.manifestNo,
      POD: null,
      PodImage: podUpload?.webUrl || null,
      InvoiceImage: invUpload?.webUrl || null,
      completedAt: new Date(),
    };

    const [created] = await prisma.$transaction([
      prisma.completedTask_DB.create({ data: completedData }),
      prisma.assignedTask_DB.delete({ where: { assignedTaskId: atId } }),
    ]);

    logger.info({ assignedTaskId: atId, podUploaded: !!podUpload, invoiceUploaded: !!invUpload }, 'Multipart completeAssignment finished');

    (async () => {
      try {
        const podBufs = podFile ? [podFile.buffer] : [];
        const invBufs = invFile ? [invFile.buffer] : [];
        const pdfBuf = await buildPdfBufferFromImages(podBufs, invBufs, checklist);
        const pdfLogical = `${datedFolderPrefix()}/pdf/POD_${inv}_${nowTimestampAU()}_${desc}.pdf`;
        const uploaded = await retryAsync(() => uploadToOneDrive(pdfBuf, pdfLogical), 3, 1500, 'uploadPDF');
        if (uploaded?.webUrl) {
          await prisma.completedTask_DB.update({
            where: { completedTaskId: created.completedTaskId },
            data: { POD: uploaded.webUrl },
          });
          logger.info({ assignedTaskId: atId, pdfUrl: uploaded.webUrl }, 'Multipart PDF uploaded and attached');
        } else {
          logger.warn({ assignedTaskId: atId }, 'Multipart PDF uploaded but no webUrl returned');
        }
      } catch (e) {
        logger.error({ assignedTaskId: atId, err: e?.message || e }, 'Multipart PDF build/upload failed');
      }
    })();

    return res.status(200).json({
      message: 'Assignment completed (multipart). PDF will be attached shortly.',
      podImageUrl: podUpload?.webUrl || null,
      invoiceImageUrl: invUpload?.webUrl || null,
    });
  } catch (e) {
    logger.error({ err: e?.response?.data || e?.message || e }, 'completeAssignment error');
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

/* ---------------------- Exports ---------------------- */
module.exports = {
  // core
  startAssignment,
  createUploadSessions,
  finalizeAssignmentUploads,
  completeAssignment, // legacy multipart kept

  // driver auth + helpers
  driverSignup,
  driverLogin,
  getOnedriveAuthUrl,
  exchangeOnedriveCode,
  testOneDriveUpload,
};
