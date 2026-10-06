CREATE TABLE "fees" (
	"id" text PRIMARY KEY NOT NULL,
	"recovery_id" text NOT NULL,
	"lovelace" bigint NOT NULL,
	"payer_address" text,
	"pay_to" text NOT NULL,
	"tx_hash" text,
	"state" text DEFAULT 'unpaid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "fees_recovery_id_unique" UNIQUE("recovery_id")
);
