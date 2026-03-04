/*
  Warnings:

  - You are about to drop the `task_db` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."task_db";

-- CreateTable
CREATE TABLE "public"."Task_DB" (
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

    CONSTRAINT "Task_DB_pkey" PRIMARY KEY ("taskid")
);

-- CreateIndex
CREATE INDEX "Task_DB_taskid_idx" ON "public"."Task_DB"("taskid");
