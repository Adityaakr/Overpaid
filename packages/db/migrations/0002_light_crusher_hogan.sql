ALTER TABLE "evidence" ADD CONSTRAINT "evidence_task_id_unique" UNIQUE("task_id");--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_task_id_unique" UNIQUE("task_id");