CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"step" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"screenshot" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" text PRIMARY KEY NOT NULL,
	"bloc_id" text NOT NULL,
	"provider" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"provider_address" text NOT NULL,
	"provider_vkey" text NOT NULL,
	"signature" text NOT NULL,
	"valid" boolean DEFAULT false NOT NULL,
	"strategy" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocs" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_nft" text,
	"campaign_utxo" text,
	"item" text NOT NULL,
	"item_hash" text,
	"members_limit" integer NOT NULL,
	"min_group_size" integer NOT NULL,
	"bid_deadline" timestamp with time zone,
	"refund_deadline" timestamp with time zone,
	"provider_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"current_price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"manifest_path" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hires" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"specialist_id" text NOT NULL,
	"job_id" text,
	"blockchain_identifier" text,
	"input_hash" text,
	"result_hash" text,
	"escrow_state" text DEFAULT 'quoted' NOT NULL,
	"pay_by" timestamp with time zone,
	"submit_result_by" timestamp with time zone,
	"unlock_at" timestamp with time zone,
	"dispute_unlock_at" timestamp with time zone,
	"tx_lock" text,
	"tx_result" text,
	"tx_collect" text,
	"tx_refund" text,
	"long_timer" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency" (
	"key" text PRIMARY KEY NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"vigil_type" text NOT NULL,
	"merchant" text NOT NULL,
	"value_estimate" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"source_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pledges" (
	"id" text PRIMARY KEY NOT NULL,
	"bloc_id" text NOT NULL,
	"member_label" text NOT NULL,
	"wallet_address" text NOT NULL,
	"utxo_ref" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"max_unit_price" bigint NOT NULL,
	"locked_amount" bigint NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recoveries" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"bloc_id" text NOT NULL,
	"tx_hash" text,
	"pledge_count" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"parsed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"demo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialists" (
	"id" text PRIMARY KEY NOT NULL,
	"masumi_agent_id" text,
	"name" text NOT NULL,
	"capability" text NOT NULL,
	"url" text NOT NULL,
	"fee_lovelace" bigint,
	"fee_asset" text,
	"fee_amount" bigint,
	"first_party" boolean DEFAULT true NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"refunded" integer DEFAULT 0 NOT NULL,
	"disputed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant" text NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cadence" text NOT NULL,
	"next_renewal" text,
	"last_use_signal" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"session_id" text,
	"recipe_id" text NOT NULL,
	"mode" text DEFAULT 'agent' NOT NULL,
	"step" text,
	"failure_reason" text,
	"live_view_url" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"merchant" text NOT NULL,
	"descriptor" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"date" text NOT NULL,
	"order_id" text,
	"kind" text DEFAULT 'charge' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
