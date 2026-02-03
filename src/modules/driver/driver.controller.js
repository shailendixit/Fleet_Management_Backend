// controllers/driver.controller.js
const PDFDocument = require('pdfkit');
const axios = require('axios');
const { Readable } = require('stream');
const prisma = require('../../lib/prisma');
const path = require('path');

const fs = require('fs');
const os = require('os');
const stream = require('stream');
const { promisify } = require('util');
const finished = promisify(stream.finished);

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

  if (cachedToken && now < cachedExpiry) return cachedToken;

  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;

  if (refreshToken) {
    if (!clientId || !clientSecret) throw new Error('ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET required');
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
    return cachedToken;
  }

  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Missing OneDrive OAuth env for app-only flow');
  }
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
  return cachedToken;
}

function driveRootBase() {
  if (process.env.ONEDRIVE_REFRESH_TOKEN) return 'https://graph.microsoft.com/v1.0/me/drive';
  const userId = process.env.ONEDRIVE_USER_ID;
  if (!userId) throw new Error('ONEDRIVE_USER_ID is required for app-only flow');
  return `https://graph.microsoft.com/v1.0/users/${userId}/drive`;
}

/* ------------------ OneDrive helpers ------------------ */
async function createUploadSessionForLogicalPath(logicalPath) {
  const accessToken = await getGraphToken();
  const root = driveRootBase();
  const pathPart = encodeDrivePath(logicalPath);
  const url = `${root}/root:/${pathPart}:/createUploadSession`;
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
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const wait = baseDelay * Math.pow(2, i);
      console.warn(`[retry] ${label} attempt ${i + 1}/${attempts}:`, e?.response?.status || e?.code || e?.message);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/* -------------------- PDF helpers -------------------- */

// existing memory-buffer builder kept for fallback (not used by default)
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

// NEW: build PDF to a temp file (stream-to-disk) -- avoids collecting PDF bytes in-memory
async function buildPdfFileFromImages(podBuffers, invoiceBuffers, checklist, outPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false });
      const writeStream = fs.createWriteStream(outPath);
      doc.pipe(writeStream);

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

      finished(writeStream).then(() => resolve(outPath)).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/* ---------------------- concurrency limiter (semaphore) ---------------------- */
// Simple semaphore to limit concurrent PDF jobs
class Semaphore {
  constructor(max) { this.max = max; this.current = 0; this.queue = []; }
  acquire() {
    if (this.current < this.max) { this.current++; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}
const PDF_CONCURRENCY = Number(process.env.PDF_CONCURRENCY) || 1; // tune via env
const pdfSemaphore = new Semaphore(PDF_CONCURRENCY);

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
    return res.status(200).json({ message: 'Assignment started', updated });
  } catch (err) {
    console.error('startAssignment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Create OneDrive upload sessions for POD & Invoice.
 * Body: { assignedTaskId, invoiceId }
 * Returns: { pod: {uploadUrl,itemPath,fileName}, invoice:{...}, chunkHintBytes }
 * Filenames: PodImage_<INV>_<TS>_<Desc>.jpg, InvoiceImage_<INV>_<TS>_<Desc>.jpg
 * Stored under: <BASE>/<DD-MM-YYYY>/images/<fileName>
 */
async function createUploadSessions(req, res) {
  try {
    const { assignedTaskId, invoiceId } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId is required' });

    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: 'Assigned task not found' });

    const inv = safeInvoiceId(invoiceId || assigned.invoiceId);
    const ts = nowTimestampAU();
    const folderPrefix = `${datedFolderPrefix()}/images`;

    // NEW: include description in filenames
    const desc = safeDesc(assigned.description);

    const podFileName = `PodImage_${inv}_${ts}_${desc}.jpg`;
    const invoiceFileName = `InvoiceImage_${inv}_${ts}_${desc}.jpg`;

    const [pod, invoice] = await Promise.all([
      createUploadSessionForLogicalPath(`${folderPrefix}/${podFileName}`),
      createUploadSessionForLogicalPath(`${folderPrefix}/${invoiceFileName}`),
    ]);

    return res.status(200).json({
      assignedTaskId: atId,
      pod,
      invoice,
      chunkHintBytes: 5 * 1024 * 1024,
    });
  } catch (e) {
    console.error('createUploadSessions error', e?.response?.data || e.message || e);
    return res.status(500).json({ error: 'Failed to create upload sessions' });
  }
}

/**
 * Finalize after client uploads.
 * Body (arrays style):
 *   { assignedTaskId, truckNo?, driverName?, invoiceId?, checklist?, podItems:[{itemPath?,webUrl?,id?}], invoiceItems:[{...}] }
 * OR single-field style (back-compat/Postman):
 *   { assignedTaskId, truckNo?, driverName?, invoiceId?, checklist?, podItemPath, invoiceItemPath }
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
      podItemPath,        // <-- back-compat single item
      invoiceItemPath,    // <-- back-compat single item
      checklist,
    } = req.body || {};

    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId is required' });

    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: 'Assigned task not found' });

    // Support both payload shapes (arrays vs single path strings)
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
        if (it?.webUrl && it?.id) { out.push({ webUrl: it.webUrl, id: it.id, itemPath: it.itemPath || null }); continue; }
        if (it?.webUrl && !it?.id) { out.push({ webUrl: it.webUrl, id: null, itemPath: it.itemPath || null }); continue; }
        if (it?.itemPath) {
          const d = await retryAsync(() => getDriveItemByPath(it.itemPath), 3, 1500, 'getByPath');
          out.push({ webUrl: d?.webUrl || null, id: d?.id || null, itemPath: it.itemPath });
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
    const groupInvoiceId = invoiceId || assigned.manifestNo;

const [created] = await prisma.$transaction([
  prisma.completedTask_DB.create({ data: completedData }),
  prisma.assignedTask_DB.deleteMany({
    where: { invoiceId: groupInvoiceId }
  }),
]);


    // Background PDF (uses semaphore to limit concurrency and writes PDF to disk)
    (async () => {
      // Acquire slot — if all slots are busy, this promise waits until a slot frees up
      await pdfSemaphore.acquire();
      console.log(
  `[PDF] START job for assignment ${assignedTaskId} | active=${pdfSemaphore.current} | waiting=${pdfSemaphore.queue.length}`
);

      const tmpFile = `${os.tmpdir()}/pod_pdf_${Date.now()}_${Math.random().toString(36).slice(2,8)}.pdf`;
      try {
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
              console.warn('skip one file (download)', e?.message || e);
            }
          }
          return bufs;
        }

        const podBuffers = await collectBuffers(podResolved);
        const invBuffers = await collectBuffers(invResolved);

        // Build PDF to a temporary file (streaming to disk)
        await buildPdfFileFromImages(podBuffers, invBuffers, checklist, tmpFile);

        // Read temp file into buffer just for upload step (bounded by concurrency)
        const pdfBuf = await fs.promises.readFile(tmpFile);

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
        }

        // help GC: dereference large arrays/buffers
        // (local variables go out of scope after this try/finally; explicit nulls speed up GC)
        // eslint-disable-next-line no-unused-expressions
        null;
      } catch (e) {
        console.error(`[Task ${assignedTaskId}] PDF build/upload failed:`, e?.message || e);
      } finally {
        // cleanup temp file
        try {
          console.log(
  `[PDF] END job for assignment ${assignedTaskId} | active(before release)=${pdfSemaphore.current}`
);

          if (fs.existsSync(tmpFile)) await fs.promises.unlink(tmpFile);
        } catch (e) {
          console.warn('failed to remove temp pdf', e?.message || e);
        }
        // release semaphore slot
        pdfSemaphore.release();
      }
    })();

    return res.status(200).json({
      message: 'Assignment completed. Images uploaded; PDF will be attached shortly.',
      podImageUrls: podUrls,
      invoiceImageUrls: invoiceUrls,
    });
  } catch (e) {
    console.error('finalizeAssignmentUploads error', e?.response?.data || e.message || e);
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
    return res.status(201).json({ message: 'Driver created successfully', driver });
  } catch (error) {
    console.error(error);
    if (error.code === 'P2002') return res.status(400).json({ message: 'Username already exists' });
    return res.status(500).json({ message: 'Internal server error' });
  }
}
async function driverLogin(req, res) {
  const { username, password } = req.body;
  try {
    const driver = await prisma.Driver_Db.findUnique({ where: { username } });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    if (password != driver.password) return res.status(401).json({ message: 'Invalid credentials' });
    return res.status(200).json({ message: 'Login successful', truckNo: driver.truckNo, driverName: driver.driverName });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/* ---------------------- (Optional) test & oauth helpers ---------------------- */
function getOnedriveAuthUrl(req, res) {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(400).json({ error: 'ONEDRIVE_CLIENT_ID and ONEDRIVE_REDIRECT_URI must be set' });

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
    if (!code || !clientId || !clientSecret || !redirectUri)
      return res.status(400).json({ error: 'code, ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET and ONEDRIVE_REDIRECT_URI required' });

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
    return res.json({ tokens: tokenRes.data });
  } catch (e) {
    console.error('exchangeOnedriveCode error', e?.response?.data || e.message || e);
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
      res.json({ uploaded });
    });
    pdf.fontSize(16).text('Test ' + new Date().toISOString());
    pdf.end();
  } catch (e) {
    console.error('testOneDriveUpload error', e?.response?.data || e.message || e);
    res.status(500).json({ error: 'Upload failed', details: e?.response?.data || e.message });
  }
}

/* ---------------------- Deprecated multipart (kept for compatibility) ----------------------
   You can still POST multipart form-data like your screenshot:
   keys: checklist (text JSON), driverName, truckNo, assignedTaskId, invoiceId, invoiceImage (file), podImage (file)
   It will:
   - Name files as: PodImage_<INV>_<TS>_<Desc>.jpg and InvoiceImage_<INV>_<TS>_<Desc>.jpg
   - Upload to OneDrive
   - Create CompletedTask_DB, delete AssignedTask_DB
   - Build PDF in background
----------------------------------------------------------------------- */
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

    // Include description in legacy multipart filenames too
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

    // Background PDF (from in-memory buffers if present)
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
        }
      } catch (e) {
        console.error(`[Task ${assignedTaskId}] PDF build/upload failed:`, e?.message || e);
      }
    })();

    return res.status(200).json({
      message: 'Assignment completed (multipart). PDF will be attached shortly.',
      podImageUrl: podUpload?.webUrl || null,
      invoiceImageUrl: invUpload?.webUrl || null,
    });
  } catch (e) {
    console.error('completeAssignment error', e?.response?.data || e.message || e);
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
