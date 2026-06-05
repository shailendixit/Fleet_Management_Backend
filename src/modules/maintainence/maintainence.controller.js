'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../../lib/prisma');

// Keep in sync with your Prisma enum
const VALID_STATUSES = ['available', 'unavailable', 'maintenance'];

/** ---------- utils ---------- */
const sanitizeDriver = (driver) => {
  if (!driver) return driver;
  const { password, ...safe } = driver;
  return safe;
};

const isNullOrType = (val, type) =>
  val === null || typeof val === type;

const parsePositiveIntOrNull = (v) => {
  if (v === null || v === undefined) return undefined;
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

const parseNumberOrNull = (v) => {
  if (v === null || v === undefined) return undefined;
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
};

/**
 * Get all drivers with their details
 * Endpoint: GET /api/maintenance/drivers
 * Query (optional, non-breaking): ?status=available|unavailable|maintenance&search=abc&page=1&pageSize=50
 * Required role: Admin
 */
async function getAllDrivers(req, res) {
  try {
    const { status, search, page, pageSize } = req.query;

    // Optional filters that DO NOT break existing calls
    const where = {};
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` });
      }
      where.status = status;
    }
    if (search && typeof search === 'string') {
      // simple OR search on name/username/truckType/truckNo
      const truckNoParsed = parsePositiveIntOrNull(search);
      where.OR = [
        { driverName: { contains: search, mode: 'insensitive' } },
        { username:   { contains: search, mode: 'insensitive' } },
        { truckType:  { contains: search, mode: 'insensitive' } },
        ...(Number.isNaN(truckNoParsed) ? [] : [{ truckNo: truckNoParsed }]),
      ];
    }

    // Optional pagination, default = return all (backwards compatible)
    let take, skip;
    if (page !== undefined || pageSize !== undefined) {
      const p = parsePositiveIntOrNull(page) || 1;
      const ps = parsePositiveIntOrNull(pageSize) || 50;
      take = ps;
      skip = (p - 1) * ps;
    }

    const [drivers, total] = await Promise.all([
      prisma.Driver_Db.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { driverName: 'asc' }
        ],
        select: {
          driverId: true,
          truckNo: true,
          cubic: true,
          driverName: true,
          truckType: true,
          status: true,
          username: true,
          TrackerID: true,
        },
        ...(take ? { take } : {}),
        ...(skip ? { skip } : {}),
      }),
      prisma.Driver_Db.count({ where }),
    ]);

    return res.status(200).json({
      message: "Drivers retrieved successfully",
      count: drivers.length,
      total, // useful if paginating
      drivers
    });
  } catch (error) {
    console.error('getAllDrivers error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Batch update multiple driver records.
 * Endpoint: PATCH /api/maintenance/drivers/batch-update
 * Required role: Admin
 */
async function batchUpdateDrivers(req, res) {
  const { updates } = req.body;

  // Input validation
  if (!Array.isArray(updates)) {
    return res.status(400).json({ 
      message: "Invalid request body. Expected 'updates' to be an array of driver updates."
    });
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: "No updates provided." });
  }

  // Validate each update object and prepare prisma updates
  const prismaUpdates = [];
  const errors = [];

  for (const [index, update] of updates.entries()) {
    try {
      if (!update.driverId || typeof update.driverId !== 'number') {
        throw new Error('driverId is required and must be a number');
      }

      const updateData = {};

      if ('truckNo' in update) {
        if (!isNullOrType(update.truckNo, 'number')) {
          throw new Error('truckNo must be a number or null');
        }
        updateData.truckNo = update.truckNo;
      }
updateData.cubic = update.cubic;

      if ('driverName' in update) {
        if (!isNullOrType(update.driverName, 'string')) {
          throw new Error('driverName must be a string or null');
        }
        updateData.driverName = update.driverName?.trim() ?? null;
      }
      if ('password' in update) {
  if (!isNullOrType(update.password, 'string')) {
    throw new Error('password must be a string or null');
  }
  updateData.password = update.password; // may be null if not provided
}

      if ('truckType' in update) {
        if (!isNullOrType(update.truckType, 'string')) {
          throw new Error('truckType must be a string or null');
        }
        updateData.truckType = update.truckType?.trim() ?? null;
      }
        updateData.status = update.status;
      if ('username' in update) {
        if (!isNullOrType(update.username, 'string')) {
          throw new Error('username must be a string or null');
        }
        updateData.username = update.username?.trim() ?? null;
      }

      if ('TrackerID' in update) {
        if (!isNullOrType(update.TrackerID, 'number')) {
          throw new Error('TrackerID must be a number or null');
        }
        updateData.TrackerID = update.TrackerID;
      }

      // If no valid fields to update, skip this record
      if (Object.keys(updateData).length === 0) {
        throw new Error('No valid fields to update');
      }

      prismaUpdates.push({
        where: { driverId: update.driverId },
        data: updateData
      });

    } catch (error) {
      errors.push({
        index,
        driverId: update.driverId,
        error: error.message
      });
    }
  }

  // If all updates are invalid, return error
  if (prismaUpdates.length === 0) {
    return res.status(400).json({
      message: "No valid updates to process",
      errors
    });
  }

  try {
    // Wrap all updates in a transaction
    const results = await prisma.$transaction(
      prismaUpdates.map(update => prisma.Driver_Db.update(update))
    );

    console.log(`Successfully updated ${results.length} drivers`);

    return res.status(200).json({
      message: `Successfully updated ${results.length} drivers`,
      updatedDrivers: results.map(d => ({
        driverId: d.driverId,
        driverName: d.driverName,
        truckNo: d.truckNo,
        status: d.status
      })),
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Batch update failed:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        message: "Update failed: Unique constraint violation",
        field: error.meta?.target?.[0],
        error: error.message
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({
        message: "One or more drivers not found",
        error: error.message
      });
    }

    return res.status(500).json({
      message: "Internal server error during batch update",
      error: error.message
    });
  }
}

/**
 * Create a new driver
 * Endpoint: POST /api/maintenance/drivers
 * Body:
 * {
 *   "truckNo": number|null,
 *   "cubic": number|null,
 *   "driverName": string|null,
 *   "truckType": string|null,
 *   "status": "available"|"unavailable"|"maintenance", // optional, default available
 *   "username": string|null, // unique
 *   "password": string|null, // optional; will be hashed if provided and non-empty
 *   "TrackerID": number|null // unique
 * }
 * Required role: Admin
 */
async function createDriver(req, res) {
  try {
    const {
      truckNo,
      cubic,
      driverName,
      truckType,
      status,
      username,
      password,
      TrackerID
    } = req.body || {};

    // Validate fields
    if (truckNo !== undefined && !isNullOrType(truckNo, 'number')) {
      return res.status(400).json({ message: 'truckNo must be a number or null' });
    }

    if (driverName !== undefined && !isNullOrType(driverName, 'string')) {
      return res.status(400).json({ message: 'driverName must be a string or null' });
    }
    if (truckType !== undefined && !isNullOrType(truckType, 'string')) {
      return res.status(400).json({ message: 'truckType must be a string or null' });
    }

    if (username !== undefined && !isNullOrType(username, 'string')) {
      return res.status(400).json({ message: 'username must be a string or null' });
    }
    if (TrackerID !== undefined && !isNullOrType(TrackerID, 'number')) {
      return res.status(400).json({ message: 'TrackerID must be a number or null' });
    }
    if (password !== undefined && !isNullOrType(password, 'string')) {
      return res.status(400).json({ message: 'password must be a string or null' });
    }

    const currentDriverCount = await prisma.Driver_Db.count();
    
    if (currentDriverCount >= process.env.MAX_DRIVERS) {
      return res.status(403).json({ 
        message: 'You cannot add more drivers. Limit exceeded for creating new drivers.' 
      });
    }
    // let hashedPassword = null;
    // if (password && typeof password === 'string' && password.trim().length > 0) {
    //   // Hash only if provided
    //   hashedPassword = await bcrypt.hash(password.trim(), 12);
    // }

    const created = await prisma.Driver_Db.create({
      data: {
        truckNo: truckNo ?? null,
        cubic: cubic ?? null,
        driverName: driverName?.trim() ?? null,
        truckType: truckType?.trim() ?? null,
        status: status || 'available',
        username: username?.trim() ?? null,
        password: password, // may be null if not provided
        TrackerID: TrackerID ?? null
      }
    });

    return res.status(201).json({
      message: 'Driver created successfully',
      driver: sanitizeDriver(created)
    });
  } catch (error) {
    console.error('createDriver error:', error);

    if (error.code === 'P2002') {
      // Unique constraint
      // error.meta.target is an array like ['username'] or ['TrackerID']
      return res.status(400).json({
        message: 'Create failed: Unique constraint violation',
        field: error.meta?.target?.[0],
        error: error.message
      });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Delete a driver by ID
 * Endpoint: DELETE /api/maintenance/drivers/:driverId
 * Required role: Admin
 */
async function deleteDriver(req, res) {
  try {
    const idParam = req.params.driverId;
    const driverId = Number(idParam);

    if (!Number.isInteger(driverId) || driverId <= 0) {
      return res.status(400).json({ message: 'driverId must be a positive integer' });
    }

    const deleted = await prisma.Driver_Db.delete({
      where: { driverId }
    });

    return res.status(200).json({
      message: 'Driver deleted successfully',
      driver: sanitizeDriver(deleted)
    });
  } catch (error) {
    console.error('deleteDriver error:', error);

    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Driver not found' });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getAllDrivers,
  batchUpdateDrivers,
  createDriver,
  deleteDriver
};
