const xlsx = require('xlsx');
const fs = require('fs');
const prisma = require('../../lib/prisma');

// ----------------- POPULATE TASK DB -----------------
exports.uploadExcel = async (req, res) => {
  try {
    const filePath = req.file.path;

    // Read Excel
    let workbook;
    if (req.file && req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    } else {
      workbook = xlsx.readFile(filePath);
    }
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Format rows according to Prisma Task schema
    const formatted = data.map(row => ({
  orderCo: row["Order Co"] ? Number(row["Order Co"]) : null,
  orTy: row["Or Ty"] || null,
  orderNumber: row["Order Number"] ? Number(row["Order Number"]) : null,
  branchPlant: row["Branch Plant"] || null,
  customerPO: row["Customer PO"] ? String(row["Customer PO"]) : null, // this one can be string
  suburbTown: row["Suburb/Town"] || null,
  name: row["Name"] || null,
  description: row["Description"] || null,
  quantityShipped: row["Quantity Shipped"] ? Number(row["Quantity Shipped"]) : null,
  itemNumber: row["Item Number"] ? Number(row["Item Number"]) : null,
  postalCode: row["Postal Code"] ? Number(row["Postal Code"]) : null,
  revNbr: row["Rev Nbr"] ? Number(row["Rev Nbr"]) : null,
  revisionReason: row["Revision Reason"] || null,
  routeCode: row["Route Code"] || null,
  schedPick: row["Sched Pick"] ? new Date(row["Sched Pick"]) : null,
  truckId: row["Truck I.D."] || null,
  location: row["Location"] || null,
  scheduledPickTime: row["Scheduled Pick Time"] ? Number(row["Scheduled Pick Time"]) : null,
  requestDate: row["Request Date"] ? new Date(row["Request Date"]) : null,
  soldTo: row["Sold To"] ? Number(row["Sold To"]) : null,
  shipTo: row["Ship To"] ? Number(row["Ship To"]) : null,
  deliverTo: row["Deliver To"] ? Number(row["Deliver To"]) : null,
  stateCode: row["State Code"] || null,
  lnTy: row["Ln Ty"] || null,
  descriptionLine2: row["Description Line 2"] || null,
  zoneNo: row["Zone No."] || null,
  stopCode: row["Stop Code"] || null,
  nextStat: row["Next Stat"] ? Number(row["Next Stat"]) : null,
  lastStat: row["Last Stat"] ? Number(row["Last Stat"]) : null,
  priority: row["Priority (1/0)"] ? Number(row["Priority (1/0)"]) : null,
  futureQtyCommitted: row["Future Qty Committed"] ? Number(row["Future Qty Committed"]) : null,
  quantityOrdered: row["Quantity Ordered"] ? Number(row["Quantity Ordered"]) : null,
  reasonCode: row["Reason Code"] || null,
  lineNumber: row["Line Number"] ? Number(row["Line Number"]) : null,
}));

    // Filter out rows that do not have an Order Number (required)
    const withOrderNumber = formatted.filter(r => r.orderNumber !== null && typeof r.orderNumber !== 'undefined');

    // Bulk insert
    await prisma.task_DB.createMany({
      data: withOrderNumber,
      skipDuplicates: true, // prevents error if same row already exists
    });

  try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e) { /* ignore cleanup errors */ }
  res.status(200).json({ message: "Tasks inserted into DB." });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};

// ----------------- POPULATE DRIVER DB -----------------
exports.populateDriverDB = async (req, res) => {
  try {
    const filePath = req.file.path;

    // Read Excel
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Format rows according to Prisma Truck schema
    const formatted = data.map(row => ({
      truckNo: row["Truck No"] ? Number(row["Truck No"]) : null,
      cubic: row["Cubic (m3)"] ? Number(row["Cubic (m3)"]) : null,
      driverName: row["Drivers Name"] || null,
      truckType: row["Truck"] || null,
      status: "available", // default since not in excel
    }));

    // Bulk insert
    await prisma.driver_Db.createMany({
      data: formatted,
      skipDuplicates: true, // avoids duplicate insertions
    });

  try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e) { /* ignore cleanup errors */ }
  res.status(200).json({ message: "Drivers inserted into DB." });
  } catch (err) {
    console.error("Driver Upload Error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};


// ----------------- FETCH TASK DATA -----------------
exports.getUnassignedTasks = async (req, res) => {
  try {
    const tasks = await prisma.task_DB.findMany({ where: { isassigned: false } });
    res.status(200).json(tasks);
  } catch (err) {
    console.error("Fetch Tasks Error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

// Assign tasks: accepts { tasks: [ { taskId, truckNo, cubic, driverName, truckType } ] }
exports.assignTasks = async (req, res) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ message: 'tasks array required' });
    }

    // Build creation payloads for AssignedTask_DB
    const createData = tasks.map(t => {
      const base = { taskId: t.taskId };
      // copy possible fields if provided (minimal mapping)
      if (t.truckNo) base.truckNo = t.truckNo;
      if (t.cubic) base.cubic = t.cubic;
      if (t.driverName) base.driverName = t.driverName;
      if (t.truckType) base.truckType = t.truckType;
      if (t.invoiceId) base.invoiceId = t.invoiceId;
      if (t.manifestNo) base.manifestNo = t.manifestNo;
      return base;
    });

    // Insert AssignedTask_DB entries (use createMany where possible)
    await prisma.$transaction(async (tx) => {
      // create individual records so we can copy over task fields from Task_DB
      for (const t of tasks) {
        // fetch task row
        const taskRow = await tx.task_DB.findUnique({ where: { taskId: t.taskId } });
        if (!taskRow) continue; // skip invalid ids

        // build record by copying fields from taskRow and merging provided driver fields
        const assignedRecord = {
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
          // driver fields (from request)
          truckNo: t.truckNo || null,
          cubic: t.cubic || null,
          driverName: t.driverName || null,
          truckType: t.truckType || null,
          invoiceId: t.invoiceId || null,
          manifestNo: t.manifestNo || null,
          status: 'Not Started',
        };

        await tx.assignedTask_DB.create({ data: assignedRecord });

        // mark original task as assigned
        await tx.task_DB.update({ where: { taskId: t.taskId }, data: { isassigned: true } });
      }
    });

    return res.status(201).json({ message: 'Tasks assigned' });
  } catch (err) {
    console.error('Assign Tasks Error:', err);
    return res.status(500).json({ message: 'Failed to assign tasks' });
  }
};

// ----------------- FETCH TASK DATA -----------------
exports.getTasksInProgress = async (req, res) => {
  try {
    const tasks = await prisma.assignedTask_DB.findMany({ where: { isCompleted : false } });
    res.status(200).json(tasks);
  } catch (err) {
    console.error("Fetch Tasks Error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

// ----------------- FETCH Completed DATA -----------------
exports.getCompletedTasks = async (req, res) => {
  try {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2); // subtract 2 days

    const tasks = await prisma.completedTask_DB.findMany({
      where: {
        completedAt: {
          gte: twoDaysAgo,
        },
      },
    });
    res.status(200).json(tasks);
  } catch (err) {
    console.error("Fetch Tasks Error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};
// Update invoiceId and/or manifestNo on AssignedTask_DB. Accepts { updates: [ { assignedTaskId?, orderNumber?, invoiceId?, manifestNo? } ] }
exports.updateInvoiceManifest = async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ message: 'updates array required' });
    }

    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        const where = {};
        if (u.assignedTaskId) where.assignedTaskId = u.assignedTaskId;
        else if (u.orderNumber) {
          // find by orderNumber
          const found = await tx.assignedTask_DB.findFirst({ where: { orderNumber: u.orderNumber } });
          if (!found) continue;
          where.assignedTaskId = found.assignedTaskId;
        } else {
          continue; // nothing to target
        }

        const data = {};
        if (typeof u.invoiceId !== 'undefined') data.invoiceId = u.invoiceId;
        if (typeof u.manifestNo !== 'undefined') data.manifestNo = u.manifestNo;

        await tx.assignedTask_DB.update({ where, data });
      }
    });

    return res.status(200).json({ message: 'Updates applied' });
  } catch (err) {
    console.error('Update Invoice/Manifest Error:', err);
    return res.status(500).json({ message: 'Failed to update records' });
  }
};

// Upload invoice Excel and update AssignedTask_DB records by orderNumber
exports.uploadInvoiceExcel = async (req, res) => {
  try {
    if (!req.file || (!req.file.path && !req.file.buffer)) {
      return res.status(400).json({ message: 'file required' });
    }

    let workbook;
    if (req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    } else {
      const filePath = req.file.path;
      workbook = xlsx.readFile(filePath);
    }
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Normalize header keys to lowercase for flexible matching
    const normalize = key => (key || '').toString().trim().toLowerCase();

    for (const row of rows) {
      // find keys for order number, document number (invoice), manifest
      const keys = Object.keys(row);
      let orderValue;
      let invoiceValue;
      let manifestValue;

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
          // prefer explicit invoice headers too
          invoiceValue = invoiceValue || v;
        } else if (nk.includes('manifest')) {
          manifestValue = v;
        }
      }

      // fallback attempts: try common keys
      if (!orderValue) {
        orderValue = row['Order Number'] || row['orderNumber'] || row['OrderNo'] || row['Order No'];
      }
      if (!invoiceValue) {
        invoiceValue = row['Document Number'] || row['DocumentNumber'] || row['Invoice No'] || row['InvoiceNumber'];
      }
      if (!manifestValue) {
        manifestValue = row['Manifest Number'] || row['ManifestNo'] || row['Manifest Number'];
      }

      if (!orderValue) continue; // nothing to match

      // parse order as number if possible
      const orderNum = typeof orderValue === 'number' ? orderValue : parseFloat(String(orderValue).replace(/[^0-9.-]+/g, ''));
      const invoiceStr = invoiceValue != null ? String(invoiceValue) : null;
      const manifestStr = manifestValue != null ? String(manifestValue) : null;

      const data = {};
      if (invoiceStr) data.invoiceId = invoiceStr;
      if (manifestStr) data.manifestNo = manifestStr;
      if (Object.keys(data).length === 0) continue; // nothing to update

      // Update all AssignedTask_DB rows with matching orderNumber
      await prisma.assignedTask_DB.updateMany({
        where: { orderNumber: orderNum },
        data,
      });
    }

  // cleanup file if path used
  try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    return res.status(200).json({ message: 'Invoice sheet processed' });
  } catch (err) {
    console.error('Upload Invoice Error:', err);
    return res.status(500).json({ message: 'Failed to process invoice sheet' });
  }
};

exports.getAssignedTasks = async (req, res) => {
    try {
        const prisma = require('../../lib/prisma');
        const { truckId, truckNo } = req.query;

        // Build where clause only with provided filters
        const where = {};
        if (truckId) where.truckId = String(truckId);
        if (truckNo) {
            const tn = Number(truckNo);
            if (!Number.isNaN(tn)) where.truckNo = tn;
        }

        // If no filter provided, this will return all assigned tasks (limit to sane number)
        const tasks = await prisma.assignedTask_DB.findMany({
            where,
            orderBy: { assignedAt: 'desc' },
            take: 200
        });

        return res.status(200).json({ tasks });
    } catch (err) {
        console.error('getAssignedTasks error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// ----------------- FETCH DRIVER DATA -----------------
exports.getAvailableDrivers = async (req, res) => {
  try {
    const drivers = await prisma.driver_Db.findMany({
      where: {
        status: "available",   // filter by status
      },
    });
    res.status(200).json(drivers);
  } catch (err) {
    console.error("Fetch Drivers Error:", err);
    res.status(500).json({ error: "Failed to fetch available drivers" });
  }
};

// Get tasks assigned to the currently authenticated driver (by username)
exports.getMyAssignedTasks = async (req, res) => {
  try {
    const username = req.user && req.user.username;
    if (!username) return res.status(400).json({ message: 'Invalid user context' });

    const tasks = await prisma.assignedTask_DB.findMany({
      where: {
        driverName: username,
        isCompleted: false,
      },
    });

    return res.status(200).json(tasks);
  } catch (err) {
    console.error('Fetch My Assigned Tasks Error:', err);
    return res.status(500).json({ message: 'Failed to fetch tasks' });
  }
};
