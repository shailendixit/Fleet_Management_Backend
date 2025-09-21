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

async function getGraphToken() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const tenant = process.env.ONEDRIVE_TENANT_ID;

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
    timeout: 10000
  });
  return tokenRes.data.access_token;
}

async function uploadPdfToOneDrive(pdfBuffer, filename) {
  const accessToken = await getGraphToken();
  const folder = process.env.ONEDRIVE_FOLDER || 'FleetPODs';

  // If using delegated refresh token, upload to the current user's drive (/me/drive)
  if (process.env.ONEDRIVE_REFRESH_TOKEN) {
// get today's date in dd-mm-yyyy
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  const dateFolder = `${dd}-${mm}-${yyyy}`;

  // final path → FleetPODs/dateFolder/filename.pdf
  const encodedPath = encodeURIComponent(`${folder}/${dateFolder}/${filename}`);
    const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;
    const res = await axios.put(uploadUrl, pdfBuffer, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/pdf'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000
    });

 const fileId = res.data.id;

    // Step 2: Create sharing link (public)
    const linkRes = await axios.post(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/createLink`,
      {
        type: "view",       // "view" makes it read-only
        scope: "anonymous", // anonymous = public link
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // Return both file metadata and permanent public URL
    return {
      ...res.data,
      publicUrl: linkRes.data.link.webUrl, // <— Use this instead of downloadUrl
    };


    return res.data;
  }

  // App-only fallback requires ONEDRIVE_USER_ID
  const userId = process.env.ONEDRIVE_USER_ID;
  if (!userId) throw new Error('ONEDRIVE_USER_ID env var is required for app-only flow');

  const encodedPath = encodeURIComponent(`${folder}/${filename}`);
  const uploadUrl = `https://graph.microsoft.com/v1.0/users/${userId}/drive/root:/${encodedPath}:/content`;

  const res = await axios.put(uploadUrl, pdfBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/pdf'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000
  });
  return res.data;
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

async function completeAssignment(req, res) {
  try {
    const files = req.files || {};
    const podFile = files.podImage && files.podImage[0];
    const invoiceFile = files.invoiceImage && files.invoiceImage[0];

    const { assignedTaskId, truckNo, driverName ,invoiceId} = req.body;
    let checklistRaw = req.body.checklist || req.body.checklistJson || req.body.checklistString || null;
    if (!assignedTaskId) return res.status(400).json({ error: 'assignedTaskId required' });

    let checklist = null;
    if (checklistRaw) {
      try {
        checklist = typeof checklistRaw === 'string' ? JSON.parse(checklistRaw) : checklistRaw;
      } catch (e) {
        // if not JSON, treat as plain text
        checklist = checklistRaw;
      }
    }

    const podImageBuffer = podFile ? podFile.buffer : null;
    const invoiceImageBuffer = invoiceFile ? invoiceFile.buffer : null;

  // build PDF buffer (await PDF generation)
  const pdfBuffer = await buildPdfBuffer({ podImageBuffer, invoiceImageBuffer, checklist });

    // prepare filename
const now = new Date();
const hours = String(now.getHours()).padStart(2, '0');
const minutes = String(now.getMinutes()).padStart(2, '0');
const seconds = String(now.getSeconds()).padStart(2, '0');

const timeStr = `${hours}-${minutes}-${seconds}`;
const filename = `POD_${invoiceId}_${timeStr}.pdf`;

    // upload to OneDrive
    let uploadResult;
    try {
      uploadResult = await uploadPdfToOneDrive(pdfBuffer, filename);
    } catch (e) {
      console.error('OneDrive upload error', e?.response?.data || e.message || e);
      return res.status(500).json({ error: 'Failed to upload PDF to OneDrive', details: e.message || e });
    }

    const podUrl = uploadResult.publicUrl || uploadResult.webUrl || uploadResult.id || null;

    // move the assigned task to completed task in DB (transaction)
    const atId = Number(assignedTaskId);
    const assigned = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId: atId } });
    if (!assigned) return res.status(404).json({ error: 'Assigned task not found' });

    // Build object for CompletedTask_DB - copy relevant fields
    const completedData = {
      taskId: assigned.taskId,
      orderCo: assigned.orderCo,
      // copy fields you want; example:
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
      POD: podUrl,
      completedAt: new Date()
    };

    // transaction: create completed and delete assigned
    await prisma.$transaction([
      prisma.completedTask_DB.create({ data: completedData }),
      prisma.assignedTask_DB.delete({ where: { assignedTaskId: atId } })
    ]);

    return res.status(200).json({ message: 'Assignment completed', podUrl, uploadResult });
  } catch (err) {
    console.error('completeAssignment error', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message || err });
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