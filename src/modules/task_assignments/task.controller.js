const xlsx = require('xlsx');
const fs = require('fs');
const prisma = require('../../lib/prisma');
const ExcelJS = require("exceljs");
const axios = require('axios');



// Normalize column headers
function normalizeHeader(header) {
  return header
    ?.toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}


// Header aliases (tolerant mapping)
const headerAliases = {
  invoiceId: ["documentnumber", "documentno", "invoicenumber"],

  ordernumber: ["ordernumber"],

  orty: ["orty"],

  linenum: ["linenum", "linenumber"],

  invoicedate: ["invoicedate"],

  invoicetime: ["invoicetime"],

  quantity: ["quantity"],

  itemnumber2: ["2nditemnumber", "itemnumber2"],

  description1: ["description1", "description"],

  branchplant: ["branchplant"],

  shiptoname: ["shiptoname"],

  address1: ["address1"],

  address2: ["address2"],

  postcode: ["postcode", "postalcode"],

  city: ["city"],

  routecode: ["routecode"],

  actualship: ["actualship"],

  manifestnumber: ["manifestnumber"],

  weightuom: ["weightuom"],

  weight: ["weight"],

  volumeuom: ["volumeuom"],

  volume: ["volume"]
};


// Extract value from row using header aliases
function getValue(row, aliases) {
  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);

    if (aliases.includes(normalized)) {
      return row[key];
    }
  }
  return null;
}


// Safe number parser
function safeNumber(val) {
  if (val === null || val === undefined || val === "") return null;

  const num = Number(val);

  return isNaN(num) ? null : num;
}


// Safe date parser
function safeDate(val) {
  if (!val) return null;

  const date = new Date(val);

  return isNaN(date.getTime()) ? null : date;
}


// Upload controller
exports.uploadExcel = async (req, res) => {
  try {

    const filePath = req.file?.path;

    let workbook;

    if (req.file?.buffer) {
      workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    } else {
      workbook = xlsx.readFile(filePath);
    }

    const sheetName = workbook.SheetNames[0];

    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);



    // Format rows according to Prisma schema
    const formatted = data.map(row => ({

      invoiceId: getValue(row, headerAliases.invoiceId)
        ? String(getValue(row, headerAliases.invoiceId))
        : null,

      ordernumber: getValue(row, headerAliases.ordernumber)
        ? String(getValue(row, headerAliases.ordernumber))
        : null,

      orty: getValue(row, headerAliases.orty) || null,

      linenum: safeNumber(getValue(row, headerAliases.linenum)),

      invoicedate: safeDate(getValue(row, headerAliases.invoicedate)),

      invoicetime: getValue(row, headerAliases.invoicetime)
        ? String(getValue(row, headerAliases.invoicetime))
        : null,

      quantity: safeNumber(getValue(row, headerAliases.quantity)),

      itemnumber2: getValue(row, headerAliases.itemnumber2)
        ? String(getValue(row, headerAliases.itemnumber2))
        : null,

      description1: getValue(row, headerAliases.description1) || null,

      branchplant: getValue(row, headerAliases.branchplant) || null,

      shiptoname: getValue(row, headerAliases.shiptoname) || null,

      address1: getValue(row, headerAliases.address1) || null,

      address2: getValue(row, headerAliases.address2) || null,

      postcode: getValue(row, headerAliases.postcode)
        ? String(getValue(row, headerAliases.postcode))
        : null,

      city: getValue(row, headerAliases.city) || null,

      routecode: getValue(row, headerAliases.routecode) || null,

      actualship: safeDate(getValue(row, headerAliases.actualship)),

      manifestnumber: getValue(row, headerAliases.manifestnumber)
        ? String(getValue(row, headerAliases.manifestnumber))
        : null,

      weightuom: getValue(row, headerAliases.weightuom) || null,

      weight: safeNumber(getValue(row, headerAliases.weight)),

      volumeuom: getValue(row, headerAliases.volumeuom) || null,

      volume: safeNumber(getValue(row, headerAliases.volume)),

    }));



    // Filter rows missing primary identifier
    const validRows = formatted.filter(
      r => r.invoiceId !== null && typeof r.invoiceId !== "undefined"
    );



    await prisma.task_db.createMany({
      data: validRows,
      skipDuplicates: true
    });



    // Cleanup uploaded file
    try {
      if (req.file?.path) {
        fs.unlink(req.file.path, err => {
          if (err) console.error("Cleanup failed:", err);
        });
      }
    } catch (e) {}



    res.status(200).json({
      message: `${validRows.length} tasks inserted successfully`
    });

  } catch (err) {

    console.error("Upload Error:", err);

    res.status(500).json({
      error: "Upload failed",
      details: err.message
    });

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

    try {
      if (req.file && req.file.path) fs.unlink(req.file.path, err => {
        if (err) console.error("Cleanup failed:", err);
      });
    } catch (e) { /* ignore cleanup errors */ }
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

//--------DELETE ALL TASKS FROM TASK DB--------
exports.deleteAllTasks = async (req, res) => {
  try {
    await prisma.task_DB.deleteMany({});
    res.status(200).json({ success: true, message: "All tasks deleted successfully" });
  } catch (err) {
    console.error("Delete All Tasks Error:", err);
    res.status(500).json({ success: false, error: "Failed to delete tasks" });
  }
};


// ----------------- Move task back to task_DB fromm assigntask db -----------------

// -------- UNASSIGN TASK (MOVE FROM assignedTask_DB BACK TO task_DB) --------
exports.unassignTask = async (req, res) => {
  const { assignedTaskId } = req.params;

  if (!assignedTaskId || isNaN(Number(assignedTaskId))) {
    return res.status(400).json({
      success: false,
      error: "Valid assignedTaskId is required",
    });
  }

  try {
    // 1️⃣ Fetch assigned task OUTSIDE transaction (important)
    const assignedTask = await prisma.assignedTask_DB.findUnique({
      where: { assignedTaskId: Number(assignedTaskId) },
    });

    if (!assignedTask) {
      return res.status(404).json({
        success: false,
        error: "Assigned task not found",
      });
    }

    // 2️⃣ Prepare task_DB payload
    const taskPayload = {
      taskId: assignedTask.taskId,
      orderCo: assignedTask.orderCo,
      orTy: assignedTask.orTy,
      orderNumber: assignedTask.orderNumber,
      branchPlant: assignedTask.branchPlant,
      customerPO: assignedTask.customerPO,
      suburbTown: assignedTask.suburbTown,
      name: assignedTask.name,
      description: assignedTask.description,
      quantityShipped: assignedTask.quantityShipped,
      itemNumber: assignedTask.itemNumber,
      postalCode: assignedTask.postalCode,
      revNbr: assignedTask.revNbr,
      revisionReason: assignedTask.revisionReason,
      routeCode: assignedTask.routeCode,
      schedPick: assignedTask.schedPick,
      truckId: assignedTask.truckId,
      location: assignedTask.location,
      scheduledPickTime: assignedTask.scheduledPickTime,
      requestDate: assignedTask.requestDate,
      soldTo: assignedTask.soldTo,
      shipTo: assignedTask.shipTo,
      deliverTo: assignedTask.deliverTo,
      stateCode: assignedTask.stateCode,
      lnTy: assignedTask.lnTy,
      descriptionLine2: assignedTask.descriptionLine2,
      zoneNo: assignedTask.zoneNo,
      stopCode: assignedTask.stopCode,
      nextStat: assignedTask.nextStat,
      lastStat: assignedTask.lastStat,
      priority: assignedTask.priority,
      futureQtyCommitted: assignedTask.futureQtyCommitted,
      quantityOrdered: assignedTask.quantityOrdered,
      reasonCode: assignedTask.reasonCode,
      lineNumber: assignedTask.lineNumber,
      isassigned: false,
    };

    // 3️⃣ Atomic operation using batch transaction
    await prisma.$transaction([
      prisma.task_DB.create({ data: taskPayload }),
      prisma.assignedTask_DB.delete({
        where: { assignedTaskId: Number(assignedTaskId) },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Task successfully unassigned and moved back to task DB",
    });
  } catch (err) {
    console.error("Unassign Task Error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to unassign task",
    });
  }
};



// Assign tasks: accepts { tasks: [ { taskId, truckNo, cubic, driverName, truckType } ] }
exports.assignTasks = async (req, res) => {
  try {

    const { tasks } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ message: "tasks array required" });
    }

    await prisma.$transaction(async (tx) => {

      const taskIds = tasks.map(t => t.taskId);

      const taskRows = await tx.task_db.findMany({
        where: { taskid: { in: taskIds } }
      });

      const assignedRecords = [];

      for (const t of tasks) {

        const taskRow = taskRows.find(row => row.taskid === t.taskId);

        if (!taskRow) continue;

        assignedRecords.push({

          taskId: taskRow.taskid,

          invoiceId: taskRow.invoiceId,
          ordernumber: taskRow.ordernumber,
          orty: taskRow.orty,
          linenum: taskRow.linenum,

          invoicedate: taskRow.invoicedate,
          invoicetime: taskRow.invoicetime,

          quantity: taskRow.quantity,
          itemnumber2: taskRow.itemnumber2,
          description1: taskRow.description1,

          branchplant: taskRow.branchplant,
          shiptoname: taskRow.shiptoname,

          address1: taskRow.address1,
          address2: taskRow.address2,

          postcode: taskRow.postcode,
          city: taskRow.city,

          routecode: taskRow.routecode,

          actualship: taskRow.actualship,

          manifestnumber: taskRow.manifestnumber,

          weightuom: taskRow.weightuom,
          weight: taskRow.weight,

          volumeuom: taskRow.volumeuom,
          volume: taskRow.volume,

          // driver assignment fields
          truckNo: t.truckNo || null,
          cubic: t.cubic || null,
          driverName: t.driverName || null,
          truckType: t.truckType || null,
          TrackerID: t.TrackerID || null,

          status: "Not Started"

        });

      }

      if (assignedRecords.length > 0) {

        await tx.assignedTask_DB.createMany({
          data: assignedRecords
        });

        await tx.task_db.deleteMany({
          where: {
            taskid: { in: assignedRecords.map(r => r.taskId) }
          }
        });

      }

    });

    return res.status(201).json({
      message: "Tasks assigned"
    });

  } catch (err) {

    console.error("Assign Tasks Error:", err);

    return res.status(500).json({
      message: "Failed to assign tasks"
    });

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
exports.getLocation = async (req, res) => {
 try {
    const { NETSTAR_BASE_URL, NETSTAR_USERNAME, NETSTAR_PASSWORD } = process.env;

    const response = await axios.get(NETSTAR_BASE_URL, {
      auth: {
        username: NETSTAR_USERNAME,
        password: NETSTAR_PASSWORD
      }
    });

    res.status(200).json(response.data);

  } catch (error) {
    console.error('Netstar API Error:', error.message);
    res.status(500).json({ message: 'Failed to fetch Netstar data', error: error.message });
  }
};

// fetch assigned task without invoice id.
exports.getTasksWithoutInvoiceExcel = async (req, res) => {
  try {
    const tasks = await prisma.assignedTask_DB.findMany();


    if (!tasks || tasks.length === 0) {
      return res.status(404).json({ message: "No tasks found without invoiceId." });
    }

    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Tasks Without Invoice");

    // Add headers
    const headers = Object.keys(tasks[0]);
    worksheet.columns = headers.map((key) => ({ header: key, key }));

    // Add rows
    tasks.forEach((task) => worksheet.addRow(task));

    // Prepare Excel file for download
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=tasks_without_invoice.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("Excel Export Error:", err);
    res.status(500).json({ error: "Failed to export Excel" });
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
      if (req.file && req.file.path) fs.unlink(req.file.path, err => {
            if (err) console.error("Cleanup failed:", err);
          });
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
        username: username,
        isCompleted: false,
      },
    });

    return res.status(200).json(tasks);
  } catch (err) {
    console.error('Fetch My Assigned Tasks Error:', err);
    return res.status(500).json({ message: 'Failed to fetch tasks' });
  }
};
