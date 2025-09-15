/*
  Warnings:

  - You are about to drop the `Truck` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."Truck";

-- CreateTable
CREATE TABLE "public"."Driver_Db" (
    "id" SERIAL NOT NULL,
    "truckNo" INTEGER,
    "Cubic (m3)" DOUBLE PRECISION,
    "Drivers Name" TEXT,
    "Truck" TEXT,
    "status" "public"."Status" NOT NULL DEFAULT 'available',

    CONSTRAINT "Driver_Db_pkey" PRIMARY KEY ("id")
);
