const PDFDocument = require('pdfkit');
const axios = require('axios');
const { Readable } = require('stream');
const prisma = require('../../lib/prisma');
const path = require('path');

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
function encodeDrivePath(rawPath) {
  // Encode each segment but keep slashes
  return (rawPath || '')
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}
function extFromMimetype(mt) {
  if (!mt) return 'jpg';
  if (mt === 'image/jpeg') return 'jpg';
  if (mt === 'image/png') return 'png';
  if (mt === 'image/webp') return 'webp';
  return 'jpg';
}

function contentTypeFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

let cachedToken = null;
let cachedExpiry = 0;

async function getGraphToken() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const tenant = process.env.ONEDRIVE_TENANT_ID;
  const now = Date.now();

  if (cachedToken && now < cachedExpiry) return cachedToken;

  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  const redirectUri  = process.env.ONEDRIVE_REDIRECT_URI;

  if (refreshToken) {
    if (!clientId || !clientSecret) throw new Error('ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET are required for refresh token flow');
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    if (redirectUri) params.append('redirect_uri', redirectUri);
    params.append('scope', 'offline_access files.readwrite openid profile');

    const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
    const tokenRes = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000
    });
    cachedToken  = tokenRes.data.access_token;
    cachedExpiry = now + (tokenRes.data.expires_in - 180) * 1000;
    return cachedToken;
  }

  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Missing OneDrive OAuth environment variables for app-only flow');
  }

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('grant_type', 'client_credentials');

  const tokenRes = await axios.post(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });
  cachedToken  = tokenRes.data.access_token;
  cachedExpiry = now + (tokenRes.data.expires_in - 180) * 1000;
  return cachedToken;
}

// Simple upload (<= 4 MB). We’ll prefer session upload but keep this.
async function simpleUpload(buffer, driveRootUrl, name) {
  const accessToken = await getGraphToken();
  const ct = contentTypeFromName(name);
  const pathPart = encodeDrivePath(name);
  const url = `${driveRootUrl}/root:/${pathPart}:/content`;
  const res = await axios.put(url, buffer, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': ct },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000
  });
  return res.data;
}

// Upload session for large files
async function uploadViaSession(buffer, driveRootUrl, name, chunkSize = 5 * 1024 * 1024) {
  const accessToken = await getGraphToken();
  const pathPart = encodeDrivePath(name);

  // 1) Create session
  const createUrl = `${driveRootUrl}/root:/${pathPart}:/createUploadSession`;
  const session = await axios.post(createUrl, {
    item: {
      '@microsoft.graph.conflictBehavior': 'replace',
      name: path.basename(name),
    }
  }, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000
  });

  const uploadUrl = session.data.uploadUrl;
  const total = buffer.length;
  let start = 0;

  // 2) Upload chunks
  while (start < total) {
    const end = Math.min(start + chunkSize, total);
    const chunk = buffer.slice(start, end);
    const contentRange = `bytes ${start}-${end - 1}/${total}`;

    await axios.put(uploadUrl, chunk, {
      headers: {
        'Content-Length': chunk.length,
        'Content-Range': contentRange,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300000
    });

    start = end;
  }

  // 3) Get item (last response can include it; if not, fetch)
  // We’ll just return the parent folder + file path URL we already know:
  // Best is to GET /root:/path after upload; but upload session final response normally returns driveItem.
  // To be safe, do a lightweight GET:
  const finalGet = await axios.get(`${driveRootUrl}/root:/${pathPart}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000
  });
  return finalGet.data;
}

async function uploadPdfToOneDrive(pdfBuffer, filename) {
  // If caller passes a path (e.g., "pdf/XYZ.pdf"), keep it; else prefix into pdf/
  const logical = filename.includes('/') ? filename : `pdf/${filename}`;
  return await uploadToOneDrive(pdfBuffer, logical);
}
async function uploadToOneDrive(buffer, logicalPath) {
  const usingRefresh = !!process.env.ONEDRIVE_REFRESH_TOKEN;
  const baseFolder = process.env.ONEDRIVE_FOLDER || 'FleetPODs';

  const day = new Date();
  const dd = String(day.getDate()).padStart(2, '0');
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const yyyy = day.getFullYear();
  const dateFolder = `${dd}-${mm}-${yyyy}`;

  // prepend base and date folder
  const nameInDrive = `${baseFolder}/${dateFolder}/${logicalPath}`.replace(/\/\/+/g, '/');

  const root = usingRefresh
    ? 'https://graph.microsoft.com/v1.0/me/drive'
    : (() => {
        const userId = process.env.ONEDRIVE_USER_ID;
        if (!userId) throw new Error('ONEDRIVE_USER_ID env var is required for app-only flow');
        return `https://graph.microsoft.com/v1.0/users/${userId}/drive`;
      })();

  const FOUR_MB = 4 * 1024 * 1024;
  const pathPart = encodeDrivePath(nameInDrive);

  if (buffer.length <= FOUR_MB) {
    const accessToken = await getGraphToken();
    const url = `${root}/root:/${pathPart}:/content`;
    const res = await axios.put(url, buffer, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentTypeFromName(nameInDrive) },
      maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 300000
    });
    return res.data;
  }

  // session upload for large files
  const accessToken = await getGraphToken();
  const createUrl = `${root}/root:/${pathPart}:/createUploadSession`;
  const session = await axios.post(createUrl, {
    item: { '@microsoft.graph.conflictBehavior': 'replace', name: path.basename(nameInDrive) }
  }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 });

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
  const finalGet = await axios.get(`${root}/root:/${pathPart}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000
  });
  return finalGet.data;
}

// Simple retry helper
async function retry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}


function buildPdfBuffer({ podImageBuffer, invoiceImageBuffer, checklist }) {
  // Return a Promise that resolves when doc stream ends
  return new Promise((resolve, reject) => {
    // checklist expected as object or array
    const doc = new PDFDocument({ autoFirstPage: false });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));
  // Page 1 - POD image
  doc.addPage({ size: 'A4', margin: 40 });
  if (podImageBuffer) {
    try {
      doc.image(podImageBuffer, { fit: [500, 700], align: 'center' });
    } catch (e) {
      // ignore image errors
      doc.fontSize(10).text('POD image could not be embedded', { align: 'left' });
    }
  } else {
    doc.fontSize(12).text('No POD image provided', { align: 'left' });
  }

  // Page 2 - Invoice image
  doc.addPage({ size: 'A4', margin: 40 });
  if (invoiceImageBuffer) {
    try {
      doc.image(invoiceImageBuffer, { fit: [500, 700], align: 'center' });
    } catch (e) {
      doc.fontSize(10).text('Invoice image could not be embedded', { align: 'left' });
    }
  } else {
    doc.fontSize(12).text('No Invoice image provided', { align: 'left' });
  }

  // Page 3 - checklist text
  doc.addPage({ size: 'A4', margin: 40 });
  doc.fontSize(12).text('Checklist / Comments:', { underline: true });
  doc.moveDown();

  try {
    if (Array.isArray(checklist)) {
      checklist.forEach((item, idx) => {
        if (typeof item === 'string') {
          doc.fontSize(11).text(`${idx + 1}. ${item}`);
        } else if (item && typeof item === 'object') {
          // object with maybe { point: '...', comment: '...' }
          const line = `${idx + 1}. ${item.point || item.title || ''}`.trim();
          doc.fontSize(11).text(line);
          if (item.comment) {
            doc.fontSize(10).fillColor('gray').text(`   comment: ${item.comment}`);
            doc.fillColor('black');
          }
          doc.moveDown(0.5);
        } else {
          doc.fontSize(11).text(`${idx + 1}. ${String(item)}`);
        }
      });
    } else if (typeof checklist === 'object') {
      // print object keys
      Object.entries(checklist).forEach(([k, v]) => {
        doc.fontSize(11).text(`${k}: ${v}`);
      });
    } else if (typeof checklist === 'string' && checklist.trim().length > 0) {
      doc.fontSize(11).text(checklist);
    } else {
      doc.fontSize(11).text('No checklist provided');
    }
  } catch (e) {
    doc.fontSize(11).text('Checklist parsing error');
  }

    doc.end();
  });
}

async function startAssignment(req, res) {
  try {
    const { assignedTaskId, truckNo } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId required' });

    const data = {};
    if (truckNo !== undefined) data.truckNo = Number(truckNo);
    data.status = 'Started';

    const updated = await prisma.assignedTask_DB.update({
      where: { assignedTaskId: Number(assignedTaskId) },
      data
    });
    return res.status(200).json({ message: 'Assignment started', updated });
  } catch (err) {
    console.error('startAssignment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Returns the authorization URL to obtain consent & code for delegated OneDrive access
function getOnedriveAuthUrl(req, res) {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(400).json({ error: 'ONEDRIVE_CLIENT_ID and ONEDRIVE_REDIRECT_URI must be set' });

  const scopes = ['offline_access', 'files.readwrite', 'openid', 'profile'];
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' ')
  });
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  return res.json({ url });
}

// Exchange authorization code (received at redirect URI) for tokens and return them (save refresh token in your env)
async function exchangeOnedriveCode(req, res) {
  try {
    const { code } = req.body;
    const clientId = process.env.ONEDRIVE_CLIENT_ID;
    const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
    const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
    if (!code || !clientId || !clientSecret || !redirectUri) return res.status(400).json({ error: 'code, ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET and ONEDRIVE_REDIRECT_URI required' });

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('scope', 'offline_access files.readwrite openid profile');

    const tokenRes = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // tokenRes.data contains access_token, refresh_token, expires_in, etc.
    return res.json({ tokens: tokenRes.data });
  } catch (e) {
    console.error('exchangeOnedriveCode error', e?.response?.data || e.message || e);
    return res.status(500).json({ error: 'Failed to exchange code', details: e?.response?.data || e.message });
  }
}

// Test upload endpoint - creates a small sample PDF and attempts to upload using current env config
async function testOneDriveUpload(req, res) {
  try {
    const samplePdf = await buildPdfBuffer({ podImageBuffer: null, invoiceImageBuffer: null, checklist: ['test upload', 'timestamp: ' + new Date().toISOString()] });
    const filename = `POD_test_${Date.now()}.pdf`;
    const uploadResult = await uploadPdfToOneDrive(samplePdf, filename);
    return res.json({ uploadResult });
  } catch (e) {
    console.error('testOneDriveUpload error', e?.response?.data || e.message || e);
    return res.status(500).json({ error: 'Upload failed', details: e?.response?.data || e.message });
  }
}

async function retryUpload(fn, filename, maxRetries = 3, delayMs = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await fn();
      if (res) return res;
      throw new Error("Empty upload response");
    } catch (err) {
      attempt++;
      const wait = delayMs * Math.pow(2, attempt - 1); // exponential backoff
      console.error(
        `[Upload Retry] ${filename} attempt ${attempt}/${maxRetries} failed: ${err.message}`
      );
      if (attempt >= maxRetries) {
        console.error(`[Upload Retry] ${filename} permanently failed after ${attempt} attempts`);
        return null;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return null;
}

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
      try {
        doc.image(buf, { fit: [520, 700], align: 'center', valign: 'center' });
      } catch {
        doc.fontSize(10).fillColor('red').text('Image could not be embedded');
        doc.fillColor('black');
      }
    };

    // POD pages
    if (podBuffers && podBuffers.length) {
      podBuffers.forEach((b, i) => addImagePage(b, `POD ${i + 1}`));
    } else {
      doc.addPage({ size: 'A4', margin: 40 }).fontSize(12).text('No POD images provided');
    }

    // Invoice pages
    if (invoiceBuffers && invoiceBuffers.length) {
      invoiceBuffers.forEach((b, i) => addImagePage(b, `Invoice ${i + 1}`));
    } else {
      doc.addPage({ size: 'A4', margin: 40 }).fontSize(12).text('No Invoice images provided');
    }

    // Checklist
    doc.addPage({ size: 'A4', margin: 40 });
    doc.fontSize(12).text('Checklist / Comments:', { underline: true });
    doc.moveDown();

    try {
      if (Array.isArray(checklist)) {
        checklist.forEach((item, idx) => {
          if (typeof item === 'string') doc.fontSize(11).text(`${idx + 1}. ${item}`);
          else if (item && typeof item === 'object') {
            const line = `${idx + 1}. ${item.point || item.title || ''}`.trim();
            doc.fontSize(11).text(line);
            if (item.comment) doc.fontSize(10).fillColor('gray').text(`   comment: ${item.comment}`).fillColor('black');
            doc.moveDown(0.5);
          } else {
            doc.fontSize(11).text(`${idx + 1}. ${String(item)}`);
          }
        });
      } else if (typeof checklist === 'object' && checklist) {
        Object.entries(checklist).forEach(([k, v]) => doc.fontSize(11).text(`${k}: ${v}`));
      } else if (typeof checklist === 'string' && checklist.trim()) {
        doc.fontSize(11).text(checklist);
      } else {
        doc.fontSize(11).text('No checklist provided');
      }
    } catch {
      doc.fontSize(11).text('Checklist parsing error');
    }

    doc.end();
  });
}


async function completeAssignment(req, res) {
  try {
    const files = req.files || {};
    // Multer config should use .array() for these fields
    // e.g., upload.fields([{ name: 'podImages', maxCount: 10 }, { name: 'invoiceImages', maxCount: 10 }])
    const podFiles = files.podImages || (files.podImage ? [files.podImage[0]] : []);
    const invFiles = files.invoiceImages || (files.invoiceImage ? [files.invoiceImage[0]] : []);

    const { assignedTaskId, truckNo, driverName, invoiceId } = req.body;
    if (!assignedTaskId) return res.status(400).json({ error: "assignedTaskId is required" });

    // Parse checklist
    let checklist = null;
    try {
      const raw = req.body.checklist || req.body.checklistJson || req.body.checklistString;
      if (raw) checklist = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      console.warn(`[Checklist Parse] Failed: ${err.message}`);
    }

    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: "Assigned task not found" });

    const safeDesc = (assigned.description || "NoDescription").replace(/[^\w\s-]/g, "_");
    const baseFolder = process.env.ONEDRIVE_FOLDER || "FleetPODs";

    // Timestamp in Australia/Sydney for filenames
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const timeStr = `${parts.find(p => p.type === "hour").value}-${parts.find(p => p.type === "minute").value}-${parts.find(p => p.type === "second").value}`;

    const baseName = `POD_${invoiceId || "NA"}_${safeDesc}_${timeStr}`;

    // Upload images (multiple) with clean names using chunked upload
    const podUploads = [];
    for (let i = 0; i < podFiles.length; i++) {
      const f = podFiles[i];
      const ext = extFromMimetype(f.mimetype);
      const fname = `${baseName}_POD_${String(i + 1).padStart(2, '0')}.${ext}`;
      const logicalPath = `images/${fname}`; // will be prefixed by date folder inside upload helper
      const up = await retryUpload(() => uploadToOneDrive(f.buffer, logicalPath), fname);
      podUploads.push(up);
    }

    const invUploads = [];
    for (let i = 0; i < invFiles.length; i++) {
      const f = invFiles[i];
      const fname = `${baseName}_INVOICE_${String(i + 1).padStart(2, '0')}.jpg`;
      const logicalPath = `images/${fname}`;
      const up = await retryUpload(() => uploadToOneDrive(f.buffer, logicalPath), fname);
      invUploads.push(up);
    }

    const podUrls = podUploads.map(u => u?.webUrl).filter(Boolean);
    const invoiceUrls = invUploads.map(u => u?.webUrl).filter(Boolean);

    // Prepare CompletedTask_DB object (same as yours, with arrays if you add columns later)
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
      invoiceId: assigned.invoiceId,
      manifestNo: assigned.manifestNo,
      POD: null, // PDF URL to be filled after upload
      PodImage: podUrls[0] || null,       // keep your fields; optionally add PodImagesJson column later
      InvoiceImage: invoiceUrls[0] || null,
      completedAt: new Date(),
    };

    let completedRecord;
    try {
      const [created] = await prisma.$transaction([
        prisma.completedTask_DB.create({ data: completedData }),
        prisma.assignedTask_DB.delete({ where: { assignedTaskId: atId } }),
      ]);
      completedRecord = created;
    } catch (err) {
      console.error(`[Task ${assignedTaskId}] DB transaction failed: ${err.message}`);
      return res.status(500).json({ error: "Database transaction failed." });
    }

    // Background PDF creation from all images
    (async () => {
      try {
        const podBuffers = podFiles.map(f => f.buffer);
        const invBuffers = invFiles.map(f => f.buffer);
        const pdfBuffer = await buildPdfBufferFromImages(podBuffers, invBuffers, checklist);
        const pdfName = `pdf/${baseName}.pdf`;
        const pdfUpload = await retryUpload(() => uploadToOneDrive(pdfBuffer, pdfName), pdfName);
        const pdfUrl = pdfUpload?.webUrl || null;

        if (pdfUrl) {
          await prisma.completedTask_DB.update({
            where: { completedTaskId: completedRecord.completedTaskId },
            data: { POD: pdfUrl },
          });
        }
      } catch (err) {
        console.error(`[Task ${assignedTaskId}] PDF generation/upload failed: ${err.message}`);
      }
    })();

    return res.status(200).json({
      message: "Assignment completed. Files uploaded; PDF will be attached shortly.",
      podImageUrls: podUrls,
      invoiceImageUrls: invoiceUrls,
    });

  } catch (err) {
    console.error(`[Task ${req.body.assignedTaskId || "unknown"}] Fatal error: ${err.message}`);
    return res.status(500).json({ error: "Unexpected server error." });
  }
}




async function driverSignup (req, res){
    const { truckNo, cubic, driverName, truckType, status, username, password } = req.body;

    try {

        const driver = await prisma.Driver_Db.create({
            data: {
                truckNo,
                cubic,
                driverName,
                truckType,
                status: status || 'available',
                username,
                password: password,
            },
        });

        return res.status(201).json({
            message: "Driver created successfully",
            driver
        });

    } catch (error) {
        console.error(error);

        if (error.code === "P2002") { // Prisma unique constraint error
            return res.status(400).json({ message: "Username already exists" });
        }

        return res.status(500).json({ message: "Internal server error" });
    }
};

async function driverLogin(req, res) {
    const { username, password } = req.body;

    try {
        const driver = await prisma.Driver_Db.findUnique({
            where: { username }
        });

        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }
        if (password != driver.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // Just return truckNo instead of token
        return res.status(200).json({
            message: "Login successful",
            truckNo: driver.truckNo
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

module.exports = {
  startAssignment,
  completeAssignment,
  getOnedriveAuthUrl,
  exchangeOnedriveCode,
  testOneDriveUpload,
  driverSignup,
  driverLogin
};