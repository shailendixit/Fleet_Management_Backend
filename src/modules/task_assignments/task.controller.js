const xlsx = require('xlsx');
const fs = require('fs');
const prisma = require('../../lib/prisma');

 // Helpers
function safeNumber(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function safeDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}


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
  orderCo: safeNumber(row["Order Co"]),
  orTy: row["Or Ty"] || null,
  orderNumber: safeNumber(row["Order Number"]),
  branchPlant: row["Branch Plant"] || null,
  customerPO: row["Customer PO"] ? String(row["Customer PO"]) : null, // string-safe
  suburbTown: row["Suburb/Town"] || null,
  name: row["Name"] || null,
  description: row["Description"] || null,
  quantityShipped: safeNumber(row["Quantity Shipped"]),
  itemNumber: safeNumber(row["Item Number"]),
  postalCode: safeNumber(row["Postal Code"]),
  revNbr: safeNumber(row["Rev Nbr"]),
  revisionReason: row["Revision Reason"] || null,
  routeCode: row["Route Code"] || null,
  schedPick: safeDate(row["Sched Pick"]),
  truckId: row["Truck I.D."] || null,
  location: row["Location"] || null,
  scheduledPickTime: safeNumber(row["Scheduled Pick Time"]),
  requestDate: safeDate(row["Request Date"]),
  soldTo: safeNumber(row["Sold To"]),
  shipTo: safeNumber(row["Ship To"]),
  deliverTo: safeNumber(row["Deliver To"]),
  stateCode: row["State Code"] || null,
  lnTy: row["Ln Ty"] || null,
  descriptionLine2: row["Description Line 2"] || null,
  zoneNo: row["Zone No."] || null,
  stopCode: row["Stop Code"] || null,
  nextStat: safeNumber(row["Next Stat"]),
  lastStat: safeNumber(row["Last Stat"]),
  priority: safeNumber(row["Priority (1/0)"]),
  futureQtyCommitted: safeNumber(row["Future Qty Committed"]),
  quantityOrdered: safeNumber(row["Quantity Ordered"]),
  reasonCode: row["Reason Code"] || null,
  lineNumber: safeNumber(row["Line Number"]),
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

    await prisma.$transaction(async (tx) => {
      // fetch all task rows in one query
      const taskIds = tasks.map(t => t.taskId);
      const taskRows = await tx.task_DB.findMany({
        where: { taskId: { in: taskIds } },
      });

      // build assigned task records
      const assignedRecords = [];
      for (const t of tasks) {
        const taskRow = taskRows.find(row => row.taskId === t.taskId);
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
          status: 'Not Started',
        });
      }

      if (assignedRecords.length > 0) {
        await tx.assignedTask_DB.createMany({ data: assignedRecords });

        await tx.task_DB.updateMany({
          where: { taskId: { in: assignedRecords.map(r => r.taskId) } },
          data: { isassigned: true },
        });
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
// Upload invoice Excel and update AssignedTask_DB records by orderNumber
exports.uploadInvoiceExcel = async (req, res) => {
  try {
    if (!req.file || (!req.file.path && !req.file.buffer)) {
      return res.status(400).json({ message: "file required" });
    }

    let workbook;
    if (req.file.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    } else {
      workbook = xlsx.readFile(req.file.path);
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ message: "Excel file has no sheets" });
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    const normalize = (key) => (key || "").toString().trim().toLowerCase();

    // Collect updates (batch by orderNumber to reduce DB hits)
    const updates = {};

    for (const row of rows) {
      try {
        const keys = Object.keys(row);
        let orderValue, invoiceValue, manifestValue;

        for (const k of keys) {
          const nk = normalize(k);
          const v = row[k];
          if (!v && v !== 0) continue;

          if (nk.includes("order") && nk.includes("number")) {
            orderValue = v;
          } else if (
            nk === "order number" ||
            nk === "ordernumber" ||
            nk === "orderno" ||
            nk === "order no"
          ) {
            orderValue = v;
          } else if (nk.includes("document") && nk.includes("number")) {
            invoiceValue = v;
          } else if (nk.includes("invoice") || nk.includes("document")) {
            invoiceValue = invoiceValue || v;
          } else if (nk.includes("manifest")) {
            manifestValue = v;
          }
        }

        // fallback attempts
        if (!orderValue) {
          orderValue =
            row["Order Number"] ||
            row["orderNumber"] ||
            row["OrderNo"] ||
            row["Order No"];
        }
        if (!invoiceValue) {
          invoiceValue =
            row["Document Number"] ||
            row["DocumentNumber"] ||
            row["Invoice No"] ||
            row["InvoiceNumber"];
        }
        if (!manifestValue) {
          manifestValue =
            row["Manifest Number"] || row["ManifestNo"] || row["Manifest"];
        }

        if (!orderValue) continue; // nothing to match

        // sanitize order number
        const orderNum =
          typeof orderValue === "number"
            ? orderValue
            : parseFloat(String(orderValue).replace(/[^0-9.-]+/g, ""));
        if (isNaN(orderNum)) continue;

        const invoiceStr = invoiceValue != null ? String(invoiceValue) : null;
        const manifestStr = manifestValue != null ? String(manifestValue) : null;

        if (!invoiceStr && !manifestStr) continue;

        // Merge updates for same orderNumber (avoid duplicate DB calls)
        if (!updates[orderNum]) updates[orderNum] = {};
        if (invoiceStr) updates[orderNum].invoiceId = invoiceStr;
        if (manifestStr) updates[orderNum].manifestNo = manifestStr;
      } catch (rowErr) {
        console.error("Row parse error:", rowErr);
        continue; // skip bad row but continue processing
      }
    }

    // Apply updates in batch
    let updatedCount = 0;
    for (const [orderNum, data] of Object.entries(updates)) {
      try {
        const result = await prisma.assignedTask_DB.updateMany({
          where: { orderNumber: parseFloat(orderNum) },
          data,
        });
        updatedCount += result.count || 0;
      } catch (dbErr) {
        console.error(`DB update failed for order ${orderNum}:`, dbErr);
      }
    }

    // cleanup file if path used
    try {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn("File cleanup failed:", e);
    }

    return res.status(200).json({
      message: "Invoice sheet processed",
      updated: updatedCount,
      totalOrders: Object.keys(updates).length,
    });
  } catch (err) {
    console.error("Upload Invoice Error:", err);
    return res
      .status(500)
      .json({ message: "Failed to process invoice sheet" });
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
