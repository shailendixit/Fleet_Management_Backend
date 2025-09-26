-- AlterTable
ALTER TABLE "public"."CompletedTask_DB" ADD COLUMN     "completedTaskId" SERIAL NOT NULL,
ADD CONSTRAINT "CompletedTask_DB_pkey" PRIMARY KEY ("completedTaskId");
