-- CreateIndex
CREATE INDEX "AssignedTask_DB_orderNumber_idx" ON "public"."AssignedTask_DB"("orderNumber");

-- CreateIndex
CREATE INDEX "AssignedTask_DB_truckNo_idx" ON "public"."AssignedTask_DB"("truckNo");

-- CreateIndex
CREATE INDEX "Task_DB_taskId_idx" ON "public"."Task_DB"("taskId");
