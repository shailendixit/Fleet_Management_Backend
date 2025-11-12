// controllers/tasks.controller.js
// NOTE: Saved as tasks/controller file (replace your current file content with this).
const xlsx = require('xlsx');
const fs = require('fs');
const prisma = require('../../lib/prisma');
const ExcelJS = require('exceljs');
const axios = require('axios');

// --- pino logger (you installed pino) ---
const pino = require('pino');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In non-production, pretty print for easier local debugging (uses pino-pretty if installed)
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss' },
        },
});

// Helpers
function safeNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function safeDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// Helper to extract caller info for logs
function callerInfo(req) {
  return {
    ip: (req && (req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress)) || 'unknown',
    user: (req && req.user && req.user.username) || null,
    path: (req && req.path) || null,
  };
}

// ----------------- POPULATE TASK DB -----------------
exports.uploadExcel = async (req, res) => {
  const ctx = callerInfo(req);
  logger.info({ action: 'uploadExcel', ...ctx }, 'uploadExcel called');

  try {
    const filePath = req.file && req.file.path;

    // Read Excel
    let workbook;
    if (req.file && req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      logger.debug({ action: 'uploadExcel', source: 'buffer', ...ctx }, 'reading excel from buffer');
    } else if (filePath) {
      workbook = xlsx.readFile(filePath);
      logger.debug({ action: 'uploadExcel', source: 'file', filePath, ...ctx }, 'reading excel from path');
    } else {
      logger.warn({ action: 'uploadExcel', ...ctx }, 'no file supplied');
      return res.status(400).json({ message: 'file required' });
    }

    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName] || {});
    logger.info({ action: 'uploadExcel', rows: Array.isArray(data) ? data.length : 0, ...ctx }, 'parsed excel rows');

    // Format rows according to Prisma Task schema
    const formatted = data.map((row) => ({
      orderCo: safeNumber(row['Order Co']),
      orTy: row['Or Ty'] || null,
      orderNumber: safeNumber(row['Order Number']),
      branchPlant: row['Branch Plant'] || null,
      customerPO: row['Customer PO'] ? String(row['Customer PO']) : null,
      suburbTown: row['Suburb/Town'] || null,
      name: row['Name'] || null,
      description: row['Description'] || null,
      quantityShipped: safeNumber(row['Quantity Shipped']),
      itemNumber: safeNumber(row['Item Number']),
      postalCode: safeNumber(row['Postal Code']),
      revNbr: safeNumber(row['Rev Nbr']),
      revisionReason: row['Revision Reason'] || null,
      routeCode: row['Route Code'] || null,
      schedPick: safeDate(row['Sched Pick']),
      truckId: row['Truck I.D.'] || null,
      location: row['Location'] || null,
      scheduledPickTime: safeNumber(row['Scheduled Pick Time']),
      requestDate: safeDate(row['Request Date']),
      soldTo: safeNumber(row['Sold To']),
      shipTo: safeNumber(row['Ship To']),
      deliverTo: safeNumber(row['Deliver To']),
      stateCode: row['State Code'] || null,
      lnTy: row['Ln Ty'] || null,
      descriptionLine2: row['Description Line 2'] || null,
      zoneNo: row['Zone No.'] || null,
      stopCode: row['Stop Code'] || null,
      nextStat: safeNumber(row['Next Stat']),
      lastStat: safeNumber(row['Last Stat']),
      priority: safeNumber(row['Priority (1/0)']),
      futureQtyCommitted: safeNumber(row['Future Qty Committed']),
      quantityOrdered: safeNumber(row['Quantity Ordered']),
      reasonCode: row['Reason Code'] || null,
      lineNumber: safeNumber(row['Line Number']),
    }));

    // Filter out rows that do not have an Order Number (required)
    const withOrderNumber = formatted.filter(
      (r) => r.orderNumber !== null && typeof r.orderNumber !== 'undefined'
    );
    logger.info({ action: 'uploadExcel', validRows: withOrderNumber.length, ...ctx }, 'rows with orderNumber will be inserted');

    // Bulk insert
    const result = await prisma.task_DB.createMany({
      data: withOrderNumber,
      skipDuplicates: true,
    });
    logger.info({ action: 'uploadExcel', inserted: result.count || 0, ...ctx }, 'createMany completed');

    // cleanup file path if present
    try {
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) logger.warn({ err: err.message, filePath: req.file.path, ...ctx }, 'cleanup failed');
          else logger.debug({ filePath: req.file.path, ...ctx }, 'temp file removed');
        });
      }
    } catch (e) {
      logger.warn({ err: e?.message || e, ...ctx }, 'cleanup exception (ignored)');
    }

    return res.status(200).json({ message: 'Tasks inserted into DB.', inserted: result.count || 0 });
  } catch (err) {
    logger.error({ err: err?.message || err, ...ctx }, 'Upload Error');
    return res.status(500).json({ error: 'Upload failed' });
  }
};

// ----------------- POPULATE DRIVER DB -----------------
exports.populateDriverDB = async (req, res) => {
  const ctx = callerInfo(req);
  logger.info({ action: 'populateDriverDB', ...ctx }, 'populateDriverDB called');

  try {
    const filePath = req.file && req.file.path;
    if (!filePath && !(req.file && req.file.buffer)) {
      logger.warn({ action: 'populateDriverDB', ...ctx }, 'no file provided');
      return res.status(400).json({ message: 'file required' });
    }

    // Read Excel
    let workbook;
    if (req.file && req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      logger.debug({ action: 'populateDriverDB', source: 'buffer', ...ctx }, 'reading excel from buffer');
    } else {
      workbook = xlsx.readFile(filePath);
      logger.debug({ action: 'populateDriverDB', source: 'file', filePath, ...ctx }, 'reading excel from path');
    }

    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName] || {});
    logger.info({ action: 'populateDriverDB', rows: Array.isArray(data) ? data.length : 0, ...ctx }, 'parsed driver rows');

    const formatted = data.map((row) => ({
      truckNo: row['Truck No'] ? Number(row['Truck No']) : null,
      cubic: row['Cubic (m3)'] ? Number(row['Cubic (m3)']) : null,
      driverName: row['Drivers Name'] || null,
      truckType: row['Truck'] || null,
      status: 'available',
    }));

    const result = await prisma.driver_Db.createMany({
      data: formatted,
      skipDuplicates: true,
    });
    logger.info({ action: 'populateDriverDB', inserted: result.count || 0, ...ctx }, 'drivers inserted');

    try {
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) logger.warn({ err: err.message, filePath: req.file.path, ...ctx }, 'cleanup failed');
          else logger.debug({ filePath: req.file.path, ...ctx }, 'temp file removed');
        });
      }
    } catch (e) {
      logger.warn({ err: e?.message || e, ...ctx }, 'cleanup exception (ignored)');
    }

    return res.status(200).json({ message: 'Drivers inserted into DB.', inserted: result.count || 0 });
  } catch (err) {
    logger.error({ err: err?.message || err, ...ctx }, 'Driver Upload Error');
    return res.status(500).json({ error: 'Upload failed' });
  }
};

// ----------------- FETCH TASK DATA -----------------
exports.getUnassignedTasks = async (req, res) => {
  try {
    const tasks = await prisma.task_DB.findMany({ where: { isassigned: false } });
    return res.status(200).json(tasks);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Fetch Tasks Error');
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

// Assign tasks: accepts { tasks: [ { taskId, truckNo, cubic, driverName, truckType } ] }
exports.assignTasks = async (req, res) => {
  const ctx = callerInfo(req);
  try {
    const { tasks } = req.body;
    logger.info({ action: 'assignTasks', count: Array.isArray(tasks) ? tasks.length : 0, ...ctx }, 'assignTasks called');

    if (!Array.isArray(tasks) || tasks.length === 0) {
      logger.warn({ action: 'assignTasks', ...ctx }, 'invalid tasks array');
      return res.status(400).json({ message: 'tasks array required' });
    }

    await prisma.$transaction(async (tx) => {
      const taskIds = tasks.map((t) => t.taskId);
      logger.debug({ action: 'assignTasks', taskIds: taskIds.slice(0, 50), ...ctx }, 'fetching task rows');
      const taskRows = await tx.task_DB.findMany({
        where: { taskId: { in: taskIds } },
      });

      const assignedRecords = [];
      for (const t of tasks) {
        const taskRow = taskRows.find((row) => row.taskId === t.taskId);
        if (!taskRow) continue;

        assignedRecords.push({
          taskId: taskRow.taskId,
          orderCo: taskRow.orderCo,
          orTy: taskRow.orTy,
          orderNumber: taskRow.orderNumber,
          branchPlant: taskRow.branchPlant,
          customerPO: taskRow.customerPO,
          suburbTown: taskRow.suburbTown,
          name: taskRow.name,
          description: taskRow.description,
          quantityShipped: taskRow.quantityShipped,
          itemNumber: taskRow.itemNumber,
          postalCode: taskRow.postalCode,
          revNbr: taskRow.revNbr,
          revisionReason: taskRow.revisionReason,
          routeCode: taskRow.routeCode,
          schedPick: taskRow.schedPick,
          truckId: taskRow.truckId,
          location: taskRow.location,
          scheduledPickTime: taskRow.scheduledPickTime,
          requestDate: taskRow.requestDate,
          soldTo: taskRow.soldTo,
          shipTo: taskRow.shipTo,
          deliverTo: taskRow.deliverTo,
          stateCode: taskRow.stateCode,
          lnTy: taskRow.lnTy,
          descriptionLine2: taskRow.descriptionLine2,
          zoneNo: taskRow.zoneNo,
          stopCode: taskRow.stopCode,
          nextStat: taskRow.nextStat,
          lastStat: taskRow.lastStat,
          priority: taskRow.priority,
          futureQtyCommitted: taskRow.futureQtyCommitted,
          quantityOrdered: taskRow.quantityOrdered,
          reasonCode: taskRow.reasonCode,
          lineNumber: taskRow.lineNumber,
          truckNo: t.truckNo || null,
          cubic: t.cubic || null,
          driverName: t.driverName || null,
          truckType: t.truckType || null,
          invoiceId: t.invoiceId || null,
          manifestNo: t.manifestNo || null,
          TrackerID: t.TrackerID || null,
          status: 'Not Started',
        });
      }

      if (assignedRecords.length > 0) {
        const created = await tx.assignedTask_DB.createMany({ data: assignedRecords });
        logger.info({ action: 'assignTasks', created: created.count || 0, ...ctx }, 'assigned tasks created');

        await tx.task_DB.deleteMany({
          where: {
            taskId: { in: assignedRecords.map((r) => r.taskId) },
          },
        });
        logger.debug({ action: 'assignTasks', removedFromTaskDB: assignedRecords.length, ...ctx }, 'moved tasks to assignedTask_DB');
      } else {
        logger.warn({ action: 'assignTasks', ...ctx }, 'no matching tasks found to assign');
      }
    });

    return res.status(201).json({ message: 'Tasks assigned' });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Assign Tasks Error');
    return res.status(500).json({ message: 'Failed to assign tasks' });
  }
};

// ----------------- FETCH TASK DATA -----------------
exports.getTasksInProgress = async (req, res) => {
  try {
    const tasks = await prisma.assignedTask_DB.findMany({ where: { isCompleted: false } });
    return res.status(200).json(tasks);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Fetch Tasks Error');
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

exports.getLocation = async (req, res) => {
  const ctx = callerInfo(req);
  try {
    const { NETSTAR_BASE_URL, NETSTAR_USERNAME, NETSTAR_PASSWORD } = process.env;
    logger.info({ action: 'getLocation', url: NETSTAR_BASE_URL, ...ctx }, 'fetching Netstar data');

    const response = await axios.get(NETSTAR_BASE_URL, {
      auth: {
        username: NETSTAR_USERNAME,
        password: NETSTAR_PASSWORD,
      },
    });

    return res.status(200).json(response.data);
  } catch (error) {
    logger.error({ err: error?.message || error, ...ctx }, 'Netstar API Error');
    return res.status(500).json({ message: 'Failed to fetch Netstar data', error: error.message });
  }
};

// fetch assigned task without invoice id.
exports.getTasksWithoutInvoiceExcel = async (req, res) => {
  const ctx = callerInfo(req);
  try {
    const tasks = await prisma.assignedTask_DB.findMany();

    if (!tasks || tasks.length === 0) {
      logger.info({ action: 'getTasksWithoutInvoiceExcel', ...ctx }, 'no tasks found');
      return res.status(404).json({ message: 'No tasks found without invoiceId.' });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Tasks Without Invoice');

    const headers = Object.keys(tasks[0] || {});
    worksheet.columns = headers.map((key) => ({ header: key, key }));

    tasks.forEach((task) => worksheet.addRow(task));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=tasks_without_invoice.xlsx');

    await workbook.xlsx.write(res);
    res.end();

    logger.info({ action: 'getTasksWithoutInvoiceExcel', rows: tasks.length, ...ctx }, 'excel generated');
  } catch (err) {
    logger.error({ err: err?.message || err, ...ctx }, 'Excel Export Error');
    return res.status(500).json({ error: 'Failed to export Excel' });
  }
};

// ----------------- FETCH Completed DATA -----------------
exports.getCompletedTasks = async (req, res) => {
  try {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const tasks = await prisma.completedTask_DB.findMany({
      where: {
        completedAt: {
          gte: twoDaysAgo,
        },
      },
    });
    return res.status(200).json(tasks);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Fetch Completed Tasks Error');
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

// Update invoiceId and/or manifestNo on AssignedTask_DB. Accepts { updates: [ { assignedTaskId?, orderNumber?, invoiceId?, manifestNo? } ] }
exports.updateInvoiceManifest = async (req, res) => {
  const ctx = callerInfo(req);
  try {
    const { updates } = req.body;
    logger.info({ action: 'updateInvoiceManifest', updatesCount: Array.isArray(updates) ? updates.length : 0, ...ctx }, 'updateInvoiceManifest called');

    if (!Array.isArray(updates) || updates.length === 0) {
      logger.warn({ action: 'updateInvoiceManifest', ...ctx }, 'invalid updates array');
      return res.status(400).json({ message: 'updates array required' });
    }

    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        const where = {};
        if (u.assignedTaskId) where.assignedTaskId = u.assignedTaskId;
        else if (u.orderNumber) {
          const found = await tx.assignedTask_DB.findFirst({ where: { orderNumber: u.orderNumber } });
          if (!found) continue;
          where.assignedTaskId = found.assignedTaskId;
        } else {
          continue;
        }

        const data = {};
        if (typeof u.invoiceId !== 'undefined') data.invoiceId = u.invoiceId;
        if (typeof u.manifestNo !== 'undefined') data.manifestNo = u.manifestNo;

        await tx.assignedTask_DB.update({ where, data });
      }
    });

    logger.info({ action: 'updateInvoiceManifest', ...ctx }, 'updates applied');
    return res.status(200).json({ message: 'Updates applied' });
  } catch (err) {
    logger.error({ err: err?.message || err, ...ctx }, 'Update Invoice/Manifest Error');
    return res.status(500).json({ message: 'Failed to update records' });
  }
};

// Upload invoice Excel and update AssignedTask_DB records by orderNumber
exports.uploadInvoiceExcel = async (req, res) => {
  const ctx = callerInfo(req);
  logger.info({ action: 'uploadInvoiceExcel', ...ctx }, 'uploadInvoiceExcel called');

  try {
    if (!req.file || (!req.file.path && !req.file.buffer)) {
      logger.warn({ action: 'uploadInvoiceExcel', ...ctx }, 'no file supplied');
      return res.status(400).json({ message: 'file required' });
    }

    let workbook;
    if (req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      logger.debug({ action: 'uploadInvoiceExcel', source: 'buffer', ...ctx }, 'reading buffer');
    } else {
      workbook = xlsx.readFile(req.file.path);
      logger.debug({ action: 'uploadInvoiceExcel', source: 'file', filePath: req.file.path, ...ctx }, 'reading file');
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      logger.warn({ action: 'uploadInvoiceExcel', ...ctx }, 'excel has no sheets');
      return res.status(400).json({ message: 'Excel file has no sheets' });
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName] || {});
    logger.info({ action: 'uploadInvoiceExcel', rows: Array.isArray(rows) ? rows.length : 0, ...ctx }, 'parsed rows');

    const normalize = (key) => (key || '').toString().trim().toLowerCase();

    const updates = {};

    for (const row of rows) {
      try {
        const keys = Object.keys(row);
        let orderValue, invoiceValue, manifestValue;

        for (const k of keys) {
          const nk = normalize(k);
          const v = row[k];
          if (!v && v !== 0) continue;

          if (nk.includes('order') && nk.includes('number')) {
            orderValue = v;
          } else if (nk === 'order number' || nk === 'ordernumber' || nk === 'orderno' || nk === 'order no') {
            orderValue = v;
          } else if (nk.includes('document') && nk.includes('number')) {
            invoiceValue = v;
          } else if (nk.includes('invoice') || nk.includes('document')) {
            invoiceValue = invoiceValue || v;
          } else if (nk.includes('manifest')) {
            manifestValue = v;
          }
        }

        if (!orderValue) {
          orderValue = row['Order Number'] || row['orderNumber'] || row['OrderNo'] || row['Order No'];
        }
        if (!invoiceValue) {
          invoiceValue = row['Document Number'] || row['DocumentNumber'] || row['Invoice No'] || row['InvoiceNumber'];
        }
        if (!manifestValue) {
          manifestValue = row['Manifest Number'] || row['ManifestNo'] || row['Manifest'];
        }

        if (!orderValue) continue;

        const orderNum =
          typeof orderValue === 'number'
            ? orderValue
            : parseFloat(String(orderValue).replace(/[^0-9.-]+/g, ''));
        if (isNaN(orderNum)) continue;

        const invoiceStr = invoiceValue != null ? String(invoiceValue) : null;
        const manifestStr = manifestValue != null ? String(manifestValue) : null;

        if (!invoiceStr && !manifestStr) continue;

        if (!updates[orderNum]) updates[orderNum] = {};
        if (invoiceStr) updates[orderNum].invoiceId = invoiceStr;
        if (manifestStr) updates[orderNum].manifestNo = manifestStr;
      } catch (rowErr) {
        logger.warn({ err: rowErr?.message || rowErr, ...ctx }, 'Row parse error - skipping row');
        continue;
      }
    }

    let updatedCount = 0;
    for (const [orderNum, data] of Object.entries(updates)) {
      try {
        const result = await prisma.assignedTask_DB.updateMany({
          where: { orderNumber: parseFloat(orderNum) },
          data,
        });
        updatedCount += result.count || 0;
      } catch (dbErr) {
        logger.warn({ orderNum, err: dbErr?.message || dbErr, ...ctx }, 'DB update failed for order - continuing');
      }
    }

    try {
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) logger.warn({ err: err.message, filePath: req.file.path, ...ctx }, 'cleanup failed');
          else logger.debug({ filePath: req.file.path, ...ctx }, 'temp file removed');
        });
      }
    } catch (e) {
      logger.warn({ err: e?.message || e, ...ctx }, 'File cleanup failed');
    }

    logger.info({ action: 'uploadInvoiceExcel', updatedCount, totalOrders: Object.keys(updates).length, ...ctx }, 'invoice sheet processed');

    return res.status(200).json({
      message: 'Invoice sheet processed',
      updated: updatedCount,
      totalOrders: Object.keys(updates).length,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, ...ctx }, 'Upload Invoice Error');
    return res.status(500).json({ message: 'Failed to process invoice sheet' });
  }
};

exports.getAssignedTasks = async (req, res) => {
  try {
    const { truckId, truckNo } = req.query;

    const where = {};
    if (truckId) where.truckId = String(truckId);
    if (truckNo) {
      const tn = Number(truckNo);
      if (!Number.isNaN(tn)) where.truckNo = tn;
    }

    const tasks = await prisma.assignedTask_DB.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      take: 200,
    });

    return res.status(200).json({ tasks });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'getAssignedTasks error');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ----------------- FETCH DRIVER DATA -----------------
exports.getAvailableDrivers = async (req, res) => {
  try {
    const drivers = await prisma.driver_Db.findMany({
      where: {
        status: 'available',
      },
    });
    return res.status(200).json(drivers);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Fetch Drivers Error');
    return res.status(500).json({ error: 'Failed to fetch available drivers' });
  }
};

// Get tasks assigned to the currently authenticated driver (by username)
exports.getMyAssignedTasks = async (req, res) => {
  try {
    const username = req.user && req.user.username;
    if (!username) return res.status(400).json({ message: 'Invalid user context' });

    const tasks = await prisma.assignedTask_DB.findMany({
      where: {
        username: username,
        isCompleted: false,
      },
    });

    return res.status(200).json(tasks);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Fetch My Assigned Tasks Error');
    return res.status(500).json({ message: 'Failed to fetch tasks' });
  }
};
