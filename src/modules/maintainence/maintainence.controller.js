const prisma = require('../../lib/prisma');

/**
 * Get all drivers with their details
 * Endpoint: GET /api/maintenance/drivers
 * Required role: Admin
 */
async function getAllDrivers(req, res) {
    try {
        const drivers = await prisma.Driver_Db.findMany({
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
                TrackerID: true
                // Exclude password for security
            }
        });

        return res.status(200).json({
            message: "Drivers retrieved successfully",
            count: drivers.length,
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
 * 
 * @param {Object} req.body.updates - Array of objects with driver updates
 * @param {number} req.body.updates[].driverId - ID of the driver to update
 * @param {number} [req.body.updates[].truckNo] - New truck number
 * @param {number} [req.body.updates[].cubic] - New cubic capacity
 * @param {string} [req.body.updates[].driverName] - New driver name
 * @param {string} [req.body.updates[].truckType] - New truck type
 * @param {string} [req.body.updates[].status] - New status (must be valid Status enum)
 * @param {string} [req.body.updates[].username] - New username
 * @param {number} [req.body.updates[].TrackerID] - New tracker ID
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
    const VALID_STATUSES = ['available', 'unavailable', 'maintenance']; // match your Prisma schema Status enum

    for (const [index, update] of updates.entries()) {
        try {
            if (!update.driverId || typeof update.driverId !== 'number') {
                throw new Error('driverId is required and must be a number');
            }

            const updateData = {};

            // Validate and collect non-null fields
            if ('truckNo' in update) {
                if (typeof update.truckNo !== 'number' && update.truckNo !== null) {
                    throw new Error('truckNo must be a number or null');
                }
                updateData.truckNo = update.truckNo;
            }

            if ('cubic' in update) {
                if (typeof update.cubic !== 'number' && update.cubic !== null) {
                    throw new Error('cubic must be a number or null');
                }
                updateData.cubic = update.cubic;
            }

            if ('driverName' in update) {
                if (typeof update.driverName !== 'string' && update.driverName !== null) {
                    throw new Error('driverName must be a string or null');
                }
                updateData.driverName = update.driverName;
            }

            if ('truckType' in update) {
                if (typeof update.truckType !== 'string' && update.truckType !== null) {
                    throw new Error('truckType must be a string or null');
                }
                updateData.truckType = update.truckType;
            }

            if ('status' in update) {
                if (!VALID_STATUSES.includes(update.status)) {
                    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
                }
                updateData.status = update.status;
            }

            if ('username' in update) {
                if (typeof update.username !== 'string' && update.username !== null) {
                    throw new Error('username must be a string or null');
                }
                updateData.username = update.username;
            }

            if ('TrackerID' in update) {
                if (typeof update.TrackerID !== 'number' && update.TrackerID !== null) {
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
            prismaUpdates.map(update => 
                prisma.Driver_Db.update(update)
            )
        );

        // Log success but don't expose full driver details in response
        console.log(`Successfully updated ${results.length} drivers`);

        return res.status(200).json({
            message: `Successfully updated ${results.length} drivers`,
            updatedDrivers: results.map(driver => ({
                driverId: driver.driverId,
                driverName: driver.driverName,
                truckNo: driver.truckNo,
                status: driver.status
            })),
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Batch update failed:', error);

        // Check for common Prisma errors
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

module.exports = {
    getAllDrivers,
    batchUpdateDrivers
};
