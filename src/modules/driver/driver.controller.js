const prisma = require('../../lib/prisma');

// Start assignment: set status to 'started' and update truckNo
exports.startAssignment = async (req, res) => {
  try {
    const { assignedTaskId, truckNo } = req.body;
    if (!assignedTaskId) return res.status(400).json({ message: 'assignedTaskId required' });

    const updated = await prisma.assignedTask_DB.update({
      where: { assignedTaskId },
      data: { status: 'started', truckNo: truckNo || undefined }
    });

    return res.status(200).json({ message: 'Assignment started', updated });
  } catch (err) {
    console.error('Start Assignment Error:', err);
    return res.status(500).json({ message: 'Failed to start assignment' });
  }
};

// Complete assignment: move row from AssignedTask_DB to CompletedTask_DB and delete from AssignedTask_DB
exports.completeAssignment = async (req, res) => {
  try {
    const { assignedTaskId, truckNo, driverName, POD } = req.body;
    if (!assignedTaskId) return res.status(400).json({ message: 'assignedTaskId required' });

    const existing = await prisma.assignedTask_DB.findUnique({ where: { assignedTaskId } });
    if (!existing) return res.status(404).json({ message: 'Assigned task not found' });

    // build completed task payload copying relevant fields
    const completedPayload = {
      taskId: existing.taskId,
      orderCo: existing.orderCo,
      orTy: existing.orTy,
      orderNumber: existing.orderNumber,
      branchPlant: existing.branchPlant,
      customerPO: existing.customerPO,
      suburbTown: existing.suburbTown,
      name: existing.name,
      description: existing.description,
      quantityShipped: existing.quantityShipped,
      itemNumber: existing.itemNumber,
      postalCode: existing.postalCode,
      revNbr: existing.revNbr,
      revisionReason: existing.revisionReason,
      routeCode: existing.routeCode,
      schedPick: existing.schedPick,
      truckId: existing.truckId,
      location: existing.location,
      scheduledPickTime: existing.scheduledPickTime,
      requestDate: existing.requestDate,
      soldTo: existing.soldTo,
      shipTo: existing.shipTo,
      deliverTo: existing.deliverTo,
      stateCode: existing.stateCode,
      lnTy: existing.lnTy,
      descriptionLine2: existing.descriptionLine2,
      zoneNo: existing.zoneNo,
      stopCode: existing.stopCode,
      nextStat: existing.nextStat,
      lastStat: existing.lastStat,
      priority: existing.priority,
      futureQtyCommitted: existing.futureQtyCommitted,
      quantityOrdered: existing.quantityOrdered,
      reasonCode: existing.reasonCode,
      lineNumber: existing.lineNumber,
      truckNo: truckNo || existing.truckNo,
      driverName: driverName || existing.driverName,
      assignedAt: existing.assignedAt,
      invoiceId: existing.invoiceId,
      manifestNo: existing.manifestNo,
      POD: POD || null
    };

    // Insert into CompletedTask_DB and delete from AssignedTask_DB in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.completedTask_DB.create({ data: completedPayload });
      await tx.assignedTask_DB.delete({ where: { assignedTaskId } });
    });

    return res.status(200).json({ message: 'Assignment completed and moved to completed tasks' });
  } catch (err) {
    console.error('Complete Assignment Error:', err);
    return res.status(500).json({ message: 'Failed to complete assignment' });
  }
};
