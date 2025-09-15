/*
  Warnings:

  - The primary key for the `Driver_Db` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Driver_Db` table. All the data in the column will be lost.
  - The primary key for the `Task_DB` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Task_DB` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Driver_Db" DROP CONSTRAINT "Driver_Db_pkey",
DROP COLUMN "id",
ADD COLUMN     "driverId" SERIAL NOT NULL,
ADD CONSTRAINT "Driver_Db_pkey" PRIMARY KEY ("driverId");

-- AlterTable
ALTER TABLE "public"."Task_DB" DROP CONSTRAINT "Task_DB_pkey",
DROP COLUMN "id",
ADD COLUMN     "isassigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taskId" SERIAL NOT NULL,
ADD CONSTRAINT "Task_DB_pkey" PRIMARY KEY ("taskId");

-- CreateTable
CREATE TABLE "public"."AssignedTask_DB" (
    "assignedTaskId" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "orderCo" DOUBLE PRECISION,
    "orTy" TEXT,
    "orderNumber" DOUBLE PRECISION,
    "branchPlant" TEXT,
    "customerPO" TEXT,
    "suburbTown" TEXT,
    "name" TEXT,
    "description" TEXT,
    "quantityShipped" DOUBLE PRECISION,
    "itemNumber" DOUBLE PRECISION,
    "postalCode" DOUBLE PRECISION,
    "revNbr" DOUBLE PRECISION,
    "revisionReason" TEXT,
    "routeCode" TEXT,
    "schedPick" TIMESTAMP(3),
    "truckId" TEXT,
    "location" TEXT,
    "scheduledPickTime" DOUBLE PRECISION,
    "requestDate" TIMESTAMP(3),
    "soldTo" DOUBLE PRECISION,
    "shipTo" DOUBLE PRECISION,
    "deliverTo" DOUBLE PRECISION,
    "stateCode" TEXT,
    "lnTy" TEXT,
    "descriptionLine2" TEXT,
    "zoneNo" TEXT,
    "stopCode" TEXT,
    "nextStat" DOUBLE PRECISION,
    "lastStat" DOUBLE PRECISION,
    "priority" DOUBLE PRECISION,
    "futureQtyCommitted" DOUBLE PRECISION,
    "quantityOrdered" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "lineNumber" DOUBLE PRECISION,
    "truckNo" INTEGER,
    "Cubic (m3)" DOUBLE PRECISION,
    "Drivers Name" TEXT,
    "Truck" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    "manifestNo" TEXT,

    CONSTRAINT "AssignedTask_DB_pkey" PRIMARY KEY ("assignedTaskId")
);

-- CreateTable
CREATE TABLE "public"."CompletedTask_DB" (
    "taskId" INTEGER NOT NULL,
    "orderCo" DOUBLE PRECISION,
    "orTy" TEXT,
    "orderNumber" DOUBLE PRECISION,
    "branchPlant" TEXT,
    "customerPO" TEXT,
    "suburbTown" TEXT,
    "name" TEXT,
    "description" TEXT,
    "quantityShipped" DOUBLE PRECISION,
    "itemNumber" DOUBLE PRECISION,
    "postalCode" DOUBLE PRECISION,
    "revNbr" DOUBLE PRECISION,
    "revisionReason" TEXT,
    "routeCode" TEXT,
    "schedPick" TIMESTAMP(3),
    "truckId" TEXT,
    "location" TEXT,
    "scheduledPickTime" DOUBLE PRECISION,
    "requestDate" TIMESTAMP(3),
    "soldTo" DOUBLE PRECISION,
    "shipTo" DOUBLE PRECISION,
    "deliverTo" DOUBLE PRECISION,
    "stateCode" TEXT,
    "lnTy" TEXT,
    "descriptionLine2" TEXT,
    "zoneNo" TEXT,
    "stopCode" TEXT,
    "nextStat" DOUBLE PRECISION,
    "lastStat" DOUBLE PRECISION,
    "priority" DOUBLE PRECISION,
    "futureQtyCommitted" DOUBLE PRECISION,
    "quantityOrdered" DOUBLE PRECISION,
    "reasonCode" TEXT,
    "lineNumber" DOUBLE PRECISION,
    "truckNo" INTEGER,
    "Drivers Name" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    "manifestNo" TEXT,
    "POD" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignedTask_DB_taskId_key" ON "public"."AssignedTask_DB"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignedTask_DB_invoiceId_key" ON "public"."AssignedTask_DB"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletedTask_DB_taskId_key" ON "public"."CompletedTask_DB"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletedTask_DB_invoiceId_key" ON "public"."CompletedTask_DB"("invoiceId");
