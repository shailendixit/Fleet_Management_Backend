/*
  Warnings:

  - You are about to drop the column `branchPlant` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `customerPO` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `deliverTo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `descriptionLine2` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `futureQtyCommitted` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `itemNumber` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lastStat` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lineNumber` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lnTy` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `manifestNo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `nextStat` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orTy` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orderCo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orderNumber` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `postalCode` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `quantityOrdered` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `quantityShipped` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `reasonCode` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `requestDate` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `revNbr` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `revisionReason` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `routeCode` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `schedPick` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledPickTime` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `shipTo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `soldTo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `stateCode` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `stopCode` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `suburbTown` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `truckId` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `zoneNo` on the `AssignedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `branchPlant` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `customerPO` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `deliverTo` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `descriptionLine2` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `futureQtyCommitted` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `itemNumber` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lastStat` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lineNumber` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `lnTy` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `nextStat` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orTy` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orderCo` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `orderNumber` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `postalCode` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `quantityOrdered` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `quantityShipped` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `reasonCode` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `requestDate` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `revNbr` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `revisionReason` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `routeCode` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `schedPick` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledPickTime` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `shipTo` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `soldTo` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `stateCode` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `stopCode` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `suburbTown` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `truckId` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the column `zoneNo` on the `CompletedTask_DB` table. All the data in the column will be lost.
  - You are about to drop the `Task_DB` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "public"."AssignedTask_DB_orderNumber_idx";

-- DropIndex
DROP INDEX "public"."AssignedTask_DB_truckNo_idx";

-- AlterTable
ALTER TABLE "public"."AssignedTask_DB" DROP COLUMN "branchPlant",
DROP COLUMN "customerPO",
DROP COLUMN "deliverTo",
DROP COLUMN "description",
DROP COLUMN "descriptionLine2",
DROP COLUMN "futureQtyCommitted",
DROP COLUMN "itemNumber",
DROP COLUMN "lastStat",
DROP COLUMN "lineNumber",
DROP COLUMN "lnTy",
DROP COLUMN "location",
DROP COLUMN "manifestNo",
DROP COLUMN "name",
DROP COLUMN "nextStat",
DROP COLUMN "orTy",
DROP COLUMN "orderCo",
DROP COLUMN "orderNumber",
DROP COLUMN "postalCode",
DROP COLUMN "priority",
DROP COLUMN "quantityOrdered",
DROP COLUMN "quantityShipped",
DROP COLUMN "reasonCode",
DROP COLUMN "requestDate",
DROP COLUMN "revNbr",
DROP COLUMN "revisionReason",
DROP COLUMN "routeCode",
DROP COLUMN "schedPick",
DROP COLUMN "scheduledPickTime",
DROP COLUMN "shipTo",
DROP COLUMN "soldTo",
DROP COLUMN "stateCode",
DROP COLUMN "stopCode",
DROP COLUMN "suburbTown",
DROP COLUMN "truckId",
DROP COLUMN "zoneNo",
ADD COLUMN     "actualship" TIMESTAMP(3),
ADD COLUMN     "address1" TEXT,
ADD COLUMN     "address2" TEXT,
ADD COLUMN     "branchplant" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "description1" TEXT,
ADD COLUMN     "invoicedate" TIMESTAMP(3),
ADD COLUMN     "invoicetime" TEXT,
ADD COLUMN     "itemnumber2" TEXT,
ADD COLUMN     "linenum" DOUBLE PRECISION,
ADD COLUMN     "manifestnumber" TEXT,
ADD COLUMN     "ordernumber" TEXT,
ADD COLUMN     "orty" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "routecode" TEXT,
ADD COLUMN     "shiptoname" TEXT,
ADD COLUMN     "volume" DOUBLE PRECISION,
ADD COLUMN     "volumeuom" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "weightuom" TEXT;

-- AlterTable
ALTER TABLE "public"."CompletedTask_DB" DROP COLUMN "branchPlant",
DROP COLUMN "customerPO",
DROP COLUMN "deliverTo",
DROP COLUMN "description",
DROP COLUMN "descriptionLine2",
DROP COLUMN "futureQtyCommitted",
DROP COLUMN "itemNumber",
DROP COLUMN "lastStat",
DROP COLUMN "lineNumber",
DROP COLUMN "lnTy",
DROP COLUMN "location",
DROP COLUMN "name",
DROP COLUMN "nextStat",
DROP COLUMN "orTy",
DROP COLUMN "orderCo",
DROP COLUMN "orderNumber",
DROP COLUMN "postalCode",
DROP COLUMN "priority",
DROP COLUMN "quantityOrdered",
DROP COLUMN "quantityShipped",
DROP COLUMN "reasonCode",
DROP COLUMN "requestDate",
DROP COLUMN "revNbr",
DROP COLUMN "revisionReason",
DROP COLUMN "routeCode",
DROP COLUMN "schedPick",
DROP COLUMN "scheduledPickTime",
DROP COLUMN "shipTo",
DROP COLUMN "soldTo",
DROP COLUMN "stateCode",
DROP COLUMN "stopCode",
DROP COLUMN "suburbTown",
DROP COLUMN "truckId",
DROP COLUMN "zoneNo",
ADD COLUMN     "actualship" TIMESTAMP(3),
ADD COLUMN     "address1" TEXT,
ADD COLUMN     "address2" TEXT,
ADD COLUMN     "branchplant" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "description1" TEXT,
ADD COLUMN     "invoicedate" TIMESTAMP(3),
ADD COLUMN     "invoicetime" TEXT,
ADD COLUMN     "itemnumber2" TEXT,
ADD COLUMN     "linenum" DOUBLE PRECISION,
ADD COLUMN     "manifestnumber" TEXT,
ADD COLUMN     "ordernumber" TEXT,
ADD COLUMN     "orty" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "routecode" TEXT,
ADD COLUMN     "shiptoname" TEXT,
ADD COLUMN     "volume" DOUBLE PRECISION,
ADD COLUMN     "volumeuom" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "weightuom" TEXT;

-- DropTable
DROP TABLE "public"."Task_DB";

-- CreateTable
CREATE TABLE "public"."task_db" (
    "taskid" SERIAL NOT NULL,
    "invoiceId" TEXT,
    "ordernumber" TEXT,
    "orty" TEXT,
    "linenum" DOUBLE PRECISION,
    "invoicedate" TIMESTAMP(3),
    "invoicetime" TEXT,
    "quantity" DOUBLE PRECISION,
    "itemnumber2" TEXT,
    "description1" TEXT,
    "branchplant" TEXT,
    "shiptoname" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "routecode" TEXT,
    "actualship" TIMESTAMP(3),
    "manifestnumber" TEXT,
    "weightuom" TEXT,
    "weight" DOUBLE PRECISION,
    "volumeuom" TEXT,
    "volume" DOUBLE PRECISION,
    "isassigned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "task_db_pkey" PRIMARY KEY ("taskid")
);

-- CreateIndex
CREATE INDEX "task_db_taskid_idx" ON "public"."task_db"("taskid");

-- CreateIndex
CREATE INDEX "AssignedTask_DB_ordernumber_idx" ON "public"."AssignedTask_DB"("ordernumber");

-- CreateIndex
CREATE INDEX "AssignedTask_DB_assignedTaskId_idx" ON "public"."AssignedTask_DB"("assignedTaskId");
