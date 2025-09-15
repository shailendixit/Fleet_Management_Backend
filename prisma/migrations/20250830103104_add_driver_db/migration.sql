-- CreateEnum
CREATE TYPE "public"."Status" AS ENUM ('available', 'unavailable');

-- CreateTable
CREATE TABLE "public"."Truck" (
    "id" SERIAL NOT NULL,
    "truckNo" INTEGER,
    "Cubic (m3)" DOUBLE PRECISION,
    "Drivers Name" TEXT,
    "Truck" TEXT,
    "status" "public"."Status" NOT NULL DEFAULT 'available',

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);
