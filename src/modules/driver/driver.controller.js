const PDFDocument = require('pdfkit');
const axios = require('axios');
const { Readable } = require('stream');
const prisma = require('../../lib/prisma');

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
let cachedToken = null;
let cachedExpiry = 0;

async function getGraphToken() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const tenant = process.env.ONEDRIVE_TENANT_ID;
  const now = Date.now();

  // 1️⃣ Return cached token if still valid
  if (cachedToken && now < cachedExpiry) {
    return cachedToken;
  }

  // If we have a refresh token configured, use delegated flow (suitable for personal accounts)
  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI; // optional for refresh grant

  if (refreshToken) {
    if (!clientId || !clientSecret) throw new Error('ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET are required for refresh token flow');
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    if (redirectUri) params.append('redirect_uri', redirectUri);
    // request scopes that include file access
    params.append('scope', 'offline_access files.readwrite openid profile');

    const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
    const tokenRes = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });
    return tokenRes.data.access_token;
  }

  // Fallback to app-only client credentials flow (requires tenant and app permissions)
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
    cachedToken = tokenRes.data.access_token;
  cachedExpiry = now + (tokenRes.data.expires_in - 180) * 1000; 
  return tokenRes.data.access_token;
}

async function uploadPdfToOneDrive(pdfBuffer, filename) {
  const accessToken = await getGraphToken();
  const folder = process.env.ONEDRIVE_FOLDER || 'FleetPODs';

  // Delegated token flow (/me/drive)
  if (process.env.ONEDRIVE_REFRESH_TOKEN) {
 
    const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;

    // Step 1: Upload the PDF
    const res = await axios.put(uploadUrl, pdfBuffer, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/pdf"
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300000 // allow large/slow uploads (5 min)
    });

    // const fileId = res.data.id;
    // console.log(res);
    // // Step 2: Try to create public link
    // let publicUrl = res.data.webUrl; // fallback to normal URL
    // try {
    //   const linkRes = await retry(
    //     () =>
    //       axios.post(
    //         `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/createLink`,
    //         { type: "view", scope: "anonymous" },
    //         {
    //           headers: { Authorization: `Bearer ${accessToken}` },
    //           timeout: 15000 // short timeout (link creation is fast)
    //         }
    //       ),
    //     3, // retries
    //     2000 // delay between retries
    //   );
    //   publicUrl = linkRes.data.link.webUrl;
    // } catch (err) {
    //   console.warn("createLink failed after retries:", err.message);
    // }

    // Always return file metadata + a usable URL
    return {
      ...res.data,
      publicUrl
    };
  }

  // App-only flow requires ONEDRIVE_USER_ID
  const userId = process.env.ONEDRIVE_USER_ID;
  if (!userId) throw new Error("ONEDRIVE_USER_ID env var is required for app-only flow");
const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const dateFolder = `${dd}-${mm}-${yyyy}`;

 
  const encodedPath = encodeURIComponent(`${filename}`);
  const uploadUrl = `https://graph.microsoft.com/v1.0/users/${userId}/drive/root:/${encodedPath}:/content`;

  const res = await axios.put(uploadUrl, pdfBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/pdf"
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 300000
  });

  const fileId = res.data.id;
let publicUrl = res.data.webUrl;

// try {
//   const linkRes = await retry(
//     () =>
//       axios.post(
//         `https://graph.microsoft.com/v1.0/users/${userId}/drive/items/${fileId}/createLink`,
//         { type: "view", scope: "anonymous" },
//         {
//           headers: { Authorization: `Bearer ${accessToken}` },
//           timeout: 15000
//         }
//       ),
//     3,
//     2000
//   );
//   publicUrl = linkRes.data.link.webUrl;
//   console.log("Public link created:", publicUrl);
// } catch (err) {
//   console.warn("createLink failed after retries:", err.response?.data || err.message);
// }


  
  return {
      ...res.data,
      publicUrl
    };
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



async function completeAssignment(req, res) {
  try {
    const files = req.files || {};
    const podFile = files.podImage?.[0];
    const invoiceFile = files.invoiceImage?.[0];
    const { assignedTaskId, truckNo, driverName, invoiceId } = req.body;

    if (!assignedTaskId) {
      return res.status(400).json({ error: "assignedTaskId is required" });
    }

    // 🧩 Parse checklist safely
    let checklist = null;
    try {
      const raw = req.body.checklist || req.body.checklistJson || req.body.checklistString;
      if (raw) checklist = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      console.warn(`[Checklist Parse] Failed to parse checklist JSON: ${err.message}`);
    }

    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: "Assigned task not found" });

    const description = (assigned.description || "NoDescription").replace(/[^\w\s-]/g, "_");

    // ---------- 🗓️ Prepare date-based folder ----------
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const dateFolder = `${dd}-${mm}-${yyyy}`;
    const baseFolder = process.env.ONEDRIVE_FOLDER || "FleetPODs";
    const uploadFolder = `${baseFolder}/${dateFolder}`;

    // ---------- 🕒 Prepare timestamps ----------
    const options = { timeZone: "Australia/Sydney", hour12: false };
    const formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(today);
    const timeStr = `${parts.find(p => p.type === "hour").value}-${parts.find(p => p.type === "minute").value}-${parts.find(p => p.type === "second").value}`;

    const baseFilename = `POD_${invoiceId || "NA"}_${description}_${timeStr}`;
    const podFilename = `${uploadFolder}/${baseFilename}_POD.jpg`;
    const invoiceFilename = `${uploadFolder}/${baseFilename}_INVOICE.jpg`;
    const pdfFilename = `${uploadFolder}/${baseFilename}.pdf`;

    const podImageBuffer = podFile?.buffer;
    const invoiceImageBuffer = invoiceFile?.buffer;

    // ---------- 📤 Upload images with retry ----------
    console.log(`[Task ${assignedTaskId}] Starting image uploads...`);
    const [podUpload, invoiceUpload] = await Promise.all([
      podImageBuffer
        ? retryUpload(() => uploadPdfToOneDrive(podImageBuffer, podFilename), podFilename)
        : Promise.resolve(null),
      invoiceImageBuffer
        ? retryUpload(() => uploadPdfToOneDrive(invoiceImageBuffer, invoiceFilename), invoiceFilename)
        : Promise.resolve(null),
    ]);

    const podUrl = podUpload?.webUrl || null;
    const invoiceUrl = invoiceUpload?.webUrl || null;
    console.log(`[Task ${assignedTaskId}] Image uploads complete.`);

    // ---------- 💾 Build object for CompletedTask_DB ----------
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
      POD: null, // will be filled after PDF upload
      PodImage: podUrl,
      InvoiceImage: invoiceUrl,
      completedAt: new Date(),
    };

    // ---------- 💾 Transaction: Move to completed ----------
    let completedRecord;
    try {
      const [created] = await prisma.$transaction([
        prisma.completedTask_DB.create({ data: completedData }),
        prisma.assignedTask_DB.delete({ where: { assignedTaskId: atId } }),
      ]);
      completedRecord = created;
      console.log(`[Task ${assignedTaskId}] Moved to CompletedTask_DB.`);
    } catch (err) {
      console.error(`[Task ${assignedTaskId}] DB transaction failed: ${err.message}`);
      return res.status(500).json({ error: "Database transaction failed." });
    }

    // ---------- ⚙️ Background PDF creation ----------
    (async () => {
      try {
        const pdfBuffer = await buildPdfBuffer({ podImageBuffer, invoiceImageBuffer, checklist });
        const pdfUpload = await retryUpload(() => uploadPdfToOneDrive(pdfBuffer, pdfFilename), pdfFilename);
        const pdfUrl = pdfUpload?.webUrl || null;

        if (pdfUrl) {
          await prisma.completedTask_DB.update({
            where: { completedTaskId: completedRecord.completedTaskId },
            data: { POD: pdfUrl },
          });
          console.log(`[Task ${assignedTaskId}] PDF uploaded successfully.`);
        } else {
          console.warn(`[Task ${assignedTaskId}] PDF upload skipped (no URL).`);
        }
      } catch (err) {
        console.error(`[Task ${assignedTaskId}] PDF generation/upload failed: ${err.message}`);
      }
    })();

    // ---------- 🚀 Respond immediately ----------
    return res.status(200).json({
      message: "Assignment completed successfully. PDF generation running in background.",
      podImageUrl: podUrl,
      invoiceImageUrl: invoiceUrl,
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