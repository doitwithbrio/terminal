#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect$1 from "effect/Effect";
import * as Layer$1 from "effect/Layer";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import * as Net from "node:net";
import { Array as Array$1, Cache, Cause, Config, Data, DateTime, Deferred, Duration, Effect, Encoding, Equal, Exit, Fiber, FileSystem, Layer, Logger, Metric, Option, Path, Predicate, PubSub, Queue, Random, Ref, References, Result, Schema, SchemaGetter, SchemaIssue, SchemaTransformation, Scope, Semaphore, ServiceMap, Stream, Struct, SynchronizedRef, Tracer, TxQueue, TxRef } from "effect";
import * as Schema$1 from "effect/Schema";
import * as SchemaTransformation$1 from "effect/SchemaTransformation";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as NFS from "node:fs";
import fs, { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import * as readline$1 from "node:readline";
import readline from "node:readline";
import * as OS from "node:os";
import { homedir } from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import Mime from "@effect/platform-node/Mime";
import { cast, dual } from "effect/Function";
import path, { extname, join } from "node:path";
import * as Crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { clamp } from "effect/Number";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import * as Semaphore$1 from "effect/Semaphore";
import * as P from "effect/Predicate";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { EventEmitter } from "node:events";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { parsePatchFiles } from "@pierre/diffs";
import fsPromises from "node:fs/promises";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

//#region ../../packages/shared/src/Net.ts
var NetError = class extends Data.TaggedError("NetError") {};
function isErrnoExceptionWithCode(cause) {
	return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string";
}
const closeServer = (server) => {
	try {
		server.close();
	} catch {}
};
const tryReservePort = (port) => Effect.callback((resume) => {
	const server = Net.createServer();
	let settled = false;
	const settle = (effect) => {
		if (settled) return;
		settled = true;
		resume(effect);
	};
	server.unref();
	server.once("error", (cause) => {
		settle(Effect.fail(new NetError({
			message: "Could not find an available port.",
			cause
		})));
	});
	server.listen(port, () => {
		const address = server.address();
		const resolved = typeof address === "object" && address !== null ? address.port : 0;
		server.close(() => {
			if (resolved > 0) {
				settle(Effect.succeed(resolved));
				return;
			}
			settle(Effect.fail(new NetError({ message: "Could not find an available port." })));
		});
	});
	return Effect.sync(() => {
		closeServer(server);
	});
});
/**
* NetService - Service tag for startup networking helpers.
*/
var NetService = class NetService extends ServiceMap.Service()("@t3tools/shared/Net/NetService") {
	static layer = Layer.sync(NetService, () => {
		/**
		* Returns true when a TCP server can bind to {host, port}.
		* `EADDRNOTAVAIL` is treated as available so IPv6-absent hosts don't fail
		* loopback availability checks.
		*/
		const canListenOnHost = (port, host) => Effect.callback((resume) => {
			const server = Net.createServer();
			let settled = false;
			const settle = (value) => {
				if (settled) return;
				settled = true;
				resume(Effect.succeed(value));
			};
			server.unref();
			server.once("error", (cause) => {
				if (isErrnoExceptionWithCode(cause) && cause.code === "EADDRNOTAVAIL") {
					settle(true);
					return;
				}
				settle(false);
			});
			server.once("listening", () => {
				server.close(() => {
					settle(true);
				});
			});
			server.listen({
				host,
				port
			});
			return Effect.sync(() => {
				closeServer(server);
			});
		});
		/**
		* Reserve an ephemeral loopback port and release it immediately.
		* Returns the reserved port number.
		*/
		const reserveLoopbackPort = (host = "127.0.0.1") => Effect.callback((resume) => {
			const probe = Net.createServer();
			let settled = false;
			const settle = (effect) => {
				if (settled) return;
				settled = true;
				resume(effect);
			};
			probe.once("error", (cause) => {
				settle(Effect.fail(new NetError({
					message: "Failed to reserve loopback port",
					cause
				})));
			});
			probe.listen(0, host, () => {
				const address = probe.address();
				const port = typeof address === "object" && address !== null ? address.port : 0;
				probe.close(() => {
					if (port > 0) {
						settle(Effect.succeed(port));
						return;
					}
					settle(Effect.fail(new NetError({ message: "Failed to reserve loopback port" })));
				});
			});
			return Effect.sync(() => {
				closeServer(probe);
			});
		});
		return {
			canListenOnHost,
			isPortAvailableOnLoopback: (port) => Effect.zipWith(canListenOnHost(port, "127.0.0.1"), canListenOnHost(port, "::1"), (ipv4, ipv6) => ipv4 && ipv6),
			reserveLoopbackPort,
			findAvailablePort: (preferred) => Effect.catch(tryReservePort(preferred), () => tryReservePort(0))
		};
	});
};

//#endregion
//#region ../../packages/contracts/src/baseSchemas.ts
const TrimmedString = Schema.Trim;
const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const IsoDateTime = Schema.String;
/**
* Construct a branded identifier. Enforces non-empty trimmed strings
*/
const makeEntityId = (brand) => TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ThreadId = makeEntityId("ThreadId");
const ProjectId = makeEntityId("ProjectId");
const CommandId = makeEntityId("CommandId");
const EventId = makeEntityId("EventId");
const MessageId = makeEntityId("MessageId");
const TurnId = makeEntityId("TurnId");
const ProviderItemId = makeEntityId("ProviderItemId");
const RuntimeSessionId = makeEntityId("RuntimeSessionId");
const RuntimeItemId = makeEntityId("RuntimeItemId");
const RuntimeRequestId = makeEntityId("RuntimeRequestId");
const RuntimeTaskId = makeEntityId("RuntimeTaskId");
const ApprovalRequestId = makeEntityId("ApprovalRequestId");
const CheckpointRef = makeEntityId("CheckpointRef");

//#endregion
//#region ../../packages/contracts/src/terminal.ts
const DEFAULT_TERMINAL_ID = "default";
const TrimmedNonEmptyStringSchema$2 = TrimmedNonEmptyString;
const TerminalColsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(20)).check(Schema.isLessThanOrEqualTo(400));
const TerminalRowsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(5)).check(Schema.isLessThanOrEqualTo(200));
const TerminalIdSchema = TrimmedNonEmptyStringSchema$2.check(Schema.isMaxLength(128));
const TerminalEnvKeySchema = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)).check(Schema.isMaxLength(128));
const TerminalEnvValueSchema = Schema.String.check(Schema.isMaxLength(8192));
const TerminalEnvSchema = Schema.Record(TerminalEnvKeySchema, TerminalEnvValueSchema).check(Schema.isMaxProperties(128));
const TerminalIdWithDefaultSchema = TerminalIdSchema.pipe(Schema.withDecodingDefault(() => DEFAULT_TERMINAL_ID));
const TerminalThreadInput = Schema.Struct({ threadId: TrimmedNonEmptyStringSchema$2 });
const TerminalSessionInput = Schema.Struct({
	...TerminalThreadInput.fields,
	terminalId: TerminalIdWithDefaultSchema
});
const TerminalOpenInput = Schema.Struct({
	...TerminalSessionInput.fields,
	cwd: TrimmedNonEmptyStringSchema$2,
	worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema$2)),
	cols: Schema.optional(TerminalColsSchema),
	rows: Schema.optional(TerminalRowsSchema),
	env: Schema.optional(TerminalEnvSchema)
});
const TerminalWriteInput = Schema.Struct({
	...TerminalSessionInput.fields,
	data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65536))
});
const TerminalResizeInput = Schema.Struct({
	...TerminalSessionInput.fields,
	cols: TerminalColsSchema,
	rows: TerminalRowsSchema
});
const TerminalClearInput = TerminalSessionInput;
const TerminalRestartInput = Schema.Struct({
	...TerminalSessionInput.fields,
	cwd: TrimmedNonEmptyStringSchema$2,
	worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema$2)),
	cols: TerminalColsSchema,
	rows: TerminalRowsSchema,
	env: Schema.optional(TerminalEnvSchema)
});
const TerminalCloseInput = Schema.Struct({
	...TerminalThreadInput.fields,
	terminalId: Schema.optional(TerminalIdSchema),
	deleteHistory: Schema.optional(Schema.Boolean)
});
const TerminalSessionStatus = Schema.Literals([
	"starting",
	"running",
	"exited",
	"error"
]);
const TerminalSessionSnapshot = Schema.Struct({
	threadId: Schema.String.check(Schema.isNonEmpty()),
	terminalId: Schema.String.check(Schema.isNonEmpty()),
	cwd: Schema.String.check(Schema.isNonEmpty()),
	worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema$2),
	status: TerminalSessionStatus,
	pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
	history: Schema.String,
	exitCode: Schema.NullOr(Schema.Int),
	exitSignal: Schema.NullOr(Schema.Int),
	updatedAt: Schema.String
});
const TerminalEventBaseSchema = Schema.Struct({
	threadId: Schema.String.check(Schema.isNonEmpty()),
	terminalId: Schema.String.check(Schema.isNonEmpty()),
	createdAt: Schema.String
});
const TerminalStartedEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("started"),
	snapshot: TerminalSessionSnapshot
});
const TerminalOutputEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("output"),
	data: Schema.String
});
const TerminalExitedEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("exited"),
	exitCode: Schema.NullOr(Schema.Int),
	exitSignal: Schema.NullOr(Schema.Int)
});
const TerminalErrorEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("error"),
	message: Schema.String.check(Schema.isNonEmpty())
});
const TerminalClearedEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("cleared")
});
const TerminalRestartedEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("restarted"),
	snapshot: TerminalSessionSnapshot
});
const TerminalActivityEvent = Schema.Struct({
	...TerminalEventBaseSchema.fields,
	type: Schema.Literal("activity"),
	hasRunningSubprocess: Schema.Boolean
});
const TerminalEvent = Schema.Union([
	TerminalStartedEvent,
	TerminalOutputEvent,
	TerminalExitedEvent,
	TerminalErrorEvent,
	TerminalClearedEvent,
	TerminalRestartedEvent,
	TerminalActivityEvent
]);
var TerminalCwdError = class extends Schema.TaggedErrorClass()("TerminalCwdError", {
	cwd: Schema.String,
	reason: Schema.Literals([
		"notFound",
		"notDirectory",
		"statFailed"
	]),
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		if (this.reason === "notDirectory") return `Terminal cwd is not a directory: ${this.cwd}`;
		if (this.reason === "notFound") return `Terminal cwd does not exist: ${this.cwd}`;
		const causeMessage = this.cause && typeof this.cause === "object" && "message" in this.cause ? this.cause.message : void 0;
		return causeMessage ? `Failed to access terminal cwd: ${this.cwd} (${causeMessage})` : `Failed to access terminal cwd: ${this.cwd}`;
	}
};
var TerminalHistoryError = class extends Schema.TaggedErrorClass()("TerminalHistoryError", {
	operation: Schema.Literals([
		"read",
		"truncate",
		"migrate"
	]),
	threadId: Schema.String,
	terminalId: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Failed to ${this.operation} terminal history for thread: ${this.threadId}, terminal: ${this.terminalId}`;
	}
};
var TerminalSessionLookupError = class extends Schema.TaggedErrorClass()("TerminalSessionLookupError", {
	threadId: Schema.String,
	terminalId: Schema.String
}) {
	get message() {
		return `Unknown terminal thread: ${this.threadId}, terminal: ${this.terminalId}`;
	}
};
var TerminalNotRunningError = class extends Schema.TaggedErrorClass()("TerminalNotRunningError", {
	threadId: Schema.String,
	terminalId: Schema.String
}) {
	get message() {
		return `Terminal is not running for thread: ${this.threadId}, terminal: ${this.terminalId}`;
	}
};
const TerminalError = Schema.Union([
	TerminalCwdError,
	TerminalHistoryError,
	TerminalSessionLookupError,
	TerminalNotRunningError
]);

//#endregion
//#region ../../packages/contracts/src/model.ts
const CODEX_REASONING_EFFORT_OPTIONS = [
	"xhigh",
	"high",
	"medium",
	"low"
];
const CLAUDE_CODE_EFFORT_OPTIONS = [
	"low",
	"medium",
	"high",
	"max",
	"ultrathink"
];
const CodexModelOptions = Schema.Struct({
	reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
	fastMode: Schema.optional(Schema.Boolean)
});
const ClaudeModelOptions = Schema.Struct({
	thinking: Schema.optional(Schema.Boolean),
	effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
	fastMode: Schema.optional(Schema.Boolean),
	contextWindow: Schema.optional(Schema.String)
});
const ProviderModelOptions = Schema.Struct({
	codex: Schema.optional(CodexModelOptions),
	claudeAgent: Schema.optional(ClaudeModelOptions)
});
const EffortOption = Schema.Struct({
	value: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
	isDefault: Schema.optional(Schema.Boolean)
});
const ContextWindowOption = Schema.Struct({
	value: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
	isDefault: Schema.optional(Schema.Boolean)
});
const ModelCapabilities = Schema.Struct({
	reasoningEffortLevels: Schema.Array(EffortOption),
	supportsFastMode: Schema.Boolean,
	supportsThinkingToggle: Schema.Boolean,
	contextWindowOptions: Schema.Array(ContextWindowOption),
	promptInjectedEffortLevels: Schema.Array(TrimmedNonEmptyString)
});
const DEFAULT_MODEL_BY_PROVIDER = {
	codex: "gpt-5.4",
	claudeAgent: "claude-sonnet-4-6"
};
const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;
/** Per-provider text generation model defaults. */
const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER = {
	codex: "gpt-5.4-mini",
	claudeAgent: "claude-haiku-4-5"
};
const MODEL_SLUG_ALIASES_BY_PROVIDER = {
	codex: {
		"5.4": "gpt-5.4",
		"5.3": "gpt-5.3-codex",
		"gpt-5.3": "gpt-5.3-codex",
		"5.3-spark": "gpt-5.3-codex-spark",
		"gpt-5.3-spark": "gpt-5.3-codex-spark"
	},
	claudeAgent: {
		opus: "claude-opus-4-6",
		"opus-4.6": "claude-opus-4-6",
		"claude-opus-4.6": "claude-opus-4-6",
		"claude-opus-4-6-20251117": "claude-opus-4-6",
		sonnet: "claude-sonnet-4-6",
		"sonnet-4.6": "claude-sonnet-4-6",
		"claude-sonnet-4.6": "claude-sonnet-4-6",
		"claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
		haiku: "claude-haiku-4-5",
		"haiku-4.5": "claude-haiku-4-5",
		"claude-haiku-4.5": "claude-haiku-4-5",
		"claude-haiku-4-5-20251001": "claude-haiku-4-5"
	}
};

//#endregion
//#region ../../packages/contracts/src/orchestration.ts
const ORCHESTRATION_WS_METHODS = {
	getSnapshot: "orchestration.getSnapshot",
	dispatchCommand: "orchestration.dispatchCommand",
	getTurnDiff: "orchestration.getTurnDiff",
	getFullThreadDiff: "orchestration.getFullThreadDiff",
	replayEvents: "orchestration.replayEvents"
};
const ProviderKind = Schema.Literals(["codex", "claudeAgent"]);
const ProviderApprovalPolicy = Schema.Literals([
	"untrusted",
	"on-failure",
	"on-request",
	"never"
]);
const ProviderSandboxMode = Schema.Literals([
	"read-only",
	"workspace-write",
	"danger-full-access"
]);
const CodexModelSelection = Schema.Struct({
	provider: Schema.Literal("codex"),
	model: TrimmedNonEmptyString,
	options: Schema.optionalKey(CodexModelOptions)
});
const ClaudeModelSelection = Schema.Struct({
	provider: Schema.Literal("claudeAgent"),
	model: TrimmedNonEmptyString,
	options: Schema.optionalKey(ClaudeModelOptions)
});
const ModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection]);
const RuntimeMode$1 = Schema.Literals(["approval-required", "full-access"]);
const DEFAULT_RUNTIME_MODE$2 = "full-access";
const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
const DEFAULT_PROVIDER_INTERACTION_MODE = "default";
const ProviderRequestKind = Schema.Literals([
	"command",
	"file-read",
	"file-change"
]);
const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
const ProviderApprovalDecision = Schema.Literals([
	"accept",
	"acceptForSession",
	"decline",
	"cancel"
]);
const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 12e4;
const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14e6;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
const ChatAttachmentId = TrimmedNonEmptyString.check(Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS), Schema.isPattern(/^[a-z0-9_-]+$/i));
const ChatImageAttachment = Schema.Struct({
	type: Schema.Literal("image"),
	id: ChatAttachmentId,
	name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
	mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
	sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES))
});
const UploadChatImageAttachment = Schema.Struct({
	type: Schema.Literal("image"),
	name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
	mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
	sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
	dataUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS))
});
const ChatAttachment = Schema.Union([ChatImageAttachment]);
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
const ProjectScriptIcon = Schema.Literals([
	"play",
	"test",
	"lint",
	"configure",
	"build",
	"debug"
]);
const ProjectScript = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	command: TrimmedNonEmptyString,
	icon: ProjectScriptIcon,
	runOnWorktreeCreate: Schema.Boolean
});
const OrchestrationProject = Schema.Struct({
	id: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	defaultModelSelection: Schema.NullOr(ModelSelection),
	scripts: Schema.Array(ProjectScript),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime)
});
const OrchestrationMessageRole = Schema.Literals([
	"user",
	"assistant",
	"system"
]);
const OrchestrationMessage = Schema.Struct({
	id: MessageId,
	role: OrchestrationMessageRole,
	text: Schema.String,
	attachments: Schema.optional(Schema.Array(ChatAttachment)),
	turnId: Schema.NullOr(TurnId),
	streaming: Schema.Boolean,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const OrchestrationProposedPlanId = TrimmedNonEmptyString;
const OrchestrationProposedPlan = Schema.Struct({
	id: OrchestrationProposedPlanId,
	turnId: Schema.NullOr(TurnId),
	planMarkdown: TrimmedNonEmptyString,
	implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
	implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const SourceProposedPlanReference = Schema.Struct({
	threadId: ThreadId,
	planId: OrchestrationProposedPlanId
});
const OrchestrationSessionStatus = Schema.Literals([
	"idle",
	"starting",
	"running",
	"ready",
	"interrupted",
	"stopped",
	"error"
]);
const OrchestrationSession = Schema.Struct({
	threadId: ThreadId,
	status: OrchestrationSessionStatus,
	providerName: Schema.NullOr(TrimmedNonEmptyString),
	runtimeMode: RuntimeMode$1.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE$2)),
	activeTurnId: Schema.NullOr(TurnId),
	lastError: Schema.NullOr(TrimmedNonEmptyString),
	updatedAt: IsoDateTime
});
const OrchestrationCheckpointFile = Schema.Struct({
	path: TrimmedNonEmptyString,
	kind: TrimmedNonEmptyString,
	additions: NonNegativeInt,
	deletions: NonNegativeInt
});
const OrchestrationCheckpointStatus = Schema.Literals([
	"ready",
	"missing",
	"error"
]);
const OrchestrationCheckpointSummary = Schema.Struct({
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	status: OrchestrationCheckpointStatus,
	files: Schema.Array(OrchestrationCheckpointFile),
	assistantMessageId: Schema.NullOr(MessageId),
	completedAt: IsoDateTime
});
const OrchestrationThreadActivityTone = Schema.Literals([
	"info",
	"tool",
	"approval",
	"error"
]);
const OrchestrationThreadActivity = Schema.Struct({
	id: EventId,
	tone: OrchestrationThreadActivityTone,
	kind: TrimmedNonEmptyString,
	summary: TrimmedNonEmptyString,
	payload: Schema.Unknown,
	turnId: Schema.NullOr(TurnId),
	sequence: Schema.optional(NonNegativeInt),
	createdAt: IsoDateTime
});
const OrchestrationLatestTurnState = Schema.Literals([
	"running",
	"interrupted",
	"completed",
	"error"
]);
const OrchestrationLatestTurn = Schema.Struct({
	turnId: TurnId,
	state: OrchestrationLatestTurnState,
	requestedAt: IsoDateTime,
	startedAt: Schema.NullOr(IsoDateTime),
	completedAt: Schema.NullOr(IsoDateTime),
	assistantMessageId: Schema.NullOr(MessageId),
	sourceProposedPlan: Schema.optional(SourceProposedPlanReference)
});
const OrchestrationThread = Schema.Struct({
	id: ThreadId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	modelSelection: ModelSelection,
	runtimeMode: RuntimeMode$1,
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	branch: Schema.NullOr(TrimmedNonEmptyString),
	worktreePath: Schema.NullOr(TrimmedNonEmptyString),
	latestTurn: Schema.NullOr(OrchestrationLatestTurn),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
	deletedAt: Schema.NullOr(IsoDateTime),
	messages: Schema.Array(OrchestrationMessage),
	proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
	activities: Schema.Array(OrchestrationThreadActivity),
	checkpoints: Schema.Array(OrchestrationCheckpointSummary),
	session: Schema.NullOr(OrchestrationSession)
});
const OrchestrationReadModel = Schema.Struct({
	snapshotSequence: NonNegativeInt,
	projects: Schema.Array(OrchestrationProject),
	threads: Schema.Array(OrchestrationThread),
	updatedAt: IsoDateTime
});
const ProjectCreateCommand = Schema.Struct({
	type: Schema.Literal("project.create"),
	commandId: CommandId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
	createdAt: IsoDateTime
});
const ProjectMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("project.meta.update"),
	commandId: CommandId,
	projectId: ProjectId,
	title: Schema.optional(TrimmedNonEmptyString),
	workspaceRoot: Schema.optional(TrimmedNonEmptyString),
	defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
	scripts: Schema.optional(Schema.Array(ProjectScript))
});
const ProjectDeleteCommand = Schema.Struct({
	type: Schema.Literal("project.delete"),
	commandId: CommandId,
	projectId: ProjectId
});
const ThreadCreateCommand = Schema.Struct({
	type: Schema.Literal("thread.create"),
	commandId: CommandId,
	threadId: ThreadId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	modelSelection: ModelSelection,
	runtimeMode: RuntimeMode$1,
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	branch: Schema.NullOr(TrimmedNonEmptyString),
	worktreePath: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoDateTime
});
const ThreadDeleteCommand = Schema.Struct({
	type: Schema.Literal("thread.delete"),
	commandId: CommandId,
	threadId: ThreadId
});
const ThreadArchiveCommand = Schema.Struct({
	type: Schema.Literal("thread.archive"),
	commandId: CommandId,
	threadId: ThreadId
});
const ThreadUnarchiveCommand = Schema.Struct({
	type: Schema.Literal("thread.unarchive"),
	commandId: CommandId,
	threadId: ThreadId
});
const ThreadMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("thread.meta.update"),
	commandId: CommandId,
	threadId: ThreadId,
	title: Schema.optional(TrimmedNonEmptyString),
	modelSelection: Schema.optional(ModelSelection),
	branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
	worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString))
});
const ThreadRuntimeModeSetCommand = Schema.Struct({
	type: Schema.Literal("thread.runtime-mode.set"),
	commandId: CommandId,
	threadId: ThreadId,
	runtimeMode: RuntimeMode$1,
	createdAt: IsoDateTime
});
const ThreadInteractionModeSetCommand = Schema.Struct({
	type: Schema.Literal("thread.interaction-mode.set"),
	commandId: CommandId,
	threadId: ThreadId,
	interactionMode: ProviderInteractionMode,
	createdAt: IsoDateTime
});
const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	modelSelection: ModelSelection,
	runtimeMode: RuntimeMode$1,
	interactionMode: ProviderInteractionMode,
	branch: Schema.NullOr(TrimmedNonEmptyString),
	worktreePath: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoDateTime
});
const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
	projectCwd: TrimmedNonEmptyString,
	baseBranch: TrimmedNonEmptyString,
	branch: Schema.optional(TrimmedNonEmptyString)
});
const ThreadTurnStartBootstrap = Schema.Struct({
	createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
	prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
	runSetupScript: Schema.optional(Schema.Boolean)
});
const ThreadTurnStartCommand = Schema.Struct({
	type: Schema.Literal("thread.turn.start"),
	commandId: CommandId,
	threadId: ThreadId,
	message: Schema.Struct({
		messageId: MessageId,
		role: Schema.Literal("user"),
		text: Schema.String,
		attachments: Schema.Array(ChatAttachment)
	}),
	modelSelection: Schema.optional(ModelSelection),
	titleSeed: Schema.optional(TrimmedNonEmptyString),
	runtimeMode: RuntimeMode$1.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE$2)),
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	bootstrap: Schema.optional(ThreadTurnStartBootstrap),
	sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
	createdAt: IsoDateTime
});
const ClientThreadTurnStartCommand = Schema.Struct({
	type: Schema.Literal("thread.turn.start"),
	commandId: CommandId,
	threadId: ThreadId,
	message: Schema.Struct({
		messageId: MessageId,
		role: Schema.Literal("user"),
		text: Schema.String,
		attachments: Schema.Array(UploadChatAttachment)
	}),
	modelSelection: Schema.optional(ModelSelection),
	titleSeed: Schema.optional(TrimmedNonEmptyString),
	runtimeMode: RuntimeMode$1,
	interactionMode: ProviderInteractionMode,
	bootstrap: Schema.optional(ThreadTurnStartBootstrap),
	sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
	createdAt: IsoDateTime
});
const ThreadTurnInterruptCommand = Schema.Struct({
	type: Schema.Literal("thread.turn.interrupt"),
	commandId: CommandId,
	threadId: ThreadId,
	turnId: Schema.optional(TurnId),
	createdAt: IsoDateTime
});
const ThreadApprovalRespondCommand = Schema.Struct({
	type: Schema.Literal("thread.approval.respond"),
	commandId: CommandId,
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	decision: ProviderApprovalDecision,
	createdAt: IsoDateTime
});
const ThreadUserInputRespondCommand = Schema.Struct({
	type: Schema.Literal("thread.user-input.respond"),
	commandId: CommandId,
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	answers: ProviderUserInputAnswers,
	createdAt: IsoDateTime
});
const ThreadCheckpointRevertCommand = Schema.Struct({
	type: Schema.Literal("thread.checkpoint.revert"),
	commandId: CommandId,
	threadId: ThreadId,
	turnCount: NonNegativeInt,
	createdAt: IsoDateTime
});
const ThreadSessionStopCommand = Schema.Struct({
	type: Schema.Literal("thread.session.stop"),
	commandId: CommandId,
	threadId: ThreadId,
	createdAt: IsoDateTime
});
const DispatchableClientOrchestrationCommand = Schema.Union([
	ProjectCreateCommand,
	ProjectMetaUpdateCommand,
	ProjectDeleteCommand,
	ThreadCreateCommand,
	ThreadDeleteCommand,
	ThreadArchiveCommand,
	ThreadUnarchiveCommand,
	ThreadMetaUpdateCommand,
	ThreadRuntimeModeSetCommand,
	ThreadInteractionModeSetCommand,
	ThreadTurnStartCommand,
	ThreadTurnInterruptCommand,
	ThreadApprovalRespondCommand,
	ThreadUserInputRespondCommand,
	ThreadCheckpointRevertCommand,
	ThreadSessionStopCommand
]);
const ClientOrchestrationCommand = Schema.Union([
	ProjectCreateCommand,
	ProjectMetaUpdateCommand,
	ProjectDeleteCommand,
	ThreadCreateCommand,
	ThreadDeleteCommand,
	ThreadArchiveCommand,
	ThreadUnarchiveCommand,
	ThreadMetaUpdateCommand,
	ThreadRuntimeModeSetCommand,
	ThreadInteractionModeSetCommand,
	ClientThreadTurnStartCommand,
	ThreadTurnInterruptCommand,
	ThreadApprovalRespondCommand,
	ThreadUserInputRespondCommand,
	ThreadCheckpointRevertCommand,
	ThreadSessionStopCommand
]);
const ThreadSessionSetCommand = Schema.Struct({
	type: Schema.Literal("thread.session.set"),
	commandId: CommandId,
	threadId: ThreadId,
	session: OrchestrationSession,
	createdAt: IsoDateTime
});
const ThreadMessageAssistantDeltaCommand = Schema.Struct({
	type: Schema.Literal("thread.message.assistant.delta"),
	commandId: CommandId,
	threadId: ThreadId,
	messageId: MessageId,
	delta: Schema.String,
	turnId: Schema.optional(TurnId),
	createdAt: IsoDateTime
});
const ThreadMessageAssistantCompleteCommand = Schema.Struct({
	type: Schema.Literal("thread.message.assistant.complete"),
	commandId: CommandId,
	threadId: ThreadId,
	messageId: MessageId,
	turnId: Schema.optional(TurnId),
	createdAt: IsoDateTime
});
const ThreadProposedPlanUpsertCommand = Schema.Struct({
	type: Schema.Literal("thread.proposed-plan.upsert"),
	commandId: CommandId,
	threadId: ThreadId,
	proposedPlan: OrchestrationProposedPlan,
	createdAt: IsoDateTime
});
const ThreadTurnDiffCompleteCommand = Schema.Struct({
	type: Schema.Literal("thread.turn.diff.complete"),
	commandId: CommandId,
	threadId: ThreadId,
	turnId: TurnId,
	completedAt: IsoDateTime,
	checkpointRef: CheckpointRef,
	status: OrchestrationCheckpointStatus,
	files: Schema.Array(OrchestrationCheckpointFile),
	assistantMessageId: Schema.optional(MessageId),
	checkpointTurnCount: NonNegativeInt,
	createdAt: IsoDateTime
});
const ThreadActivityAppendCommand = Schema.Struct({
	type: Schema.Literal("thread.activity.append"),
	commandId: CommandId,
	threadId: ThreadId,
	activity: OrchestrationThreadActivity,
	createdAt: IsoDateTime
});
const ThreadRevertCompleteCommand = Schema.Struct({
	type: Schema.Literal("thread.revert.complete"),
	commandId: CommandId,
	threadId: ThreadId,
	turnCount: NonNegativeInt,
	createdAt: IsoDateTime
});
const InternalOrchestrationCommand = Schema.Union([
	ThreadSessionSetCommand,
	ThreadMessageAssistantDeltaCommand,
	ThreadMessageAssistantCompleteCommand,
	ThreadProposedPlanUpsertCommand,
	ThreadTurnDiffCompleteCommand,
	ThreadActivityAppendCommand,
	ThreadRevertCompleteCommand
]);
const OrchestrationCommand = Schema.Union([DispatchableClientOrchestrationCommand, InternalOrchestrationCommand]);
const OrchestrationEventType = Schema.Literals([
	"project.created",
	"project.meta-updated",
	"project.deleted",
	"thread.created",
	"thread.deleted",
	"thread.archived",
	"thread.unarchived",
	"thread.meta-updated",
	"thread.runtime-mode-set",
	"thread.interaction-mode-set",
	"thread.message-sent",
	"thread.turn-start-requested",
	"thread.turn-interrupt-requested",
	"thread.approval-response-requested",
	"thread.user-input-response-requested",
	"thread.checkpoint-revert-requested",
	"thread.reverted",
	"thread.session-stop-requested",
	"thread.session-set",
	"thread.proposed-plan-upserted",
	"thread.turn-diff-completed",
	"thread.activity-appended"
]);
const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
const OrchestrationActorKind = Schema.Literals([
	"client",
	"server",
	"provider"
]);
const ProjectCreatedPayload$1 = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	defaultModelSelection: Schema.NullOr(ModelSelection),
	scripts: Schema.Array(ProjectScript),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ProjectMetaUpdatedPayload$1 = Schema.Struct({
	projectId: ProjectId,
	title: Schema.optional(TrimmedNonEmptyString),
	workspaceRoot: Schema.optional(TrimmedNonEmptyString),
	defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
	scripts: Schema.optional(Schema.Array(ProjectScript)),
	updatedAt: IsoDateTime
});
const ProjectDeletedPayload$1 = Schema.Struct({
	projectId: ProjectId,
	deletedAt: IsoDateTime
});
const ThreadCreatedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	modelSelection: ModelSelection,
	runtimeMode: RuntimeMode$1.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE$2)),
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	branch: Schema.NullOr(TrimmedNonEmptyString),
	worktreePath: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ThreadDeletedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	deletedAt: IsoDateTime
});
const ThreadArchivedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	archivedAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ThreadUnarchivedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	updatedAt: IsoDateTime
});
const ThreadMetaUpdatedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	title: Schema.optional(TrimmedNonEmptyString),
	modelSelection: Schema.optional(ModelSelection),
	branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
	worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
	updatedAt: IsoDateTime
});
const ThreadRuntimeModeSetPayload$1 = Schema.Struct({
	threadId: ThreadId,
	runtimeMode: RuntimeMode$1,
	updatedAt: IsoDateTime
});
const ThreadInteractionModeSetPayload$1 = Schema.Struct({
	threadId: ThreadId,
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	updatedAt: IsoDateTime
});
const ThreadMessageSentPayload = Schema.Struct({
	threadId: ThreadId,
	messageId: MessageId,
	role: OrchestrationMessageRole,
	text: Schema.String,
	attachments: Schema.optional(Schema.Array(ChatAttachment)),
	turnId: Schema.NullOr(TurnId),
	streaming: Schema.Boolean,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ThreadTurnStartRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	messageId: MessageId,
	modelSelection: Schema.optional(ModelSelection),
	titleSeed: Schema.optional(TrimmedNonEmptyString),
	runtimeMode: RuntimeMode$1.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE$2)),
	interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)),
	sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
	createdAt: IsoDateTime
});
const ThreadTurnInterruptRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	turnId: Schema.optional(TurnId),
	createdAt: IsoDateTime
});
const ThreadApprovalResponseRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	decision: ProviderApprovalDecision,
	createdAt: IsoDateTime
});
const ThreadUserInputResponseRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	answers: ProviderUserInputAnswers,
	createdAt: IsoDateTime
});
const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	turnCount: NonNegativeInt,
	createdAt: IsoDateTime
});
const ThreadRevertedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	turnCount: NonNegativeInt
});
const ThreadSessionStopRequestedPayload = Schema.Struct({
	threadId: ThreadId,
	createdAt: IsoDateTime
});
const ThreadSessionSetPayload$1 = Schema.Struct({
	threadId: ThreadId,
	session: OrchestrationSession
});
const ThreadProposedPlanUpsertedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	proposedPlan: OrchestrationProposedPlan
});
const ThreadTurnDiffCompletedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	status: OrchestrationCheckpointStatus,
	files: Schema.Array(OrchestrationCheckpointFile),
	assistantMessageId: Schema.NullOr(MessageId),
	completedAt: IsoDateTime
});
const ThreadActivityAppendedPayload$1 = Schema.Struct({
	threadId: ThreadId,
	activity: OrchestrationThreadActivity
});
const OrchestrationEventMetadata = Schema.Struct({
	providerTurnId: Schema.optional(TrimmedNonEmptyString),
	providerItemId: Schema.optional(ProviderItemId),
	adapterKey: Schema.optional(TrimmedNonEmptyString),
	requestId: Schema.optional(ApprovalRequestId),
	ingestedAt: Schema.optional(IsoDateTime)
});
const EventBaseFields = {
	sequence: NonNegativeInt,
	eventId: EventId,
	aggregateKind: OrchestrationAggregateKind,
	aggregateId: Schema.Union([ProjectId, ThreadId]),
	occurredAt: IsoDateTime,
	commandId: Schema.NullOr(CommandId),
	causationEventId: Schema.NullOr(EventId),
	correlationId: Schema.NullOr(CommandId),
	metadata: OrchestrationEventMetadata
};
const OrchestrationEvent = Schema.Union([
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("project.created"),
		payload: ProjectCreatedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("project.meta-updated"),
		payload: ProjectMetaUpdatedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("project.deleted"),
		payload: ProjectDeletedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.created"),
		payload: ThreadCreatedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.deleted"),
		payload: ThreadDeletedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.archived"),
		payload: ThreadArchivedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.unarchived"),
		payload: ThreadUnarchivedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.meta-updated"),
		payload: ThreadMetaUpdatedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.runtime-mode-set"),
		payload: ThreadRuntimeModeSetPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.interaction-mode-set"),
		payload: ThreadInteractionModeSetPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.message-sent"),
		payload: ThreadMessageSentPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.turn-start-requested"),
		payload: ThreadTurnStartRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.turn-interrupt-requested"),
		payload: ThreadTurnInterruptRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.approval-response-requested"),
		payload: ThreadApprovalResponseRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.user-input-response-requested"),
		payload: ThreadUserInputResponseRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.checkpoint-revert-requested"),
		payload: ThreadCheckpointRevertRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.reverted"),
		payload: ThreadRevertedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.session-stop-requested"),
		payload: ThreadSessionStopRequestedPayload
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.session-set"),
		payload: ThreadSessionSetPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.proposed-plan-upserted"),
		payload: ThreadProposedPlanUpsertedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.turn-diff-completed"),
		payload: ThreadTurnDiffCompletedPayload$1
	}),
	Schema.Struct({
		...EventBaseFields,
		type: Schema.Literal("thread.activity-appended"),
		payload: ThreadActivityAppendedPayload$1
	})
]);
const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
const TurnCountRange = Schema.Struct({
	fromTurnCount: NonNegativeInt,
	toTurnCount: NonNegativeInt
}).check(Schema.makeFilter((input) => input.fromTurnCount <= input.toTurnCount || new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), { message: "fromTurnCount must be less than or equal to toTurnCount" }), { identifier: "OrchestrationTurnDiffRange" }));
const ThreadTurnDiff = TurnCountRange.mapFields(Struct.assign({
	threadId: ThreadId,
	diff: Schema.String
}), { unsafePreserveChecks: true });
const ProviderSessionRuntimeStatus = Schema.Literals([
	"starting",
	"running",
	"stopped",
	"error"
]);
Schema.Literals([
	"running",
	"completed",
	"interrupted",
	"error"
]);
Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	status: OrchestrationCheckpointStatus,
	files: Schema.Array(OrchestrationCheckpointFile),
	assistantMessageId: Schema.NullOr(MessageId),
	completedAt: IsoDateTime
});
const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
const DispatchResult = Schema.Struct({ sequence: NonNegativeInt });
const OrchestrationGetSnapshotInput = Schema.Struct({});
const OrchestrationGetSnapshotResult = OrchestrationReadModel;
const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(Struct.assign({ threadId: ThreadId }), { unsafePreserveChecks: true });
const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
const OrchestrationGetFullThreadDiffInput = Schema.Struct({
	threadId: ThreadId,
	toTurnCount: NonNegativeInt
});
const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
const OrchestrationReplayEventsInput = Schema.Struct({ fromSequenceExclusive: NonNegativeInt });
const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
const OrchestrationRpcSchemas = {
	getSnapshot: {
		input: OrchestrationGetSnapshotInput,
		output: OrchestrationGetSnapshotResult
	},
	dispatchCommand: {
		input: ClientOrchestrationCommand,
		output: DispatchResult
	},
	getTurnDiff: {
		input: OrchestrationGetTurnDiffInput,
		output: OrchestrationGetTurnDiffResult
	},
	getFullThreadDiff: {
		input: OrchestrationGetFullThreadDiffInput,
		output: OrchestrationGetFullThreadDiffResult
	},
	replayEvents: {
		input: OrchestrationReplayEventsInput,
		output: OrchestrationReplayEventsResult
	}
};
var OrchestrationGetSnapshotError = class extends Schema.TaggedErrorClass()("OrchestrationGetSnapshotError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};
var OrchestrationDispatchCommandError = class extends Schema.TaggedErrorClass()("OrchestrationDispatchCommandError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};
var OrchestrationGetTurnDiffError = class extends Schema.TaggedErrorClass()("OrchestrationGetTurnDiffError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};
var OrchestrationGetFullThreadDiffError = class extends Schema.TaggedErrorClass()("OrchestrationGetFullThreadDiffError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};
var OrchestrationReplayEventsError = class extends Schema.TaggedErrorClass()("OrchestrationReplayEventsError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};

//#endregion
//#region ../../packages/contracts/src/provider.ts
const ProviderSessionStatus = Schema.Literals([
	"connecting",
	"ready",
	"running",
	"error",
	"closed"
]);
const ProviderSession = Schema.Struct({
	provider: ProviderKind,
	status: ProviderSessionStatus,
	runtimeMode: RuntimeMode$1,
	cwd: Schema.optional(TrimmedNonEmptyString),
	model: Schema.optional(TrimmedNonEmptyString),
	threadId: ThreadId,
	resumeCursor: Schema.optional(Schema.Unknown),
	activeTurnId: Schema.optional(TurnId),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	lastError: Schema.optional(TrimmedNonEmptyString)
});
const ProviderSessionStartInput = Schema.Struct({
	threadId: ThreadId,
	provider: Schema.optional(ProviderKind),
	cwd: Schema.optional(TrimmedNonEmptyString),
	modelSelection: Schema.optional(ModelSelection),
	resumeCursor: Schema.optional(Schema.Unknown),
	approvalPolicy: Schema.optional(ProviderApprovalPolicy),
	sandboxMode: Schema.optional(ProviderSandboxMode),
	runtimeMode: RuntimeMode$1
});
const ProviderSendTurnInput = Schema.Struct({
	threadId: ThreadId,
	input: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS))),
	attachments: Schema.optional(Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS))),
	modelSelection: Schema.optional(ModelSelection),
	interactionMode: Schema.optional(ProviderInteractionMode)
});
const ProviderTurnStartResult = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	resumeCursor: Schema.optional(Schema.Unknown)
});
const ProviderInterruptTurnInput = Schema.Struct({
	threadId: ThreadId,
	turnId: Schema.optional(TurnId)
});
const ProviderStopSessionInput = Schema.Struct({ threadId: ThreadId });
const ProviderRespondToRequestInput = Schema.Struct({
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	decision: ProviderApprovalDecision
});
const ProviderRespondToUserInputInput = Schema.Struct({
	threadId: ThreadId,
	requestId: ApprovalRequestId,
	answers: ProviderUserInputAnswers
});
const ProviderEventKind = Schema.Literals([
	"session",
	"notification",
	"request",
	"error"
]);
const ProviderEvent = Schema.Struct({
	id: EventId,
	kind: ProviderEventKind,
	provider: ProviderKind,
	threadId: ThreadId,
	createdAt: IsoDateTime,
	method: TrimmedNonEmptyString,
	message: Schema.optional(TrimmedNonEmptyString),
	turnId: Schema.optional(TurnId),
	itemId: Schema.optional(ProviderItemId),
	requestId: Schema.optional(ApprovalRequestId),
	requestKind: Schema.optional(ProviderRequestKind),
	textDelta: Schema.optional(Schema.String),
	payload: Schema.optional(Schema.Unknown)
});

//#endregion
//#region ../../packages/contracts/src/providerRuntime.ts
const TrimmedNonEmptyStringSchema$1 = TrimmedNonEmptyString;
const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const RuntimeEventRawSource = Schema.Literals([
	"codex.app-server.notification",
	"codex.app-server.request",
	"codex.eventmsg",
	"claude.sdk.message",
	"claude.sdk.permission",
	"codex.sdk.thread-event"
]);
const RuntimeEventRaw = Schema.Struct({
	source: RuntimeEventRawSource,
	method: Schema.optional(TrimmedNonEmptyStringSchema$1),
	messageType: Schema.optional(TrimmedNonEmptyStringSchema$1),
	payload: Schema.Unknown
});
const ProviderRequestId = TrimmedNonEmptyStringSchema$1;
const ProviderRefs = Schema.Struct({
	providerTurnId: Schema.optional(TrimmedNonEmptyStringSchema$1),
	providerItemId: Schema.optional(ProviderItemId),
	providerRequestId: Schema.optional(ProviderRequestId)
});
const RuntimeSessionState = Schema.Literals([
	"starting",
	"ready",
	"running",
	"waiting",
	"stopped",
	"error"
]);
const RuntimeThreadState = Schema.Literals([
	"active",
	"idle",
	"archived",
	"closed",
	"compacted",
	"error"
]);
const RuntimeTurnState = Schema.Literals([
	"completed",
	"failed",
	"interrupted",
	"cancelled"
]);
const RuntimePlanStepStatus = Schema.Literals([
	"pending",
	"inProgress",
	"completed"
]);
const RuntimeItemStatus = Schema.Literals([
	"inProgress",
	"completed",
	"failed",
	"declined"
]);
const RuntimeContentStreamKind = Schema.Literals([
	"assistant_text",
	"reasoning_text",
	"reasoning_summary_text",
	"plan_text",
	"command_output",
	"file_change_output",
	"unknown"
]);
const RuntimeSessionExitKind = Schema.Literals(["graceful", "error"]);
const RuntimeErrorClass = Schema.Literals([
	"provider_error",
	"transport_error",
	"permission_error",
	"validation_error",
	"unknown"
]);
const TOOL_LIFECYCLE_ITEM_TYPES = [
	"command_execution",
	"file_change",
	"mcp_tool_call",
	"dynamic_tool_call",
	"collab_agent_tool_call",
	"web_search",
	"image_view"
];
const ToolLifecycleItemType = Schema.Literals(TOOL_LIFECYCLE_ITEM_TYPES);
function isToolLifecycleItemType(value) {
	return TOOL_LIFECYCLE_ITEM_TYPES.includes(value);
}
const CanonicalItemType = Schema.Literals([
	"user_message",
	"assistant_message",
	"reasoning",
	"plan",
	...TOOL_LIFECYCLE_ITEM_TYPES,
	"review_entered",
	"review_exited",
	"context_compaction",
	"error",
	"unknown"
]);
const CanonicalRequestType = Schema.Literals([
	"command_execution_approval",
	"file_read_approval",
	"file_change_approval",
	"apply_patch_approval",
	"exec_command_approval",
	"tool_user_input",
	"dynamic_tool_call",
	"auth_tokens_refresh",
	"unknown"
]);
Schema.Literals([
	"session.started",
	"session.configured",
	"session.state.changed",
	"session.exited",
	"thread.started",
	"thread.state.changed",
	"thread.metadata.updated",
	"thread.token-usage.updated",
	"thread.realtime.started",
	"thread.realtime.item-added",
	"thread.realtime.audio.delta",
	"thread.realtime.error",
	"thread.realtime.closed",
	"turn.started",
	"turn.completed",
	"turn.aborted",
	"turn.plan.updated",
	"turn.proposed.delta",
	"turn.proposed.completed",
	"turn.diff.updated",
	"item.started",
	"item.updated",
	"item.completed",
	"content.delta",
	"request.opened",
	"request.resolved",
	"user-input.requested",
	"user-input.resolved",
	"task.started",
	"task.progress",
	"task.completed",
	"hook.started",
	"hook.progress",
	"hook.completed",
	"tool.progress",
	"tool.summary",
	"auth.status",
	"account.updated",
	"account.rate-limits.updated",
	"mcp.status.updated",
	"mcp.oauth.completed",
	"model.rerouted",
	"config.warning",
	"deprecation.notice",
	"files.persisted",
	"runtime.warning",
	"runtime.error"
]);
const SessionStartedType = Schema.Literal("session.started");
const SessionConfiguredType = Schema.Literal("session.configured");
const SessionStateChangedType = Schema.Literal("session.state.changed");
const SessionExitedType = Schema.Literal("session.exited");
const ThreadStartedType = Schema.Literal("thread.started");
const ThreadStateChangedType = Schema.Literal("thread.state.changed");
const ThreadMetadataUpdatedType = Schema.Literal("thread.metadata.updated");
const ThreadTokenUsageUpdatedType = Schema.Literal("thread.token-usage.updated");
const ThreadRealtimeStartedType = Schema.Literal("thread.realtime.started");
const ThreadRealtimeItemAddedType = Schema.Literal("thread.realtime.item-added");
const ThreadRealtimeAudioDeltaType = Schema.Literal("thread.realtime.audio.delta");
const ThreadRealtimeErrorType = Schema.Literal("thread.realtime.error");
const ThreadRealtimeClosedType = Schema.Literal("thread.realtime.closed");
const TurnStartedType = Schema.Literal("turn.started");
const TurnCompletedType = Schema.Literal("turn.completed");
const TurnAbortedType = Schema.Literal("turn.aborted");
const TurnPlanUpdatedType = Schema.Literal("turn.plan.updated");
const TurnProposedDeltaType = Schema.Literal("turn.proposed.delta");
const TurnProposedCompletedType = Schema.Literal("turn.proposed.completed");
const TurnDiffUpdatedType = Schema.Literal("turn.diff.updated");
const ItemStartedType = Schema.Literal("item.started");
const ItemUpdatedType = Schema.Literal("item.updated");
const ItemCompletedType = Schema.Literal("item.completed");
const ContentDeltaType = Schema.Literal("content.delta");
const RequestOpenedType = Schema.Literal("request.opened");
const RequestResolvedType = Schema.Literal("request.resolved");
const UserInputRequestedType = Schema.Literal("user-input.requested");
const UserInputResolvedType = Schema.Literal("user-input.resolved");
const TaskStartedType = Schema.Literal("task.started");
const TaskProgressType = Schema.Literal("task.progress");
const TaskCompletedType = Schema.Literal("task.completed");
const HookStartedType = Schema.Literal("hook.started");
const HookProgressType = Schema.Literal("hook.progress");
const HookCompletedType = Schema.Literal("hook.completed");
const ToolProgressType = Schema.Literal("tool.progress");
const ToolSummaryType = Schema.Literal("tool.summary");
const AuthStatusType = Schema.Literal("auth.status");
const AccountUpdatedType = Schema.Literal("account.updated");
const AccountRateLimitsUpdatedType = Schema.Literal("account.rate-limits.updated");
const McpStatusUpdatedType = Schema.Literal("mcp.status.updated");
const McpOauthCompletedType = Schema.Literal("mcp.oauth.completed");
const ModelReroutedType = Schema.Literal("model.rerouted");
const ConfigWarningType = Schema.Literal("config.warning");
const DeprecationNoticeType = Schema.Literal("deprecation.notice");
const FilesPersistedType = Schema.Literal("files.persisted");
const RuntimeWarningType = Schema.Literal("runtime.warning");
const RuntimeErrorType = Schema.Literal("runtime.error");
const ProviderRuntimeEventBase = Schema.Struct({
	eventId: EventId,
	provider: ProviderKind,
	threadId: ThreadId,
	createdAt: IsoDateTime,
	turnId: Schema.optional(TurnId),
	itemId: Schema.optional(RuntimeItemId),
	requestId: Schema.optional(RuntimeRequestId),
	providerRefs: Schema.optional(ProviderRefs),
	raw: Schema.optional(RuntimeEventRaw)
});
const SessionStartedPayload = Schema.Struct({
	message: Schema.optional(TrimmedNonEmptyStringSchema$1),
	resume: Schema.optional(Schema.Unknown)
});
const SessionConfiguredPayload = Schema.Struct({ config: UnknownRecordSchema });
const SessionStateChangedPayload = Schema.Struct({
	state: RuntimeSessionState,
	reason: Schema.optional(TrimmedNonEmptyStringSchema$1),
	detail: Schema.optional(Schema.Unknown)
});
const SessionExitedPayload = Schema.Struct({
	reason: Schema.optional(TrimmedNonEmptyStringSchema$1),
	recoverable: Schema.optional(Schema.Boolean),
	exitKind: Schema.optional(RuntimeSessionExitKind)
});
const ThreadStartedPayload = Schema.Struct({ providerThreadId: Schema.optional(TrimmedNonEmptyStringSchema$1) });
const ThreadStateChangedPayload = Schema.Struct({
	state: RuntimeThreadState,
	detail: Schema.optional(Schema.Unknown)
});
const ThreadMetadataUpdatedPayload = Schema.Struct({
	name: Schema.optional(TrimmedNonEmptyStringSchema$1),
	metadata: Schema.optional(UnknownRecordSchema)
});
const ThreadTokenUsageSnapshot = Schema.Struct({
	usedTokens: NonNegativeInt,
	totalProcessedTokens: Schema.optional(NonNegativeInt),
	maxTokens: Schema.optional(PositiveInt),
	inputTokens: Schema.optional(NonNegativeInt),
	cachedInputTokens: Schema.optional(NonNegativeInt),
	outputTokens: Schema.optional(NonNegativeInt),
	reasoningOutputTokens: Schema.optional(NonNegativeInt),
	lastUsedTokens: Schema.optional(NonNegativeInt),
	lastInputTokens: Schema.optional(NonNegativeInt),
	lastCachedInputTokens: Schema.optional(NonNegativeInt),
	lastOutputTokens: Schema.optional(NonNegativeInt),
	lastReasoningOutputTokens: Schema.optional(NonNegativeInt),
	toolUses: Schema.optional(NonNegativeInt),
	durationMs: Schema.optional(NonNegativeInt),
	compactsAutomatically: Schema.optional(Schema.Boolean)
});
const ThreadTokenUsageUpdatedPayload = Schema.Struct({ usage: ThreadTokenUsageSnapshot });
const ThreadRealtimeStartedPayload = Schema.Struct({ realtimeSessionId: Schema.optional(TrimmedNonEmptyStringSchema$1) });
const ThreadRealtimeItemAddedPayload = Schema.Struct({ item: Schema.Unknown });
const ThreadRealtimeAudioDeltaPayload = Schema.Struct({ audio: Schema.Unknown });
const ThreadRealtimeErrorPayload = Schema.Struct({ message: TrimmedNonEmptyStringSchema$1 });
const ThreadRealtimeClosedPayload = Schema.Struct({ reason: Schema.optional(TrimmedNonEmptyStringSchema$1) });
const TurnStartedPayload = Schema.Struct({
	model: Schema.optional(TrimmedNonEmptyStringSchema$1),
	effort: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const TurnCompletedPayload = Schema.Struct({
	state: RuntimeTurnState,
	stopReason: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema$1)),
	usage: Schema.optional(Schema.Unknown),
	modelUsage: Schema.optional(UnknownRecordSchema),
	totalCostUsd: Schema.optional(Schema.Number),
	errorMessage: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const TurnAbortedPayload = Schema.Struct({ reason: TrimmedNonEmptyStringSchema$1 });
const RuntimePlanStep = Schema.Struct({
	step: TrimmedNonEmptyStringSchema$1,
	status: RuntimePlanStepStatus
});
const TurnPlanUpdatedPayload = Schema.Struct({
	explanation: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema$1)),
	plan: Schema.Array(RuntimePlanStep)
});
const TurnProposedDeltaPayload = Schema.Struct({ delta: Schema.String });
const TurnProposedCompletedPayload = Schema.Struct({ planMarkdown: TrimmedNonEmptyStringSchema$1 });
const TurnDiffUpdatedPayload = Schema.Struct({ unifiedDiff: Schema.String });
const ItemLifecyclePayload = Schema.Struct({
	itemType: CanonicalItemType,
	status: Schema.optional(RuntimeItemStatus),
	title: Schema.optional(TrimmedNonEmptyStringSchema$1),
	detail: Schema.optional(TrimmedNonEmptyStringSchema$1),
	data: Schema.optional(Schema.Unknown)
});
const ContentDeltaPayload = Schema.Struct({
	streamKind: RuntimeContentStreamKind,
	delta: Schema.String,
	contentIndex: Schema.optional(Schema.Int),
	summaryIndex: Schema.optional(Schema.Int)
});
const RequestOpenedPayload = Schema.Struct({
	requestType: CanonicalRequestType,
	detail: Schema.optional(TrimmedNonEmptyStringSchema$1),
	args: Schema.optional(Schema.Unknown)
});
const RequestResolvedPayload = Schema.Struct({
	requestType: CanonicalRequestType,
	decision: Schema.optional(TrimmedNonEmptyStringSchema$1),
	resolution: Schema.optional(Schema.Unknown)
});
const UserInputQuestionOption = Schema.Struct({
	label: TrimmedNonEmptyStringSchema$1,
	description: TrimmedNonEmptyStringSchema$1
});
const UserInputQuestion = Schema.Struct({
	id: TrimmedNonEmptyStringSchema$1,
	header: TrimmedNonEmptyStringSchema$1,
	question: TrimmedNonEmptyStringSchema$1,
	options: Schema.Array(UserInputQuestionOption),
	multiSelect: Schema.optional(Schema.Boolean).pipe(Schema.withConstructorDefault(() => Option.some(false)))
});
const UserInputRequestedPayload = Schema.Struct({ questions: Schema.Array(UserInputQuestion) });
const UserInputResolvedPayload = Schema.Struct({ answers: UnknownRecordSchema });
const TaskStartedPayload = Schema.Struct({
	taskId: RuntimeTaskId,
	description: Schema.optional(TrimmedNonEmptyStringSchema$1),
	taskType: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const TaskProgressPayload = Schema.Struct({
	taskId: RuntimeTaskId,
	description: TrimmedNonEmptyStringSchema$1,
	summary: Schema.optional(TrimmedNonEmptyStringSchema$1),
	usage: Schema.optional(Schema.Unknown),
	lastToolName: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const TaskCompletedPayload = Schema.Struct({
	taskId: RuntimeTaskId,
	status: Schema.Literals([
		"completed",
		"failed",
		"stopped"
	]),
	summary: Schema.optional(TrimmedNonEmptyStringSchema$1),
	usage: Schema.optional(Schema.Unknown)
});
const HookStartedPayload = Schema.Struct({
	hookId: TrimmedNonEmptyStringSchema$1,
	hookName: TrimmedNonEmptyStringSchema$1,
	hookEvent: TrimmedNonEmptyStringSchema$1
});
const HookProgressPayload = Schema.Struct({
	hookId: TrimmedNonEmptyStringSchema$1,
	output: Schema.optional(Schema.String),
	stdout: Schema.optional(Schema.String),
	stderr: Schema.optional(Schema.String)
});
const HookCompletedPayload = Schema.Struct({
	hookId: TrimmedNonEmptyStringSchema$1,
	outcome: Schema.Literals([
		"success",
		"error",
		"cancelled"
	]),
	output: Schema.optional(Schema.String),
	stdout: Schema.optional(Schema.String),
	stderr: Schema.optional(Schema.String),
	exitCode: Schema.optional(Schema.Int)
});
const ToolProgressPayload = Schema.Struct({
	toolUseId: Schema.optional(TrimmedNonEmptyStringSchema$1),
	toolName: Schema.optional(TrimmedNonEmptyStringSchema$1),
	summary: Schema.optional(TrimmedNonEmptyStringSchema$1),
	elapsedSeconds: Schema.optional(Schema.Number)
});
const ToolSummaryPayload = Schema.Struct({
	summary: TrimmedNonEmptyStringSchema$1,
	precedingToolUseIds: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema$1))
});
const AuthStatusPayload = Schema.Struct({
	isAuthenticating: Schema.optional(Schema.Boolean),
	output: Schema.optional(Schema.Array(Schema.String)),
	error: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const AccountUpdatedPayload = Schema.Struct({ account: Schema.Unknown });
const AccountRateLimitsUpdatedPayload = Schema.Struct({ rateLimits: Schema.Unknown });
const McpStatusUpdatedPayload = Schema.Struct({ status: Schema.Unknown });
const McpOauthCompletedPayload = Schema.Struct({
	success: Schema.Boolean,
	name: Schema.optional(TrimmedNonEmptyStringSchema$1),
	error: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const ModelReroutedPayload = Schema.Struct({
	fromModel: TrimmedNonEmptyStringSchema$1,
	toModel: TrimmedNonEmptyStringSchema$1,
	reason: TrimmedNonEmptyStringSchema$1
});
const ConfigWarningPayload = Schema.Struct({
	summary: TrimmedNonEmptyStringSchema$1,
	details: Schema.optional(TrimmedNonEmptyStringSchema$1),
	path: Schema.optional(TrimmedNonEmptyStringSchema$1),
	range: Schema.optional(Schema.Unknown)
});
const DeprecationNoticePayload = Schema.Struct({
	summary: TrimmedNonEmptyStringSchema$1,
	details: Schema.optional(TrimmedNonEmptyStringSchema$1)
});
const FilesPersistedPayload = Schema.Struct({
	files: Schema.Array(Schema.Struct({
		filename: TrimmedNonEmptyStringSchema$1,
		fileId: TrimmedNonEmptyStringSchema$1
	})),
	failed: Schema.optional(Schema.Array(Schema.Struct({
		filename: TrimmedNonEmptyStringSchema$1,
		error: TrimmedNonEmptyStringSchema$1
	})))
});
const RuntimeWarningPayload = Schema.Struct({
	message: TrimmedNonEmptyStringSchema$1,
	detail: Schema.optional(Schema.Unknown)
});
const RuntimeErrorPayload = Schema.Struct({
	message: TrimmedNonEmptyStringSchema$1,
	class: Schema.optional(RuntimeErrorClass),
	detail: Schema.optional(Schema.Unknown)
});
const ProviderRuntimeSessionStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: SessionStartedType,
	payload: SessionStartedPayload
});
const ProviderRuntimeSessionConfiguredEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: SessionConfiguredType,
	payload: SessionConfiguredPayload
});
const ProviderRuntimeSessionStateChangedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: SessionStateChangedType,
	payload: SessionStateChangedPayload
});
const ProviderRuntimeSessionExitedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: SessionExitedType,
	payload: SessionExitedPayload
});
const ProviderRuntimeThreadStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadStartedType,
	payload: ThreadStartedPayload
});
const ProviderRuntimeThreadStateChangedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadStateChangedType,
	payload: ThreadStateChangedPayload
});
const ProviderRuntimeThreadMetadataUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadMetadataUpdatedType,
	payload: ThreadMetadataUpdatedPayload
});
const ProviderRuntimeThreadTokenUsageUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadTokenUsageUpdatedType,
	payload: ThreadTokenUsageUpdatedPayload
});
const ProviderRuntimeThreadRealtimeStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadRealtimeStartedType,
	payload: ThreadRealtimeStartedPayload
});
const ProviderRuntimeThreadRealtimeItemAddedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadRealtimeItemAddedType,
	payload: ThreadRealtimeItemAddedPayload
});
const ProviderRuntimeThreadRealtimeAudioDeltaEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadRealtimeAudioDeltaType,
	payload: ThreadRealtimeAudioDeltaPayload
});
const ProviderRuntimeThreadRealtimeErrorEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadRealtimeErrorType,
	payload: ThreadRealtimeErrorPayload
});
const ProviderRuntimeThreadRealtimeClosedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ThreadRealtimeClosedType,
	payload: ThreadRealtimeClosedPayload
});
const ProviderRuntimeTurnStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnStartedType,
	payload: TurnStartedPayload
});
const ProviderRuntimeTurnCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnCompletedType,
	payload: TurnCompletedPayload
});
const ProviderRuntimeTurnAbortedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnAbortedType,
	payload: TurnAbortedPayload
});
const ProviderRuntimeTurnPlanUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnPlanUpdatedType,
	payload: TurnPlanUpdatedPayload
});
const ProviderRuntimeTurnProposedDeltaEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnProposedDeltaType,
	payload: TurnProposedDeltaPayload
});
const ProviderRuntimeTurnProposedCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnProposedCompletedType,
	payload: TurnProposedCompletedPayload
});
const ProviderRuntimeTurnDiffUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TurnDiffUpdatedType,
	payload: TurnDiffUpdatedPayload
});
const ProviderRuntimeItemStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ItemStartedType,
	payload: ItemLifecyclePayload
});
const ProviderRuntimeItemUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ItemUpdatedType,
	payload: ItemLifecyclePayload
});
const ProviderRuntimeItemCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ItemCompletedType,
	payload: ItemLifecyclePayload
});
const ProviderRuntimeContentDeltaEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ContentDeltaType,
	payload: ContentDeltaPayload
});
const ProviderRuntimeRequestOpenedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: RequestOpenedType,
	payload: RequestOpenedPayload
});
const ProviderRuntimeRequestResolvedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: RequestResolvedType,
	payload: RequestResolvedPayload
});
const ProviderRuntimeUserInputRequestedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: UserInputRequestedType,
	payload: UserInputRequestedPayload
});
const ProviderRuntimeUserInputResolvedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: UserInputResolvedType,
	payload: UserInputResolvedPayload
});
const ProviderRuntimeTaskStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TaskStartedType,
	payload: TaskStartedPayload
});
const ProviderRuntimeTaskProgressEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TaskProgressType,
	payload: TaskProgressPayload
});
const ProviderRuntimeTaskCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: TaskCompletedType,
	payload: TaskCompletedPayload
});
const ProviderRuntimeHookStartedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: HookStartedType,
	payload: HookStartedPayload
});
const ProviderRuntimeHookProgressEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: HookProgressType,
	payload: HookProgressPayload
});
const ProviderRuntimeHookCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: HookCompletedType,
	payload: HookCompletedPayload
});
const ProviderRuntimeToolProgressEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ToolProgressType,
	payload: ToolProgressPayload
});
const ProviderRuntimeToolSummaryEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ToolSummaryType,
	payload: ToolSummaryPayload
});
const ProviderRuntimeAuthStatusEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: AuthStatusType,
	payload: AuthStatusPayload
});
const ProviderRuntimeAccountUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: AccountUpdatedType,
	payload: AccountUpdatedPayload
});
const ProviderRuntimeAccountRateLimitsUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: AccountRateLimitsUpdatedType,
	payload: AccountRateLimitsUpdatedPayload
});
const ProviderRuntimeMcpStatusUpdatedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: McpStatusUpdatedType,
	payload: McpStatusUpdatedPayload
});
const ProviderRuntimeMcpOauthCompletedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: McpOauthCompletedType,
	payload: McpOauthCompletedPayload
});
const ProviderRuntimeModelReroutedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ModelReroutedType,
	payload: ModelReroutedPayload
});
const ProviderRuntimeConfigWarningEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: ConfigWarningType,
	payload: ConfigWarningPayload
});
const ProviderRuntimeDeprecationNoticeEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: DeprecationNoticeType,
	payload: DeprecationNoticePayload
});
const ProviderRuntimeFilesPersistedEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: FilesPersistedType,
	payload: FilesPersistedPayload
});
const ProviderRuntimeWarningEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: RuntimeWarningType,
	payload: RuntimeWarningPayload
});
const ProviderRuntimeErrorEvent = Schema.Struct({
	...ProviderRuntimeEventBase.fields,
	type: RuntimeErrorType,
	payload: RuntimeErrorPayload
});
const ProviderRuntimeEventV2 = Schema.Union([
	ProviderRuntimeSessionStartedEvent,
	ProviderRuntimeSessionConfiguredEvent,
	ProviderRuntimeSessionStateChangedEvent,
	ProviderRuntimeSessionExitedEvent,
	ProviderRuntimeThreadStartedEvent,
	ProviderRuntimeThreadStateChangedEvent,
	ProviderRuntimeThreadMetadataUpdatedEvent,
	ProviderRuntimeThreadTokenUsageUpdatedEvent,
	ProviderRuntimeThreadRealtimeStartedEvent,
	ProviderRuntimeThreadRealtimeItemAddedEvent,
	ProviderRuntimeThreadRealtimeAudioDeltaEvent,
	ProviderRuntimeThreadRealtimeErrorEvent,
	ProviderRuntimeThreadRealtimeClosedEvent,
	ProviderRuntimeTurnStartedEvent,
	ProviderRuntimeTurnCompletedEvent,
	ProviderRuntimeTurnAbortedEvent,
	ProviderRuntimeTurnPlanUpdatedEvent,
	ProviderRuntimeTurnProposedDeltaEvent,
	ProviderRuntimeTurnProposedCompletedEvent,
	ProviderRuntimeTurnDiffUpdatedEvent,
	ProviderRuntimeItemStartedEvent,
	ProviderRuntimeItemUpdatedEvent,
	ProviderRuntimeItemCompletedEvent,
	ProviderRuntimeContentDeltaEvent,
	ProviderRuntimeRequestOpenedEvent,
	ProviderRuntimeRequestResolvedEvent,
	ProviderRuntimeUserInputRequestedEvent,
	ProviderRuntimeUserInputResolvedEvent,
	ProviderRuntimeTaskStartedEvent,
	ProviderRuntimeTaskProgressEvent,
	ProviderRuntimeTaskCompletedEvent,
	ProviderRuntimeHookStartedEvent,
	ProviderRuntimeHookProgressEvent,
	ProviderRuntimeHookCompletedEvent,
	ProviderRuntimeToolProgressEvent,
	ProviderRuntimeToolSummaryEvent,
	ProviderRuntimeAuthStatusEvent,
	ProviderRuntimeAccountUpdatedEvent,
	ProviderRuntimeAccountRateLimitsUpdatedEvent,
	ProviderRuntimeMcpStatusUpdatedEvent,
	ProviderRuntimeMcpOauthCompletedEvent,
	ProviderRuntimeModelReroutedEvent,
	ProviderRuntimeConfigWarningEvent,
	ProviderRuntimeDeprecationNoticeEvent,
	ProviderRuntimeFilesPersistedEvent,
	ProviderRuntimeWarningEvent,
	ProviderRuntimeErrorEvent
]);
Schema.Literals([
	"command",
	"file-read",
	"file-change",
	"other"
]);

//#endregion
//#region ../../packages/contracts/src/keybindings.ts
const MAX_KEYBINDING_VALUE_LENGTH = 64;
const MAX_KEYBINDING_WHEN_LENGTH = 256;
const MAX_WHEN_EXPRESSION_DEPTH = 64;
const MAX_SCRIPT_ID_LENGTH = 24;
const MAX_KEYBINDINGS_COUNT = 256;
const THREAD_JUMP_KEYBINDING_COMMANDS = [
	"thread.jump.1",
	"thread.jump.2",
	"thread.jump.3",
	"thread.jump.4",
	"thread.jump.5",
	"thread.jump.6",
	"thread.jump.7",
	"thread.jump.8",
	"thread.jump.9"
];
const THREAD_KEYBINDING_COMMANDS = [
	"thread.previous",
	"thread.next",
	...THREAD_JUMP_KEYBINDING_COMMANDS
];
const STATIC_KEYBINDING_COMMANDS = [
	"terminal.toggle",
	"terminal.split",
	"terminal.new",
	"terminal.close",
	"diff.toggle",
	"chat.new",
	"chat.newLocal",
	"editor.openFavorite",
	...THREAD_KEYBINDING_COMMANDS
];
const SCRIPT_RUN_COMMAND_PATTERN = Schema.TemplateLiteral([
	Schema.Literal("script."),
	Schema.NonEmptyString.check(Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH), Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
	Schema.Literal(".run")
]);
const KeybindingCommand = Schema.Union([Schema.Literals(STATIC_KEYBINDING_COMMANDS), SCRIPT_RUN_COMMAND_PATTERN]);
const KeybindingValue = TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_KEYBINDING_VALUE_LENGTH));
const KeybindingWhen = TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_KEYBINDING_WHEN_LENGTH));
const KeybindingRule = Schema.Struct({
	key: KeybindingValue,
	command: KeybindingCommand,
	when: Schema.optional(KeybindingWhen)
});
const KeybindingsConfig = Schema.Array(KeybindingRule).check(Schema.isMaxLength(MAX_KEYBINDINGS_COUNT));
const KeybindingShortcut = Schema.Struct({
	key: KeybindingValue,
	metaKey: Schema.Boolean,
	ctrlKey: Schema.Boolean,
	shiftKey: Schema.Boolean,
	altKey: Schema.Boolean,
	modKey: Schema.Boolean
});
const KeybindingWhenNodeRef = Schema.suspend(() => KeybindingWhenNode);
const KeybindingWhenNode = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("identifier"),
		name: Schema.NonEmptyString
	}),
	Schema.Struct({
		type: Schema.Literal("not"),
		node: KeybindingWhenNodeRef
	}),
	Schema.Struct({
		type: Schema.Literal("and"),
		left: KeybindingWhenNodeRef,
		right: KeybindingWhenNodeRef
	}),
	Schema.Struct({
		type: Schema.Literal("or"),
		left: KeybindingWhenNodeRef,
		right: KeybindingWhenNodeRef
	})
]);
const ResolvedKeybindingRule = Schema.Struct({
	command: KeybindingCommand,
	shortcut: KeybindingShortcut,
	whenAst: Schema.optional(KeybindingWhenNode)
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
const ResolvedKeybindingsConfig = Schema.Array(ResolvedKeybindingRule).check(Schema.isMaxLength(MAX_KEYBINDINGS_COUNT));
var KeybindingsConfigError = class extends Schema.TaggedErrorClass()("KeybindingsConfigParseError", {
	configPath: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Unable to parse keybindings config at ${this.configPath}: ${this.detail}`;
	}
};

//#endregion
//#region ../../packages/contracts/src/editor.ts
const EditorLaunchStyle = Schema.Literals([
	"direct-path",
	"goto",
	"line-column"
]);
const EDITORS = [
	{
		id: "cursor",
		label: "Cursor",
		command: "cursor",
		launchStyle: "goto"
	},
	{
		id: "trae",
		label: "Trae",
		command: "trae",
		launchStyle: "goto"
	},
	{
		id: "vscode",
		label: "VS Code",
		command: "code",
		launchStyle: "goto"
	},
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		command: "code-insiders",
		launchStyle: "goto"
	},
	{
		id: "vscodium",
		label: "VSCodium",
		command: "codium",
		launchStyle: "goto"
	},
	{
		id: "zed",
		label: "Zed",
		command: "zed",
		launchStyle: "direct-path"
	},
	{
		id: "antigravity",
		label: "Antigravity",
		command: "agy",
		launchStyle: "goto"
	},
	{
		id: "idea",
		label: "IntelliJ IDEA",
		command: "idea",
		launchStyle: "line-column"
	},
	{
		id: "file-manager",
		label: "File Manager",
		command: null,
		launchStyle: "direct-path"
	}
];
const EditorId = Schema.Literals(EDITORS.map((e) => e.id));
const OpenInEditorInput = Schema.Struct({
	cwd: TrimmedNonEmptyString,
	editor: EditorId
});
var OpenError = class extends Schema.TaggedErrorClass()("OpenError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {};

//#endregion
//#region ../../packages/contracts/src/settings.ts
const TimestampFormat = Schema$1.Literals([
	"locale",
	"12-hour",
	"24-hour"
]);
const DEFAULT_TIMESTAMP_FORMAT = "locale";
const SidebarProjectSortOrder = Schema$1.Literals([
	"updated_at",
	"created_at",
	"manual"
]);
const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER = "updated_at";
const SidebarThreadSortOrder = Schema$1.Literals(["updated_at", "created_at"]);
const DEFAULT_SIDEBAR_THREAD_SORT_ORDER = "updated_at";
const ClientSettingsSchema = Schema$1.Struct({
	confirmThreadArchive: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => false)),
	confirmThreadDelete: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => true)),
	diffWordWrap: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => false)),
	sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(Schema$1.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
	sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(Schema$1.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
	timestampFormat: TimestampFormat.pipe(Schema$1.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT))
});
const DEFAULT_CLIENT_SETTINGS = Schema$1.decodeSync(ClientSettingsSchema)({});
const ThreadEnvMode = Schema$1.Literals(["local", "worktree"]);
const makeBinaryPathSetting = (fallback) => TrimmedString.pipe(Schema$1.decodeTo(Schema$1.String, SchemaTransformation$1.transformOrFail({
	decode: (value) => Effect.succeed(value || fallback),
	encode: (value) => Effect.succeed(value)
})), Schema$1.withDecodingDefault(() => fallback));
const CodexSettings = Schema$1.Struct({
	enabled: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => true)),
	binaryPath: makeBinaryPathSetting("codex"),
	homePath: TrimmedString.pipe(Schema$1.withDecodingDefault(() => "")),
	customModels: Schema$1.Array(Schema$1.String).pipe(Schema$1.withDecodingDefault(() => []))
});
const ClaudeSettings = Schema$1.Struct({
	enabled: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => true)),
	binaryPath: makeBinaryPathSetting("claude"),
	customModels: Schema$1.Array(Schema$1.String).pipe(Schema$1.withDecodingDefault(() => []))
});
const ObservabilitySettings = Schema$1.Struct({
	otlpTracesUrl: TrimmedString.pipe(Schema$1.withDecodingDefault(() => "")),
	otlpMetricsUrl: TrimmedString.pipe(Schema$1.withDecodingDefault(() => ""))
});
const ServerSettings = Schema$1.Struct({
	enableAssistantStreaming: Schema$1.Boolean.pipe(Schema$1.withDecodingDefault(() => false)),
	defaultThreadEnvMode: ThreadEnvMode.pipe(Schema$1.withDecodingDefault(() => "local")),
	textGenerationModelSelection: ModelSelection.pipe(Schema$1.withDecodingDefault(() => ({
		provider: "codex",
		model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex
	}))),
	providers: Schema$1.Struct({
		codex: CodexSettings.pipe(Schema$1.withDecodingDefault(() => ({}))),
		claudeAgent: ClaudeSettings.pipe(Schema$1.withDecodingDefault(() => ({})))
	}).pipe(Schema$1.withDecodingDefault(() => ({}))),
	observability: ObservabilitySettings.pipe(Schema$1.withDecodingDefault(() => ({})))
});
const DEFAULT_SERVER_SETTINGS = Schema$1.decodeSync(ServerSettings)({});
var ServerSettingsError = class extends Schema$1.TaggedErrorClass()("ServerSettingsError", {
	settingsPath: Schema$1.String,
	detail: Schema$1.String,
	cause: Schema$1.optional(Schema$1.Defect)
}) {
	get message() {
		return `Server settings error at ${this.settingsPath}: ${this.detail}`;
	}
};
const DEFAULT_UNIFIED_SETTINGS = {
	...DEFAULT_SERVER_SETTINGS,
	...DEFAULT_CLIENT_SETTINGS
};
const CodexModelOptionsPatch = Schema$1.Struct({
	reasoningEffort: Schema$1.optionalKey(CodexModelOptions.fields.reasoningEffort),
	fastMode: Schema$1.optionalKey(CodexModelOptions.fields.fastMode)
});
const ClaudeModelOptionsPatch = Schema$1.Struct({
	thinking: Schema$1.optionalKey(ClaudeModelOptions.fields.thinking),
	effort: Schema$1.optionalKey(ClaudeModelOptions.fields.effort),
	fastMode: Schema$1.optionalKey(ClaudeModelOptions.fields.fastMode),
	contextWindow: Schema$1.optionalKey(ClaudeModelOptions.fields.contextWindow)
});
const ModelSelectionPatch = Schema$1.Union([Schema$1.Struct({
	provider: Schema$1.optionalKey(Schema$1.Literal("codex")),
	model: Schema$1.optionalKey(TrimmedNonEmptyString),
	options: Schema$1.optionalKey(CodexModelOptionsPatch)
}), Schema$1.Struct({
	provider: Schema$1.optionalKey(Schema$1.Literal("claudeAgent")),
	model: Schema$1.optionalKey(TrimmedNonEmptyString),
	options: Schema$1.optionalKey(ClaudeModelOptionsPatch)
})]);
const CodexSettingsPatch = Schema$1.Struct({
	enabled: Schema$1.optionalKey(Schema$1.Boolean),
	binaryPath: Schema$1.optionalKey(Schema$1.String),
	homePath: Schema$1.optionalKey(Schema$1.String),
	customModels: Schema$1.optionalKey(Schema$1.Array(Schema$1.String))
});
const ClaudeSettingsPatch = Schema$1.Struct({
	enabled: Schema$1.optionalKey(Schema$1.Boolean),
	binaryPath: Schema$1.optionalKey(Schema$1.String),
	customModels: Schema$1.optionalKey(Schema$1.Array(Schema$1.String))
});
const ServerSettingsPatch = Schema$1.Struct({
	enableAssistantStreaming: Schema$1.optionalKey(Schema$1.Boolean),
	defaultThreadEnvMode: Schema$1.optionalKey(ThreadEnvMode),
	textGenerationModelSelection: Schema$1.optionalKey(ModelSelectionPatch),
	observability: Schema$1.optionalKey(Schema$1.Struct({
		otlpTracesUrl: Schema$1.optionalKey(Schema$1.String),
		otlpMetricsUrl: Schema$1.optionalKey(Schema$1.String)
	})),
	providers: Schema$1.optionalKey(Schema$1.Struct({
		codex: Schema$1.optionalKey(CodexSettingsPatch),
		claudeAgent: Schema$1.optionalKey(ClaudeSettingsPatch)
	}))
});

//#endregion
//#region ../../packages/contracts/src/server.ts
const KeybindingsMalformedConfigIssue = Schema.Struct({
	kind: Schema.Literal("keybindings.malformed-config"),
	message: TrimmedNonEmptyString
});
const KeybindingsInvalidEntryIssue = Schema.Struct({
	kind: Schema.Literal("keybindings.invalid-entry"),
	message: TrimmedNonEmptyString,
	index: Schema.Number
});
const ServerConfigIssue = Schema.Union([KeybindingsMalformedConfigIssue, KeybindingsInvalidEntryIssue]);
const ServerConfigIssues = Schema.Array(ServerConfigIssue);
const ServerProviderState = Schema.Literals([
	"ready",
	"warning",
	"error",
	"disabled"
]);
const ServerProviderAuthStatus = Schema.Literals([
	"authenticated",
	"unauthenticated",
	"unknown"
]);
const ServerProviderAuth = Schema.Struct({
	status: ServerProviderAuthStatus,
	type: Schema.optional(TrimmedNonEmptyString),
	label: Schema.optional(TrimmedNonEmptyString)
});
const ServerProviderModel = Schema.Struct({
	slug: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	isCustom: Schema.Boolean,
	capabilities: Schema.NullOr(ModelCapabilities)
});
const ServerProvider = Schema.Struct({
	provider: ProviderKind,
	enabled: Schema.Boolean,
	installed: Schema.Boolean,
	version: Schema.NullOr(TrimmedNonEmptyString),
	status: ServerProviderState,
	auth: ServerProviderAuth,
	checkedAt: IsoDateTime,
	message: Schema.optional(TrimmedNonEmptyString),
	models: Schema.Array(ServerProviderModel)
});
const ServerProviders = Schema.Array(ServerProvider);
const ServerObservability = Schema.Struct({
	logsDirectoryPath: TrimmedNonEmptyString,
	localTracingEnabled: Schema.Boolean,
	otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
	otlpTracesEnabled: Schema.Boolean,
	otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
	otlpMetricsEnabled: Schema.Boolean
});
const ServerConfig$1 = Schema.Struct({
	cwd: TrimmedNonEmptyString,
	keybindingsConfigPath: TrimmedNonEmptyString,
	keybindings: ResolvedKeybindingsConfig,
	issues: ServerConfigIssues,
	providers: ServerProviders,
	availableEditors: Schema.Array(EditorId),
	observability: ServerObservability,
	settings: ServerSettings
});
const ServerUpsertKeybindingInput = KeybindingRule;
const ServerUpsertKeybindingResult = Schema.Struct({
	keybindings: ResolvedKeybindingsConfig,
	issues: ServerConfigIssues
});
const ServerConfigUpdatedPayload = Schema.Struct({
	issues: ServerConfigIssues,
	providers: ServerProviders,
	settings: Schema.optional(ServerSettings)
});
const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({ issues: ServerConfigIssues });
const ServerConfigProviderStatusesPayload = Schema.Struct({ providers: ServerProviders });
const ServerConfigSettingsUpdatedPayload = Schema.Struct({ settings: ServerSettings });
const ServerConfigStreamSnapshotEvent = Schema.Struct({
	version: Schema.Literal(1),
	type: Schema.Literal("snapshot"),
	config: ServerConfig$1
});
const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
	version: Schema.Literal(1),
	type: Schema.Literal("keybindingsUpdated"),
	payload: ServerConfigKeybindingsUpdatedPayload
});
const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
	version: Schema.Literal(1),
	type: Schema.Literal("providerStatuses"),
	payload: ServerConfigProviderStatusesPayload
});
const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
	version: Schema.Literal(1),
	type: Schema.Literal("settingsUpdated"),
	payload: ServerConfigSettingsUpdatedPayload
});
const ServerConfigStreamEvent = Schema.Union([
	ServerConfigStreamSnapshotEvent,
	ServerConfigStreamKeybindingsUpdatedEvent,
	ServerConfigStreamProviderStatusesEvent,
	ServerConfigStreamSettingsUpdatedEvent
]);
const ServerLifecycleReadyPayload = Schema.Struct({ at: IsoDateTime });
const ServerLifecycleWelcomePayload = Schema.Struct({
	cwd: TrimmedNonEmptyString,
	projectName: TrimmedNonEmptyString,
	bootstrapProjectId: Schema.optional(ProjectId),
	bootstrapThreadId: Schema.optional(ThreadId)
});
const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
	version: Schema.Literal(1),
	sequence: NonNegativeInt,
	type: Schema.Literal("welcome"),
	payload: ServerLifecycleWelcomePayload
});
const ServerLifecycleStreamReadyEvent = Schema.Struct({
	version: Schema.Literal(1),
	sequence: NonNegativeInt,
	type: Schema.Literal("ready"),
	payload: ServerLifecycleReadyPayload
});
const ServerLifecycleStreamEvent = Schema.Union([ServerLifecycleStreamWelcomeEvent, ServerLifecycleStreamReadyEvent]);
const ServerProviderUpdatedPayload = Schema.Struct({ providers: ServerProviders });

//#endregion
//#region ../../packages/contracts/src/git.ts
const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;
const GIT_LIST_BRANCHES_MAX_LIMIT = 200;
const GitStackedAction = Schema.Literals([
	"commit",
	"push",
	"create_pr",
	"commit_push",
	"commit_push_pr"
]);
const GitActionProgressPhase = Schema.Literals([
	"branch",
	"commit",
	"push",
	"pr"
]);
const GitActionProgressKind = Schema.Literals([
	"action_started",
	"phase_started",
	"hook_started",
	"hook_output",
	"hook_finished",
	"action_finished",
	"action_failed"
]);
const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
const GitCommitStepStatus = Schema.Literals([
	"created",
	"skipped_no_changes",
	"skipped_not_requested"
]);
const GitPushStepStatus = Schema.Literals([
	"pushed",
	"skipped_not_requested",
	"skipped_up_to_date"
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals([
	"created",
	"opened_existing",
	"skipped_not_requested"
]);
const GitStatusPrState = Schema.Literals([
	"open",
	"closed",
	"merged"
]);
const GitPullRequestReference = TrimmedNonEmptyStringSchema;
const GitPullRequestState = Schema.Literals([
	"open",
	"closed",
	"merged"
]);
const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
const GitRunStackedActionToastRunAction = Schema.Struct({ kind: GitStackedAction });
const GitRunStackedActionToastCta = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("none") }),
	Schema.Struct({
		kind: Schema.Literal("open_pr"),
		label: TrimmedNonEmptyStringSchema,
		url: Schema.String
	}),
	Schema.Struct({
		kind: Schema.Literal("run_action"),
		label: TrimmedNonEmptyStringSchema,
		action: GitRunStackedActionToastRunAction
	})
]);
const GitRunStackedActionToast = Schema.Struct({
	title: TrimmedNonEmptyStringSchema,
	description: Schema.optional(TrimmedNonEmptyStringSchema),
	cta: GitRunStackedActionToastCta
});
const GitBranch = Schema.Struct({
	name: TrimmedNonEmptyStringSchema,
	isRemote: Schema.optional(Schema.Boolean),
	remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
	current: Schema.Boolean,
	isDefault: Schema.Boolean,
	worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr)
});
const GitWorktree = Schema.Struct({
	path: TrimmedNonEmptyStringSchema,
	branch: TrimmedNonEmptyStringSchema
});
const GitResolvedPullRequest = Schema.Struct({
	number: PositiveInt,
	title: TrimmedNonEmptyStringSchema,
	url: Schema.String,
	baseBranch: TrimmedNonEmptyStringSchema,
	headBranch: TrimmedNonEmptyStringSchema,
	state: GitPullRequestState
});
const GitStatusInput = Schema.Struct({ cwd: TrimmedNonEmptyStringSchema });
const GitPullInput = Schema.Struct({ cwd: TrimmedNonEmptyStringSchema });
const GitRunStackedActionInput = Schema.Struct({
	actionId: TrimmedNonEmptyStringSchema,
	cwd: TrimmedNonEmptyStringSchema,
	action: GitStackedAction,
	commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(1e4))),
	featureBranch: Schema.optional(Schema.Boolean),
	filePaths: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)))
});
const GitListBranchesInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	query: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(256))),
	cursor: Schema.optional(NonNegativeInt),
	limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_LIST_BRANCHES_MAX_LIMIT)))
});
const GitCreateWorktreeInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	branch: TrimmedNonEmptyStringSchema,
	newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
	path: Schema.NullOr(TrimmedNonEmptyStringSchema)
});
const GitPullRequestRefInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	reference: GitPullRequestReference
});
const GitPreparePullRequestThreadInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	reference: GitPullRequestReference,
	mode: GitPreparePullRequestThreadMode,
	threadId: Schema.optional(ThreadId)
});
const GitRemoveWorktreeInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	path: TrimmedNonEmptyStringSchema,
	force: Schema.optional(Schema.Boolean)
});
const GitCreateBranchInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	branch: TrimmedNonEmptyStringSchema
});
const GitCheckoutInput = Schema.Struct({
	cwd: TrimmedNonEmptyStringSchema,
	branch: TrimmedNonEmptyStringSchema
});
const GitInitInput = Schema.Struct({ cwd: TrimmedNonEmptyStringSchema });
const GitStatusPr = Schema.Struct({
	number: PositiveInt,
	title: TrimmedNonEmptyStringSchema,
	url: Schema.String,
	baseBranch: TrimmedNonEmptyStringSchema,
	headBranch: TrimmedNonEmptyStringSchema,
	state: GitStatusPrState
});
const GitStatusResult = Schema.Struct({
	isRepo: Schema.Boolean,
	hasOriginRemote: Schema.Boolean,
	isDefaultBranch: Schema.Boolean,
	branch: Schema.NullOr(TrimmedNonEmptyStringSchema),
	hasWorkingTreeChanges: Schema.Boolean,
	workingTree: Schema.Struct({
		files: Schema.Array(Schema.Struct({
			path: TrimmedNonEmptyStringSchema,
			insertions: NonNegativeInt,
			deletions: NonNegativeInt
		})),
		insertions: NonNegativeInt,
		deletions: NonNegativeInt
	}),
	hasUpstream: Schema.Boolean,
	aheadCount: NonNegativeInt,
	behindCount: NonNegativeInt,
	pr: Schema.NullOr(GitStatusPr)
});
const GitListBranchesResult = Schema.Struct({
	branches: Schema.Array(GitBranch),
	isRepo: Schema.Boolean,
	hasOriginRemote: Schema.Boolean,
	nextCursor: NonNegativeInt.pipe(Schema.NullOr),
	totalCount: NonNegativeInt
});
const GitCreateWorktreeResult = Schema.Struct({ worktree: GitWorktree });
const GitResolvePullRequestResult = Schema.Struct({ pullRequest: GitResolvedPullRequest });
const GitPreparePullRequestThreadResult = Schema.Struct({
	pullRequest: GitResolvedPullRequest,
	branch: TrimmedNonEmptyStringSchema,
	worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr)
});
const GitRunStackedActionResult = Schema.Struct({
	action: GitStackedAction,
	branch: Schema.Struct({
		status: GitBranchStepStatus,
		name: Schema.optional(TrimmedNonEmptyStringSchema)
	}),
	commit: Schema.Struct({
		status: GitCommitStepStatus,
		commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
		subject: Schema.optional(TrimmedNonEmptyStringSchema)
	}),
	push: Schema.Struct({
		status: GitPushStepStatus,
		branch: Schema.optional(TrimmedNonEmptyStringSchema),
		upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
		setUpstream: Schema.optional(Schema.Boolean)
	}),
	pr: Schema.Struct({
		status: GitPrStepStatus,
		url: Schema.optional(Schema.String),
		number: Schema.optional(PositiveInt),
		baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
		headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
		title: Schema.optional(TrimmedNonEmptyStringSchema)
	}),
	toast: GitRunStackedActionToast
});
const GitPullResult = Schema.Struct({
	status: Schema.Literals(["pulled", "skipped_up_to_date"]),
	branch: TrimmedNonEmptyStringSchema,
	upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr)
});
var GitCommandError = class extends Schema.TaggedErrorClass()("GitCommandError", {
	operation: Schema.String,
	command: Schema.String,
	cwd: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Git command failed in ${this.operation}: ${this.command} (${this.cwd}) - ${this.detail}`;
	}
};
var GitHubCliError = class extends Schema.TaggedErrorClass()("GitHubCliError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
	}
};
var TextGenerationError = class extends Schema.TaggedErrorClass()("TextGenerationError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Text generation failed in ${this.operation}: ${this.detail}`;
	}
};
var GitManagerError = class extends Schema.TaggedErrorClass()("GitManagerError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Git manager failed in ${this.operation}: ${this.detail}`;
	}
};
const GitManagerServiceError = Schema.Union([
	GitManagerError,
	GitCommandError,
	GitHubCliError,
	TextGenerationError
]);
const GitActionProgressBase = Schema.Struct({
	actionId: TrimmedNonEmptyStringSchema,
	cwd: TrimmedNonEmptyStringSchema,
	action: GitStackedAction
});
const GitActionStartedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("action_started"),
	phases: Schema.Array(GitActionProgressPhase)
});
const GitActionPhaseStartedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("phase_started"),
	phase: GitActionProgressPhase,
	label: TrimmedNonEmptyStringSchema
});
const GitActionHookStartedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("hook_started"),
	hookName: TrimmedNonEmptyStringSchema
});
const GitActionHookOutputEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("hook_output"),
	hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
	stream: GitActionProgressStream,
	text: TrimmedNonEmptyStringSchema
});
const GitActionHookFinishedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("hook_finished"),
	hookName: TrimmedNonEmptyStringSchema,
	exitCode: Schema.NullOr(Schema.Int),
	durationMs: Schema.NullOr(NonNegativeInt)
});
const GitActionFinishedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("action_finished"),
	result: GitRunStackedActionResult
});
const GitActionFailedEvent = Schema.Struct({
	...GitActionProgressBase.fields,
	kind: Schema.Literal("action_failed"),
	phase: Schema.NullOr(GitActionProgressPhase),
	message: TrimmedNonEmptyStringSchema
});
const GitActionProgressEvent = Schema.Union([
	GitActionStartedEvent,
	GitActionPhaseStartedEvent,
	GitActionHookStartedEvent,
	GitActionHookOutputEvent,
	GitActionHookFinishedEvent,
	GitActionFinishedEvent,
	GitActionFailedEvent
]);

//#endregion
//#region ../../packages/contracts/src/project.ts
const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const ProjectSearchEntriesInput = Schema.Struct({
	cwd: TrimmedNonEmptyString,
	query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
	limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT))
});
const ProjectEntryKind = Schema.Literals(["file", "directory"]);
const ProjectEntry = Schema.Struct({
	path: TrimmedNonEmptyString,
	kind: ProjectEntryKind,
	parentPath: Schema.optional(TrimmedNonEmptyString)
});
const ProjectSearchEntriesResult = Schema.Struct({
	entries: Schema.Array(ProjectEntry),
	truncated: Schema.Boolean
});
var ProjectSearchEntriesError = class extends Schema.TaggedErrorClass()("ProjectSearchEntriesError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};
const ProjectWriteFileInput = Schema.Struct({
	cwd: TrimmedNonEmptyString,
	relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
	contents: Schema.String
});
const ProjectWriteFileResult = Schema.Struct({ relativePath: TrimmedNonEmptyString });
var ProjectWriteFileError = class extends Schema.TaggedErrorClass()("ProjectWriteFileError", {
	message: TrimmedNonEmptyString,
	cause: Schema.optional(Schema.Defect)
}) {};

//#endregion
//#region ../../packages/contracts/src/rpc.ts
const WS_METHODS = {
	projectsList: "projects.list",
	projectsAdd: "projects.add",
	projectsRemove: "projects.remove",
	projectsSearchEntries: "projects.searchEntries",
	projectsWriteFile: "projects.writeFile",
	shellOpenInEditor: "shell.openInEditor",
	gitPull: "git.pull",
	gitStatus: "git.status",
	gitRunStackedAction: "git.runStackedAction",
	gitListBranches: "git.listBranches",
	gitCreateWorktree: "git.createWorktree",
	gitRemoveWorktree: "git.removeWorktree",
	gitCreateBranch: "git.createBranch",
	gitCheckout: "git.checkout",
	gitInit: "git.init",
	gitResolvePullRequest: "git.resolvePullRequest",
	gitPreparePullRequestThread: "git.preparePullRequestThread",
	terminalOpen: "terminal.open",
	terminalWrite: "terminal.write",
	terminalResize: "terminal.resize",
	terminalClear: "terminal.clear",
	terminalRestart: "terminal.restart",
	terminalClose: "terminal.close",
	serverGetConfig: "server.getConfig",
	serverRefreshProviders: "server.refreshProviders",
	serverUpsertKeybinding: "server.upsertKeybinding",
	serverGetSettings: "server.getSettings",
	serverUpdateSettings: "server.updateSettings",
	subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
	subscribeTerminalEvents: "subscribeTerminalEvents",
	subscribeServerConfig: "subscribeServerConfig",
	subscribeServerLifecycle: "subscribeServerLifecycle"
};
const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
	payload: ServerUpsertKeybindingInput,
	success: ServerUpsertKeybindingResult,
	error: KeybindingsConfigError
});
const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
	payload: Schema.Struct({}),
	success: ServerConfig$1,
	error: Schema.Union([KeybindingsConfigError, ServerSettingsError])
});
const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
	payload: Schema.Struct({}),
	success: ServerProviderUpdatedPayload
});
const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
	payload: Schema.Struct({}),
	success: ServerSettings,
	error: ServerSettingsError
});
const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
	payload: Schema.Struct({ patch: ServerSettingsPatch }),
	success: ServerSettings,
	error: ServerSettingsError
});
const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
	payload: ProjectSearchEntriesInput,
	success: ProjectSearchEntriesResult,
	error: ProjectSearchEntriesError
});
const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
	payload: ProjectWriteFileInput,
	success: ProjectWriteFileResult,
	error: ProjectWriteFileError
});
const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
	payload: OpenInEditorInput,
	error: OpenError
});
const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
	payload: GitStatusInput,
	success: GitStatusResult,
	error: GitManagerServiceError
});
const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
	payload: GitPullInput,
	success: GitPullResult,
	error: GitCommandError
});
const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
	payload: GitRunStackedActionInput,
	success: GitActionProgressEvent,
	error: GitManagerServiceError,
	stream: true
});
const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
	payload: GitPullRequestRefInput,
	success: GitResolvePullRequestResult,
	error: GitManagerServiceError
});
const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
	payload: GitPreparePullRequestThreadInput,
	success: GitPreparePullRequestThreadResult,
	error: GitManagerServiceError
});
const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
	payload: GitListBranchesInput,
	success: GitListBranchesResult,
	error: GitCommandError
});
const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
	payload: GitCreateWorktreeInput,
	success: GitCreateWorktreeResult,
	error: GitCommandError
});
const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
	payload: GitRemoveWorktreeInput,
	error: GitCommandError
});
const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
	payload: GitCreateBranchInput,
	error: GitCommandError
});
const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
	payload: GitCheckoutInput,
	error: GitCommandError
});
const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
	payload: GitInitInput,
	error: GitCommandError
});
const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
	payload: TerminalOpenInput,
	success: TerminalSessionSnapshot,
	error: TerminalError
});
const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
	payload: TerminalWriteInput,
	error: TerminalError
});
const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
	payload: TerminalResizeInput,
	error: TerminalError
});
const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
	payload: TerminalClearInput,
	error: TerminalError
});
const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
	payload: TerminalRestartInput,
	success: TerminalSessionSnapshot,
	error: TerminalError
});
const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
	payload: TerminalCloseInput,
	error: TerminalError
});
const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
	payload: OrchestrationGetSnapshotInput,
	success: OrchestrationRpcSchemas.getSnapshot.output,
	error: OrchestrationGetSnapshotError
});
const WsOrchestrationDispatchCommandRpc = Rpc.make(ORCHESTRATION_WS_METHODS.dispatchCommand, {
	payload: ClientOrchestrationCommand,
	success: OrchestrationRpcSchemas.dispatchCommand.output,
	error: OrchestrationDispatchCommandError
});
const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
	payload: OrchestrationGetTurnDiffInput,
	success: OrchestrationRpcSchemas.getTurnDiff.output,
	error: OrchestrationGetTurnDiffError
});
const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
	payload: OrchestrationGetFullThreadDiffInput,
	success: OrchestrationRpcSchemas.getFullThreadDiff.output,
	error: OrchestrationGetFullThreadDiffError
});
const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
	payload: OrchestrationReplayEventsInput,
	success: OrchestrationRpcSchemas.replayEvents.output,
	error: OrchestrationReplayEventsError
});
const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(WS_METHODS.subscribeOrchestrationDomainEvents, {
	payload: Schema.Struct({}),
	success: OrchestrationEvent,
	stream: true
});
const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
	payload: Schema.Struct({}),
	success: TerminalEvent,
	stream: true
});
const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
	payload: Schema.Struct({}),
	success: ServerConfigStreamEvent,
	error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
	stream: true
});
const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
	payload: Schema.Struct({}),
	success: ServerLifecycleStreamEvent,
	stream: true
});
const WsRpcGroup = RpcGroup.make(WsServerGetConfigRpc, WsServerRefreshProvidersRpc, WsServerUpsertKeybindingRpc, WsServerGetSettingsRpc, WsServerUpdateSettingsRpc, WsProjectsSearchEntriesRpc, WsProjectsWriteFileRpc, WsShellOpenInEditorRpc, WsGitStatusRpc, WsGitPullRpc, WsGitRunStackedActionRpc, WsGitResolvePullRequestRpc, WsGitPreparePullRequestThreadRpc, WsGitListBranchesRpc, WsGitCreateWorktreeRpc, WsGitRemoveWorktreeRpc, WsGitCreateBranchRpc, WsGitCheckoutRpc, WsGitInitRpc, WsTerminalOpenRpc, WsTerminalWriteRpc, WsTerminalResizeRpc, WsTerminalClearRpc, WsTerminalRestartRpc, WsTerminalCloseRpc, WsSubscribeOrchestrationDomainEventsRpc, WsSubscribeTerminalEventsRpc, WsSubscribeServerConfigRpc, WsSubscribeServerLifecycleRpc, WsOrchestrationGetSnapshotRpc, WsOrchestrationDispatchCommandRpc, WsOrchestrationGetTurnDiffRpc, WsOrchestrationGetFullThreadDiffRpc, WsOrchestrationReplayEventsRpc);

//#endregion
//#region ../../packages/shared/src/schemaJson.ts
const decodeJsonResult = (schema) => {
	const decode = Schema.decodeExit(Schema.fromJsonString(schema));
	return (input) => {
		const result = decode(input);
		if (Exit.isFailure(result)) return Result.fail(result.cause);
		return Result.succeed(result.value);
	};
};
/**
* A `Getter` that parses a lenient JSON string (tolerating trailing commas
* and JS-style comments) into an unknown value.
*
* Mirrors `SchemaGetter.parseJson()` but uses `parseLenientJson` instead
* of `JSON.parse`.
*/
const parseLenientJsonGetter = SchemaGetter.onSome((input) => Effect.try({
	try: () => {
		let stripped = input.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (match, stringLiteral) => stringLiteral ? match : "");
		stripped = stripped.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (match, stringLiteral) => stringLiteral ? match : "");
		stripped = stripped.replace(/,(\s*[}\]])/g, "$1");
		return Option.some(JSON.parse(stripped));
	},
	catch: (e) => new SchemaIssue.InvalidValue(Option.some(input), { message: String(e) })
}));
/**
* Schema transformation: lenient JSONC string ↔ unknown.
*
* Same API as `SchemaTransformation.fromJsonString`, but the decode side
* strips trailing commas and JS-style comments before parsing.
* Encoding produces strict JSON via `JSON.stringify`.
*/
const fromLenientJsonString = new SchemaTransformation.Transformation(parseLenientJsonGetter, SchemaGetter.stringifyJson());
/**
* Build a schema that decodes a lenient JSON string into `A`.
*
* Drop-in replacement for `Schema.fromJsonString(schema)` that tolerates
* trailing commas and comments in the input.
*/
const fromLenientJson = (schema) => Schema.String.pipe(Schema.decodeTo(schema, fromLenientJsonString));

//#endregion
//#region ../../packages/shared/src/serverSettings.ts
const ServerSettingsJson$1 = fromLenientJson(ServerSettings);
function normalizePersistedServerSettingString(value) {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : void 0;
}
function extractPersistedServerObservabilitySettings(input) {
	return {
		otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
		otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl)
	};
}
function parsePersistedServerObservabilitySettings(raw) {
	try {
		return extractPersistedServerObservabilitySettings(Schema.decodeUnknownSync(ServerSettingsJson$1)(raw));
	} catch {
		return {
			otlpTracesUrl: void 0,
			otlpMetricsUrl: void 0
		};
	}
}

//#endregion
//#region src/config.ts
/**
* ServerConfig - Runtime configuration services.
*
* Defines process-level server configuration and networking helpers used by
* startup and runtime layers.
*
* @module ServerConfig
*/
const DEFAULT_PORT = 3773;
const RuntimeMode = Schema.Literals(["web", "desktop"]);
const deriveServerPaths = Effect.fn(function* (baseDir, devUrl) {
	const { join } = yield* Path.Path;
	const stateDir = join(baseDir, devUrl !== void 0 ? "dev" : "userdata");
	const dbPath = join(stateDir, "state.sqlite");
	const attachmentsDir = join(stateDir, "attachments");
	const logsDir = join(stateDir, "logs");
	const providerLogsDir = join(logsDir, "provider");
	return {
		stateDir,
		dbPath,
		keybindingsConfigPath: join(stateDir, "keybindings.json"),
		settingsPath: join(stateDir, "settings.json"),
		worktreesDir: join(baseDir, "worktrees"),
		attachmentsDir,
		logsDir,
		serverLogPath: join(logsDir, "server.log"),
		serverTracePath: join(logsDir, "server.trace.ndjson"),
		providerLogsDir,
		providerEventLogPath: join(providerLogsDir, "events.log"),
		terminalLogsDir: join(logsDir, "terminals"),
		anonymousIdPath: join(stateDir, "anonymous-id")
	};
});
const ensureServerDirectories = Effect.fn(function* (derivedPaths) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* Effect.all([
		fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
		fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
		fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
		fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
		fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
		fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
		fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
		fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
		fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true })
	], { concurrency: "unbounded" });
});
/**
* ServerConfig - Service tag for server runtime configuration.
*/
var ServerConfig = class ServerConfig extends ServiceMap.Service()("t3/config/ServerConfig") {
	static layerTest = (cwd, baseDirOrPrefix) => Layer.effect(ServerConfig, Effect.gen(function* () {
		const devUrl = void 0;
		const fs = yield* FileSystem.FileSystem;
		const baseDir = typeof baseDirOrPrefix === "string" ? baseDirOrPrefix : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
		const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
		yield* ensureServerDirectories(derivedPaths);
		return {
			logLevel: "Error",
			traceMinLevel: "Info",
			traceTimingEnabled: true,
			traceBatchWindowMs: 200,
			traceMaxBytes: 10 * 1024 * 1024,
			traceMaxFiles: 10,
			otlpTracesUrl: void 0,
			otlpMetricsUrl: void 0,
			otlpExportIntervalMs: 1e4,
			otlpServiceName: "t3-server",
			cwd,
			baseDir,
			...derivedPaths,
			mode: "web",
			autoBootstrapProjectFromCwd: false,
			logWebSocketEvents: false,
			port: 0,
			host: void 0,
			authToken: void 0,
			staticDir: void 0,
			devUrl,
			noBrowser: false
		};
	}));
};
const resolveStaticDir = Effect.fn(function* () {
	const { join, resolve } = yield* Path.Path;
	const { exists } = yield* FileSystem.FileSystem;
	const bundledClient = resolve(join(import.meta.dirname, "client"));
	if (yield* exists(join(bundledClient, "index.html")).pipe(Effect.orElseSucceed(() => false))) return bundledClient;
	const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
	if (yield* exists(join(monorepoClient, "index.html")).pipe(Effect.orElseSucceed(() => false))) return monorepoClient;
});

//#endregion
//#region src/bootstrap.ts
var BootstrapError = class extends Data.TaggedError("BootstrapError") {};
const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* (schema, fd, options) {
	if (!(yield* isFdReady(fd))) return Option.none();
	const stream = yield* makeBootstrapInputStream(fd);
	const timeoutMs = options?.timeoutMs ?? 1e3;
	return yield* Effect.callback((resume) => {
		const input = readline$1.createInterface({
			input: stream,
			crlfDelay: Infinity
		});
		const cleanup = () => {
			stream.removeListener("error", handleError);
			input.removeListener("line", handleLine);
			input.removeListener("close", handleClose);
			input.close();
			stream.destroy();
		};
		const handleError = (error) => {
			if (isUnavailableBootstrapFdError(error)) {
				resume(Effect.succeedNone);
				return;
			}
			resume(Effect.fail(new BootstrapError({
				message: "Failed to read bootstrap envelope.",
				cause: error
			})));
		};
		const handleLine = (line) => {
			const parsed = decodeJsonResult(schema)(line);
			if (Result.isSuccess(parsed)) resume(Effect.succeedSome(parsed.success));
			else resume(Effect.fail(new BootstrapError({
				message: "Failed to decode bootstrap envelope.",
				cause: parsed.failure
			})));
		};
		const handleClose = () => {
			resume(Effect.succeedNone);
		};
		stream.once("error", handleError);
		input.once("line", handleLine);
		input.once("close", handleClose);
		return Effect.sync(cleanup);
	}).pipe(Effect.timeoutOption(timeoutMs), Effect.map(Option.flatten));
});
const isUnavailableBootstrapFdError = Predicate.compose(Predicate.hasProperty("code"), (_) => _.code === "EBADF" || _.code === "ENOENT");
const isFdReady = (fd) => Effect.try({
	try: () => NFS.fstatSync(fd),
	catch: (error) => new BootstrapError({
		message: "Failed to stat bootstrap fd.",
		cause: error
	})
}).pipe(Effect.as(true), Effect.catchIf((error) => isUnavailableBootstrapFdError(error.cause), () => Effect.succeed(false)));
const makeBootstrapInputStream = (fd) => Effect.try({
	try: () => {
		const fdPath = resolveFdPath(fd);
		if (fdPath === void 0) return makeDirectBootstrapStream(fd);
		let streamFd;
		try {
			streamFd = NFS.openSync(fdPath, "r");
			return NFS.createReadStream("", {
				fd: streamFd,
				encoding: "utf8",
				autoClose: true
			});
		} catch (error) {
			if (isBootstrapFdPathDuplicationError(error)) {
				if (streamFd !== void 0) NFS.closeSync(streamFd);
				return makeDirectBootstrapStream(fd);
			}
			throw error;
		}
	},
	catch: (error) => new BootstrapError({
		message: "Failed to duplicate bootstrap fd.",
		cause: error
	})
});
const makeDirectBootstrapStream = (fd) => {
	try {
		return NFS.createReadStream("", {
			fd,
			encoding: "utf8",
			autoClose: true
		});
	} catch {
		const stream = new Net.Socket({
			fd,
			readable: true,
			writable: false
		});
		stream.setEncoding("utf8");
		return stream;
	}
};
const isBootstrapFdPathDuplicationError = Predicate.compose(Predicate.hasProperty("code"), (_) => _.code === "ENXIO" || _.code === "EINVAL" || _.code === "EPERM");
function resolveFdPath(fd, platform = process.platform) {
	if (platform === "linux") return `/proc/self/fd/${fd}`;
	if (platform === "win32") return;
	return `/dev/fd/${fd}`;
}

//#endregion
//#region ../../packages/shared/src/shell.ts
const SHELL_ENV_NAME_PATTERN = /^[A-Z0-9_]+$/;
function resolveLoginShell(platform, shell) {
	const trimmedShell = shell?.trim();
	if (trimmedShell) return trimmedShell;
	if (platform === "darwin") return "/bin/zsh";
	if (platform === "linux") return "/bin/bash";
}
function readPathFromLoginShell(shell, execFile = execFileSync) {
	return readEnvironmentFromLoginShell(shell, ["PATH"], execFile).PATH;
}
function envCaptureStart(name) {
	return `__T3CODE_ENV_${name}_START__`;
}
function envCaptureEnd(name) {
	return `__T3CODE_ENV_${name}_END__`;
}
function buildEnvironmentCaptureCommand(names) {
	return names.map((name) => {
		if (!SHELL_ENV_NAME_PATTERN.test(name)) throw new Error(`Unsupported environment variable name: ${name}`);
		return [
			`printf '%s\\n' '${envCaptureStart(name)}'`,
			`printenv ${name} || true`,
			`printf '%s\\n' '${envCaptureEnd(name)}'`
		].join("; ");
	}).join("; ");
}
function extractEnvironmentValue(output, name) {
	const startMarker = envCaptureStart(name);
	const endMarker = envCaptureEnd(name);
	const startIndex = output.indexOf(startMarker);
	if (startIndex === -1) return void 0;
	const valueStartIndex = startIndex + startMarker.length;
	const endIndex = output.indexOf(endMarker, valueStartIndex);
	if (endIndex === -1) return void 0;
	let value = output.slice(valueStartIndex, endIndex);
	if (value.startsWith("\n")) value = value.slice(1);
	if (value.endsWith("\n")) value = value.slice(0, -1);
	return value.length > 0 ? value : void 0;
}
const readEnvironmentFromLoginShell = (shell, names, execFile = execFileSync) => {
	if (names.length === 0) return {};
	const output = execFile(shell, ["-ilc", buildEnvironmentCaptureCommand(names)], {
		encoding: "utf8",
		timeout: 5e3
	});
	const environment = {};
	for (const name of names) {
		const value = extractEnvironmentValue(output, name);
		if (value !== void 0) environment[name] = value;
	}
	return environment;
};

//#endregion
//#region src/os-jank.ts
function fixPath(options = {}) {
	const platform = options.platform ?? process.platform;
	if (platform !== "darwin" && platform !== "linux") return;
	const env = options.env ?? process.env;
	try {
		const shell = resolveLoginShell(platform, env.SHELL);
		if (!shell) return;
		const result = (options.readPath ?? readPathFromLoginShell)(shell);
		if (result) env.PATH = result;
	} catch {}
}
const expandHomePath$1 = Effect.fn(function* (input) {
	const { join } = yield* Path.Path;
	if (input === "~") return OS.homedir();
	if (input.startsWith("~/") || input.startsWith("~\\")) return join(OS.homedir(), input.slice(2));
	return input;
});
const resolveBaseDir = Effect.fn(function* (raw) {
	const { join, resolve } = yield* Path.Path;
	if (!raw || raw.trim().length === 0) return join(OS.homedir(), ".t3");
	return resolve(yield* expandHomePath$1(raw.trim()));
});

//#endregion
//#region src/attachmentPaths.ts
const ATTACHMENTS_ROUTE_PREFIX = "/attachments";
function normalizeAttachmentRelativePath(rawRelativePath) {
	const normalized = path.normalize(rawRelativePath).replace(/^[/\\]+/, "");
	if (normalized.length === 0 || normalized.startsWith("..") || normalized.includes("\0")) return null;
	return normalized.replace(/\\/g, "/");
}
function resolveAttachmentRelativePath(input) {
	const normalizedRelativePath = normalizeAttachmentRelativePath(input.relativePath);
	if (!normalizedRelativePath) return null;
	const attachmentsRoot = path.resolve(input.attachmentsDir);
	const filePath = path.resolve(path.join(attachmentsRoot, normalizedRelativePath));
	if (!filePath.startsWith(`${attachmentsRoot}${path.sep}`)) return null;
	return filePath;
}

//#endregion
//#region src/imageMime.ts
const IMAGE_EXTENSION_BY_MIME_TYPE = {
	"image/avif": ".avif",
	"image/bmp": ".bmp",
	"image/gif": ".gif",
	"image/heic": ".heic",
	"image/heif": ".heif",
	"image/jpeg": ".jpg",
	"image/jpg": ".jpg",
	"image/png": ".png",
	"image/svg+xml": ".svg",
	"image/tiff": ".tiff",
	"image/webp": ".webp"
};
const SAFE_IMAGE_FILE_EXTENSIONS = new Set([
	".avif",
	".bmp",
	".gif",
	".heic",
	".heif",
	".ico",
	".jpeg",
	".jpg",
	".png",
	".svg",
	".tiff",
	".webp"
]);
function parseBase64DataUrl(dataUrl) {
	const match = /^data:([^,]+),([a-z0-9+/=\r\n ]+)$/i.exec(dataUrl.trim());
	if (!match) return null;
	const headerParts = (match[1] ?? "").split(";").map((part) => part.trim()).filter((part) => part.length > 0);
	if (headerParts.length < 2) return null;
	if (headerParts.at(-1)?.toLowerCase() !== "base64") return null;
	const mimeType = headerParts[0]?.toLowerCase();
	const base64 = match[2]?.replace(/\s+/g, "");
	if (!mimeType || !base64) return null;
	return {
		mimeType,
		base64
	};
}
function inferImageExtension(input) {
	const key = input.mimeType.toLowerCase();
	const fromMime = Object.hasOwn(IMAGE_EXTENSION_BY_MIME_TYPE, key) ? IMAGE_EXTENSION_BY_MIME_TYPE[key] : void 0;
	if (fromMime) return fromMime;
	const fromMimeExtension = Mime.getExtension(input.mimeType);
	if (fromMimeExtension && SAFE_IMAGE_FILE_EXTENSIONS.has(fromMimeExtension)) return fromMimeExtension;
	const fileName = input.fileName?.trim() ?? "";
	const extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(fileName);
	const fileNameExtension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : "";
	if (SAFE_IMAGE_FILE_EXTENSIONS.has(fileNameExtension)) return fileNameExtension;
	return ".bin";
}

//#endregion
//#region src/attachmentStore.ts
const ATTACHMENT_FILENAME_EXTENSIONS = [...SAFE_IMAGE_FILE_EXTENSIONS, ".bin"];
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_PATTERN = new RegExp(`^([a-z0-9_]+(?:-[a-z0-9_]+)*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`, "i");
function toSafeThreadAttachmentSegment(threadId) {
	const segment = threadId.trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS).replace(/[-_]+$/g, "");
	if (segment.length === 0) return null;
	return segment;
}
function createAttachmentId(threadId) {
	const threadSegment = toSafeThreadAttachmentSegment(threadId);
	if (!threadSegment) return null;
	return `${threadSegment}-${randomUUID()}`;
}
function parseThreadSegmentFromAttachmentId(attachmentId) {
	const normalizedId = normalizeAttachmentRelativePath(attachmentId);
	if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) return null;
	const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
	if (!match) return null;
	return match[1]?.toLowerCase() ?? null;
}
function attachmentRelativePath(attachment) {
	switch (attachment.type) {
		case "image": {
			const extension = inferImageExtension({
				mimeType: attachment.mimeType,
				fileName: attachment.name
			});
			return `${attachment.id}${extension}`;
		}
	}
}
function resolveAttachmentPath(input) {
	return resolveAttachmentRelativePath({
		attachmentsDir: input.attachmentsDir,
		relativePath: attachmentRelativePath(input.attachment)
	});
}
function resolveAttachmentPathById(input) {
	const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
	if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) return null;
	for (const extension of ATTACHMENT_FILENAME_EXTENSIONS) {
		const maybePath = resolveAttachmentRelativePath({
			attachmentsDir: input.attachmentsDir,
			relativePath: `${normalizedId}${extension}`
		});
		if (maybePath && existsSync(maybePath)) return maybePath;
	}
	return null;
}
function parseAttachmentIdFromRelativePath(relativePath) {
	const normalized = normalizeAttachmentRelativePath(relativePath);
	if (!normalized || normalized.includes("/")) return null;
	const extensionIndex = normalized.lastIndexOf(".");
	if (extensionIndex <= 0) return null;
	const id = normalized.slice(0, extensionIndex);
	return id.length > 0 && !id.includes(".") ? id : null;
}

//#endregion
//#region src/observability/Attributes.ts
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function markSeen(value, seen) {
	if (seen.has(value)) return true;
	seen.add(value);
	return false;
}
function normalizeJsonValue(value, seen = /* @__PURE__ */ new WeakSet()) {
	if (value === null || value === void 0 || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value ?? null;
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
	if (value instanceof Error) return {
		name: value.name,
		message: value.message,
		...value.stack ? { stack: value.stack } : {}
	};
	if (Array.isArray(value)) {
		if (markSeen(value, seen)) return "[Circular]";
		return value.map((entry) => normalizeJsonValue(entry, seen));
	}
	if (value instanceof Map) {
		if (markSeen(value, seen)) return "[Circular]";
		return Object.fromEntries(Array.from(value.entries(), ([key, entryValue]) => [String(key), normalizeJsonValue(entryValue, seen)]));
	}
	if (value instanceof Set) {
		if (markSeen(value, seen)) return "[Circular]";
		return Array.from(value.values(), (entry) => normalizeJsonValue(entry, seen));
	}
	if (!isPlainObject(value)) return String(value);
	if (markSeen(value, seen)) return "[Circular]";
	return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, normalizeJsonValue(entryValue, seen)]));
}
function compactTraceAttributes(attributes) {
	return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== void 0).map(([key, value]) => [key, normalizeJsonValue(value)]));
}
function compactMetricAttributes(attributes) {
	return Object.fromEntries(Object.entries(attributes).flatMap(([key, value]) => {
		if (value === void 0 || value === null) return [];
		if (typeof value === "string") return [[key, value]];
		if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return [[key, String(value)]];
		return [];
	}));
}
function outcomeFromExit(exit) {
	if (Exit.isSuccess(exit)) return "success";
	return Cause.hasInterruptsOnly(exit.cause) ? "interrupt" : "failure";
}
function normalizeModelMetricLabel(model) {
	const normalized = model?.trim().toLowerCase();
	if (!normalized) return;
	if (normalized.includes("gpt")) return "gpt";
	if (normalized.includes("claude")) return "claude";
	if (normalized.includes("gemini")) return "gemini";
	return "other";
}

//#endregion
//#region src/observability/TraceRecord.ts
function formatTraceExit(exit) {
	if (Exit.isSuccess(exit)) return { _tag: "Success" };
	if (Cause.hasInterruptsOnly(exit.cause)) return {
		_tag: "Interrupted",
		cause: Cause.pretty(exit.cause)
	};
	return {
		_tag: "Failure",
		cause: Cause.pretty(exit.cause)
	};
}
function spanToTraceRecord(span) {
	const status = span.status;
	const parentSpanId = Option.getOrUndefined(span.parent)?.spanId;
	return {
		type: "effect-span",
		name: span.name,
		traceId: span.traceId,
		spanId: span.spanId,
		...parentSpanId ? { parentSpanId } : {},
		sampled: span.sampled,
		kind: span.kind,
		startTimeUnixNano: String(status.startTime),
		endTimeUnixNano: String(status.endTime),
		durationMs: Number(status.endTime - status.startTime) / 1e6,
		attributes: compactTraceAttributes(Object.fromEntries(span.attributes)),
		events: span.events.map(([name, startTime, attributes]) => ({
			name,
			timeUnixNano: String(startTime),
			attributes: compactTraceAttributes(attributes)
		})),
		links: span.links.map((link) => ({
			traceId: link.span.traceId,
			spanId: link.span.spanId,
			attributes: compactTraceAttributes(link.attributes)
		})),
		exit: formatTraceExit(status.exit)
	};
}
const SPAN_KIND_MAP = {
	1: "internal",
	2: "server",
	3: "client",
	4: "producer",
	5: "consumer"
};
function decodeOtlpTraceRecords(payload) {
	const records = [];
	for (const resourceSpan of payload.resourceSpans) {
		const resourceAttributes = decodeAttributes(resourceSpan.resource?.attributes ?? []);
		for (const scopeSpan of resourceSpan.scopeSpans) for (const span of scopeSpan.spans) records.push(otlpSpanToTraceRecord({
			resourceAttributes,
			scopeAttributes: decodeAttributes("attributes" in scopeSpan.scope && Array.isArray(scopeSpan.scope.attributes) ? scopeSpan.scope.attributes : []),
			scopeName: scopeSpan.scope.name,
			scopeVersion: "version" in scopeSpan.scope && typeof scopeSpan.scope.version === "string" ? scopeSpan.scope.version : void 0,
			span
		}));
	}
	return records;
}
function otlpSpanToTraceRecord(input) {
	return {
		type: "otlp-span",
		name: input.span.name,
		traceId: input.span.traceId,
		spanId: input.span.spanId,
		...input.span.parentSpanId ? { parentSpanId: input.span.parentSpanId } : {},
		sampled: true,
		kind: normalizeSpanKind(input.span.kind),
		startTimeUnixNano: input.span.startTimeUnixNano,
		endTimeUnixNano: input.span.endTimeUnixNano,
		durationMs: Number(parseBigInt(input.span.endTimeUnixNano) - parseBigInt(input.span.startTimeUnixNano)) / 1e6,
		attributes: decodeAttributes(input.span.attributes),
		resourceAttributes: input.resourceAttributes,
		scope: {
			...input.scopeName ? { name: input.scopeName } : {},
			...input.scopeVersion ? { version: input.scopeVersion } : {},
			attributes: input.scopeAttributes
		},
		events: decodeEvents(input.span.events),
		links: decodeLinks(input.span.links),
		status: decodeStatus(input.span.status)
	};
}
function decodeStatus(input) {
	const code = String(input.code);
	const message = input.message;
	return {
		code,
		...message ? { message } : {}
	};
}
function decodeEvents(input) {
	return input.map((current) => ({
		name: current.name,
		timeUnixNano: current.timeUnixNano,
		attributes: decodeAttributes(current.attributes)
	}));
}
function decodeLinks(input) {
	return input.flatMap((current) => {
		return {
			traceId: current.traceId,
			spanId: current.spanId,
			attributes: decodeAttributes(current.attributes)
		};
	});
}
function decodeAttributes(input) {
	const entries = {};
	for (const attribute of input) entries[attribute.key] = decodeValue(attribute.value);
	return compactTraceAttributes(entries);
}
function decodeValue(input) {
	if (input == null) return null;
	if ("stringValue" in input) return input.stringValue;
	if ("boolValue" in input) return input.boolValue;
	if ("intValue" in input) return input.intValue;
	if ("doubleValue" in input) return input.doubleValue;
	if ("bytesValue" in input) return input.bytesValue;
	if (input.arrayValue) return input.arrayValue.values.map((entry) => decodeValue(entry));
	if (input.kvlistValue) return decodeAttributes(input.kvlistValue.values);
	return null;
}
function normalizeSpanKind(input) {
	return SPAN_KIND_MAP[input] || "internal";
}
function parseBigInt(input) {
	try {
		return BigInt(input);
	} catch {
		return 0n;
	}
}

//#endregion
//#region src/observability/Services/BrowserTraceCollector.ts
var BrowserTraceCollector = class extends ServiceMap.Service()("t3/observability/Services/BrowserTraceCollector") {};

//#endregion
//#region src/project/Services/ProjectFaviconResolver.ts
/**
* ProjectFaviconResolver - Effect service contract for project icon discovery.
*
* Resolves a representative favicon or app icon file for a workspace by
* checking common file locations and project source metadata.
*
* @module ProjectFaviconResolver
*/
/**
* ProjectFaviconResolver - Service tag for project favicon resolution.
*/
var ProjectFaviconResolver = class extends ServiceMap.Service()("t3/project/Services/ProjectFaviconResolver") {};

//#endregion
//#region src/http.ts
const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
var DecodeOtlpTraceRecordsError = class extends Data.TaggedError("DecodeOtlpTraceRecordsError") {};
const otlpTracesProxyRouteLayer = HttpRouter.add("POST", OTLP_TRACES_PROXY_PATH, Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const otlpTracesUrl = (yield* ServerConfig).otlpTracesUrl;
	const browserTraceCollector = yield* BrowserTraceCollector;
	const httpClient = yield* HttpClient.HttpClient;
	const bodyJson = cast(yield* request.json);
	yield* Effect.try({
		try: () => decodeOtlpTraceRecords(bodyJson),
		catch: (cause) => new DecodeOtlpTraceRecordsError({
			cause,
			bodyJson
		})
	}).pipe(Effect.flatMap((records) => browserTraceCollector.record(records)), Effect.catch((cause) => Effect.logWarning("Failed to decode browser OTLP traces", {
		cause,
		bodyJson
	})));
	if (otlpTracesUrl === void 0) return HttpServerResponse.empty({ status: 204 });
	return yield* httpClient.post(otlpTracesUrl, { body: HttpBody.jsonUnsafe(bodyJson) }).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.as(HttpServerResponse.empty({ status: 204 })), Effect.tapError((cause) => Effect.logWarning("Failed to export browser OTLP traces", {
		cause,
		otlpTracesUrl
	})), Effect.catch(() => Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 }))));
})).pipe(Layer.provide(HttpRouter.cors({
	allowedMethods: ["POST", "OPTIONS"],
	allowedHeaders: ["content-type"],
	maxAge: 600
})));
const attachmentsRouteLayer = HttpRouter.add("GET", `${ATTACHMENTS_ROUTE_PREFIX}/*`, Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const url = HttpServerRequest.toURL(request);
	if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
	const config = yield* ServerConfig;
	const normalizedRelativePath = normalizeAttachmentRelativePath(url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length));
	if (!normalizedRelativePath) return HttpServerResponse.text("Invalid attachment path", { status: 400 });
	const isIdLookup = !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
	const filePath = isIdLookup ? resolveAttachmentPathById({
		attachmentsDir: config.attachmentsDir,
		attachmentId: normalizedRelativePath
	}) : resolveAttachmentRelativePath({
		attachmentsDir: config.attachmentsDir,
		relativePath: normalizedRelativePath
	});
	if (!filePath) return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", { status: isIdLookup ? 404 : 400 });
	const fileInfo = yield* (yield* FileSystem.FileSystem).stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
	if (!fileInfo || fileInfo.type !== "File") return HttpServerResponse.text("Not Found", { status: 404 });
	return yield* HttpServerResponse.file(filePath, {
		status: 200,
		headers: { "Cache-Control": "public, max-age=31536000, immutable" }
	}).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 }))));
}));
const projectFaviconRouteLayer = HttpRouter.add("GET", "/api/project-favicon", Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const url = HttpServerRequest.toURL(request);
	if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
	const projectCwd = url.value.searchParams.get("cwd");
	if (!projectCwd) return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
	const faviconFilePath = yield* (yield* ProjectFaviconResolver).resolvePath(projectCwd);
	if (!faviconFilePath) return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
		status: 200,
		contentType: "image/svg+xml",
		headers: { "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL }
	});
	return yield* HttpServerResponse.file(faviconFilePath, {
		status: 200,
		headers: { "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL }
	}).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 }))));
}));
const staticAndDevRouteLayer = HttpRouter.add("GET", "*", Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const url = HttpServerRequest.toURL(request);
	if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
	const config = yield* ServerConfig;
	if (config.devUrl) return HttpServerResponse.redirect(config.devUrl.href, { status: 302 });
	if (!config.staticDir) return HttpServerResponse.text("No static directory configured and no dev URL set.", { status: 503 });
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const staticRoot = path.resolve(config.staticDir);
	const rawStaticRelativePath = (url.value.pathname === "/" ? "/index.html" : url.value.pathname).replace(/^[/\\]+/, "");
	const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
	const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
	const hasPathTraversalSegment = staticRelativePath.startsWith("..");
	if (staticRelativePath.length === 0 || hasRawLeadingParentSegment || hasPathTraversalSegment || staticRelativePath.includes("\0")) return HttpServerResponse.text("Invalid static file path", { status: 400 });
	const isWithinStaticRoot = (candidate) => candidate === staticRoot || candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);
	let filePath = path.resolve(staticRoot, staticRelativePath);
	if (!isWithinStaticRoot(filePath)) return HttpServerResponse.text("Invalid static file path", { status: 400 });
	if (!path.extname(filePath)) {
		filePath = path.resolve(filePath, "index.html");
		if (!isWithinStaticRoot(filePath)) return HttpServerResponse.text("Invalid static file path", { status: 400 });
	}
	const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
	if (!fileInfo || fileInfo.type !== "File") {
		const indexPath = path.resolve(staticRoot, "index.html");
		const indexData = yield* fileSystem.readFile(indexPath).pipe(Effect.catch(() => Effect.succeed(null)));
		if (!indexData) return HttpServerResponse.text("Not Found", { status: 404 });
		return HttpServerResponse.uint8Array(indexData, {
			status: 200,
			contentType: "text/html; charset=utf-8"
		});
	}
	const contentType = Mime.getType(filePath) ?? "application/octet-stream";
	const data = yield* fileSystem.readFile(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
	if (!data) return HttpServerResponse.text("Internal Server Error", { status: 500 });
	return HttpServerResponse.uint8Array(data, {
		status: 200,
		contentType
	});
}));

//#endregion
//#region src/checkpointing/Services/CheckpointDiffQuery.ts
/**
* CheckpointDiffQuery - Service tag for checkpoint diff queries.
*/
var CheckpointDiffQuery = class extends ServiceMap.Service()("t3/checkpointing/Services/CheckpointDiffQuery") {};

//#endregion
//#region src/git/Services/GitCore.ts
/**
* GitCore - Effect service contract for low-level Git operations.
*
* Wraps core repository primitives used by higher-level orchestration
* services and WebSocket routes.
*
* @module GitCore
*/
/**
* GitCore - Service tag for low-level Git repository operations.
*/
var GitCore = class extends ServiceMap.Service()("t3/git/Services/GitCore") {};

//#endregion
//#region src/git/Services/GitManager.ts
/**
* GitManager - Service tag for stacked Git workflow orchestration.
*/
var GitManager = class extends ServiceMap.Service()("t3/git/Services/GitManager") {};

//#endregion
//#region src/keybindings.ts
/**
* Keybindings - Keybinding configuration service definitions.
*
* Owns parsing, validation, merge, and persistence of user keybinding
* configuration consumed by the server runtime.
*
* @module Keybindings
*/
const DEFAULT_KEYBINDINGS = [
	{
		key: "mod+j",
		command: "terminal.toggle"
	},
	{
		key: "mod+d",
		command: "terminal.split",
		when: "terminalFocus"
	},
	{
		key: "mod+n",
		command: "terminal.new",
		when: "terminalFocus"
	},
	{
		key: "mod+w",
		command: "terminal.close",
		when: "terminalFocus"
	},
	{
		key: "mod+d",
		command: "diff.toggle",
		when: "!terminalFocus"
	},
	{
		key: "mod+n",
		command: "chat.new",
		when: "!terminalFocus"
	},
	{
		key: "mod+shift+o",
		command: "chat.new",
		when: "!terminalFocus"
	},
	{
		key: "mod+shift+n",
		command: "chat.newLocal",
		when: "!terminalFocus"
	},
	{
		key: "mod+o",
		command: "editor.openFavorite"
	},
	{
		key: "mod+shift+[",
		command: "thread.previous"
	},
	{
		key: "mod+shift+]",
		command: "thread.next"
	},
	...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
		key: `mod+${index + 1}`,
		command
	}))
];
function normalizeKeyToken(token) {
	if (token === "space") return " ";
	if (token === "esc") return "escape";
	return token;
}
/** @internal - Exported for testing */
function parseKeybindingShortcut(value) {
	const tokens = [...value.toLowerCase().split("+").map((token) => token.trim())];
	let trailingEmptyCount = 0;
	while (tokens[tokens.length - 1] === "") {
		trailingEmptyCount += 1;
		tokens.pop();
	}
	if (trailingEmptyCount > 0) tokens.push("+");
	if (tokens.some((token) => token.length === 0)) return null;
	if (tokens.length === 0) return null;
	let key = null;
	let metaKey = false;
	let ctrlKey = false;
	let shiftKey = false;
	let altKey = false;
	let modKey = false;
	for (const token of tokens) switch (token) {
		case "cmd":
		case "meta":
			metaKey = true;
			break;
		case "ctrl":
		case "control":
			ctrlKey = true;
			break;
		case "shift":
			shiftKey = true;
			break;
		case "alt":
		case "option":
			altKey = true;
			break;
		case "mod":
			modKey = true;
			break;
		default:
			if (key !== null) return null;
			key = normalizeKeyToken(token);
	}
	if (key === null) return null;
	return {
		key,
		metaKey,
		ctrlKey,
		shiftKey,
		altKey,
		modKey
	};
}
function tokenizeWhenExpression(expression) {
	const tokens = [];
	let index = 0;
	while (index < expression.length) {
		const current = expression[index];
		if (!current) break;
		if (/\s/.test(current)) {
			index += 1;
			continue;
		}
		if (expression.startsWith("&&", index)) {
			tokens.push({ type: "and" });
			index += 2;
			continue;
		}
		if (expression.startsWith("||", index)) {
			tokens.push({ type: "or" });
			index += 2;
			continue;
		}
		if (current === "!") {
			tokens.push({ type: "not" });
			index += 1;
			continue;
		}
		if (current === "(") {
			tokens.push({ type: "lparen" });
			index += 1;
			continue;
		}
		if (current === ")") {
			tokens.push({ type: "rparen" });
			index += 1;
			continue;
		}
		const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index));
		if (!identifier) return null;
		tokens.push({
			type: "identifier",
			value: identifier[0]
		});
		index += identifier[0].length;
	}
	return tokens;
}
function parseKeybindingWhenExpression(expression) {
	const tokens = tokenizeWhenExpression(expression);
	if (!tokens || tokens.length === 0) return null;
	let index = 0;
	const parsePrimary = (depth) => {
		if (depth > MAX_WHEN_EXPRESSION_DEPTH) return null;
		const token = tokens[index];
		if (!token) return null;
		if (token.type === "identifier") {
			index += 1;
			return {
				type: "identifier",
				name: token.value
			};
		}
		if (token.type === "lparen") {
			index += 1;
			const expressionNode = parseOr(depth + 1);
			const closeToken = tokens[index];
			if (!expressionNode || !closeToken || closeToken.type !== "rparen") return null;
			index += 1;
			return expressionNode;
		}
		return null;
	};
	const parseUnary = (depth) => {
		let notCount = 0;
		while (tokens[index]?.type === "not") {
			index += 1;
			notCount += 1;
			if (notCount > MAX_WHEN_EXPRESSION_DEPTH) return null;
		}
		let node = parsePrimary(depth);
		if (!node) return null;
		while (notCount > 0) {
			node = {
				type: "not",
				node
			};
			notCount -= 1;
		}
		return node;
	};
	const parseAnd = (depth) => {
		let left = parseUnary(depth);
		if (!left) return null;
		while (tokens[index]?.type === "and") {
			index += 1;
			const right = parseUnary(depth);
			if (!right) return null;
			left = {
				type: "and",
				left,
				right
			};
		}
		return left;
	};
	const parseOr = (depth) => {
		let left = parseAnd(depth);
		if (!left) return null;
		while (tokens[index]?.type === "or") {
			index += 1;
			const right = parseAnd(depth);
			if (!right) return null;
			left = {
				type: "or",
				left,
				right
			};
		}
		return left;
	};
	const ast = parseOr(0);
	if (!ast || index !== tokens.length) return null;
	return ast;
}
/** @internal - Exported for testing */
function compileResolvedKeybindingRule(rule) {
	const shortcut = parseKeybindingShortcut(rule.key);
	if (!shortcut) return null;
	if (rule.when !== void 0) {
		const whenAst = parseKeybindingWhenExpression(rule.when);
		if (!whenAst) return null;
		return {
			command: rule.command,
			shortcut,
			whenAst
		};
	}
	return {
		command: rule.command,
		shortcut
	};
}
function compileResolvedKeybindingsConfig(config) {
	const compiled = [];
	for (const rule of config) {
		const result = Schema.decodeExit(ResolvedKeybindingFromConfig)(rule);
		if (result._tag === "Success") compiled.push(result.value);
	}
	return compiled;
}
const ResolvedKeybindingFromConfig = KeybindingRule.pipe(Schema.decodeTo(Schema.toType(ResolvedKeybindingRule), SchemaTransformation.transformOrFail({
	decode: (rule) => Effect.succeed(compileResolvedKeybindingRule(rule)).pipe(Effect.filterOrFail(Predicate.isNotNull, () => new SchemaIssue.InvalidValue(Option.some(rule), { title: "Invalid keybinding rule" })), Effect.map((resolved) => resolved)),
	encode: (resolved) => Effect.gen(function* () {
		const key = encodeShortcut(resolved.shortcut);
		if (!key) return yield* Effect.fail(new SchemaIssue.InvalidValue(Option.some(resolved), { title: "Resolved shortcut cannot be encoded to key string" }));
		const when = resolved.whenAst ? encodeWhenAst(resolved.whenAst) : void 0;
		return {
			key,
			command: resolved.command,
			when
		};
	})
})));
const ResolvedKeybindingsFromConfig = Schema.Array(ResolvedKeybindingFromConfig).check(Schema.isMaxLength(MAX_KEYBINDINGS_COUNT));
function isSameKeybindingRule(left, right) {
	return left.command === right.command && left.key === right.key && (left.when ?? void 0) === (right.when ?? void 0);
}
function keybindingShortcutContext(rule) {
	const parsed = parseKeybindingShortcut(rule.key);
	if (!parsed) return null;
	const encoded = encodeShortcut(parsed);
	if (!encoded) return null;
	return `${encoded}\u0000${rule.when ?? ""}`;
}
function hasSameShortcutContext(left, right) {
	const leftContext = keybindingShortcutContext(left);
	const rightContext = keybindingShortcutContext(right);
	if (!leftContext || !rightContext) return false;
	return leftContext === rightContext;
}
function encodeShortcut(shortcut) {
	const modifiers = [];
	if (shortcut.modKey) modifiers.push("mod");
	if (shortcut.metaKey) modifiers.push("meta");
	if (shortcut.ctrlKey) modifiers.push("ctrl");
	if (shortcut.altKey) modifiers.push("alt");
	if (shortcut.shiftKey) modifiers.push("shift");
	if (!shortcut.key) return null;
	if (shortcut.key !== "+" && shortcut.key.includes("+")) return null;
	const key = shortcut.key === " " ? "space" : shortcut.key;
	return [...modifiers, key].join("+");
}
function encodeWhenAst(node) {
	switch (node.type) {
		case "identifier": return node.name;
		case "not": return `!(${encodeWhenAst(node.node)})`;
		case "and": return `(${encodeWhenAst(node.left)} && ${encodeWhenAst(node.right)})`;
		case "or": return `(${encodeWhenAst(node.left)} || ${encodeWhenAst(node.right)})`;
	}
}
const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);
const RawKeybindingsEntries = fromLenientJson(Schema.Array(Schema.Unknown));
const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);
const PrettyJsonString = SchemaGetter.parseJson().compose(SchemaGetter.stringifyJson({ space: 2 }));
const KeybindingsConfigPrettyJson = KeybindingsConfigJson.pipe(Schema.encode({
	decode: PrettyJsonString,
	encode: PrettyJsonString
}));
function trimIssueMessage(message) {
	const trimmed = message.trim();
	return trimmed.length > 0 ? trimmed : "Invalid keybindings configuration.";
}
function malformedConfigIssue(detail) {
	return {
		kind: "keybindings.malformed-config",
		message: trimIssueMessage(detail)
	};
}
function invalidEntryIssue(index, detail) {
	return {
		kind: "keybindings.invalid-entry",
		index,
		message: trimIssueMessage(detail)
	};
}
function mergeWithDefaultKeybindings(custom) {
	if (custom.length === 0) return [...DEFAULT_RESOLVED_KEYBINDINGS];
	const overriddenCommands = new Set(custom.map((binding) => binding.command));
	const merged = [...DEFAULT_RESOLVED_KEYBINDINGS.filter((binding) => !overriddenCommands.has(binding.command)), ...custom];
	if (merged.length <= MAX_KEYBINDINGS_COUNT) return merged;
	return merged.slice(-MAX_KEYBINDINGS_COUNT);
}
/**
* Keybindings - Service tag for keybinding configuration operations.
*/
var Keybindings = class extends ServiceMap.Service()("t3/keybindings") {};
const makeKeybindings = Effect.gen(function* () {
	const { keybindingsConfigPath } = yield* ServerConfig;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const upsertSemaphore = yield* Semaphore$1.make(1);
	const resolvedConfigCacheKey = "resolved";
	const changesPubSub = yield* PubSub.unbounded();
	const startedRef = yield* Ref.make(false);
	const startedDeferred = yield* Deferred.make();
	const watcherScope = yield* Scope.make("sequential");
	yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
	const emitChange = (configState) => PubSub.publish(changesPubSub, configState).pipe(Effect.asVoid);
	const readConfigExists = fs.exists(keybindingsConfigPath).pipe(Effect.mapError((cause) => new KeybindingsConfigError({
		configPath: keybindingsConfigPath,
		detail: "failed to access keybindings config",
		cause
	})));
	const readRawConfig = fs.readFileString(keybindingsConfigPath).pipe(Effect.mapError((cause) => new KeybindingsConfigError({
		configPath: keybindingsConfigPath,
		detail: "failed to read keybindings config",
		cause
	})));
	const loadWritableCustomKeybindingsConfig = Effect.fn(function* () {
		if (!(yield* readConfigExists)) return [];
		const rawConfig = yield* readRawConfig.pipe(Effect.flatMap(Schema.decodeEffect(RawKeybindingsEntries)), Effect.mapError((cause) => new KeybindingsConfigError({
			configPath: keybindingsConfigPath,
			detail: "expected JSON array",
			cause
		})));
		return yield* Effect.forEach(rawConfig, (entry) => Effect.gen(function* () {
			const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(entry);
			if (decodedRule._tag === "Failure") {
				yield* Effect.logWarning("ignoring invalid keybinding entry", {
					path: keybindingsConfigPath,
					entry,
					error: Cause.pretty(decodedRule.cause)
				});
				return null;
			}
			const resolved = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
			if (resolved._tag === "Failure") {
				yield* Effect.logWarning("ignoring invalid keybinding entry", {
					path: keybindingsConfigPath,
					entry,
					error: Cause.pretty(resolved.cause)
				});
				return null;
			}
			return decodedRule.value;
		})).pipe(Effect.map(Array$1.filter(Predicate.isNotNull)));
	});
	const loadRuntimeCustomKeybindingsConfig = Effect.fn(function* () {
		if (!(yield* readConfigExists)) return {
			keybindings: [],
			issues: []
		};
		const rawConfig = yield* readRawConfig;
		const decodedEntries = Schema.decodeUnknownExit(RawKeybindingsEntries)(rawConfig);
		if (decodedEntries._tag === "Failure") return {
			keybindings: [],
			issues: [malformedConfigIssue(`expected JSON array (${Cause.pretty(decodedEntries.cause)})`)]
		};
		const keybindings = [];
		const issues = [];
		for (const [index, entry] of decodedEntries.value.entries()) {
			const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(entry);
			if (decodedRule._tag === "Failure") {
				const detail = Cause.pretty(decodedRule.cause);
				issues.push(invalidEntryIssue(index, detail));
				yield* Effect.logWarning("ignoring invalid keybinding entry", {
					path: keybindingsConfigPath,
					index,
					entry,
					error: detail
				});
				continue;
			}
			const resolvedRule = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
			if (resolvedRule._tag === "Failure") {
				const detail = Cause.pretty(resolvedRule.cause);
				issues.push(invalidEntryIssue(index, detail));
				yield* Effect.logWarning("ignoring invalid keybinding entry", {
					path: keybindingsConfigPath,
					index,
					entry,
					error: detail
				});
				continue;
			}
			keybindings.push(decodedRule.value);
		}
		return {
			keybindings,
			issues
		};
	});
	const writeConfigAtomically = (rules) => {
		const tempPath = `${keybindingsConfigPath}.${process.pid}.${Date.now()}.tmp`;
		return Schema.encodeEffect(KeybindingsConfigPrettyJson)(rules).pipe(Effect.map((encoded) => `${encoded}\n`), Effect.tap(() => fs.makeDirectory(path.dirname(keybindingsConfigPath), { recursive: true })), Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)), Effect.flatMap(() => fs.rename(tempPath, keybindingsConfigPath)), Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))), Effect.mapError((cause) => new KeybindingsConfigError({
			configPath: keybindingsConfigPath,
			detail: "failed to write keybindings config",
			cause
		})));
	};
	const loadConfigStateFromDisk = loadRuntimeCustomKeybindingsConfig().pipe(Effect.map(({ keybindings, issues }) => ({
		keybindings: mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(keybindings)),
		issues
	})));
	const resolvedConfigCache = yield* Cache.make({
		capacity: 1,
		lookup: () => loadConfigStateFromDisk
	});
	const loadConfigStateFromCacheOrDisk = Cache.get(resolvedConfigCache, resolvedConfigCacheKey);
	const revalidateAndEmit = upsertSemaphore.withPermits(1)(Effect.gen(function* () {
		yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
		yield* emitChange(yield* loadConfigStateFromCacheOrDisk);
	}));
	const syncDefaultKeybindingsOnStartup = upsertSemaphore.withPermits(1)(Effect.gen(function* () {
		if (!(yield* readConfigExists)) {
			yield* writeConfigAtomically(DEFAULT_KEYBINDINGS);
			yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
			return;
		}
		const runtimeConfig = yield* loadRuntimeCustomKeybindingsConfig();
		if (runtimeConfig.issues.length > 0) {
			yield* Effect.logWarning("skipping startup keybindings default sync because config has issues", {
				path: keybindingsConfigPath,
				issues: runtimeConfig.issues
			});
			yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
			return;
		}
		const customConfig = runtimeConfig.keybindings;
		const existingCommands = new Set(customConfig.map((entry) => entry.command));
		const missingDefaults = [];
		const shortcutConflictWarnings = [];
		for (const defaultRule of DEFAULT_KEYBINDINGS) {
			if (existingCommands.has(defaultRule.command)) continue;
			const conflictingEntry = customConfig.find((entry) => hasSameShortcutContext(entry, defaultRule));
			if (conflictingEntry) {
				shortcutConflictWarnings.push({
					defaultCommand: defaultRule.command,
					conflictingCommand: conflictingEntry.command,
					key: defaultRule.key,
					when: defaultRule.when ?? null
				});
				continue;
			}
			missingDefaults.push(defaultRule);
		}
		for (const conflict of shortcutConflictWarnings) yield* Effect.logWarning("skipping default keybinding due to shortcut conflict", {
			path: keybindingsConfigPath,
			defaultCommand: conflict.defaultCommand,
			conflictingCommand: conflict.conflictingCommand,
			key: conflict.key,
			when: conflict.when,
			reason: "shortcut context already used by existing rule"
		});
		if (missingDefaults.length === 0) {
			yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
			return;
		}
		const matchingDefaults = DEFAULT_KEYBINDINGS.filter((defaultRule) => customConfig.some((entry) => isSameKeybindingRule(entry, defaultRule))).map((rule) => rule.command);
		if (matchingDefaults.length > 0) yield* Effect.logWarning("default keybinding rule already defined in user config", {
			path: keybindingsConfigPath,
			commands: matchingDefaults
		});
		const nextConfig = [...customConfig, ...missingDefaults];
		const cappedConfig = nextConfig.length > MAX_KEYBINDINGS_COUNT ? nextConfig.slice(-MAX_KEYBINDINGS_COUNT) : nextConfig;
		if (nextConfig.length > MAX_KEYBINDINGS_COUNT) yield* Effect.logWarning("truncating keybindings config to max entries", {
			path: keybindingsConfigPath,
			maxEntries: MAX_KEYBINDINGS_COUNT
		});
		yield* writeConfigAtomically(cappedConfig);
		yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
	}));
	const startWatcher = Effect.gen(function* () {
		const keybindingsConfigDir = path.dirname(keybindingsConfigPath);
		const keybindingsConfigFile = path.basename(keybindingsConfigPath);
		const keybindingsConfigPathResolved = path.resolve(keybindingsConfigPath);
		yield* fs.makeDirectory(keybindingsConfigDir, { recursive: true }).pipe(Effect.mapError((cause) => new KeybindingsConfigError({
			configPath: keybindingsConfigPath,
			detail: "failed to prepare keybindings config directory",
			cause
		})));
		const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));
		const debouncedKeybindingsEvents = fs.watch(keybindingsConfigDir).pipe(Stream.filter((event) => {
			return event.path === keybindingsConfigFile || event.path === keybindingsConfigPath || path.resolve(keybindingsConfigDir, event.path) === keybindingsConfigPathResolved;
		}), Stream.debounce(Duration.millis(100)));
		yield* Stream.runForEach(debouncedKeybindingsEvents, () => revalidateAndEmitSafely).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
	});
	return {
		start: Effect.gen(function* () {
			if (yield* Ref.get(startedRef)) return yield* Deferred.await(startedDeferred);
			yield* Ref.set(startedRef, true);
			const startup = Effect.gen(function* () {
				yield* startWatcher;
				yield* syncDefaultKeybindingsOnStartup;
				yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
				yield* loadConfigStateFromCacheOrDisk;
			});
			const startupExit = yield* Effect.exit(startup);
			if (startupExit._tag === "Failure") {
				yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
				return yield* Effect.failCause(startupExit.cause);
			}
			yield* Deferred.succeed(startedDeferred, void 0).pipe(Effect.orDie);
		}),
		ready: Deferred.await(startedDeferred),
		syncDefaultKeybindingsOnStartup,
		loadConfigState: loadConfigStateFromCacheOrDisk,
		getSnapshot: loadConfigStateFromCacheOrDisk,
		get streamChanges() {
			return Stream.fromPubSub(changesPubSub);
		},
		upsertKeybindingRule: (rule) => upsertSemaphore.withPermits(1)(Effect.gen(function* () {
			const nextConfig = [...(yield* loadWritableCustomKeybindingsConfig()).filter((entry) => entry.command !== rule.command), rule];
			const cappedConfig = nextConfig.length > MAX_KEYBINDINGS_COUNT ? nextConfig.slice(-MAX_KEYBINDINGS_COUNT) : nextConfig;
			if (nextConfig.length > MAX_KEYBINDINGS_COUNT) yield* Effect.logWarning("truncating keybindings config to max entries", {
				path: keybindingsConfigPath,
				maxEntries: MAX_KEYBINDINGS_COUNT
			});
			yield* writeConfigAtomically(cappedConfig);
			const nextResolved = mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(cappedConfig));
			yield* Cache.set(resolvedConfigCache, resolvedConfigCacheKey, {
				keybindings: nextResolved,
				issues: []
			});
			yield* emitChange({
				keybindings: nextResolved,
				issues: []
			});
			return nextResolved;
		}))
	};
});
const KeybindingsLive = Layer.effect(Keybindings, makeKeybindings);

//#endregion
//#region src/open.ts
/**
* Open - Browser/editor launch service interface.
*
* Owns process launch helpers for opening URLs in a browser and workspace
* paths in a configured editor.
*
* @module Open
*/
const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;
function parseTargetPathAndPosition(target) {
	const match = TARGET_WITH_POSITION_PATTERN.exec(target);
	if (!match?.[1] || !match[2]) return null;
	return {
		path: match[1],
		line: match[2],
		column: match[3]
	};
}
function resolveCommandEditorArgs(editor, target) {
	const parsedTarget = parseTargetPathAndPosition(target);
	switch (editor.launchStyle) {
		case "direct-path": return [target];
		case "goto": return parsedTarget ? ["--goto", target] : [target];
		case "line-column": {
			if (!parsedTarget) return [target];
			const { path, line, column } = parsedTarget;
			return [
				...line ? ["--line", line] : [],
				...column ? ["--column", column] : [],
				path
			];
		}
	}
}
function fileManagerCommandForPlatform(platform) {
	switch (platform) {
		case "darwin": return "open";
		case "win32": return "explorer";
		default: return "xdg-open";
	}
}
function stripWrappingQuotes(value) {
	return value.replace(/^"+|"+$/g, "");
}
function resolvePathEnvironmentVariable(env) {
	return env.PATH ?? env.Path ?? env.path ?? "";
}
function resolveWindowsPathExtensions(env) {
	const rawValue = env.PATHEXT;
	const fallback = [
		".COM",
		".EXE",
		".BAT",
		".CMD"
	];
	if (!rawValue) return fallback;
	const parsed = rawValue.split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0).map((entry) => entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`);
	return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}
function resolveCommandCandidates(command, platform, windowsPathExtensions) {
	if (platform !== "win32") return [command];
	const extension = extname(command);
	const normalizedExtension = extension.toUpperCase();
	if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
		const commandWithoutExtension = command.slice(0, -extension.length);
		return Array.from(new Set([
			command,
			`${commandWithoutExtension}${normalizedExtension}`,
			`${commandWithoutExtension}${normalizedExtension.toLowerCase()}`
		]));
	}
	const candidates = [];
	for (const extension of windowsPathExtensions) {
		candidates.push(`${command}${extension}`);
		candidates.push(`${command}${extension.toLowerCase()}`);
	}
	return Array.from(new Set(candidates));
}
function isExecutableFile(filePath, platform, windowsPathExtensions) {
	try {
		if (!statSync(filePath).isFile()) return false;
		if (platform === "win32") {
			const extension = extname(filePath);
			if (extension.length === 0) return false;
			return windowsPathExtensions.includes(extension.toUpperCase());
		}
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
function resolvePathDelimiter(platform) {
	return platform === "win32" ? ";" : ":";
}
function isCommandAvailable(command, options = {}) {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
	const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);
	if (command.includes("/") || command.includes("\\")) return commandCandidates.some((candidate) => isExecutableFile(candidate, platform, windowsPathExtensions));
	const pathValue = resolvePathEnvironmentVariable(env);
	if (pathValue.length === 0) return false;
	const pathEntries = pathValue.split(resolvePathDelimiter(platform)).map((entry) => stripWrappingQuotes(entry.trim())).filter((entry) => entry.length > 0);
	for (const pathEntry of pathEntries) for (const candidate of commandCandidates) if (isExecutableFile(join(pathEntry, candidate), platform, windowsPathExtensions)) return true;
	return false;
}
function resolveAvailableEditors(platform = process.platform, env = process.env) {
	const available = [];
	for (const editor of EDITORS) if (isCommandAvailable(editor.command ?? fileManagerCommandForPlatform(platform), {
		platform,
		env
	})) available.push(editor.id);
	return available;
}
/**
* Open - Service tag for browser/editor launch operations.
*/
var Open = class extends ServiceMap.Service()("t3/open") {};
const resolveEditorLaunch = Effect.fn("resolveEditorLaunch")(function* (input, platform = process.platform) {
	yield* Effect.annotateCurrentSpan({
		"open.editor": input.editor,
		"open.cwd": input.cwd,
		"open.platform": platform
	});
	const editorDef = EDITORS.find((editor) => editor.id === input.editor);
	if (!editorDef) return yield* new OpenError({ message: `Unknown editor: ${input.editor}` });
	if (editorDef.command) return {
		command: editorDef.command,
		args: resolveCommandEditorArgs(editorDef, input.cwd)
	};
	if (editorDef.id !== "file-manager") return yield* new OpenError({ message: `Unsupported editor: ${input.editor}` });
	return {
		command: fileManagerCommandForPlatform(platform),
		args: [input.cwd]
	};
});
const launchDetached = (launch) => Effect.gen(function* () {
	if (!isCommandAvailable(launch.command)) return yield* new OpenError({ message: `Editor command not found: ${launch.command}` });
	yield* Effect.callback((resume) => {
		let child;
		try {
			child = spawn(launch.command, [...launch.args], {
				detached: true,
				stdio: "ignore",
				shell: process.platform === "win32"
			});
		} catch (error) {
			return resume(Effect.fail(new OpenError({
				message: "failed to spawn detached process",
				cause: error
			})));
		}
		const handleSpawn = () => {
			child.unref();
			resume(Effect.void);
		};
		child.once("spawn", handleSpawn);
		child.once("error", (cause) => resume(Effect.fail(new OpenError({
			message: "failed to spawn detached process",
			cause
		}))));
	});
});
const make$4 = Effect.gen(function* () {
	const open = yield* Effect.tryPromise({
		try: () => import("open"),
		catch: (cause) => new OpenError({
			message: "failed to load browser opener",
			cause
		})
	});
	return {
		openBrowser: (target) => Effect.tryPromise({
			try: () => open.default(target),
			catch: (cause) => new OpenError({
				message: "Browser auto-open failed",
				cause
			})
		}),
		openInEditor: (input) => Effect.flatMap(resolveEditorLaunch(input), launchDetached)
	};
});
const OpenLive = Layer.effect(Open, make$4);

//#endregion
//#region src/workspace/Services/WorkspacePaths.ts
/**
* WorkspacePaths - Effect service contract for workspace path handling.
*
* Owns normalization and validation of workspace roots plus safe resolution of
* workspace-root-relative paths.
*
* @module WorkspacePaths
*/
var WorkspaceRootNotExistsError = class extends Schema.TaggedErrorClass()("WorkspaceRootNotExistsError", {
	workspaceRoot: Schema.String,
	normalizedWorkspaceRoot: Schema.String
}) {
	get message() {
		return `Workspace root does not exist: ${this.normalizedWorkspaceRoot}`;
	}
};
var WorkspaceRootNotDirectoryError = class extends Schema.TaggedErrorClass()("WorkspaceRootNotDirectoryError", {
	workspaceRoot: Schema.String,
	normalizedWorkspaceRoot: Schema.String
}) {
	get message() {
		return `Workspace root is not a directory: ${this.normalizedWorkspaceRoot}`;
	}
};
var WorkspacePathOutsideRootError = class extends Schema.TaggedErrorClass()("WorkspacePathOutsideRootError", {
	workspaceRoot: Schema.String,
	relativePath: Schema.String
}) {
	get message() {
		return `Workspace file path must be relative to the project root: ${this.relativePath}`;
	}
};
const WorkspacePathsError = Schema.Union([
	WorkspaceRootNotExistsError,
	WorkspaceRootNotDirectoryError,
	WorkspacePathOutsideRootError
]);
/**
* WorkspacePaths - Service tag for workspace path normalization and resolution.
*/
var WorkspacePaths = class extends ServiceMap.Service()("t3/workspace/Services/WorkspacePaths") {};

//#endregion
//#region src/orchestration/Normalizer.ts
const normalizeDispatchCommand = (command) => Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const serverConfig = yield* ServerConfig;
	const workspacePaths = yield* WorkspacePaths;
	const normalizeProjectWorkspaceRoot = (workspaceRoot) => workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(Effect.mapError((cause) => new OrchestrationDispatchCommandError({ message: cause.message })));
	if (command.type === "project.create") return {
		...command,
		workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot)
	};
	if (command.type === "project.meta.update" && command.workspaceRoot !== void 0) return {
		...command,
		workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot)
	};
	if (command.type !== "thread.turn.start") return command;
	const normalizedAttachments = yield* Effect.forEach(command.message.attachments, (attachment) => Effect.gen(function* () {
		const parsed = parseBase64DataUrl(attachment.dataUrl);
		if (!parsed || !parsed.mimeType.startsWith("image/")) return yield* new OrchestrationDispatchCommandError({ message: `Invalid image attachment payload for '${attachment.name}'.` });
		const bytes = Buffer.from(parsed.base64, "base64");
		if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return yield* new OrchestrationDispatchCommandError({ message: `Image attachment '${attachment.name}' is empty or too large.` });
		const attachmentId = createAttachmentId(command.threadId);
		if (!attachmentId) return yield* new OrchestrationDispatchCommandError({ message: "Failed to create a safe attachment id." });
		const persistedAttachment = {
			type: "image",
			id: attachmentId,
			name: attachment.name,
			mimeType: parsed.mimeType.toLowerCase(),
			sizeBytes: bytes.byteLength
		};
		const attachmentPath = resolveAttachmentPath({
			attachmentsDir: serverConfig.attachmentsDir,
			attachment: persistedAttachment
		});
		if (!attachmentPath) return yield* new OrchestrationDispatchCommandError({ message: `Failed to resolve persisted path for '${attachment.name}'.` });
		yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(Effect.mapError(() => new OrchestrationDispatchCommandError({ message: `Failed to create attachment directory for '${attachment.name}'.` })));
		yield* fileSystem.writeFile(attachmentPath, bytes).pipe(Effect.mapError(() => new OrchestrationDispatchCommandError({ message: `Failed to persist attachment '${attachment.name}'.` })));
		return persistedAttachment;
	}), { concurrency: 1 });
	return {
		...command,
		message: {
			...command.message,
			attachments: normalizedAttachments
		}
	};
});

//#endregion
//#region src/orchestration/Services/OrchestrationEngine.ts
/**
* OrchestrationEngineService - Service tag for orchestration engine access.
*
* @example
* ```ts
* const program = Effect.gen(function* () {
*   const engine = yield* OrchestrationEngineService
*   return yield* engine.getReadModel()
* })
* ```
*/
var OrchestrationEngineService = class extends ServiceMap.Service()("t3/orchestration/Services/OrchestrationEngine/OrchestrationEngineService") {};

//#endregion
//#region src/orchestration/Services/ProjectionSnapshotQuery.ts
/**
* ProjectionSnapshotQuery - Service tag for projection snapshot queries.
*/
var ProjectionSnapshotQuery = class extends ServiceMap.Service()("t3/orchestration/Services/ProjectionSnapshotQuery") {};

//#endregion
//#region src/observability/Metrics.ts
const rpcRequestsTotal = Metric.counter("t3_rpc_requests_total", { description: "Total RPC requests handled by the websocket RPC server." });
const rpcRequestDuration = Metric.timer("t3_rpc_request_duration", { description: "RPC request handling duration." });
const orchestrationCommandsTotal = Metric.counter("t3_orchestration_commands_total", { description: "Total orchestration commands dispatched." });
const orchestrationCommandDuration = Metric.timer("t3_orchestration_command_duration", { description: "Orchestration command dispatch duration." });
const orchestrationCommandAckDuration = Metric.timer("t3_orchestration_command_ack_duration", { description: "Time from orchestration command dispatch to the first committed domain event emitted for that command." });
const orchestrationEventsProcessedTotal = Metric.counter("t3_orchestration_events_processed_total", { description: "Total orchestration intent events processed by runtime reactors." });
const providerSessionsTotal = Metric.counter("t3_provider_sessions_total", { description: "Total provider session lifecycle operations." });
const providerTurnsTotal = Metric.counter("t3_provider_turns_total", { description: "Total provider turn lifecycle operations." });
const providerTurnDuration = Metric.timer("t3_provider_turn_duration", { description: "Provider turn request duration." });
const providerRuntimeEventsTotal = Metric.counter("t3_provider_runtime_events_total", { description: "Total canonical provider runtime events processed." });
const gitCommandsTotal = Metric.counter("t3_git_commands_total", { description: "Total git commands executed by the server runtime." });
const gitCommandDuration = Metric.timer("t3_git_command_duration", { description: "Git command execution duration." });
const terminalSessionsTotal = Metric.counter("t3_terminal_sessions_total", { description: "Total terminal sessions started." });
const terminalRestartsTotal = Metric.counter("t3_terminal_restarts_total", { description: "Total terminal restart requests handled." });
const metricAttributes = (attributes) => Object.entries(compactMetricAttributes(attributes));
const increment = (metric, attributes, amount = 1) => Metric.update(Metric.withAttributes(metric, metricAttributes(attributes)), amount);
const withMetricsImpl = (effect, options) => Effect.gen(function* () {
	const startedAt = Date.now();
	const exit = yield* Effect.exit(effect);
	const duration = Duration.millis(Math.max(0, Date.now() - startedAt));
	const baseAttributes = typeof options.attributes === "function" ? options.attributes() : options.attributes ?? {};
	if (options.timer) yield* Metric.update(Metric.withAttributes(options.timer, metricAttributes(baseAttributes)), duration);
	if (options.counter) {
		const outcome = outcomeFromExit(exit);
		yield* Metric.update(Metric.withAttributes(options.counter, metricAttributes({
			...baseAttributes,
			outcome,
			...options.outcomeAttributes ? options.outcomeAttributes(outcome) : {}
		})), 1);
	}
	if (Exit.isSuccess(exit)) return exit.value;
	return yield* Effect.failCause(exit.cause);
});
const withMetrics = dual(2, withMetricsImpl);
const providerMetricAttributes = (provider, extra) => compactMetricAttributes({
	provider,
	...extra
});
const providerTurnMetricAttributes = (input) => {
	const modelFamily = normalizeModelMetricLabel(input.model);
	return compactMetricAttributes({
		provider: input.provider,
		...modelFamily ? { modelFamily } : {},
		...input.extra
	});
};

//#endregion
//#region src/observability/RpcInstrumentation.ts
const annotateRpcSpan = (method, traceAttributes) => Effect.annotateCurrentSpan({
	"rpc.method": method,
	...traceAttributes
});
const recordRpcStreamMetrics = (method, startedAt, exit) => Effect.gen(function* () {
	yield* Metric.update(Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })), Duration.millis(Math.max(0, Date.now() - startedAt)));
	yield* Metric.update(Metric.withAttributes(rpcRequestsTotal, metricAttributes({
		method,
		outcome: outcomeFromExit(exit)
	})), 1);
});
const observeRpcEffect = (method, effect, traceAttributes) => Effect.gen(function* () {
	yield* annotateRpcSpan(method, traceAttributes);
	return yield* effect.pipe(withMetrics({
		counter: rpcRequestsTotal,
		timer: rpcRequestDuration,
		attributes: { method }
	}));
});
const observeRpcStream = (method, stream, traceAttributes) => Stream.unwrap(Effect.gen(function* () {
	yield* annotateRpcSpan(method, traceAttributes);
	const startedAt = Date.now();
	return stream.pipe(Stream.onExit((exit) => recordRpcStreamMetrics(method, startedAt, exit)));
}));
const observeRpcStreamEffect = (method, effect, traceAttributes) => Stream.unwrap(Effect.gen(function* () {
	yield* annotateRpcSpan(method, traceAttributes);
	const startedAt = Date.now();
	const exit = yield* Effect.exit(effect);
	if (Exit.isFailure(exit)) {
		yield* recordRpcStreamMetrics(method, startedAt, exit);
		return yield* Effect.failCause(exit.cause);
	}
	return exit.value.pipe(Stream.onExit((streamExit) => recordRpcStreamMetrics(method, startedAt, streamExit)));
}));

//#endregion
//#region src/provider/Services/ProviderRegistry.ts
var ProviderRegistry = class extends ServiceMap.Service()("t3/provider/Services/ProviderRegistry") {};

//#endregion
//#region src/serverLifecycleEvents.ts
var ServerLifecycleEvents = class extends ServiceMap.Service()("t3/serverLifecycleEvents") {};
const ServerLifecycleEventsLive = Layer.effect(ServerLifecycleEvents, Effect.gen(function* () {
	const pubsub = yield* PubSub.unbounded();
	const state = yield* Ref.make({
		sequence: 0,
		events: []
	});
	return {
		publish: (event) => Ref.modify(state, (current) => {
			const nextSequence = current.sequence + 1;
			const nextEvent = {
				...event,
				sequence: nextSequence
			};
			return [nextEvent, {
				sequence: nextSequence,
				events: nextEvent.type === "welcome" ? [nextEvent, ...current.events.filter((entry) => entry.type !== "welcome")] : [nextEvent, ...current.events.filter((entry) => entry.type !== "ready")]
			}];
		}).pipe(Effect.tap((event) => PubSub.publish(pubsub, event))),
		snapshot: Ref.get(state),
		get stream() {
			return Stream.fromPubSub(pubsub);
		}
	};
}));

//#endregion
//#region src/orchestration/Services/OrchestrationReactor.ts
/**
* OrchestrationReactor - Composite orchestration reactor service interface.
*
* Coordinates startup of orchestration runtime reactors that translate domain
* events into downstream side effects.
*
* @module OrchestrationReactor
*/
/**
* OrchestrationReactor - Service tag for orchestration reactor coordination.
*/
var OrchestrationReactor = class extends ServiceMap.Service()("t3/orchestration/Services/OrchestrationReactor") {};

//#endregion
//#region ../../packages/shared/src/Struct.ts
function deepMerge(current, patch) {
	if (!P.isObject(current) || !P.isObject(patch)) return patch;
	const next = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === void 0) continue;
		const existing = next[key];
		next[key] = P.isObject(existing) && P.isObject(value) ? deepMerge(existing, value) : value;
	}
	return next;
}

//#endregion
//#region src/serverSettings.ts
/**
* ServerSettings - Server-authoritative settings service.
*
* Owns persistence, validation, and change notification of settings that affect
* server-side behavior (binary paths, streaming mode, env mode, custom models,
* text generation model selection).
*
* Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
* Semaphore + FileSystem.watch for concurrency and external edit detection.
*
* @module ServerSettings
*/
var ServerSettingsService = class ServerSettingsService extends ServiceMap.Service()("t3/serverSettings/ServerSettingsService") {
	static layerTest = (overrides = {}) => Layer.effect(ServerSettingsService, Effect.gen(function* () {
		const currentSettingsRef = yield* Ref.make(deepMerge(DEFAULT_SERVER_SETTINGS, overrides));
		return {
			start: Effect.void,
			ready: Effect.void,
			getSettings: Ref.get(currentSettingsRef),
			updateSettings: (patch) => Ref.get(currentSettingsRef).pipe(Effect.map((currentSettings) => deepMerge(currentSettings, patch)), Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings))),
			streamChanges: Stream.empty
		};
	}));
};
const ServerSettingsJson = fromLenientJson(ServerSettings);
const PROVIDER_ORDER = ["codex", "claudeAgent"];
/**
* Ensure the `textGenerationModelSelection` points to an enabled provider.
* If the selected provider is disabled, fall back to the first enabled
* provider with its default model.  This is applied at read-time so the
* persisted preference is preserved for when a provider is re-enabled.
*/
function resolveTextGenerationProvider(settings) {
	const selection = settings.textGenerationModelSelection;
	if (settings.providers[selection.provider].enabled) return settings;
	const fallback = PROVIDER_ORDER.find((p) => settings.providers[p].enabled);
	if (!fallback) return settings;
	return {
		...settings,
		textGenerationModelSelection: {
			provider: fallback,
			model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback]
		}
	};
}
const ATOMIC_SETTINGS_KEYS = new Set(["textGenerationModelSelection"]);
function stripDefaultServerSettings(current, defaults) {
	if (Array.isArray(current) || Array.isArray(defaults)) return Equal.equals(current, defaults) ? void 0 : current;
	if (current !== null && defaults !== null && typeof current === "object" && typeof defaults === "object") {
		const currentRecord = current;
		const defaultsRecord = defaults;
		const next = {};
		for (const key of Object.keys(currentRecord)) if (ATOMIC_SETTINGS_KEYS.has(key)) {
			if (!Equal.equals(currentRecord[key], defaultsRecord[key])) next[key] = currentRecord[key];
		} else {
			const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key]);
			if (stripped !== void 0) next[key] = stripped;
		}
		return Object.keys(next).length > 0 ? next : void 0;
	}
	return Object.is(current, defaults) ? void 0 : current;
}
const makeServerSettings = Effect.gen(function* () {
	const { settingsPath } = yield* ServerConfig;
	const fs = yield* FileSystem.FileSystem;
	const pathService = yield* Path.Path;
	const writeSemaphore = yield* Semaphore$1.make(1);
	const cacheKey = "settings";
	const changesPubSub = yield* PubSub.unbounded();
	const startedRef = yield* Ref.make(false);
	const startedDeferred = yield* Deferred.make();
	const watcherScope = yield* Scope.make("sequential");
	yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
	const emitChange = (settings) => PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);
	const readConfigExists = fs.exists(settingsPath).pipe(Effect.mapError((cause) => new ServerSettingsError({
		settingsPath,
		detail: "failed to check settings file existence",
		cause
	})));
	const readRawConfig = fs.readFileString(settingsPath).pipe(Effect.mapError((cause) => new ServerSettingsError({
		settingsPath,
		detail: "failed to read settings file",
		cause
	})));
	const loadSettingsFromDisk = Effect.gen(function* () {
		if (!(yield* readConfigExists)) return DEFAULT_SERVER_SETTINGS;
		const raw = yield* readRawConfig;
		const decoded = Schema.decodeUnknownExit(ServerSettingsJson)(raw);
		if (decoded._tag === "Failure") {
			yield* Effect.logWarning("failed to parse settings.json, using defaults", {
				path: settingsPath,
				issues: Cause.pretty(decoded.cause)
			});
			return DEFAULT_SERVER_SETTINGS;
		}
		return decoded.value;
	});
	const settingsCache = yield* Cache.make({
		capacity: 1,
		lookup: () => loadSettingsFromDisk
	});
	const getSettingsFromCache = Cache.get(settingsCache, cacheKey);
	const writeSettingsAtomically = (settings) => {
		const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
		const sparseSettings = stripDefaultServerSettings(settings, DEFAULT_SERVER_SETTINGS) ?? {};
		return Effect.succeed(`${JSON.stringify(sparseSettings, null, 2)}\n`).pipe(Effect.tap(() => fs.makeDirectory(pathService.dirname(settingsPath), { recursive: true })), Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)), Effect.flatMap(() => fs.rename(tempPath, settingsPath)), Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))), Effect.mapError((cause) => new ServerSettingsError({
			settingsPath,
			detail: "failed to write settings file",
			cause
		})));
	};
	const revalidateAndEmit = writeSemaphore.withPermits(1)(Effect.gen(function* () {
		yield* Cache.invalidate(settingsCache, cacheKey);
		yield* emitChange(yield* getSettingsFromCache);
	}));
	const startWatcher = Effect.gen(function* () {
		const settingsDir = pathService.dirname(settingsPath);
		const settingsFile = pathService.basename(settingsPath);
		const settingsPathResolved = pathService.resolve(settingsPath);
		yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(Effect.mapError((cause) => new ServerSettingsError({
			settingsPath,
			detail: "failed to prepare settings directory",
			cause
		})));
		const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));
		const debouncedSettingsEvents = fs.watch(settingsDir).pipe(Stream.filter((event) => {
			return event.path === settingsFile || event.path === settingsPath || pathService.resolve(settingsDir, event.path) === settingsPathResolved;
		}), Stream.debounce(Duration.millis(100)));
		yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
	});
	return {
		start: Effect.gen(function* () {
			if (!(yield* Ref.modify(startedRef, (started) => [!started, true]))) return yield* Deferred.await(startedDeferred);
			const startup = Effect.gen(function* () {
				yield* startWatcher;
				yield* Cache.invalidate(settingsCache, cacheKey);
				yield* getSettingsFromCache;
			});
			const startupExit = yield* Effect.exit(startup);
			if (startupExit._tag === "Failure") {
				yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
				return yield* Effect.failCause(startupExit.cause);
			}
			yield* Deferred.succeed(startedDeferred, void 0).pipe(Effect.orDie);
		}),
		ready: Deferred.await(startedDeferred),
		getSettings: getSettingsFromCache.pipe(Effect.map(resolveTextGenerationProvider)),
		updateSettings: (patch) => writeSemaphore.withPermits(1)(Effect.gen(function* () {
			const current = yield* getSettingsFromCache;
			const next = yield* Schema.decodeEffect(ServerSettings)(deepMerge(current, patch)).pipe(Effect.mapError((cause) => new ServerSettingsError({
				settingsPath: "<memory>",
				detail: `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
				cause
			})));
			yield* writeSettingsAtomically(next);
			yield* Cache.set(settingsCache, cacheKey, next);
			yield* emitChange(next);
			return resolveTextGenerationProvider(next);
		})),
		get streamChanges() {
			return Stream.fromPubSub(changesPubSub).pipe(Stream.map(resolveTextGenerationProvider));
		}
	};
});
const ServerSettingsLive = Layer.effect(ServerSettingsService, makeServerSettings);

//#endregion
//#region src/telemetry/Services/AnalyticsService.ts
/**
* AnalyticsService - Anonymous telemetry capture contract.
*
* Provides a best-effort event API for runtime telemetry and a strict
* `captureImmediate` method for call sites that need explicit error handling.
*
* @module AnalyticsService
*/
var AnalyticsService = class AnalyticsService extends ServiceMap.Service()("t3/telemetry/Services/AnalyticsService") {
	static layerTest = Layer.succeed(AnalyticsService, {
		record: () => Effect.void,
		flush: Effect.void
	});
};

//#endregion
//#region src/serverRuntimeStartup.ts
const isWildcardHost = (host) => host === "0.0.0.0" || host === "::" || host === "[::]";
const formatHostForUrl = (host) => host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
var ServerRuntimeStartupError = class extends Data.TaggedError("ServerRuntimeStartupError") {};
var ServerRuntimeStartup = class extends ServiceMap.Service()("t3/serverRuntimeStartup") {};
const settleQueuedCommand = (deferred, exit) => Exit.isSuccess(exit) ? Deferred.succeed(deferred, exit.value) : Deferred.failCause(deferred, exit.cause);
const makeCommandGate = Effect.gen(function* () {
	const commandReady = yield* Deferred.make();
	const commandQueue = yield* Queue.unbounded();
	const commandReadinessState = yield* Ref.make("pending");
	const commandWorker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)));
	yield* Effect.forkScoped(commandWorker);
	return {
		awaitCommandReady: Deferred.await(commandReady),
		signalCommandReady: Effect.gen(function* () {
			yield* Ref.set(commandReadinessState, "ready");
			yield* Deferred.succeed(commandReady, void 0).pipe(Effect.orDie);
		}),
		failCommandReady: (error) => Effect.gen(function* () {
			yield* Ref.set(commandReadinessState, error);
			yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
		}),
		enqueueCommand: (effect) => Effect.gen(function* () {
			const readinessState = yield* Ref.get(commandReadinessState);
			if (readinessState === "ready") return yield* effect;
			if (readinessState !== "pending") return yield* readinessState;
			const result = yield* Deferred.make();
			yield* Queue.offer(commandQueue, { run: Deferred.await(commandReady).pipe(Effect.flatMap(() => effect), Effect.exit, Effect.flatMap((exit) => settleQueuedCommand(result, exit))) });
			return yield* Deferred.await(result);
		})
	};
});
const recordStartupHeartbeat = Effect.gen(function* () {
	const analytics = yield* AnalyticsService;
	const { threadCount, projectCount } = yield* (yield* ProjectionSnapshotQuery).getCounts().pipe(Effect.catch((cause) => Effect.logWarning("failed to gather startup projection counts for telemetry", { cause }).pipe(Effect.as({
		threadCount: 0,
		projectCount: 0
	}))));
	yield* analytics.record("server.boot.heartbeat", {
		threadCount,
		projectCount
	});
});
const launchStartupHeartbeat = recordStartupHeartbeat.pipe(Effect.annotateSpans({ "startup.phase": "heartbeat.record" }), Effect.withSpan("server.startup.heartbeat.record"), Effect.ignoreCause({ log: true }), Effect.forkScoped, Effect.asVoid);
const autoBootstrapWelcome = Effect.gen(function* () {
	const serverConfig = yield* ServerConfig;
	const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
	const orchestrationEngine = yield* OrchestrationEngineService;
	const path = yield* Path.Path;
	let bootstrapProjectId;
	let bootstrapThreadId;
	if (serverConfig.autoBootstrapProjectFromCwd) yield* Effect.gen(function* () {
		const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(serverConfig.cwd);
		let nextProjectId;
		let nextProjectDefaultModelSelection;
		if (Option.isNone(existingProject)) {
			const createdAt = (/* @__PURE__ */ new Date()).toISOString();
			nextProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
			const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
			nextProjectDefaultModelSelection = {
				provider: "codex",
				model: "gpt-5-codex"
			};
			yield* orchestrationEngine.dispatch({
				type: "project.create",
				commandId: CommandId.makeUnsafe(crypto.randomUUID()),
				projectId: nextProjectId,
				title: bootstrapProjectTitle,
				workspaceRoot: serverConfig.cwd,
				defaultModelSelection: nextProjectDefaultModelSelection,
				createdAt
			});
		} else {
			nextProjectId = existingProject.value.id;
			nextProjectDefaultModelSelection = existingProject.value.defaultModelSelection ?? {
				provider: "codex",
				model: "gpt-5-codex"
			};
		}
		const existingThreadId = yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);
		if (Option.isNone(existingThreadId)) {
			const createdAt = (/* @__PURE__ */ new Date()).toISOString();
			const createdThreadId = ThreadId.makeUnsafe(crypto.randomUUID());
			yield* orchestrationEngine.dispatch({
				type: "thread.create",
				commandId: CommandId.makeUnsafe(crypto.randomUUID()),
				threadId: createdThreadId,
				projectId: nextProjectId,
				title: "New thread",
				modelSelection: nextProjectDefaultModelSelection,
				interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
				runtimeMode: "full-access",
				branch: null,
				worktreePath: null,
				createdAt
			});
			bootstrapProjectId = nextProjectId;
			bootstrapThreadId = createdThreadId;
		} else {
			bootstrapProjectId = nextProjectId;
			bootstrapThreadId = existingThreadId.value;
		}
	});
	const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
	const projectName = segments[segments.length - 1] ?? "project";
	return {
		cwd: serverConfig.cwd,
		projectName,
		...bootstrapProjectId ? { bootstrapProjectId } : {},
		...bootstrapThreadId ? { bootstrapThreadId } : {}
	};
});
const maybeOpenBrowser = Effect.gen(function* () {
	const serverConfig = yield* ServerConfig;
	if (serverConfig.noBrowser) return;
	const { openBrowser } = yield* Open;
	const localUrl = `http://localhost:${serverConfig.port}`;
	const bindUrl = serverConfig.host && !isWildcardHost(serverConfig.host) ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}` : localUrl;
	const target = serverConfig.devUrl?.toString() ?? bindUrl;
	yield* openBrowser(target).pipe(Effect.catch(() => Effect.logInfo("browser auto-open unavailable", { hint: `Open ${target} in your browser.` })));
});
const runStartupPhase = (phase, effect) => effect.pipe(Effect.annotateSpans({ "startup.phase": phase }), Effect.withSpan(`server.startup.${phase}`));
const makeServerRuntimeStartup = Effect.gen(function* () {
	const serverConfig = yield* ServerConfig;
	const keybindings = yield* Keybindings;
	const orchestrationReactor = yield* OrchestrationReactor;
	const lifecycleEvents = yield* ServerLifecycleEvents;
	const serverSettings = yield* ServerSettingsService;
	const commandGate = yield* makeCommandGate;
	const httpListening = yield* Deferred.make();
	const reactorScope = yield* Scope.make("sequential");
	yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));
	const startup = Effect.gen(function* () {
		yield* Effect.logDebug("startup phase: starting keybindings runtime");
		yield* runStartupPhase("keybindings.start", keybindings.start.pipe(Effect.catch((error) => Effect.logWarning("failed to start keybindings runtime", {
			path: error.configPath,
			detail: error.detail,
			cause: error.cause
		})), Effect.forkScoped));
		yield* Effect.logDebug("startup phase: starting server settings runtime");
		yield* runStartupPhase("settings.start", serverSettings.start.pipe(Effect.catch((error) => Effect.logWarning("failed to start server settings runtime", {
			path: error.settingsPath,
			detail: error.detail,
			cause: error.cause
		})), Effect.forkScoped));
		yield* Effect.logDebug("startup phase: starting orchestration reactors");
		yield* runStartupPhase("reactors.start", orchestrationReactor.start().pipe(Scope.provide(reactorScope)));
		yield* Effect.logDebug("startup phase: preparing welcome payload");
		const welcome = yield* runStartupPhase("welcome.prepare", autoBootstrapWelcome);
		yield* Effect.logDebug("startup phase: publishing welcome event", {
			cwd: welcome.cwd,
			projectName: welcome.projectName,
			bootstrapProjectId: welcome.bootstrapProjectId,
			bootstrapThreadId: welcome.bootstrapThreadId
		});
		yield* runStartupPhase("welcome.publish", lifecycleEvents.publish({
			version: 1,
			type: "welcome",
			payload: welcome
		}));
	}).pipe(Effect.annotateSpans({
		"server.mode": serverConfig.mode,
		"server.port": serverConfig.port,
		"server.host": serverConfig.host ?? "default"
	}), Effect.withSpan("server.startup", {
		kind: "server",
		root: true
	}));
	yield* Effect.forkScoped(Effect.gen(function* () {
		const startupExit = yield* Effect.exit(startup);
		if (Exit.isFailure(startupExit)) {
			const error = new ServerRuntimeStartupError({
				message: "Server runtime startup failed before command readiness.",
				cause: startupExit.cause
			});
			yield* Effect.logError("server runtime startup failed", { cause: startupExit.cause });
			yield* commandGate.failCommandReady(error);
			return;
		}
		yield* Effect.logDebug("Accepting commands");
		yield* commandGate.signalCommandReady;
		yield* Effect.logDebug("startup phase: waiting for http listener");
		yield* runStartupPhase("http.wait", Deferred.await(httpListening));
		yield* Effect.logDebug("startup phase: publishing ready event");
		yield* runStartupPhase("ready.publish", lifecycleEvents.publish({
			version: 1,
			type: "ready",
			payload: { at: (/* @__PURE__ */ new Date()).toISOString() }
		}));
		yield* Effect.logDebug("startup phase: recording startup heartbeat");
		yield* launchStartupHeartbeat;
		yield* Effect.logDebug("startup phase: browser open check");
		yield* runStartupPhase("browser.open", maybeOpenBrowser);
		yield* Effect.logDebug("startup phase: complete");
	}));
	return {
		awaitCommandReady: commandGate.awaitCommandReady,
		markHttpListening: Deferred.succeed(httpListening, void 0),
		enqueueCommand: commandGate.enqueueCommand
	};
});
const ServerRuntimeStartupLive = Layer.effect(ServerRuntimeStartup, makeServerRuntimeStartup);

//#endregion
//#region src/terminal/Services/Manager.ts
/**
* TerminalManager - Terminal session orchestration service interface.
*
* Owns terminal lifecycle operations, output fanout, and session state
* transitions for thread-scoped terminals.
*
* @module TerminalManager
*/
/**
* TerminalManager - Service tag for terminal session orchestration.
*/
var TerminalManager = class extends ServiceMap.Service()("t3/terminal/Services/Manager/TerminalManager") {};

//#endregion
//#region src/workspace/Services/WorkspaceEntries.ts
/**
* WorkspaceEntries - Effect service contract for cached workspace entry search.
*
* Owns indexed workspace entry search plus cache invalidation for workspace
* roots when the underlying filesystem changes.
*
* @module WorkspaceEntries
*/
var WorkspaceEntriesError = class extends Schema.TaggedErrorClass()("WorkspaceEntriesError", {
	cwd: Schema.String,
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {};
/**
* WorkspaceEntries - Service tag for cached workspace entry search.
*/
var WorkspaceEntries = class extends ServiceMap.Service()("t3/workspace/Services/WorkspaceEntries") {};

//#endregion
//#region src/workspace/Services/WorkspaceFileSystem.ts
/**
* WorkspaceFileSystem - Effect service contract for workspace file mutations.
*
* Owns workspace-root-relative file write operations and their associated
* safety checks and cache invalidation hooks.
*
* @module WorkspaceFileSystem
*/
var WorkspaceFileSystemError = class extends Schema.TaggedErrorClass()("WorkspaceFileSystemError", {
	cwd: Schema.String,
	relativePath: Schema.optional(Schema.String),
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {};
/**
* WorkspaceFileSystem - Service tag for workspace file operations.
*/
var WorkspaceFileSystem = class extends ServiceMap.Service()("t3/workspace/Services/WorkspaceFileSystem") {};

//#endregion
//#region src/project/Services/ProjectSetupScriptRunner.ts
var ProjectSetupScriptRunner = class extends ServiceMap.Service()("t3/project/ProjectSetupScriptRunner") {};

//#endregion
//#region src/ws.ts
const WsRpcLayer = WsRpcGroup.toLayer(Effect.gen(function* () {
	const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
	const orchestrationEngine = yield* OrchestrationEngineService;
	const checkpointDiffQuery = yield* CheckpointDiffQuery;
	const keybindings = yield* Keybindings;
	const open = yield* Open;
	const gitManager = yield* GitManager;
	const git = yield* GitCore;
	const terminalManager = yield* TerminalManager;
	const providerRegistry = yield* ProviderRegistry;
	const config = yield* ServerConfig;
	const lifecycleEvents = yield* ServerLifecycleEvents;
	const serverSettings = yield* ServerSettingsService;
	const startup = yield* ServerRuntimeStartup;
	const workspaceEntries = yield* WorkspaceEntries;
	const workspaceFileSystem = yield* WorkspaceFileSystem;
	const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
	const serverCommandId = (tag) => CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
	const appendSetupScriptActivity = (input) => orchestrationEngine.dispatch({
		type: "thread.activity.append",
		commandId: serverCommandId("setup-script-activity"),
		threadId: input.threadId,
		activity: {
			id: EventId.makeUnsafe(crypto.randomUUID()),
			tone: input.tone,
			kind: input.kind,
			summary: input.summary,
			payload: input.payload,
			turnId: null,
			createdAt: input.createdAt
		},
		createdAt: input.createdAt
	});
	const toDispatchCommandError = (cause, fallbackMessage) => Schema.is(OrchestrationDispatchCommandError)(cause) ? cause : new OrchestrationDispatchCommandError({
		message: cause instanceof Error ? cause.message : fallbackMessage,
		cause
	});
	const toBootstrapDispatchCommandCauseError = (cause) => {
		const error = Cause.squash(cause);
		return Schema.is(OrchestrationDispatchCommandError)(error) ? error : new OrchestrationDispatchCommandError({
			message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
			cause
		});
	};
	const dispatchBootstrapTurnStart = (command) => Effect.gen(function* () {
		const bootstrap = command.bootstrap;
		const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
		let createdThread = false;
		let targetProjectId = bootstrap?.createThread?.projectId;
		let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
		let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;
		const cleanupCreatedThread = () => createdThread ? orchestrationEngine.dispatch({
			type: "thread.delete",
			commandId: serverCommandId("bootstrap-thread-delete"),
			threadId: command.threadId
		}).pipe(Effect.ignoreCause({ log: true })) : Effect.void;
		const recordSetupScriptLaunchFailure = (input) => {
			const detail = input.error instanceof Error ? input.error.message : "Unknown setup failure.";
			return appendSetupScriptActivity({
				threadId: command.threadId,
				kind: "setup-script.failed",
				summary: "Setup script failed to start",
				createdAt: input.requestedAt,
				payload: {
					detail,
					worktreePath: input.worktreePath
				},
				tone: "error"
			}).pipe(Effect.ignoreCause({ log: false }), Effect.flatMap(() => Effect.logWarning("bootstrap turn start failed to launch setup script", {
				threadId: command.threadId,
				worktreePath: input.worktreePath,
				detail
			})));
		};
		const recordSetupScriptStarted = (input) => {
			const payload = {
				scriptId: input.scriptId,
				scriptName: input.scriptName,
				terminalId: input.terminalId,
				worktreePath: input.worktreePath
			};
			return Effect.all([appendSetupScriptActivity({
				threadId: command.threadId,
				kind: "setup-script.requested",
				summary: "Starting setup script",
				createdAt: input.requestedAt,
				payload,
				tone: "info"
			}), appendSetupScriptActivity({
				threadId: command.threadId,
				kind: "setup-script.started",
				summary: "Setup script started",
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				payload,
				tone: "info"
			})]).pipe(Effect.asVoid, Effect.catch((error) => Effect.logWarning("bootstrap turn start launched setup script but failed to record setup activity", {
				threadId: command.threadId,
				worktreePath: input.worktreePath,
				scriptId: input.scriptId,
				terminalId: input.terminalId,
				detail: error instanceof Error ? error.message : "Unknown setup activity dispatch failure."
			})));
		};
		const runSetupProgram = () => bootstrap?.runSetupScript && targetWorktreePath ? (() => {
			const worktreePath = targetWorktreePath;
			const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
			return projectSetupScriptRunner.runForThread({
				threadId: command.threadId,
				...targetProjectId ? { projectId: targetProjectId } : {},
				...targetProjectCwd ? { projectCwd: targetProjectCwd } : {},
				worktreePath
			}).pipe(Effect.matchEffect({
				onFailure: (error) => recordSetupScriptLaunchFailure({
					error,
					requestedAt,
					worktreePath
				}),
				onSuccess: (setupResult) => {
					if (setupResult.status !== "started") return Effect.void;
					return recordSetupScriptStarted({
						requestedAt,
						worktreePath,
						scriptId: setupResult.scriptId,
						scriptName: setupResult.scriptName,
						terminalId: setupResult.terminalId
					});
				}
			}));
		})() : Effect.void;
		return yield* Effect.gen(function* () {
			if (bootstrap?.createThread) {
				yield* orchestrationEngine.dispatch({
					type: "thread.create",
					commandId: serverCommandId("bootstrap-thread-create"),
					threadId: command.threadId,
					projectId: bootstrap.createThread.projectId,
					title: bootstrap.createThread.title,
					modelSelection: bootstrap.createThread.modelSelection,
					runtimeMode: bootstrap.createThread.runtimeMode,
					interactionMode: bootstrap.createThread.interactionMode,
					branch: bootstrap.createThread.branch,
					worktreePath: bootstrap.createThread.worktreePath,
					createdAt: bootstrap.createThread.createdAt
				});
				createdThread = true;
			}
			if (bootstrap?.prepareWorktree) {
				const worktree = yield* git.createWorktree({
					cwd: bootstrap.prepareWorktree.projectCwd,
					branch: bootstrap.prepareWorktree.baseBranch,
					newBranch: bootstrap.prepareWorktree.branch,
					path: null
				});
				targetWorktreePath = worktree.worktree.path;
				yield* orchestrationEngine.dispatch({
					type: "thread.meta.update",
					commandId: serverCommandId("bootstrap-thread-meta-update"),
					threadId: command.threadId,
					branch: worktree.worktree.branch,
					worktreePath: targetWorktreePath
				});
			}
			yield* runSetupProgram();
			return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
		}).pipe(Effect.catchCause((cause) => {
			const dispatchError = toBootstrapDispatchCommandCauseError(cause);
			if (Cause.hasInterruptsOnly(cause)) return Effect.fail(dispatchError);
			return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
		}));
	});
	const dispatchNormalizedCommand = (normalizedCommand) => {
		const dispatchEffect = normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap ? dispatchBootstrapTurnStart(normalizedCommand) : orchestrationEngine.dispatch(normalizedCommand).pipe(Effect.mapError((cause) => toDispatchCommandError(cause, "Failed to dispatch orchestration command")));
		return startup.enqueueCommand(dispatchEffect).pipe(Effect.mapError((cause) => toDispatchCommandError(cause, "Failed to dispatch orchestration command")));
	};
	const loadServerConfig = Effect.gen(function* () {
		const keybindingsConfig = yield* keybindings.loadConfigState;
		const providers = yield* providerRegistry.getProviders;
		const settings = yield* serverSettings.getSettings;
		return {
			cwd: config.cwd,
			keybindingsConfigPath: config.keybindingsConfigPath,
			keybindings: keybindingsConfig.keybindings,
			issues: keybindingsConfig.issues,
			providers,
			availableEditors: resolveAvailableEditors(),
			observability: {
				logsDirectoryPath: config.logsDir,
				localTracingEnabled: true,
				...config.otlpTracesUrl !== void 0 ? { otlpTracesUrl: config.otlpTracesUrl } : {},
				otlpTracesEnabled: config.otlpTracesUrl !== void 0,
				...config.otlpMetricsUrl !== void 0 ? { otlpMetricsUrl: config.otlpMetricsUrl } : {},
				otlpMetricsEnabled: config.otlpMetricsUrl !== void 0
			},
			settings
		};
	});
	return WsRpcGroup.of({
		[ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) => observeRpcEffect(ORCHESTRATION_WS_METHODS.getSnapshot, projectionSnapshotQuery.getSnapshot().pipe(Effect.mapError((cause) => new OrchestrationGetSnapshotError({
			message: "Failed to load orchestration snapshot",
			cause
		}))), { "rpc.aggregate": "orchestration" }),
		[ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) => observeRpcEffect(ORCHESTRATION_WS_METHODS.dispatchCommand, Effect.gen(function* () {
			const normalizedCommand = yield* normalizeDispatchCommand(command);
			const result = yield* dispatchNormalizedCommand(normalizedCommand);
			if (normalizedCommand.type === "thread.archive") yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(Effect.catch((error) => Effect.logWarning("failed to close thread terminals after archive", {
				threadId: normalizedCommand.threadId,
				error: error.message
			})));
			return result;
		}).pipe(Effect.mapError((cause) => Schema.is(OrchestrationDispatchCommandError)(cause) ? cause : new OrchestrationDispatchCommandError({
			message: "Failed to dispatch orchestration command",
			cause
		}))), { "rpc.aggregate": "orchestration" }),
		[ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) => observeRpcEffect(ORCHESTRATION_WS_METHODS.getTurnDiff, checkpointDiffQuery.getTurnDiff(input).pipe(Effect.mapError((cause) => new OrchestrationGetTurnDiffError({
			message: "Failed to load turn diff",
			cause
		}))), { "rpc.aggregate": "orchestration" }),
		[ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) => observeRpcEffect(ORCHESTRATION_WS_METHODS.getFullThreadDiff, checkpointDiffQuery.getFullThreadDiff(input).pipe(Effect.mapError((cause) => new OrchestrationGetFullThreadDiffError({
			message: "Failed to load full thread diff",
			cause
		}))), { "rpc.aggregate": "orchestration" }),
		[ORCHESTRATION_WS_METHODS.replayEvents]: (input) => observeRpcEffect(ORCHESTRATION_WS_METHODS.replayEvents, Stream.runCollect(orchestrationEngine.readEvents(clamp(input.fromSequenceExclusive, {
			maximum: Number.MAX_SAFE_INTEGER,
			minimum: 0
		}))).pipe(Effect.map((events) => Array.from(events)), Effect.mapError((cause) => new OrchestrationReplayEventsError({
			message: "Failed to replay orchestration events",
			cause
		}))), { "rpc.aggregate": "orchestration" }),
		[WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) => observeRpcStreamEffect(WS_METHODS.subscribeOrchestrationDomainEvents, Effect.gen(function* () {
			const fromSequenceExclusive = (yield* orchestrationEngine.getReadModel()).snapshotSequence;
			const replayEvents = yield* Stream.runCollect(orchestrationEngine.readEvents(fromSequenceExclusive)).pipe(Effect.map((events) => Array.from(events)), Effect.catch(() => Effect.succeed([])));
			const replayStream = Stream.fromIterable(replayEvents);
			const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
			const state = yield* Ref.make({
				nextSequence: fromSequenceExclusive + 1,
				pendingBySequence: /* @__PURE__ */ new Map()
			});
			return source.pipe(Stream.mapEffect((event) => Ref.modify(state, ({ nextSequence, pendingBySequence }) => {
				if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) return [[], {
					nextSequence,
					pendingBySequence
				}];
				const updatedPending = new Map(pendingBySequence);
				updatedPending.set(event.sequence, event);
				const emit = [];
				let expected = nextSequence;
				for (;;) {
					const expectedEvent = updatedPending.get(expected);
					if (!expectedEvent) break;
					emit.push(expectedEvent);
					updatedPending.delete(expected);
					expected += 1;
				}
				return [emit, {
					nextSequence: expected,
					pendingBySequence: updatedPending
				}];
			})), Stream.flatMap((events) => Stream.fromIterable(events)));
		}), { "rpc.aggregate": "orchestration" }),
		[WS_METHODS.serverGetConfig]: (_input) => observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, { "rpc.aggregate": "server" }),
		[WS_METHODS.serverRefreshProviders]: (_input) => observeRpcEffect(WS_METHODS.serverRefreshProviders, providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))), { "rpc.aggregate": "server" }),
		[WS_METHODS.serverUpsertKeybinding]: (rule) => observeRpcEffect(WS_METHODS.serverUpsertKeybinding, Effect.gen(function* () {
			return {
				keybindings: yield* keybindings.upsertKeybindingRule(rule),
				issues: []
			};
		}), { "rpc.aggregate": "server" }),
		[WS_METHODS.serverGetSettings]: (_input) => observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, { "rpc.aggregate": "server" }),
		[WS_METHODS.serverUpdateSettings]: ({ patch }) => observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), { "rpc.aggregate": "server" }),
		[WS_METHODS.projectsSearchEntries]: (input) => observeRpcEffect(WS_METHODS.projectsSearchEntries, workspaceEntries.search(input).pipe(Effect.mapError((cause) => new ProjectSearchEntriesError({
			message: `Failed to search workspace entries: ${cause.detail}`,
			cause
		}))), { "rpc.aggregate": "workspace" }),
		[WS_METHODS.projectsWriteFile]: (input) => observeRpcEffect(WS_METHODS.projectsWriteFile, workspaceFileSystem.writeFile(input).pipe(Effect.mapError((cause) => {
			return new ProjectWriteFileError({
				message: Schema.is(WorkspacePathOutsideRootError)(cause) ? "Workspace file path must stay within the project root." : "Failed to write workspace file",
				cause
			});
		})), { "rpc.aggregate": "workspace" }),
		[WS_METHODS.shellOpenInEditor]: (input) => observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), { "rpc.aggregate": "workspace" }),
		[WS_METHODS.gitStatus]: (input) => observeRpcEffect(WS_METHODS.gitStatus, gitManager.status(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitPull]: (input) => observeRpcEffect(WS_METHODS.gitPull, git.pullCurrentBranch(input.cwd), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitRunStackedAction]: (input) => observeRpcStream(WS_METHODS.gitRunStackedAction, Stream.callback((queue) => gitManager.runStackedAction(input, {
			actionId: input.actionId,
			progressReporter: { publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid) }
		}).pipe(Effect.matchCauseEffect({
			onFailure: (cause) => Queue.failCause(queue, cause),
			onSuccess: () => Queue.end(queue).pipe(Effect.asVoid)
		}))), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitResolvePullRequest]: (input) => observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitPreparePullRequestThread]: (input) => observeRpcEffect(WS_METHODS.gitPreparePullRequestThread, gitManager.preparePullRequestThread(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitListBranches]: (input) => observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitCreateWorktree]: (input) => observeRpcEffect(WS_METHODS.gitCreateWorktree, git.createWorktree(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitRemoveWorktree]: (input) => observeRpcEffect(WS_METHODS.gitRemoveWorktree, git.removeWorktree(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitCreateBranch]: (input) => observeRpcEffect(WS_METHODS.gitCreateBranch, git.createBranch(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitCheckout]: (input) => observeRpcEffect(WS_METHODS.gitCheckout, Effect.scoped(git.checkoutBranch(input)), { "rpc.aggregate": "git" }),
		[WS_METHODS.gitInit]: (input) => observeRpcEffect(WS_METHODS.gitInit, git.initRepo(input), { "rpc.aggregate": "git" }),
		[WS_METHODS.terminalOpen]: (input) => observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.terminalWrite]: (input) => observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.terminalResize]: (input) => observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.terminalClear]: (input) => observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.terminalRestart]: (input) => observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.terminalClose]: (input) => observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.subscribeTerminalEvents]: (_input) => observeRpcStream(WS_METHODS.subscribeTerminalEvents, Stream.callback((queue) => Effect.acquireRelease(terminalManager.subscribe((event) => Queue.offer(queue, event)), (unsubscribe) => Effect.sync(unsubscribe))), { "rpc.aggregate": "terminal" }),
		[WS_METHODS.subscribeServerConfig]: (_input) => observeRpcStreamEffect(WS_METHODS.subscribeServerConfig, Effect.gen(function* () {
			const keybindingsUpdates = keybindings.streamChanges.pipe(Stream.map((event) => ({
				version: 1,
				type: "keybindingsUpdated",
				payload: { issues: event.issues }
			})));
			const providerStatuses = providerRegistry.streamChanges.pipe(Stream.map((providers) => ({
				version: 1,
				type: "providerStatuses",
				payload: { providers }
			})));
			const settingsUpdates = serverSettings.streamChanges.pipe(Stream.map((settings) => ({
				version: 1,
				type: "settingsUpdated",
				payload: { settings }
			})));
			return Stream.concat(Stream.make({
				version: 1,
				type: "snapshot",
				config: yield* loadServerConfig
			}), Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)));
		}), { "rpc.aggregate": "server" }),
		[WS_METHODS.subscribeServerLifecycle]: (_input) => observeRpcStreamEffect(WS_METHODS.subscribeServerLifecycle, Effect.gen(function* () {
			const snapshot = yield* lifecycleEvents.snapshot;
			const snapshotEvents = Array.from(snapshot.events).toSorted((left, right) => left.sequence - right.sequence);
			const liveEvents = lifecycleEvents.stream.pipe(Stream.filter((event) => event.sequence > snapshot.sequence));
			return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
		}), { "rpc.aggregate": "server" })
	});
}));
const websocketRpcRouteLayer = Layer.unwrap(Effect.gen(function* () {
	const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
		spanPrefix: "ws.rpc",
		spanAttributes: {
			"rpc.transport": "websocket",
			"rpc.system": "effect-rpc"
		}
	}).pipe(Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)));
	return HttpRouter.add("GET", "/ws", Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const config = yield* ServerConfig;
		if (config.authToken) {
			const url = HttpServerRequest.toURL(request);
			if (Option.isNone(url)) return HttpServerResponse.text("Invalid WebSocket URL", { status: 400 });
			if (url.value.searchParams.get("token") !== config.authToken) return HttpServerResponse.text("Unauthorized WebSocket connection", { status: 401 });
		}
		return yield* rpcWebSocketHttpEffect;
	}));
}));

//#endregion
//#region src/persistence/Migrations/001_OrchestrationEvents.ts
var _001_OrchestrationEvents_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orch_events_stream_version
    ON orchestration_events(aggregate_kind, stream_id, stream_version)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_events_stream_sequence
    ON orchestration_events(aggregate_kind, stream_id, sequence)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_events_command_id
    ON orchestration_events(command_id)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_events_correlation_id
    ON orchestration_events(correlation_id)
  `;
});

//#endregion
//#region src/persistence/Migrations/002_OrchestrationCommandReceipts.ts
var _002_OrchestrationCommandReceipts_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_command_receipts_sequence
    ON orchestration_command_receipts(result_sequence)
  `;
});

//#endregion
//#region src/persistence/Migrations/003_CheckpointDiffBlobs.ts
var _003_CheckpointDiffBlobs_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS checkpoint_diff_blobs (
      thread_id TEXT NOT NULL,
      from_turn_count INTEGER NOT NULL,
      to_turn_count INTEGER NOT NULL,
      diff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (thread_id, from_turn_count, to_turn_count)
    )
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_diff_blobs_thread_to_turn
    ON checkpoint_diff_blobs(thread_id, to_turn_count)
  `;
});

//#endregion
//#region src/persistence/Migrations/004_ProviderSessionRuntime.ts
var _004_ProviderSessionRuntime_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT
    )
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status
    ON provider_session_runtime(status)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_provider
    ON provider_session_runtime(provider_name)
  `;
});

//#endregion
//#region src/persistence/Migrations/005_Projections.ts
var _005_Projections_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      default_model TEXT,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider_name TEXT,
      provider_session_id TEXT,
      provider_thread_id TEXT,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_turns (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      pending_message_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      checkpoint_turn_count INTEGER,
      checkpoint_ref TEXT,
      checkpoint_status TEXT,
      checkpoint_files_json TEXT NOT NULL,
      UNIQUE (thread_id, turn_id),
      UNIQUE (thread_id, checkpoint_turn_count)
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_updated_at
    ON projection_projects(updated_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_id
    ON projection_threads(project_id)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_thread_created
    ON projection_thread_messages(thread_id, created_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_created
    ON projection_thread_activities(thread_id, created_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_provider_session
    ON projection_thread_sessions(provider_session_id)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_requested
    ON projection_turns(thread_id, requested_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_checkpoint_completed
    ON projection_turns(thread_id, checkpoint_turn_count, completed_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_pending_approvals_thread_status
    ON projection_pending_approvals(thread_id, status)
  `;
});

//#endregion
//#region src/persistence/Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts
const DEFAULT_RUNTIME_MODE$1 = "full-access";
var _006_ProjectionThreadSessionRuntimeModeColumns_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'full-access'
    `;
	yield* sql`
    UPDATE projection_thread_sessions
    SET runtime_mode = ${DEFAULT_RUNTIME_MODE$1}
    WHERE runtime_mode IS NULL
  `;
});

//#endregion
//#region src/persistence/Migrations/007_ProjectionThreadMessageAttachments.ts
var _007_ProjectionThreadMessageAttachments_default = Effect$1.gen(function* () {
	yield* (yield* SqlClient.SqlClient)`
    ALTER TABLE projection_thread_messages
    ADD COLUMN attachments_json TEXT
  `;
});

//#endregion
//#region src/persistence/Migrations/008_ProjectionThreadActivitySequence.ts
var _008_ProjectionThreadActivitySequence_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    ALTER TABLE projection_thread_activities
    ADD COLUMN sequence INTEGER
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_sequence
    ON projection_thread_activities(thread_id, sequence)
  `;
});

//#endregion
//#region src/persistence/Migrations/009_ProviderSessionRuntimeMode.ts
var _009_ProviderSessionRuntimeMode_default = Effect$1.gen(function* () {
	yield* SqlClient.SqlClient;
});

//#endregion
//#region src/persistence/Migrations/010_ProjectionThreadsRuntimeMode.ts
var _010_ProjectionThreadsRuntimeMode_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'full-access'
  `;
	yield* sql`
    UPDATE projection_threads
    SET runtime_mode = 'full-access'
    WHERE runtime_mode IS NULL
  `;
});

//#endregion
//#region src/persistence/Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts
var _011_OrchestrationThreadCreatedRuntimeMode_default = Effect$1.gen(function* () {
	yield* (yield* SqlClient.SqlClient)`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.runtimeMode', 'full-access')
    WHERE event_type = 'thread.created'
      AND json_type(payload_json, '$.runtimeMode') IS NULL
  `;
});

//#endregion
//#region src/persistence/Migrations/012_ProjectionThreadsInteractionMode.ts
var _012_ProjectionThreadsInteractionMode_default = Effect$1.gen(function* () {
	yield* (yield* SqlClient.SqlClient)`
    ALTER TABLE projection_threads
    ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'default'
  `;
});

//#endregion
//#region src/persistence/Migrations/013_ProjectionThreadProposedPlans.ts
var _013_ProjectionThreadProposedPlans_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans(thread_id, created_at)
  `;
});

//#endregion
//#region src/persistence/Migrations/014_ProjectionThreadProposedPlanImplementation.ts
var _014_ProjectionThreadProposedPlanImplementation_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    ALTER TABLE projection_thread_proposed_plans
    ADD COLUMN implemented_at TEXT
  `;
	yield* sql`
    ALTER TABLE projection_thread_proposed_plans
    ADD COLUMN implementation_thread_id TEXT
  `;
});

//#endregion
//#region src/persistence/Migrations/015_ProjectionTurnsSourceProposedPlan.ts
var _015_ProjectionTurnsSourceProposedPlan_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN source_proposed_plan_thread_id TEXT
  `;
	yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN source_proposed_plan_id TEXT
  `;
});

//#endregion
//#region src/persistence/Migrations/016_CanonicalizeModelSelections.ts
var _016_CanonicalizeModelSelections_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN default_model_selection_json TEXT
  `;
	yield* sql`
    UPDATE projection_projects
    SET default_model_selection_json = CASE
      WHEN default_model IS NULL THEN NULL
      ELSE json_object(
        'provider',
        CASE
          WHEN lower(default_model) LIKE '%claude%' THEN 'claudeAgent'
          ELSE 'codex'
        END,
        'model',
        default_model
      )
    END
    WHERE default_model_selection_json IS NULL
  `;
	yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN model_selection_json TEXT
  `;
	yield* sql`
    UPDATE projection_threads
    SET model_selection_json = json_object(
      'provider',
      COALESCE(
        (
          SELECT provider_name
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = projection_threads.thread_id
        ),
        CASE
          WHEN lower(model) LIKE '%claude%' THEN 'claudeAgent'
          ELSE 'codex'
        END,
        'codex'
      ),
      'model',
      model
    )
    WHERE model_selection_json IS NULL
  `;
	yield* sql`
    ALTER TABLE projection_projects
    DROP COLUMN default_model
  `;
	yield* sql`
    ALTER TABLE projection_threads
    DROP COLUMN model
  `;
	yield* sql`
    UPDATE orchestration_events
    SET payload_json = CASE
      WHEN json_type(payload_json, '$.defaultModel') = 'null' THEN json_remove(
        json_set(payload_json, '$.defaultModelSelection', json('null')),
        '$.defaultProvider',
        '$.defaultModel',
        '$.defaultModelOptions'
      )
      ELSE json_remove(
        json_set(
          payload_json,
          '$.defaultModelSelection',
          json_patch(
            json_object(
              'provider',
              CASE
                WHEN json_extract(payload_json, '$.defaultProvider') IS NOT NULL
                THEN json_extract(payload_json, '$.defaultProvider')
                WHEN lower(json_extract(payload_json, '$.defaultModel')) LIKE '%claude%'
                THEN 'claudeAgent'
                ELSE 'codex'
              END,
              'model',
              json_extract(payload_json, '$.defaultModel')
            ),
              CASE
                WHEN json_type(payload_json, '$.defaultModelOptions') IS NULL THEN '{}'
                WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                  OR json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
                THEN CASE
                  WHEN (
                  CASE
                    WHEN json_extract(payload_json, '$.defaultProvider') IS NOT NULL
                    THEN json_extract(payload_json, '$.defaultProvider')
                    WHEN lower(json_extract(payload_json, '$.defaultModel')) LIKE '%claude%'
                    THEN 'claudeAgent'
                    ELSE 'codex'
                    END
                  ) = 'claudeAgent'
                  THEN CASE
                    WHEN json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
                    THEN json_object(
                      'options',
                      json(json_extract(payload_json, '$.defaultModelOptions.claudeAgent'))
                    )
                    WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                    THEN json_object(
                      'options',
                      json(json_extract(payload_json, '$.defaultModelOptions.codex'))
                    )
                    ELSE '{}'
                  END
                  ELSE CASE
                    WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                    THEN json_object(
                      'options',
                      json(json_extract(payload_json, '$.defaultModelOptions.codex'))
                    )
                    WHEN json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
                    THEN json_object(
                      'options',
                      json(json_extract(payload_json, '$.defaultModelOptions.claudeAgent'))
                    )
                    ELSE '{}'
                  END
                END
              ELSE json_object(
                'options',
                json(json_extract(payload_json, '$.defaultModelOptions'))
              )
            END
          )
        ),
        '$.defaultProvider',
        '$.defaultModel',
        '$.defaultModelOptions'
      )
    END
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_type(payload_json, '$.defaultModelSelection') IS NULL
      AND json_type(payload_json, '$.defaultModel') IS NOT NULL
  `;
	yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.modelSelection',
        json_patch(
          json_object(
            'provider',
            CASE
              WHEN json_extract(payload_json, '$.provider') IS NOT NULL
              THEN json_extract(payload_json, '$.provider')
              WHEN lower(json_extract(payload_json, '$.model')) LIKE '%claude%'
              THEN 'claudeAgent'
              ELSE 'codex'
            END,
            'model',
            json_extract(payload_json, '$.model')
          ),
          CASE
            WHEN json_type(payload_json, '$.modelOptions') IS NULL THEN '{}'
            WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
              OR json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
            THEN CASE
              WHEN (
                CASE
                  WHEN json_extract(payload_json, '$.provider') IS NOT NULL
                  THEN json_extract(payload_json, '$.provider')
                  WHEN lower(json_extract(payload_json, '$.model')) LIKE '%claude%'
                  THEN 'claudeAgent'
                  ELSE 'codex'
                  END
              ) = 'claudeAgent'
              THEN CASE
                WHEN json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
                THEN json_object(
                  'options',
                  json(json_extract(payload_json, '$.modelOptions.claudeAgent'))
                )
                WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
                THEN json_object(
                  'options',
                  json(json_extract(payload_json, '$.modelOptions.codex'))
                )
                ELSE '{}'
              END
              ELSE CASE
                WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
                THEN json_object(
                  'options',
                  json(json_extract(payload_json, '$.modelOptions.codex'))
                )
                WHEN json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
                THEN json_object(
                  'options',
                  json(json_extract(payload_json, '$.modelOptions.claudeAgent'))
                )
                ELSE '{}'
              END
            END
            ELSE json_object('options', json(json_extract(payload_json, '$.modelOptions')))
          END
        )
      ),
      '$.provider',
      '$.model',
      '$.modelOptions'
    )
    WHERE event_type IN ('thread.created', 'thread.meta-updated', 'thread.turn-start-requested')
      AND json_type(payload_json, '$.modelSelection') IS NULL
      AND json_type(payload_json, '$.model') IS NOT NULL
  `;
	yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.modelSelection',
      json(json_object('provider', 'codex', 'model', 'gpt-5.4'))
    )
    WHERE event_type = 'thread.created'
      AND json_type(payload_json, '$.modelSelection') IS NULL
      AND json_type(payload_json, '$.model') IS NULL
  `;
});

//#endregion
//#region src/persistence/Migrations/017_ProjectionThreadsArchivedAt.ts
var _017_ProjectionThreadsArchivedAt_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	if ((yield* sql`
    PRAGMA table_info(projection_threads)
  `).some((column) => column.name === "archived_at")) return;
	yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN archived_at TEXT
  `;
});

//#endregion
//#region src/persistence/Migrations/018_ProjectionThreadsArchivedAtIndex.ts
var _018_ProjectionThreadsArchivedAtIndex_default = Effect$1.gen(function* () {
	yield* (yield* SqlClient.SqlClient)`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_archived_at
    ON projection_threads(project_id, archived_at)
  `;
});

//#endregion
//#region src/persistence/Migrations/019_ProjectionSnapshotLookupIndexes.ts
var _019_ProjectionSnapshotLookupIndexes_default = Effect$1.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_workspace_root_deleted_at
    ON projection_projects(workspace_root, deleted_at)
  `;
	yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_deleted_created
    ON projection_threads(project_id, deleted_at, created_at)
  `;
});

//#endregion
//#region src/persistence/Migrations.ts
/**
* MigrationsLive - Migration runner with inline loader
*
* Uses Migrator.make with fromRecord to define migrations inline.
* All migrations are statically imported - no dynamic file system loading.
*
* Migrations run automatically when the MigrationLayer is provided,
* ensuring the database schema is always up-to-date before the application starts.
*/
/**
* Migration loader with all migrations defined inline.
*
* Key format: "{id}_{name}" where:
* - id: numeric migration ID (determines execution order)
* - name: descriptive name for the migration
*
* Uses Migrator.fromRecord which parses the key format and
* returns migrations sorted by ID.
*/
const migrationEntries = [
	[
		1,
		"OrchestrationEvents",
		_001_OrchestrationEvents_default
	],
	[
		2,
		"OrchestrationCommandReceipts",
		_002_OrchestrationCommandReceipts_default
	],
	[
		3,
		"CheckpointDiffBlobs",
		_003_CheckpointDiffBlobs_default
	],
	[
		4,
		"ProviderSessionRuntime",
		_004_ProviderSessionRuntime_default
	],
	[
		5,
		"Projections",
		_005_Projections_default
	],
	[
		6,
		"ProjectionThreadSessionRuntimeModeColumns",
		_006_ProjectionThreadSessionRuntimeModeColumns_default
	],
	[
		7,
		"ProjectionThreadMessageAttachments",
		_007_ProjectionThreadMessageAttachments_default
	],
	[
		8,
		"ProjectionThreadActivitySequence",
		_008_ProjectionThreadActivitySequence_default
	],
	[
		9,
		"ProviderSessionRuntimeMode",
		_009_ProviderSessionRuntimeMode_default
	],
	[
		10,
		"ProjectionThreadsRuntimeMode",
		_010_ProjectionThreadsRuntimeMode_default
	],
	[
		11,
		"OrchestrationThreadCreatedRuntimeMode",
		_011_OrchestrationThreadCreatedRuntimeMode_default
	],
	[
		12,
		"ProjectionThreadsInteractionMode",
		_012_ProjectionThreadsInteractionMode_default
	],
	[
		13,
		"ProjectionThreadProposedPlans",
		_013_ProjectionThreadProposedPlans_default
	],
	[
		14,
		"ProjectionThreadProposedPlanImplementation",
		_014_ProjectionThreadProposedPlanImplementation_default
	],
	[
		15,
		"ProjectionTurnsSourceProposedPlan",
		_015_ProjectionTurnsSourceProposedPlan_default
	],
	[
		16,
		"CanonicalizeModelSelections",
		_016_CanonicalizeModelSelections_default
	],
	[
		17,
		"ProjectionThreadsArchivedAt",
		_017_ProjectionThreadsArchivedAt_default
	],
	[
		18,
		"ProjectionThreadsArchivedAtIndex",
		_018_ProjectionThreadsArchivedAtIndex_default
	],
	[
		19,
		"ProjectionSnapshotLookupIndexes",
		_019_ProjectionSnapshotLookupIndexes_default
	]
];
const makeMigrationLoader = (throughId) => Migrator.fromRecord(Object.fromEntries(migrationEntries.filter(([id]) => throughId === void 0 || id <= throughId).map(([id, name, migration]) => [`${id}_${name}`, migration])));
/**
* Migrator run function - no schema dumping needed
* Uses the base Migrator.make without platform dependencies
*/
const run = Migrator.make({});
/**
* Run all pending migrations.
*
* Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
* then runs any migrations with ID greater than the latest recorded migration.
*
* Returns array of [id, name] tuples for migrations that were run.
*
* @returns Effect containing array of executed migrations
*/
const runMigrations = Effect$1.fn("runMigrations")(function* ({ toMigrationInclusive } = {}) {
	yield* Effect$1.log(toMigrationInclusive === void 0 ? "Running all migrations..." : `Running migrations 1 through ${toMigrationInclusive}...`);
	const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
	yield* Effect$1.log("Migrations ran successfully").pipe(Effect$1.annotateLogs({ migrations: executedMigrations.map(([id, name]) => `${id}_${name}`) }));
	return executedMigrations;
});
/**
* Layer that runs migrations when the layer is built.
*
* Use this to ensure migrations run before your application starts.
* Migrations are run automatically - no separate script is needed.
*
* @example
* ```typescript
* import { MigrationsLive } from "@acme/db/Migrations"
* import * as SqliteClient from "@acme/db/SqliteClient"
*
* // Migrations run automatically when SqliteClient is provided
* const AppLayer = MigrationsLive.pipe(
*   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
* )
* ```
*/
const MigrationsLive = Layer$1.effectDiscard(runMigrations());

//#endregion
//#region src/persistence/Layers/Sqlite.ts
const defaultSqliteClientLoaders = {
	bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
	node: () => import("./NodeSqliteClient-ZjyRXhjx.mjs")
};
const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (config) {
	const loader = defaultSqliteClientLoaders[process.versions.bun !== void 0 ? "bun" : "node"];
	return (yield* Effect.promise(loader)).layer(config);
}, Layer.unwrap);
const setup = Layer.effectDiscard(Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`PRAGMA journal_mode = WAL;`;
	yield* sql`PRAGMA foreign_keys = ON;`;
	yield* runMigrations();
}));
const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (dbPath) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
	return Layer.provideMerge(setup, makeRuntimeSqliteLayer({
		filename: dbPath,
		spanAttributes: {
			"db.name": path.basename(dbPath),
			"service.name": "t3-server"
		}
	}));
}, Layer.unwrap);
const SqlitePersistenceMemory = Layer.provideMerge(setup, makeRuntimeSqliteLayer({ filename: ":memory:" }));
const layerConfig = Layer.unwrap(Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)));

//#endregion
//#region src/telemetry/Identify.ts
const CodexAuthJsonSchema = Schema.Struct({ tokens: Schema.Struct({ account_id: Schema.String }) });
const ClaudeJsonSchema = Schema.Struct({ userID: Schema.String });
var IdentifyUserError = class extends Schema.TaggedErrorClass()("IdentifyUserError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {};
const hash = (value) => Effect.try({
	try: () => Crypto.createHash("sha256").update(value).digest("hex"),
	catch: (error) => new IdentifyUserError({
		message: "Failed to hash identifier",
		cause: error
	})
});
const getCodexAccountId = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const authJsonPath = (yield* Path.Path).join(homedir(), ".codex", "auth.json");
	return (yield* Effect.flatMap(fileSystem.readFileString(authJsonPath), Schema.decodeEffect(Schema.fromJsonString(CodexAuthJsonSchema)))).tokens.account_id;
});
const getClaudeUserId = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const claudeJsonPath = (yield* Path.Path).join(homedir(), ".claude.json");
	return (yield* Effect.flatMap(fileSystem.readFileString(claudeJsonPath), Schema.decodeEffect(Schema.fromJsonString(ClaudeJsonSchema)))).userID;
});
const upsertAnonymousId = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const { anonymousIdPath } = yield* ServerConfig;
	return yield* fileSystem.readFileString(anonymousIdPath).pipe(Effect.catch(() => Effect.gen(function* () {
		const randomId = yield* Random.nextUUIDv4;
		yield* fileSystem.writeFileString(anonymousIdPath, randomId);
		return randomId;
	})));
});
/**
* getTelemetryIdentifier - Users are "identified" by finding the first match of the following, then hashing the value.
* 1. ~/.codex/auth.json tokens.account_id
* 2. ~/.claude.json userID
* 3. ~/.t3/telemetry/anonymous-id
*/
const getTelemetryIdentifier = Effect.gen(function* () {
	const codexAccountId = yield* Effect.result(getCodexAccountId);
	if (codexAccountId._tag === "Success") return yield* hash(codexAccountId.success);
	const claudeUserId = yield* Effect.result(getClaudeUserId);
	if (claudeUserId._tag === "Success") return yield* hash(claudeUserId.success);
	const anonymousId = yield* Effect.result(upsertAnonymousId);
	if (anonymousId._tag === "Success") return yield* hash(anonymousId.success);
	return null;
}).pipe(Effect.tapError((error) => Effect.logWarning("Failed to get identifier", { cause: error })), Effect.orElseSucceed(() => null));

//#endregion
//#region package.json
var version = "0.0.15";

//#endregion
//#region src/telemetry/Layers/AnalyticsService.ts
/**
* AnalyticsServiceLive - Anonymous PostHog telemetry layer.
*
* Persists a random installation-scoped anonymous id to state dir, buffers
* events in memory, and flushes batches to PostHog over Effect HttpClient.
*
* @module AnalyticsServiceLive
*/
const TelemetryEnvConfig = Config.all({
	posthogKey: Config.string("T3CODE_POSTHOG_KEY").pipe(Config.withDefault("phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m")),
	posthogHost: Config.string("T3CODE_POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
	enabled: Config.boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),
	flushBatchSize: Config.number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
	maxBufferedEvents: Config.number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(Config.withDefault(1e3))
});
const makeAnalyticsService = Effect.gen(function* () {
	const telemetryConfig = yield* TelemetryEnvConfig.asEffect();
	const httpClient = yield* HttpClient.HttpClient;
	const serverConfig = yield* ServerConfig;
	const identifier = yield* getTelemetryIdentifier;
	const bufferRef = yield* Ref.make([]);
	const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";
	const enqueueBufferedEvent = (event, properties) => Effect.flatMap(DateTime.now, (now) => Ref.modify(bufferRef, (current) => {
		const appended = [...current, {
			event,
			...properties ? { properties } : {},
			capturedAt: DateTime.formatIso(now)
		}];
		const next = appended.length > telemetryConfig.maxBufferedEvents ? appended.slice(appended.length - telemetryConfig.maxBufferedEvents) : appended;
		return [{
			size: next.length,
			dropped: next.length !== appended.length
		}, next];
	}));
	const sendBatch = Effect.fn("sendBatch")(function* (events) {
		if (!telemetryConfig.enabled || !identifier) return;
		const payload = {
			api_key: telemetryConfig.posthogKey,
			batch: events.map((event) => ({
				event: event.event,
				distinct_id: identifier,
				properties: {
					...event.properties,
					$process_person_profile: false,
					platform: process.platform,
					wsl: process.env.WSL_DISTRO_NAME,
					arch: process.arch,
					t3CodeVersion: version,
					clientType
				},
				timestamp: event.capturedAt
			}))
		};
		yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(HttpClientRequest.bodyJson(payload), Effect.flatMap(httpClient.execute), Effect.flatMap(HttpClientResponse.filterStatusOk));
	});
	const flush = Effect.gen(function* () {
		while (true) {
			const batch = yield* Ref.modify(bufferRef, (current) => {
				if (current.length === 0) return [[], current];
				const nextBatch = current.slice(0, telemetryConfig.flushBatchSize);
				return [nextBatch, current.slice(nextBatch.length)];
			});
			if (batch.length === 0) return;
			yield* sendBatch(batch).pipe(Effect.catch((error) => Ref.update(bufferRef, (current) => [...batch, ...current]).pipe(Effect.flatMap(() => Effect.fail(error)))));
		}
	}).pipe(Effect.catch((cause) => Effect.logError("Failed to flush telemetry", { cause })));
	const record = Effect.fn("record")(function* (event, properties) {
		if (!telemetryConfig.enabled || !identifier) return;
		const enqueueResult = yield* enqueueBufferedEvent(event, properties);
		if (enqueueResult.dropped) yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
			size: enqueueResult.size,
			event
		});
	});
	yield* Effect.forever(Effect.sleep(1e3).pipe(Effect.flatMap(() => flush)), { disableYield: true }).pipe(Effect.forkScoped);
	yield* Effect.addFinalizer(() => flush);
	return {
		record,
		flush
	};
});
const AnalyticsServiceLayerLive = Layer.effect(AnalyticsService, makeAnalyticsService);

//#endregion
//#region ../../packages/shared/src/logging.ts
var RotatingFileSink = class {
	filePath;
	maxBytes;
	maxFiles;
	throwOnError;
	currentSize = 0;
	constructor(options) {
		if (options.maxBytes < 1) throw new Error(`maxBytes must be >= 1 (received ${options.maxBytes})`);
		if (options.maxFiles < 1) throw new Error(`maxFiles must be >= 1 (received ${options.maxFiles})`);
		this.filePath = options.filePath;
		this.maxBytes = options.maxBytes;
		this.maxFiles = options.maxFiles;
		this.throwOnError = options.throwOnError ?? false;
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		this.pruneOverflowBackups();
		this.currentSize = this.readCurrentSize();
	}
	write(chunk) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		if (buffer.length === 0) return;
		try {
			if (this.currentSize > 0 && this.currentSize + buffer.length > this.maxBytes) this.rotate();
			fs.appendFileSync(this.filePath, buffer);
			this.currentSize += buffer.length;
			if (this.currentSize > this.maxBytes) this.rotate();
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) throw new Error(`Failed to write log chunk to ${this.filePath}`);
		}
	}
	rotate() {
		try {
			const oldest = this.withSuffix(this.maxFiles);
			if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
			for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
				const source = this.withSuffix(index);
				const target = this.withSuffix(index + 1);
				if (fs.existsSync(source)) fs.renameSync(source, target);
			}
			if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, this.withSuffix(1));
			this.currentSize = 0;
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) throw new Error(`Failed to rotate log file ${this.filePath}`);
		}
	}
	pruneOverflowBackups() {
		try {
			const dir = path.dirname(this.filePath);
			const baseName = path.basename(this.filePath);
			for (const entry of fs.readdirSync(dir)) {
				if (!entry.startsWith(`${baseName}.`)) continue;
				const suffix = Number(entry.slice(baseName.length + 1));
				if (!Number.isInteger(suffix) || suffix <= this.maxFiles) continue;
				fs.rmSync(path.join(dir, entry), { force: true });
			}
		} catch {
			if (this.throwOnError) throw new Error(`Failed to prune log backups for ${this.filePath}`);
		}
	}
	readCurrentSize() {
		try {
			return fs.statSync(this.filePath).size;
		} catch {
			return 0;
		}
	}
	withSuffix(index) {
		return `${this.filePath}.${index}`;
	}
};

//#endregion
//#region src/provider/Layers/EventNdjsonLogger.ts
/**
* Provider event logger helper.
*
* Best-effort writer for observability logs. Each record is formatted as a
* single effect-style text line in a thread-scoped file. Failures are
* downgraded to warnings so provider runtime behavior is unaffected.
*/
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_BATCH_WINDOW_MS = 200;
const GLOBAL_THREAD_SEGMENT = "_global";
const LOG_SCOPE = "provider-observability";
function logWarning(message, context) {
	return Effect.logWarning(message, context).pipe(Effect.annotateLogs({ scope: LOG_SCOPE }));
}
function resolveThreadSegment(raw) {
	return (typeof raw === "string" ? toSafeThreadAttachmentSegment(raw) : null) ?? GLOBAL_THREAD_SEGMENT;
}
function formatLoggerMessage(message) {
	if (Array.isArray(message)) return message.map((part) => typeof part === "string" ? part : String(part)).join(" ");
	return typeof message === "string" ? message : String(message);
}
function makeLineLogger(streamLabel) {
	return Logger.make(({ date, message }) => `[${date.toISOString()}] ${streamLabel}: ${formatLoggerMessage(message)}\n`);
}
function resolveStreamLabel(stream) {
	switch (stream) {
		case "native": return "NTIVE";
		default: return "CANON";
	}
}
const toLogMessage = Effect.fn("toLogMessage")(function* (event) {
	const serialized = yield* Effect.sync(() => {
		try {
			return {
				ok: true,
				value: JSON.stringify(event)
			};
		} catch (error) {
			return {
				ok: false,
				error
			};
		}
	});
	if (!serialized.ok) {
		yield* logWarning("failed to serialize provider event log record", { error: serialized.error });
		return;
	}
	if (typeof serialized.value !== "string") return;
	return serialized.value;
});
const makeThreadWriter = Effect.fn("makeThreadWriter")(function* (input) {
	const sinkResult = yield* Effect.sync(() => {
		try {
			return {
				ok: true,
				sink: new RotatingFileSink({
					filePath: input.filePath,
					maxBytes: input.maxBytes,
					maxFiles: input.maxFiles,
					throwOnError: true
				})
			};
		} catch (error) {
			return {
				ok: false,
				error
			};
		}
	});
	if (!sinkResult.ok) {
		yield* logWarning("failed to initialize provider thread log file", {
			filePath: input.filePath,
			error: sinkResult.error
		});
		return;
	}
	const sink = sinkResult.sink;
	const scope = yield* Scope.make();
	const lineLogger = makeLineLogger(input.streamLabel);
	const batchedLogger = yield* Logger.batched(lineLogger, {
		window: input.batchWindowMs,
		flush: Effect.fn("makeThreadWriter.flush")(function* (messages) {
			const flushResult = yield* Effect.sync(() => {
				try {
					for (const message of messages) sink.write(message);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error
					};
				}
			});
			if (!flushResult.ok) yield* logWarning("provider event log batch flush failed", {
				filePath: input.filePath,
				error: flushResult.error
			});
		})
	}).pipe(Effect.provideService(Scope.Scope, scope));
	const loggerLayer = Logger.layer([batchedLogger], { mergeWithExisting: false });
	return {
		writeMessage(message) {
			return Effect.log(message).pipe(Effect.provide(loggerLayer));
		},
		close() {
			return Scope.close(scope, Exit.void);
		}
	};
});
const makeEventNdjsonLogger = Effect.fn("makeEventNdjsonLogger")(function* (filePath, options) {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
	const streamLabel = resolveStreamLabel(options.stream);
	const directoryReady = yield* Effect.sync(() => {
		try {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			return true;
		} catch (error) {
			return {
				ok: false,
				error
			};
		}
	});
	if (directoryReady !== true) {
		yield* logWarning("failed to create provider event log directory", {
			filePath,
			error: directoryReady.error
		});
		return;
	}
	const stateRef = yield* SynchronizedRef.make({
		threadWriters: /* @__PURE__ */ new Map(),
		failedSegments: /* @__PURE__ */ new Set()
	});
	const resolveThreadWriter = Effect.fn("resolveThreadWriter")(function* (threadSegment) {
		return yield* SynchronizedRef.modifyEffect(stateRef, (state) => {
			if (state.failedSegments.has(threadSegment)) return Effect.succeed([void 0, state]);
			const existing = state.threadWriters.get(threadSegment);
			if (existing) return Effect.succeed([existing, state]);
			return makeThreadWriter({
				filePath: path.join(path.dirname(filePath), `${threadSegment}.log`),
				maxBytes,
				maxFiles,
				batchWindowMs,
				streamLabel
			}).pipe(Effect.map((writer) => {
				if (!writer) {
					const nextFailedSegments = new Set(state.failedSegments);
					nextFailedSegments.add(threadSegment);
					return [void 0, {
						...state,
						failedSegments: nextFailedSegments
					}];
				}
				const nextThreadWriters = new Map(state.threadWriters);
				nextThreadWriters.set(threadSegment, writer);
				return [writer, {
					...state,
					threadWriters: nextThreadWriters
				}];
			}));
		});
	});
	return {
		filePath,
		write: Effect.fn("write")(function* (event, threadId) {
			const threadSegment = resolveThreadSegment(threadId);
			const message = yield* toLogMessage(event);
			if (!message) return;
			const writer = yield* resolveThreadWriter(threadSegment);
			if (!writer) return;
			yield* writer.writeMessage(message);
		}),
		close: Effect.fn("close")(function* () {
			yield* SynchronizedRef.modifyEffect(stateRef, (state) => Effect.gen(function* () {
				for (const writer of state.threadWriters.values()) yield* writer.close();
				return [void 0, {
					threadWriters: /* @__PURE__ */ new Map(),
					failedSegments: /* @__PURE__ */ new Set()
				}];
			}));
		})
	};
});

//#endregion
//#region src/persistence/Services/ProviderSessionRuntime.ts
/**
* ProviderSessionRuntimeRepository - Repository interface for provider runtime sessions.
*
* Owns persistence operations for provider runtime metadata and resume cursors.
*
* @module ProviderSessionRuntimeRepository
*/
const ProviderSessionRuntime = Schema.Struct({
	threadId: ThreadId,
	providerName: Schema.String,
	adapterKey: Schema.String,
	runtimeMode: RuntimeMode$1,
	status: ProviderSessionRuntimeStatus,
	lastSeenAt: IsoDateTime,
	resumeCursor: Schema.NullOr(Schema.Unknown),
	runtimePayload: Schema.NullOr(Schema.Unknown)
});
const GetProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
const DeleteProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
/**
* ProviderSessionRuntimeRepository - Service tag for provider runtime persistence.
*/
var ProviderSessionRuntimeRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProviderSessionRuntime/ProviderSessionRuntimeRepository") {};

//#endregion
//#region src/provider/Errors.ts
/**
* ProviderAdapterValidationError - Invalid adapter API input.
*/
var ProviderAdapterValidationError = class extends Schema.TaggedErrorClass()("ProviderAdapterValidationError", {
	provider: Schema.String,
	operation: Schema.String,
	issue: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider adapter validation failed (${this.provider}) in ${this.operation}: ${this.issue}`;
	}
};
/**
* ProviderAdapterSessionNotFoundError - Adapter-owned session id is unknown.
*/
var ProviderAdapterSessionNotFoundError = class extends Schema.TaggedErrorClass()("ProviderAdapterSessionNotFoundError", {
	provider: Schema.String,
	threadId: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Unknown ${this.provider} adapter thread: ${this.threadId}`;
	}
};
/**
* ProviderAdapterSessionClosedError - Adapter session exists but is closed.
*/
var ProviderAdapterSessionClosedError = class extends Schema.TaggedErrorClass()("ProviderAdapterSessionClosedError", {
	provider: Schema.String,
	threadId: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `${this.provider} adapter thread is closed: ${this.threadId}`;
	}
};
/**
* ProviderAdapterRequestError - Provider protocol request failed or timed out.
*/
var ProviderAdapterRequestError = class extends Schema.TaggedErrorClass()("ProviderAdapterRequestError", {
	provider: Schema.String,
	method: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider adapter request failed (${this.provider}) for ${this.method}: ${this.detail}`;
	}
};
/**
* ProviderAdapterProcessError - Provider process lifecycle failure.
*/
var ProviderAdapterProcessError = class extends Schema.TaggedErrorClass()("ProviderAdapterProcessError", {
	provider: Schema.String,
	threadId: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider adapter process error (${this.provider}) for thread ${this.threadId}: ${this.detail}`;
	}
};
/**
* ProviderValidationError - Invalid provider API input.
*/
var ProviderValidationError = class extends Schema.TaggedErrorClass()("ProviderValidationError", {
	operation: Schema.String,
	issue: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider validation failed in ${this.operation}: ${this.issue}`;
	}
};
/**
* ProviderUnsupportedError - Requested provider is not implemented.
*/
var ProviderUnsupportedError = class extends Schema.TaggedErrorClass()("ProviderUnsupportedError", {
	provider: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider '${this.provider}' is not implemented`;
	}
};
/**
* ProviderSessionDirectoryPersistenceError - Session directory persistence failure.
*/
var ProviderSessionDirectoryPersistenceError = class extends Schema.TaggedErrorClass()("ProviderSessionDirectoryPersistenceError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Provider session directory persistence error in ${this.operation}: ${this.detail}`;
	}
};

//#endregion
//#region src/provider/Services/ProviderSessionDirectory.ts
var ProviderSessionDirectory = class extends ServiceMap.Service()("t3/provider/Services/ProviderSessionDirectory") {};

//#endregion
//#region src/provider/Layers/ProviderSessionDirectory.ts
function toPersistenceError(operation) {
	return (cause) => new ProviderSessionDirectoryPersistenceError({
		operation,
		detail: `Failed to execute ${operation}.`,
		cause
	});
}
function decodeProviderKind(providerName, operation) {
	if (providerName === "codex" || providerName === "claudeAgent") return Effect.succeed(providerName);
	return Effect.fail(new ProviderSessionDirectoryPersistenceError({
		operation,
		detail: `Unknown persisted provider '${providerName}'.`
	}));
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeRuntimePayload(existing, next) {
	if (next === void 0) return existing ?? null;
	if (isRecord(existing) && isRecord(next)) return {
		...existing,
		...next
	};
	return next;
}
const makeProviderSessionDirectory = Effect.gen(function* () {
	const repository = yield* ProviderSessionRuntimeRepository;
	const getBinding = (threadId) => repository.getByThreadId({ threadId }).pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.getBinding:getByThreadId")), Effect.flatMap((runtime) => Option.match(runtime, {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (value) => decodeProviderKind(value.providerName, "ProviderSessionDirectory.getBinding").pipe(Effect.map((provider) => Option.some({
			threadId: value.threadId,
			provider,
			adapterKey: value.adapterKey,
			runtimeMode: value.runtimeMode,
			status: value.status,
			resumeCursor: value.resumeCursor,
			runtimePayload: value.runtimePayload
		})))
	})));
	const upsert = Effect.fn(function* (binding) {
		const existing = yield* repository.getByThreadId({ threadId: binding.threadId }).pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:getByThreadId")));
		const existingRuntime = Option.getOrUndefined(existing);
		const resolvedThreadId = binding.threadId ?? existingRuntime?.threadId;
		if (!resolvedThreadId) return yield* new ProviderValidationError({
			operation: "ProviderSessionDirectory.upsert",
			issue: "threadId must be a non-empty string."
		});
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const providerChanged = existingRuntime !== void 0 && existingRuntime.providerName !== binding.provider;
		yield* repository.upsert({
			threadId: resolvedThreadId,
			providerName: binding.provider,
			adapterKey: binding.adapterKey ?? (providerChanged ? binding.provider : existingRuntime?.adapterKey ?? binding.provider),
			runtimeMode: binding.runtimeMode ?? existingRuntime?.runtimeMode ?? "full-access",
			status: binding.status ?? existingRuntime?.status ?? "running",
			lastSeenAt: now,
			resumeCursor: binding.resumeCursor !== void 0 ? binding.resumeCursor : existingRuntime?.resumeCursor ?? null,
			runtimePayload: mergeRuntimePayload(existingRuntime?.runtimePayload ?? null, binding.runtimePayload)
		}).pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:upsert")));
	});
	const getProvider = (threadId) => getBinding(threadId).pipe(Effect.flatMap((binding) => Option.match(binding, {
		onSome: (value) => Effect.succeed(value.provider),
		onNone: () => Effect.fail(new ProviderSessionDirectoryPersistenceError({
			operation: "ProviderSessionDirectory.getProvider",
			detail: `No persisted provider binding found for thread '${threadId}'.`
		}))
	})));
	const remove = (threadId) => repository.deleteByThreadId({ threadId }).pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.remove:deleteByThreadId")));
	const listThreadIds = () => repository.list().pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.listThreadIds:list")), Effect.map((rows) => rows.map((row) => row.threadId)));
	return {
		upsert,
		getProvider,
		getBinding,
		remove,
		listThreadIds
	};
});
const ProviderSessionDirectoryLive = Layer.effect(ProviderSessionDirectory, makeProviderSessionDirectory);

//#endregion
//#region src/persistence/Errors.ts
var PersistenceSqlError = class extends Schema.TaggedErrorClass()("PersistenceSqlError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `SQL error in ${this.operation}: ${this.detail}`;
	}
};
var PersistenceDecodeError = class extends Schema.TaggedErrorClass()("PersistenceDecodeError", {
	operation: Schema.String,
	issue: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Decode error in ${this.operation}: ${this.issue}`;
	}
};
function toPersistenceSqlError(operation) {
	return (cause) => new PersistenceSqlError({
		operation,
		detail: `Failed to execute ${operation}`,
		cause
	});
}
function toPersistenceDecodeError(operation) {
	return (error) => new PersistenceDecodeError({
		operation,
		issue: SchemaIssue.makeFormatterDefault()(error.issue),
		cause: error
	});
}
const isPersistenceError = (u) => Schema.is(PersistenceSqlError)(u) || Schema.is(PersistenceDecodeError)(u);

//#endregion
//#region src/persistence/Layers/ProviderSessionRuntime.ts
const ProviderSessionRuntimeDbRowSchema = ProviderSessionRuntime.mapFields(Struct.assign({
	resumeCursor: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
	runtimePayload: Schema.NullOr(Schema.fromJsonString(Schema.Unknown))
}));
const decodeRuntime = Schema.decodeUnknownEffect(ProviderSessionRuntime);
const GetRuntimeRequestSchema = Schema.Struct({ threadId: ThreadId });
const DeleteRuntimeRequestSchema = GetRuntimeRequestSchema;
function toPersistenceSqlOrDecodeError$4(sqlOperation, decodeOperation) {
	return (cause) => Schema.isSchemaError(cause) ? toPersistenceDecodeError(decodeOperation)(cause) : toPersistenceSqlError(sqlOperation)(cause);
}
const makeProviderSessionRuntimeRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertRuntimeRow = SqlSchema.void({
		Request: ProviderSessionRuntimeDbRowSchema,
		execute: (runtime) => sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES (
          ${runtime.threadId},
          ${runtime.providerName},
          ${runtime.adapterKey},
          ${runtime.runtimeMode},
          ${runtime.status},
          ${runtime.lastSeenAt},
          ${runtime.resumeCursor},
          ${runtime.runtimePayload}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          adapter_key = excluded.adapter_key,
          runtime_mode = excluded.runtime_mode,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at,
          resume_cursor_json = excluded.resume_cursor_json,
          runtime_payload_json = excluded.runtime_payload_json
      `
	});
	const getRuntimeRowByThreadId = SqlSchema.findOneOption({
		Request: GetRuntimeRequestSchema,
		Result: ProviderSessionRuntimeDbRowSchema,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        WHERE thread_id = ${threadId}
      `
	});
	const listRuntimeRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProviderSessionRuntimeDbRowSchema,
		execute: () => sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        ORDER BY last_seen_at ASC, thread_id ASC
      `
	});
	const deleteRuntimeByThreadId = SqlSchema.void({
		Request: DeleteRuntimeRequestSchema,
		execute: ({ threadId }) => sql`
        DELETE FROM provider_session_runtime
        WHERE thread_id = ${threadId}
      `
	});
	const upsert = (runtime) => upsertRuntimeRow(runtime).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$4("ProviderSessionRuntimeRepository.upsert:query", "ProviderSessionRuntimeRepository.upsert:encodeRequest")));
	const getByThreadId = (input) => getRuntimeRowByThreadId(input).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$4("ProviderSessionRuntimeRepository.getByThreadId:query", "ProviderSessionRuntimeRepository.getByThreadId:decodeRow")), Effect.flatMap((runtimeRowOption) => Option.match(runtimeRowOption, {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeRuntime(row).pipe(Effect.mapError(toPersistenceDecodeError("ProviderSessionRuntimeRepository.getByThreadId:rowToRuntime")), Effect.map((runtime) => Option.some(runtime)))
	})));
	const list = () => listRuntimeRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$4("ProviderSessionRuntimeRepository.list:query", "ProviderSessionRuntimeRepository.list:decodeRows")), Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeRuntime(row).pipe(Effect.mapError(toPersistenceDecodeError("ProviderSessionRuntimeRepository.list:rowToRuntime"))), { concurrency: "unbounded" })));
	const deleteByThreadId = (input) => deleteRuntimeByThreadId(input).pipe(Effect.mapError(toPersistenceSqlError("ProviderSessionRuntimeRepository.deleteByThreadId:query")));
	return {
		upsert,
		getByThreadId,
		list,
		deleteByThreadId
	};
});
const ProviderSessionRuntimeRepositoryLive = Layer.effect(ProviderSessionRuntimeRepository, makeProviderSessionRuntimeRepository);

//#endregion
//#region src/provider/Services/CodexAdapter.ts
/**
* CodexAdapter - Codex implementation of the generic provider adapter contract.
*
* This service owns Codex app-server process / JSON-RPC semantics and emits
* Codex provider events. It does not perform cross-provider routing, shared
* event fan-out, or checkpoint orchestration.
*
* Uses Effect `ServiceMap.Service` for dependency injection and returns the
* shared provider-adapter error channel with `provider: "codex"` context.
*
* @module CodexAdapter
*/
/**
* CodexAdapter - Service tag for Codex provider adapter operations.
*/
var CodexAdapter = class extends ServiceMap.Service()("t3/provider/Services/CodexAdapter") {};

//#endregion
//#region ../../packages/shared/src/model.ts
/** Check whether a capabilities object includes a given effort value. */
function hasEffortLevel(caps, value) {
	return caps.reasoningEffortLevels.some((l) => l.value === value);
}
/** Return the default effort value for a capabilities object, or null if none. */
function getDefaultEffort(caps) {
	return caps.reasoningEffortLevels.find((l) => l.isDefault)?.value ?? null;
}
/**
* Resolve a raw effort option against capabilities.
*
* Returns the effective effort value — the explicit value if supported and not
* prompt-injected, otherwise the model's default. Returns `undefined` only
* when the model has no effort levels at all.
*
* Prompt-injected efforts (e.g. "ultrathink") are excluded because they are
* applied via prompt text, not the effort API parameter.
*/
function resolveEffort(caps, raw) {
	const defaultValue = getDefaultEffort(caps);
	const trimmed = typeof raw === "string" ? raw.trim() : null;
	if (trimmed && !caps.promptInjectedEffortLevels.includes(trimmed) && hasEffortLevel(caps, trimmed)) return trimmed;
	return defaultValue ?? void 0;
}
/** Check whether a capabilities object includes a given context window value. */
function hasContextWindowOption(caps, value) {
	return caps.contextWindowOptions.some((o) => o.value === value);
}
/** Return the default context window value, or `null` if none is defined. */
function getDefaultContextWindow(caps) {
	return caps.contextWindowOptions.find((o) => o.isDefault)?.value ?? null;
}
/**
* Resolve a raw `contextWindow` option against capabilities.
*
* Returns the effective context window value — the explicit value if supported,
* otherwise the model's default. Returns `undefined` only when the model has
* no context window options at all.
*
* Unlike effort levels (where the API has matching defaults), the context
* window requires an explicit API suffix (e.g. `[1m]`), so we always preserve
* the resolved value to avoid ambiguity between "user chose the default" and
* "not specified".
*/
function resolveContextWindow(caps, raw) {
	const defaultValue = getDefaultContextWindow(caps);
	if (!raw) return defaultValue ?? void 0;
	return hasContextWindowOption(caps, raw) ? raw : defaultValue ?? void 0;
}
function normalizeCodexModelOptionsWithCapabilities(caps, modelOptions) {
	const reasoningEffort = resolveEffort(caps, modelOptions?.reasoningEffort);
	const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : void 0;
	const nextOptions = {
		...reasoningEffort ? { reasoningEffort } : {},
		...fastMode !== void 0 ? { fastMode } : {}
	};
	return Object.keys(nextOptions).length > 0 ? nextOptions : void 0;
}
function normalizeClaudeModelOptionsWithCapabilities(caps, modelOptions) {
	const effort = resolveEffort(caps, modelOptions?.effort);
	const thinking = caps.supportsThinkingToggle ? modelOptions?.thinking : void 0;
	const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : void 0;
	const contextWindow = resolveContextWindow(caps, modelOptions?.contextWindow);
	const nextOptions = {
		...thinking !== void 0 ? { thinking } : {},
		...effort ? { effort } : {},
		...fastMode !== void 0 ? { fastMode } : {},
		...contextWindow !== void 0 ? { contextWindow } : {}
	};
	return Object.keys(nextOptions).length > 0 ? nextOptions : void 0;
}
function normalizeModelSlug(model, provider = "codex") {
	if (typeof model !== "string") return null;
	const trimmed = model.trim();
	if (!trimmed) return null;
	const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider];
	const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed) ? aliases[trimmed] : void 0;
	return typeof aliased === "string" ? aliased : trimmed;
}
/** Trim a string, returning null for empty/missing values. */
function trimOrNull(value) {
	if (typeof value !== "string") return null;
	return value.trim() || null;
}
/**
* Resolve the actual API model identifier from a model selection.
*
* Provider-aware: each provider can map `contextWindow` (or other options)
* to whatever the API requires — a model-id suffix, a separate parameter, etc.
* The canonical slug stored in the selection stays unchanged so the
* capabilities system keeps working.
*
* Expects `contextWindow` to already be resolved (via `resolveContextWindow`)
* to the effective value, not stripped to `undefined` for defaults.
*/
function resolveApiModelId(modelSelection) {
	switch (modelSelection.provider) {
		case "claudeAgent": switch (modelSelection.options?.contextWindow) {
			case "1m": return `${modelSelection.model}[1m]`;
			default: return modelSelection.model;
		}
		default: return modelSelection.model;
	}
}
function applyClaudePromptEffortPrefix(text, effort) {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;
	if (effort !== "ultrathink") return trimmed;
	if (trimmed.startsWith("Ultrathink:")) return trimmed;
	return `Ultrathink:\n${trimmed}`;
}

//#endregion
//#region src/provider/codexCliVersion.ts
const CODEX_VERSION_PATTERN = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/;
const MINIMUM_CODEX_CLI_VERSION = "0.37.0";
function normalizeCodexVersion(version) {
	const [main, prerelease] = version.trim().split("-", 2);
	const segments = (main ?? "").split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
	if (segments.length === 2) segments.push("0");
	return prerelease ? `${segments.join(".")}-${prerelease}` : segments.join(".");
}
function parseSemver(version) {
	const [main = "", prerelease] = normalizeCodexVersion(version).split("-", 2);
	const segments = main.split(".");
	if (segments.length !== 3) return null;
	const [majorSegment, minorSegment, patchSegment] = segments;
	if (majorSegment === void 0 || minorSegment === void 0 || patchSegment === void 0) return null;
	const major = Number.parseInt(majorSegment, 10);
	const minor = Number.parseInt(minorSegment, 10);
	const patch = Number.parseInt(patchSegment, 10);
	if (![
		major,
		minor,
		patch
	].every(Number.isInteger)) return null;
	return {
		major,
		minor,
		patch,
		prerelease: prerelease?.split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0) ?? []
	};
}
function comparePrereleaseIdentifier(left, right) {
	const leftNumeric = /^\d+$/.test(left);
	const rightNumeric = /^\d+$/.test(right);
	if (leftNumeric && rightNumeric) return Number.parseInt(left, 10) - Number.parseInt(right, 10);
	if (leftNumeric) return -1;
	if (rightNumeric) return 1;
	return left.localeCompare(right);
}
function compareCodexCliVersions(left, right) {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);
	if (!parsedLeft || !parsedRight) return left.localeCompare(right);
	if (parsedLeft.major !== parsedRight.major) return parsedLeft.major - parsedRight.major;
	if (parsedLeft.minor !== parsedRight.minor) return parsedLeft.minor - parsedRight.minor;
	if (parsedLeft.patch !== parsedRight.patch) return parsedLeft.patch - parsedRight.patch;
	if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) return 0;
	if (parsedLeft.prerelease.length === 0) return 1;
	if (parsedRight.prerelease.length === 0) return -1;
	const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = parsedLeft.prerelease[index];
		const rightIdentifier = parsedRight.prerelease[index];
		if (leftIdentifier === void 0) return -1;
		if (rightIdentifier === void 0) return 1;
		const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
		if (comparison !== 0) return comparison;
	}
	return 0;
}
function parseCodexCliVersion(output) {
	const match = CODEX_VERSION_PATTERN.exec(output);
	if (!match?.[1]) return null;
	if (!parseSemver(match[1])) return null;
	return normalizeCodexVersion(match[1]);
}
function isCodexCliVersionSupported(version) {
	return compareCodexCliVersions(version, MINIMUM_CODEX_CLI_VERSION) >= 0;
}
function formatCodexCliUpgradeMessage(version) {
	return `Codex CLI ${version ? `v${version}` : "the installed version"} is too old for T3 Code. Upgrade to v${MINIMUM_CODEX_CLI_VERSION} or newer and restart T3 Code.`;
}

//#endregion
//#region src/provider/codexAccount.ts
const CODEX_DEFAULT_MODEL = "gpt-5.3-codex";
const CODEX_SPARK_MODEL = "gpt-5.3-codex-spark";
const CODEX_SPARK_ENABLED_PLAN_TYPES = new Set(["pro"]);
function asObject$1(value) {
	if (!value || typeof value !== "object") return;
	return value;
}
function asString$1(value) {
	return typeof value === "string" ? value : void 0;
}
function readCodexAccountSnapshot(response) {
	const record = asObject$1(response);
	const account = asObject$1(record?.account) ?? record;
	const accountType = asString$1(account?.type);
	if (accountType === "apiKey") return {
		type: "apiKey",
		planType: null,
		sparkEnabled: false
	};
	if (accountType === "chatgpt") {
		const planType = account?.planType ?? "unknown";
		return {
			type: "chatgpt",
			planType,
			sparkEnabled: CODEX_SPARK_ENABLED_PLAN_TYPES.has(planType)
		};
	}
	return {
		type: "unknown",
		planType: null,
		sparkEnabled: false
	};
}
function codexAuthSubType(account) {
	if (account?.type === "apiKey") return "apiKey";
	if (account?.type !== "chatgpt") return;
	return account.planType && account.planType !== "unknown" ? account.planType : "chatgpt";
}
function codexAuthSubLabel(account) {
	switch (codexAuthSubType(account)) {
		case "apiKey": return "OpenAI API Key";
		case "chatgpt": return "ChatGPT Subscription";
		case "free": return "ChatGPT Free Subscription";
		case "go": return "ChatGPT Go Subscription";
		case "plus": return "ChatGPT Plus Subscription";
		case "pro": return "ChatGPT Pro Subscription";
		case "team": return "ChatGPT Team Subscription";
		case "business": return "ChatGPT Business Subscription";
		case "enterprise": return "ChatGPT Enterprise Subscription";
		case "edu": return "ChatGPT Edu Subscription";
		default: return;
	}
}
function adjustCodexModelsForAccount(baseModels, account) {
	if (account?.sparkEnabled !== false) return baseModels;
	return baseModels.filter((model) => model.isCustom || model.slug !== CODEX_SPARK_MODEL);
}
function resolveCodexModelForAccount(model, account) {
	if (model !== CODEX_SPARK_MODEL || account.sparkEnabled) return model;
	return CODEX_DEFAULT_MODEL;
}

//#endregion
//#region src/provider/codexAppServer.ts
function readErrorMessage(response) {
	return typeof response.error?.message === "string" ? response.error.message : void 0;
}
function buildCodexInitializeParams() {
	return {
		clientInfo: {
			name: "t3code_desktop",
			title: "T3 Code Desktop",
			version: "0.1.0"
		},
		capabilities: { experimentalApi: true }
	};
}
function killCodexChildProcess(child) {
	if (process.platform === "win32" && child.pid !== void 0) try {
		spawnSync("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], { stdio: "ignore" });
		return;
	} catch {}
	child.kill();
}
async function probeCodexAccount(input) {
	return await new Promise((resolve, reject) => {
		const child = spawn(input.binaryPath, ["app-server"], {
			env: {
				...process.env,
				...input.homePath ? { CODEX_HOME: input.homePath } : {}
			},
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			shell: process.platform === "win32"
		});
		const output = readline.createInterface({ input: child.stdout });
		let completed = false;
		const cleanup = () => {
			output.removeAllListeners();
			output.close();
			child.removeAllListeners();
			if (!child.killed) killCodexChildProcess(child);
		};
		const finish = (callback) => {
			if (completed) return;
			completed = true;
			cleanup();
			callback();
		};
		const fail = (error) => finish(() => reject(error instanceof Error ? error : /* @__PURE__ */ new Error(`Codex account probe failed: ${String(error)}.`)));
		if (input.signal?.aborted) {
			fail(/* @__PURE__ */ new Error("Codex account probe aborted."));
			return;
		}
		input.signal?.addEventListener("abort", () => fail(/* @__PURE__ */ new Error("Codex account probe aborted.")));
		const writeMessage = (message) => {
			if (!child.stdin.writable) {
				fail(/* @__PURE__ */ new Error("Cannot write to codex app-server stdin."));
				return;
			}
			child.stdin.write(`${JSON.stringify(message)}\n`);
		};
		output.on("line", (line) => {
			let parsed;
			try {
				parsed = JSON.parse(line);
			} catch {
				fail(/* @__PURE__ */ new Error("Received invalid JSON from codex app-server during account probe."));
				return;
			}
			if (!parsed || typeof parsed !== "object") return;
			const response = parsed;
			if (response.id === 1) {
				const errorMessage = readErrorMessage(response);
				if (errorMessage) {
					fail(/* @__PURE__ */ new Error(`initialize failed: ${errorMessage}`));
					return;
				}
				writeMessage({ method: "initialized" });
				writeMessage({
					id: 2,
					method: "account/read",
					params: {}
				});
				return;
			}
			if (response.id === 2) {
				const errorMessage = readErrorMessage(response);
				if (errorMessage) {
					fail(/* @__PURE__ */ new Error(`account/read failed: ${errorMessage}`));
					return;
				}
				finish(() => resolve(readCodexAccountSnapshot(response.result)));
			}
		});
		child.once("error", fail);
		child.once("exit", (code, signal) => {
			if (completed) return;
			fail(/* @__PURE__ */ new Error(`codex app-server exited before probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`));
		});
		writeMessage({
			id: 1,
			method: "initialize",
			params: buildCodexInitializeParams()
		});
	});
}

//#endregion
//#region src/codexAppServerManager.ts
const CODEX_VERSION_CHECK_TIMEOUT_MS = 4e3;
const ANSI_ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESCAPE_CHAR}\\[[0-9;]*m`, "g");
const CODEX_STDERR_LOG_REGEX = /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/;
const BENIGN_ERROR_LOG_SNIPPETS = ["state db missing rollout path for thread", "state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back"];
const RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS = [
	"not found",
	"missing thread",
	"no such thread",
	"unknown thread",
	"does not exist"
];
const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS = `<collaboration_mode># Plan Mode (Conversational)

You work in 3 phases, and you should *chat your way* to a great plan before finalizing it. A great plan is very detailed-intent- and implementation-wise-so that it can be handed to another engineer or agent to be implemented right away. It must be **decision complete**, where the implementer does not need to make any decisions.

## Mode rules (strict)

You are in **Plan Mode** until a developer message explicitly ends it.

Plan Mode is not changed by user intent, tone, or imperative language. If a user asks for execution while still in Plan Mode, treat it as a request to **plan the execution**, not perform it.

## Plan Mode vs update_plan tool

Plan Mode is a collaboration mode that can involve requesting user input and eventually issuing a \`<proposed_plan>\` block.

Separately, \`update_plan\` is a checklist/progress/TODOs tool; it does not enter or exit Plan Mode. Do not confuse it with Plan mode or try to use it while in Plan mode. If you try to use \`update_plan\` in Plan mode, it will return an error.

## Execution vs. mutation in Plan Mode

You may explore and execute **non-mutating** actions that improve the plan. You must not perform **mutating** actions.

### Allowed (non-mutating, plan-improving)

Actions that gather truth, reduce ambiguity, or validate feasibility without changing repo-tracked state. Examples:

* Reading or searching files, configs, schemas, types, manifests, and docs
* Static analysis, inspection, and repo exploration
* Dry-run style commands when they do not edit repo-tracked files
* Tests, builds, or checks that may write to caches or build artifacts (for example, \`target/\`, \`.cache/\`, or snapshots) so long as they do not edit repo-tracked files

### Not allowed (mutating, plan-executing)

Actions that implement the plan or change repo-tracked state. Examples:

* Editing or writing files
* Running formatters or linters that rewrite files
* Applying patches, migrations, or codegen that updates repo-tracked files
* Side-effectful commands whose purpose is to carry out the plan rather than refine it

When in doubt: if the action would reasonably be described as "doing the work" rather than "planning the work," do not do it.

## PHASE 1 - Ground in the environment (explore first, ask second)

Begin by grounding yourself in the actual environment. Eliminate unknowns in the prompt by discovering facts, not by asking the user. Resolve all questions that can be answered through exploration or inspection. Identify missing or ambiguous details only if they cannot be derived from the environment. Silent exploration between turns is allowed and encouraged.

Before asking the user any question, perform at least one targeted non-mutating exploration pass (for example: search relevant files, inspect likely entrypoints/configs, confirm current implementation shape), unless no local environment/repo is available.

Exception: you may ask clarifying questions about the user's prompt before exploring, ONLY if there are obvious ambiguities or contradictions in the prompt itself. However, if ambiguity might be resolved by exploring, always prefer exploring first.

Do not ask questions that can be answered from the repo or system (for example, "where is this struct?" or "which UI component should we use?" when exploration can make it clear). Only ask once you have exhausted reasonable non-mutating exploration.

## PHASE 2 - Intent chat (what they actually want)

* Keep asking until you can clearly state: goal + success criteria, audience, in/out of scope, constraints, current state, and the key preferences/tradeoffs.
* Bias toward questions over guessing: if any high-impact ambiguity remains, do NOT plan yet-ask.

## PHASE 3 - Implementation chat (what/how we'll build)

* Once intent is stable, keep asking until the spec is decision complete: approach, interfaces (APIs/schemas/I/O), data flow, edge cases/failure modes, testing + acceptance criteria, rollout/monitoring, and any migrations/compat constraints.

## Asking questions

Critical rules:

* Strongly prefer using the \`request_user_input\` tool to ask any questions.
* Offer only meaningful multiple-choice options; don't include filler choices that are obviously wrong or irrelevant.
* In rare cases where an unavoidable, important question can't be expressed with reasonable multiple-choice options (due to extreme ambiguity), you may ask it directly without the tool.

You SHOULD ask many questions, but each question must:

* materially change the spec/plan, OR
* confirm/lock an assumption, OR
* choose between meaningful tradeoffs.
* not be answerable by non-mutating commands.

Use the \`request_user_input\` tool only for decisions that materially change the plan, for confirming important assumptions, or for information that cannot be discovered via non-mutating exploration.

## Two kinds of unknowns (treat differently)

1. **Discoverable facts** (repo/system truth): explore first.

   * Before asking, run targeted searches and check likely sources of truth (configs/manifests/entrypoints/schemas/types/constants).
   * Ask only if: multiple plausible candidates; nothing found but you need a missing identifier/context; or ambiguity is actually product intent.
   * If asking, present concrete candidates (paths/service names) + recommend one.
   * Never ask questions you can answer from your environment (e.g., "where is this struct").

2. **Preferences/tradeoffs** (not discoverable): ask early.

   * These are intent or implementation preferences that cannot be derived from exploration.
   * Provide 2-4 mutually exclusive options + a recommended default.
   * If unanswered, proceed with the recommended option and record it as an assumption in the final plan.

## Finalization rule

Only output the final plan when it is decision complete and leaves no decisions to the implementer.

When you present the official plan, wrap it in a \`<proposed_plan>\` block so the client can render it specially:

1) The opening tag must be on its own line.
2) Start the plan content on the next line (no text on the same line as the tag).
3) The closing tag must be on its own line.
4) Use Markdown inside the block.
5) Keep the tags exactly as \`<proposed_plan>\` and \`</proposed_plan>\` (do not translate or rename them), even if the plan content is in another language.

Example:

<proposed_plan>
plan content
</proposed_plan>

plan content should be human and agent digestible. The final plan must be plan-only and include:

* A clear title
* A brief summary section
* Important changes or additions to public APIs/interfaces/types
* Test cases and scenarios
* Explicit assumptions and defaults chosen where needed

Do not ask "should I proceed?" in the final output. The user can easily switch out of Plan mode and request implementation if you have included a \`<proposed_plan>\` block in your response. Alternatively, they can decide to stay in Plan mode and continue refining the plan.

Only produce at most one \`<proposed_plan>\` block per turn, and only when you are presenting a complete spec.
</collaboration_mode>`;
const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS = `<collaboration_mode># Collaboration Mode: Default

You are now in Default mode. Any previous instructions for other modes (e.g. Plan mode) are no longer active.

Your active mode changes only when new developer instructions with a different \`<collaboration_mode>...</collaboration_mode>\` change it; user requests or tool descriptions do not change mode by themselves. Known mode names are Default and Plan.

## request_user_input availability

The \`request_user_input\` tool is unavailable in Default mode. If you call it while in Default mode, it will return an error.

In Default mode, strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions. If you absolutely must ask a question because the answer cannot be discovered from local context and a reasonable assumption would be risky, ask the user directly with a concise plain-text question. Never write a multiple choice question as a textual assistant message.
</collaboration_mode>`;
function mapCodexRuntimeMode(runtimeMode) {
	if (runtimeMode === "approval-required") return {
		approvalPolicy: "on-request",
		sandbox: "workspace-write"
	};
	return {
		approvalPolicy: "never",
		sandbox: "danger-full-access"
	};
}
/**
* On Windows with `shell: true`, `child.kill()` only terminates the `cmd.exe`
* wrapper, leaving the actual command running. Use `taskkill /T` to kill the
* entire process tree instead.
*/
function killChildTree(child) {
	killCodexChildProcess(child);
}
function normalizeCodexModelSlug(model, preferredId) {
	const normalized = normalizeModelSlug(model);
	if (!normalized) return;
	if (preferredId?.endsWith("-codex") && preferredId !== normalized) return preferredId;
	return normalized;
}
function buildCodexCollaborationMode(input) {
	if (input.interactionMode === void 0) return;
	const model = normalizeCodexModelSlug(input.model) ?? "gpt-5.3-codex";
	return {
		mode: input.interactionMode,
		settings: {
			model,
			reasoning_effort: input.effort ?? "medium",
			developer_instructions: input.interactionMode === "plan" ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS
		}
	};
}
function toCodexUserInputAnswer(value) {
	if (typeof value === "string") return { answers: [value] };
	if (Array.isArray(value)) return { answers: value.filter((entry) => typeof entry === "string") };
	if (value && typeof value === "object") {
		const maybeAnswers = value.answers;
		if (Array.isArray(maybeAnswers)) return { answers: maybeAnswers.filter((entry) => typeof entry === "string") };
	}
	throw new Error("User input answers must be strings or arrays of strings.");
}
function toCodexUserInputAnswers(answers) {
	return Object.fromEntries(Object.entries(answers).map(([questionId, value]) => [questionId, toCodexUserInputAnswer(value)]));
}
function classifyCodexStderrLine(rawLine) {
	const line = rawLine.replaceAll(ANSI_ESCAPE_REGEX, "").trim();
	if (!line) return null;
	const match = line.match(CODEX_STDERR_LOG_REGEX);
	if (match) {
		const level = match[1];
		if (level && level !== "ERROR") return null;
		if (BENIGN_ERROR_LOG_SNIPPETS.some((snippet) => line.includes(snippet))) return null;
	}
	return { message: line };
}
function isRecoverableThreadResumeError(error) {
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	if (!message.includes("thread/resume")) return false;
	return RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}
var CodexAppServerManager = class extends EventEmitter {
	sessions = /* @__PURE__ */ new Map();
	runPromise;
	constructor(services) {
		super();
		this.runPromise = services ? Effect.runPromiseWith(services) : Effect.runPromise;
	}
	async startSession(input) {
		const threadId = input.threadId;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let context;
		try {
			const resolvedCwd = input.cwd ?? process.cwd();
			const session = {
				provider: "codex",
				status: "connecting",
				runtimeMode: input.runtimeMode,
				model: normalizeCodexModelSlug(input.model),
				cwd: resolvedCwd,
				threadId,
				createdAt: now,
				updatedAt: now
			};
			const codexBinaryPath = input.binaryPath;
			const codexHomePath = input.homePath;
			this.assertSupportedCodexCliVersion({
				binaryPath: codexBinaryPath,
				cwd: resolvedCwd,
				...codexHomePath ? { homePath: codexHomePath } : {}
			});
			const child = spawn(codexBinaryPath, ["app-server"], {
				cwd: resolvedCwd,
				env: {
					...process.env,
					...codexHomePath ? { CODEX_HOME: codexHomePath } : {}
				},
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				shell: process.platform === "win32"
			});
			context = {
				session,
				account: {
					type: "unknown",
					planType: null,
					sparkEnabled: true
				},
				child,
				output: readline.createInterface({ input: child.stdout }),
				pending: /* @__PURE__ */ new Map(),
				pendingApprovals: /* @__PURE__ */ new Map(),
				pendingUserInputs: /* @__PURE__ */ new Map(),
				collabReceiverTurns: /* @__PURE__ */ new Map(),
				nextRequestId: 1,
				stopping: false
			};
			this.sessions.set(threadId, context);
			this.attachProcessListeners(context);
			this.emitLifecycleEvent(context, "session/connecting", "Starting codex app-server");
			await this.sendRequest(context, "initialize", buildCodexInitializeParams());
			this.writeMessage(context, { method: "initialized" });
			try {
				const modelListResponse = await this.sendRequest(context, "model/list", {});
				console.log("codex model/list response", modelListResponse);
			} catch (error) {
				console.log("codex model/list failed", error);
			}
			try {
				const accountReadResponse = await this.sendRequest(context, "account/read", {});
				console.log("codex account/read response", accountReadResponse);
				context.account = readCodexAccountSnapshot(accountReadResponse);
				console.log("codex subscription status", {
					type: context.account.type,
					planType: context.account.planType,
					sparkEnabled: context.account.sparkEnabled
				});
			} catch (error) {
				console.log("codex account/read failed", error);
			}
			const normalizedModel = resolveCodexModelForAccount(normalizeCodexModelSlug(input.model), context.account);
			const sessionOverrides = {
				model: normalizedModel ?? null,
				...input.serviceTier !== void 0 ? { serviceTier: input.serviceTier } : {},
				cwd: input.cwd ?? null,
				...mapCodexRuntimeMode(input.runtimeMode ?? "full-access")
			};
			const threadStartParams = {
				...sessionOverrides,
				experimentalRawEvents: false
			};
			const resumeThreadId = readResumeThreadId(input);
			this.emitLifecycleEvent(context, "session/threadOpenRequested", resumeThreadId ? `Attempting to resume thread ${resumeThreadId}.` : "Starting a new Codex thread.");
			await Effect.logInfo("codex app-server opening thread", {
				threadId,
				requestedRuntimeMode: input.runtimeMode,
				requestedModel: normalizedModel ?? null,
				requestedCwd: resolvedCwd,
				resumeThreadId: resumeThreadId ?? null
			}).pipe(this.runPromise);
			let threadOpenMethod = "thread/start";
			let threadOpenResponse;
			if (resumeThreadId) try {
				threadOpenMethod = "thread/resume";
				threadOpenResponse = await this.sendRequest(context, "thread/resume", {
					...sessionOverrides,
					threadId: resumeThreadId
				});
			} catch (error) {
				if (!isRecoverableThreadResumeError(error)) {
					this.emitErrorEvent(context, "session/threadResumeFailed", error instanceof Error ? error.message : "Codex thread resume failed.");
					await Effect.logWarning("codex app-server thread resume failed", {
						threadId,
						requestedRuntimeMode: input.runtimeMode,
						resumeThreadId,
						recoverable: false,
						cause: error instanceof Error ? error.message : String(error)
					}).pipe(this.runPromise);
					throw error;
				}
				threadOpenMethod = "thread/start";
				this.emitLifecycleEvent(context, "session/threadResumeFallback", `Could not resume thread ${resumeThreadId}; started a new thread instead.`);
				await Effect.logWarning("codex app-server thread resume fell back to fresh start", {
					threadId,
					requestedRuntimeMode: input.runtimeMode,
					resumeThreadId,
					recoverable: true,
					cause: error instanceof Error ? error.message : String(error)
				}).pipe(this.runPromise);
				threadOpenResponse = await this.sendRequest(context, "thread/start", threadStartParams);
			}
			else {
				threadOpenMethod = "thread/start";
				threadOpenResponse = await this.sendRequest(context, "thread/start", threadStartParams);
			}
			const threadOpenRecord = this.readObject(threadOpenResponse);
			const threadIdRaw = this.readString(this.readObject(threadOpenRecord, "thread"), "id") ?? this.readString(threadOpenRecord, "threadId");
			if (!threadIdRaw) throw new Error(`${threadOpenMethod} response did not include a thread id.`);
			const providerThreadId = threadIdRaw;
			this.updateSession(context, {
				status: "ready",
				resumeCursor: { threadId: providerThreadId }
			});
			this.emitLifecycleEvent(context, "session/threadOpenResolved", `Codex ${threadOpenMethod} resolved.`);
			await Effect.logInfo("codex app-server thread open resolved", {
				threadId,
				threadOpenMethod,
				requestedResumeThreadId: resumeThreadId ?? null,
				resolvedThreadId: providerThreadId,
				requestedRuntimeMode: input.runtimeMode
			}).pipe(this.runPromise);
			this.emitLifecycleEvent(context, "session/ready", `Connected to thread ${providerThreadId}`);
			return { ...context.session };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to start Codex session.";
			if (context) {
				this.updateSession(context, {
					status: "error",
					lastError: message
				});
				this.emitErrorEvent(context, "session/startFailed", message);
				this.stopSession(threadId);
			} else this.emitEvent({
				id: EventId.makeUnsafe(randomUUID()),
				kind: "error",
				provider: "codex",
				threadId,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				method: "session/startFailed",
				message
			});
			throw new Error(message, { cause: error });
		}
	}
	async sendTurn(input) {
		const context = this.requireSession(input.threadId);
		context.collabReceiverTurns.clear();
		const turnInput = [];
		if (input.input) turnInput.push({
			type: "text",
			text: input.input,
			text_elements: []
		});
		for (const attachment of input.attachments ?? []) if (attachment.type === "image") turnInput.push({
			type: "image",
			url: attachment.url
		});
		if (turnInput.length === 0) throw new Error("Turn input must include text or attachments.");
		const providerThreadId = readResumeThreadId({
			threadId: context.session.threadId,
			runtimeMode: context.session.runtimeMode,
			resumeCursor: context.session.resumeCursor
		});
		if (!providerThreadId) throw new Error("Session is missing provider resume thread id.");
		const turnStartParams = {
			threadId: providerThreadId,
			input: turnInput
		};
		const normalizedModel = resolveCodexModelForAccount(normalizeCodexModelSlug(input.model ?? context.session.model), context.account);
		if (normalizedModel) turnStartParams.model = normalizedModel;
		if (input.serviceTier !== void 0) turnStartParams.serviceTier = input.serviceTier;
		if (input.effort) turnStartParams.effort = input.effort;
		const collaborationMode = buildCodexCollaborationMode({
			...input.interactionMode !== void 0 ? { interactionMode: input.interactionMode } : {},
			...normalizedModel !== void 0 ? { model: normalizedModel } : {},
			...input.effort !== void 0 ? { effort: input.effort } : {}
		});
		if (collaborationMode) {
			if (!turnStartParams.model) turnStartParams.model = collaborationMode.settings.model;
			turnStartParams.collaborationMode = collaborationMode;
		}
		const response = await this.sendRequest(context, "turn/start", turnStartParams);
		const turn = this.readObject(this.readObject(response), "turn");
		const turnIdRaw = this.readString(turn, "id");
		if (!turnIdRaw) throw new Error("turn/start response did not include a turn id.");
		const turnId = TurnId.makeUnsafe(turnIdRaw);
		this.updateSession(context, {
			status: "running",
			activeTurnId: turnId,
			...context.session.resumeCursor !== void 0 ? { resumeCursor: context.session.resumeCursor } : {}
		});
		return {
			threadId: context.session.threadId,
			turnId,
			...context.session.resumeCursor !== void 0 ? { resumeCursor: context.session.resumeCursor } : {}
		};
	}
	async interruptTurn(threadId, turnId) {
		const context = this.requireSession(threadId);
		const effectiveTurnId = turnId ?? context.session.activeTurnId;
		const providerThreadId = readResumeThreadId({
			threadId: context.session.threadId,
			runtimeMode: context.session.runtimeMode,
			resumeCursor: context.session.resumeCursor
		});
		if (!effectiveTurnId || !providerThreadId) return;
		await this.sendRequest(context, "turn/interrupt", {
			threadId: providerThreadId,
			turnId: effectiveTurnId
		});
	}
	async readThread(threadId) {
		const context = this.requireSession(threadId);
		const providerThreadId = readResumeThreadId({
			threadId: context.session.threadId,
			runtimeMode: context.session.runtimeMode,
			resumeCursor: context.session.resumeCursor
		});
		if (!providerThreadId) throw new Error("Session is missing a provider resume thread id.");
		const response = await this.sendRequest(context, "thread/read", {
			threadId: providerThreadId,
			includeTurns: true
		});
		return this.parseThreadSnapshot("thread/read", response);
	}
	async rollbackThread(threadId, numTurns) {
		const context = this.requireSession(threadId);
		const providerThreadId = readResumeThreadId({
			threadId: context.session.threadId,
			runtimeMode: context.session.runtimeMode,
			resumeCursor: context.session.resumeCursor
		});
		if (!providerThreadId) throw new Error("Session is missing a provider resume thread id.");
		if (!Number.isInteger(numTurns) || numTurns < 1) throw new Error("numTurns must be an integer >= 1.");
		const response = await this.sendRequest(context, "thread/rollback", {
			threadId: providerThreadId,
			numTurns
		});
		this.updateSession(context, {
			status: "ready",
			activeTurnId: void 0
		});
		return this.parseThreadSnapshot("thread/rollback", response);
	}
	async respondToRequest(threadId, requestId, decision) {
		const context = this.requireSession(threadId);
		const pendingRequest = context.pendingApprovals.get(requestId);
		if (!pendingRequest) throw new Error(`Unknown pending approval request: ${requestId}`);
		context.pendingApprovals.delete(requestId);
		this.writeMessage(context, {
			id: pendingRequest.jsonRpcId,
			result: { decision }
		});
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "notification",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method: "item/requestApproval/decision",
			turnId: pendingRequest.turnId,
			itemId: pendingRequest.itemId,
			requestId: pendingRequest.requestId,
			requestKind: pendingRequest.requestKind,
			payload: {
				requestId: pendingRequest.requestId,
				requestKind: pendingRequest.requestKind,
				decision
			}
		});
	}
	async respondToUserInput(threadId, requestId, answers) {
		const context = this.requireSession(threadId);
		const pendingRequest = context.pendingUserInputs.get(requestId);
		if (!pendingRequest) throw new Error(`Unknown pending user input request: ${requestId}`);
		context.pendingUserInputs.delete(requestId);
		const codexAnswers = toCodexUserInputAnswers(answers);
		this.writeMessage(context, {
			id: pendingRequest.jsonRpcId,
			result: { answers: codexAnswers }
		});
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "notification",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method: "item/tool/requestUserInput/answered",
			turnId: pendingRequest.turnId,
			itemId: pendingRequest.itemId,
			requestId: pendingRequest.requestId,
			payload: {
				requestId: pendingRequest.requestId,
				answers: codexAnswers
			}
		});
	}
	stopSession(threadId) {
		const context = this.sessions.get(threadId);
		if (!context) return;
		context.stopping = true;
		for (const pending of context.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(/* @__PURE__ */ new Error("Session stopped before request completed."));
		}
		context.pending.clear();
		context.pendingApprovals.clear();
		context.pendingUserInputs.clear();
		context.output.close();
		if (!context.child.killed) killChildTree(context.child);
		this.updateSession(context, {
			status: "closed",
			activeTurnId: void 0
		});
		this.emitLifecycleEvent(context, "session/closed", "Session stopped");
		this.sessions.delete(threadId);
	}
	listSessions() {
		return Array.from(this.sessions.values(), ({ session }) => ({ ...session }));
	}
	hasSession(threadId) {
		return this.sessions.has(threadId);
	}
	stopAll() {
		for (const threadId of this.sessions.keys()) this.stopSession(threadId);
	}
	requireSession(threadId) {
		const context = this.sessions.get(threadId);
		if (!context) throw new Error(`Unknown session for thread: ${threadId}`);
		if (context.session.status === "closed") throw new Error(`Session is closed for thread: ${threadId}`);
		return context;
	}
	attachProcessListeners(context) {
		context.output.on("line", (line) => {
			this.handleStdoutLine(context, line);
		});
		context.child.stderr.on("data", (chunk) => {
			const lines = chunk.toString().split(/\r?\n/g);
			for (const rawLine of lines) {
				const classified = classifyCodexStderrLine(rawLine);
				if (!classified) continue;
				this.emitNotificationEvent(context, "process/stderr", classified.message);
			}
		});
		context.child.on("error", (error) => {
			const message = error.message || "codex app-server process errored.";
			this.updateSession(context, {
				status: "error",
				lastError: message
			});
			this.emitErrorEvent(context, "process/error", message);
		});
		context.child.on("exit", (code, signal) => {
			if (context.stopping) return;
			const message = `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
			this.updateSession(context, {
				status: "closed",
				activeTurnId: void 0,
				lastError: code === 0 ? context.session.lastError : message
			});
			this.emitLifecycleEvent(context, "session/exited", message);
			this.sessions.delete(context.session.threadId);
		});
	}
	handleStdoutLine(context, line) {
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.emitErrorEvent(context, "protocol/parseError", "Received invalid JSON from codex app-server.");
			return;
		}
		if (!parsed || typeof parsed !== "object") {
			this.emitErrorEvent(context, "protocol/invalidMessage", "Received non-object protocol message.");
			return;
		}
		if (this.isServerRequest(parsed)) {
			this.handleServerRequest(context, parsed);
			return;
		}
		if (this.isServerNotification(parsed)) {
			this.handleServerNotification(context, parsed);
			return;
		}
		if (this.isResponse(parsed)) {
			this.handleResponse(context, parsed);
			return;
		}
		this.emitErrorEvent(context, "protocol/unrecognizedMessage", "Received protocol message in an unknown shape.");
	}
	handleServerNotification(context, notification) {
		const rawRoute = this.readRouteFields(notification.params);
		this.rememberCollabReceiverTurns(context, notification.params, rawRoute.turnId);
		const childParentTurnId = this.readChildParentTurnId(context, notification.params);
		const isChildConversation = childParentTurnId !== void 0;
		if (isChildConversation && this.shouldSuppressChildConversationNotification(notification.method)) return;
		const textDelta = notification.method === "item/agentMessage/delta" ? this.readString(notification.params, "delta") : void 0;
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "notification",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method: notification.method,
			...childParentTurnId ?? rawRoute.turnId ? { turnId: childParentTurnId ?? rawRoute.turnId } : {},
			...rawRoute.itemId ? { itemId: rawRoute.itemId } : {},
			textDelta,
			payload: notification.params
		});
		if (notification.method === "thread/started") {
			const providerThreadId = normalizeProviderThreadId(this.readString(this.readObject(notification.params)?.thread, "id"));
			if (providerThreadId) this.updateSession(context, { resumeCursor: { threadId: providerThreadId } });
			return;
		}
		if (notification.method === "turn/started") {
			if (isChildConversation) return;
			const turnId = toTurnId$3(this.readString(this.readObject(notification.params)?.turn, "id"));
			this.updateSession(context, {
				status: "running",
				activeTurnId: turnId
			});
			return;
		}
		if (notification.method === "turn/completed") {
			if (isChildConversation) return;
			context.collabReceiverTurns.clear();
			const turn = this.readObject(notification.params, "turn");
			const status = this.readString(turn, "status");
			const errorMessage = this.readString(this.readObject(turn, "error"), "message");
			this.updateSession(context, {
				status: status === "failed" ? "error" : "ready",
				activeTurnId: void 0,
				lastError: errorMessage ?? context.session.lastError
			});
			return;
		}
		if (notification.method === "error") {
			if (isChildConversation) return;
			const message = this.readString(this.readObject(notification.params)?.error, "message");
			const willRetry = this.readBoolean(notification.params, "willRetry");
			this.updateSession(context, {
				status: willRetry ? "running" : "error",
				lastError: message ?? context.session.lastError
			});
		}
	}
	handleServerRequest(context, request) {
		const rawRoute = this.readRouteFields(request.params);
		const effectiveTurnId = this.readChildParentTurnId(context, request.params) ?? rawRoute.turnId;
		const requestKind = this.requestKindForMethod(request.method);
		let requestId;
		if (requestKind) {
			requestId = ApprovalRequestId.makeUnsafe(randomUUID());
			const pendingRequest = {
				requestId,
				jsonRpcId: request.id,
				method: requestKind === "command" ? "item/commandExecution/requestApproval" : requestKind === "file-read" ? "item/fileRead/requestApproval" : "item/fileChange/requestApproval",
				requestKind,
				threadId: context.session.threadId,
				...effectiveTurnId ? { turnId: effectiveTurnId } : {},
				...rawRoute.itemId ? { itemId: rawRoute.itemId } : {}
			};
			context.pendingApprovals.set(requestId, pendingRequest);
		}
		if (request.method === "item/tool/requestUserInput") {
			requestId = ApprovalRequestId.makeUnsafe(randomUUID());
			context.pendingUserInputs.set(requestId, {
				requestId,
				jsonRpcId: request.id,
				threadId: context.session.threadId,
				...effectiveTurnId ? { turnId: effectiveTurnId } : {},
				...rawRoute.itemId ? { itemId: rawRoute.itemId } : {}
			});
		}
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "request",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method: request.method,
			...effectiveTurnId ? { turnId: effectiveTurnId } : {},
			...rawRoute.itemId ? { itemId: rawRoute.itemId } : {},
			requestId,
			requestKind,
			payload: request.params
		});
		if (requestKind) return;
		if (request.method === "item/tool/requestUserInput") return;
		this.writeMessage(context, {
			id: request.id,
			error: {
				code: -32601,
				message: `Unsupported server request: ${request.method}`
			}
		});
	}
	handleResponse(context, response) {
		const key = String(response.id);
		const pending = context.pending.get(key);
		if (!pending) return;
		clearTimeout(pending.timeout);
		context.pending.delete(key);
		if (response.error?.message) {
			pending.reject(/* @__PURE__ */ new Error(`${pending.method} failed: ${String(response.error.message)}`));
			return;
		}
		pending.resolve(response.result);
	}
	async sendRequest(context, method, params, timeoutMs = 2e4) {
		const id = context.nextRequestId;
		context.nextRequestId += 1;
		return await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				context.pending.delete(String(id));
				reject(/* @__PURE__ */ new Error(`Timed out waiting for ${method}.`));
			}, timeoutMs);
			context.pending.set(String(id), {
				method,
				timeout,
				resolve,
				reject
			});
			this.writeMessage(context, {
				method,
				id,
				params
			});
		});
	}
	writeMessage(context, message) {
		const encoded = JSON.stringify(message);
		if (!context.child.stdin.writable) throw new Error("Cannot write to codex app-server stdin.");
		context.child.stdin.write(`${encoded}\n`);
	}
	emitLifecycleEvent(context, method, message) {
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "session",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method,
			message
		});
	}
	emitErrorEvent(context, method, message) {
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "error",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method,
			message
		});
	}
	emitNotificationEvent(context, method, message) {
		this.emitEvent({
			id: EventId.makeUnsafe(randomUUID()),
			kind: "notification",
			provider: "codex",
			threadId: context.session.threadId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			method,
			message
		});
	}
	emitEvent(event) {
		this.emit("event", event);
	}
	assertSupportedCodexCliVersion(input) {
		assertSupportedCodexCliVersion(input);
	}
	updateSession(context, updates) {
		context.session = {
			...context.session,
			...updates,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	requestKindForMethod(method) {
		if (method === "item/commandExecution/requestApproval") return "command";
		if (method === "item/fileRead/requestApproval") return "file-read";
		if (method === "item/fileChange/requestApproval") return "file-change";
	}
	parseThreadSnapshot(method, response) {
		const responseRecord = this.readObject(response);
		const thread = this.readObject(responseRecord, "thread");
		const threadIdRaw = this.readString(thread, "id") ?? this.readString(responseRecord, "threadId");
		if (!threadIdRaw) throw new Error(`${method} response did not include a thread id.`);
		return {
			threadId: threadIdRaw,
			turns: (this.readArray(thread, "turns") ?? this.readArray(responseRecord, "turns") ?? []).map((turnValue, index) => {
				const turn = this.readObject(turnValue);
				const turnIdRaw = this.readString(turn, "id") ?? `${threadIdRaw}:turn:${index + 1}`;
				return {
					id: TurnId.makeUnsafe(turnIdRaw),
					items: this.readArray(turn, "items") ?? []
				};
			})
		};
	}
	isServerRequest(value) {
		if (!value || typeof value !== "object") return false;
		const candidate = value;
		return typeof candidate.method === "string" && (typeof candidate.id === "string" || typeof candidate.id === "number");
	}
	isServerNotification(value) {
		if (!value || typeof value !== "object") return false;
		const candidate = value;
		return typeof candidate.method === "string" && !("id" in candidate);
	}
	isResponse(value) {
		if (!value || typeof value !== "object") return false;
		const candidate = value;
		const hasId = typeof candidate.id === "string" || typeof candidate.id === "number";
		const hasMethod = typeof candidate.method === "string";
		return hasId && !hasMethod;
	}
	readRouteFields(params) {
		const route = {};
		const turnId = toTurnId$3(this.readString(params, "turnId") ?? this.readString(this.readObject(params, "turn"), "id"));
		const itemId = toProviderItemId$1(this.readString(params, "itemId") ?? this.readString(this.readObject(params, "item"), "id"));
		if (turnId) route.turnId = turnId;
		if (itemId) route.itemId = itemId;
		return route;
	}
	readProviderConversationId(params) {
		return this.readString(params, "threadId") ?? this.readString(this.readObject(params, "thread"), "id") ?? this.readString(params, "conversationId");
	}
	readChildParentTurnId(context, params) {
		const providerConversationId = this.readProviderConversationId(params);
		if (!providerConversationId) return;
		return context.collabReceiverTurns.get(providerConversationId);
	}
	rememberCollabReceiverTurns(context, params, parentTurnId) {
		if (!parentTurnId) return;
		const payload = this.readObject(params);
		const item = this.readObject(payload, "item") ?? payload;
		if ((this.readString(item, "type") ?? this.readString(item, "kind")) !== "collabAgentToolCall") return;
		const receiverThreadIds = this.readArray(item, "receiverThreadIds")?.map((value) => typeof value === "string" ? value : null).filter((value) => value !== null) ?? [];
		for (const receiverThreadId of receiverThreadIds) context.collabReceiverTurns.set(receiverThreadId, parentTurnId);
	}
	shouldSuppressChildConversationNotification(method) {
		return method === "thread/started" || method === "thread/status/changed" || method === "thread/archived" || method === "thread/unarchived" || method === "thread/closed" || method === "thread/compacted" || method === "thread/name/updated" || method === "thread/tokenUsage/updated" || method === "turn/started" || method === "turn/completed" || method === "turn/aborted" || method === "turn/plan/updated" || method === "item/plan/delta";
	}
	readObject(value, key) {
		const target = key === void 0 ? value : value && typeof value === "object" ? value[key] : void 0;
		if (!target || typeof target !== "object") return;
		return target;
	}
	readArray(value, key) {
		const target = key === void 0 ? value : value && typeof value === "object" ? value[key] : void 0;
		return Array.isArray(target) ? target : void 0;
	}
	readString(value, key) {
		if (!value || typeof value !== "object") return;
		const candidate = value[key];
		return typeof candidate === "string" ? candidate : void 0;
	}
	readBoolean(value, key) {
		if (!value || typeof value !== "object") return;
		const candidate = value[key];
		return typeof candidate === "boolean" ? candidate : void 0;
	}
};
function brandIfNonEmpty(value, maker) {
	const normalized = value?.trim();
	return normalized?.length ? maker(normalized) : void 0;
}
function normalizeProviderThreadId(value) {
	return brandIfNonEmpty(value, (normalized) => normalized);
}
function assertSupportedCodexCliVersion(input) {
	const result = spawnSync(input.binaryPath, ["--version"], {
		cwd: input.cwd,
		env: {
			...process.env,
			...input.homePath ? { CODEX_HOME: input.homePath } : {}
		},
		encoding: "utf8",
		shell: process.platform === "win32",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
		maxBuffer: 1024 * 1024
	});
	if (result.error) {
		const lower = result.error.message.toLowerCase();
		if (lower.includes("enoent") || lower.includes("command not found") || lower.includes("not found")) throw new Error(`Codex CLI (${input.binaryPath}) is not installed or not executable.`);
		throw new Error(`Failed to execute Codex CLI version check: ${result.error.message || String(result.error)}`);
	}
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	if (result.status !== 0) {
		const detail = stderr.trim() || stdout.trim() || `Command exited with code ${result.status}.`;
		throw new Error(`Codex CLI version check failed. ${detail}`);
	}
	const parsedVersion = parseCodexCliVersion(`${stdout}\n${stderr}`);
	if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) throw new Error(formatCodexCliUpgradeMessage(parsedVersion));
}
function readResumeCursorThreadId(resumeCursor) {
	if (!resumeCursor || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) return;
	const rawThreadId = resumeCursor.threadId;
	return typeof rawThreadId === "string" ? normalizeProviderThreadId(rawThreadId) : void 0;
}
function readResumeThreadId(input) {
	return readResumeCursorThreadId(input.resumeCursor);
}
function toTurnId$3(value) {
	return brandIfNonEmpty(value, TurnId.makeUnsafe);
}
function toProviderItemId$1(value) {
	return brandIfNonEmpty(value, ProviderItemId.makeUnsafe);
}

//#endregion
//#region src/provider/Layers/CodexAdapter.ts
/**
* CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
*
* Wraps `CodexAppServerManager` behind the `CodexAdapter` service contract and
* maps manager failures into the shared `ProviderAdapterError` algebra.
*
* @module CodexAdapterLive
*/
const PROVIDER$3 = "codex";
function toMessage$1(cause, fallback) {
	if (cause instanceof Error && cause.message.length > 0) return cause.message;
	return fallback;
}
function toSessionError$1(threadId, cause) {
	const normalized = toMessage$1(cause, "").toLowerCase();
	if (normalized.includes("unknown session") || normalized.includes("unknown provider session")) return new ProviderAdapterSessionNotFoundError({
		provider: PROVIDER$3,
		threadId,
		cause
	});
	if (normalized.includes("session is closed")) return new ProviderAdapterSessionClosedError({
		provider: PROVIDER$3,
		threadId,
		cause
	});
}
function toRequestError$1(threadId, method, cause) {
	const sessionError = toSessionError$1(threadId, cause);
	if (sessionError) return sessionError;
	return new ProviderAdapterRequestError({
		provider: PROVIDER$3,
		method,
		detail: toMessage$1(cause, `${method} failed`),
		cause
	});
}
function asObject(value) {
	if (!value || typeof value !== "object") return;
	return value;
}
function asString(value) {
	return typeof value === "string" ? value : void 0;
}
function asArray(value) {
	return Array.isArray(value) ? value : void 0;
}
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
const FATAL_CODEX_STDERR_SNIPPETS = ["failed to connect to websocket"];
function isFatalCodexProcessStderrMessage(message) {
	const normalized = message.toLowerCase();
	return FATAL_CODEX_STDERR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}
function normalizeCodexTokenUsage(value) {
	const usage = asObject(value);
	const totalUsage = asObject(usage?.total_token_usage ?? usage?.total);
	const lastUsage = asObject(usage?.last_token_usage ?? usage?.last);
	const totalProcessedTokens = asNumber(totalUsage?.total_tokens) ?? asNumber(totalUsage?.totalTokens);
	const usedTokens = asNumber(lastUsage?.total_tokens) ?? asNumber(lastUsage?.totalTokens) ?? totalProcessedTokens;
	if (usedTokens === void 0 || usedTokens <= 0) return;
	const maxTokens = asNumber(usage?.model_context_window) ?? asNumber(usage?.modelContextWindow);
	const inputTokens = asNumber(lastUsage?.input_tokens) ?? asNumber(lastUsage?.inputTokens);
	const cachedInputTokens = asNumber(lastUsage?.cached_input_tokens) ?? asNumber(lastUsage?.cachedInputTokens);
	const outputTokens = asNumber(lastUsage?.output_tokens) ?? asNumber(lastUsage?.outputTokens);
	const reasoningOutputTokens = asNumber(lastUsage?.reasoning_output_tokens) ?? asNumber(lastUsage?.reasoningOutputTokens);
	return {
		usedTokens,
		...totalProcessedTokens !== void 0 && totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {},
		...maxTokens !== void 0 ? { maxTokens } : {},
		...inputTokens !== void 0 ? { inputTokens } : {},
		...cachedInputTokens !== void 0 ? { cachedInputTokens } : {},
		...outputTokens !== void 0 ? { outputTokens } : {},
		...reasoningOutputTokens !== void 0 ? { reasoningOutputTokens } : {},
		...usedTokens !== void 0 ? { lastUsedTokens: usedTokens } : {},
		...inputTokens !== void 0 ? { lastInputTokens: inputTokens } : {},
		...cachedInputTokens !== void 0 ? { lastCachedInputTokens: cachedInputTokens } : {},
		...outputTokens !== void 0 ? { lastOutputTokens: outputTokens } : {},
		...reasoningOutputTokens !== void 0 ? { lastReasoningOutputTokens: reasoningOutputTokens } : {},
		compactsAutomatically: true
	};
}
function toTurnId$2(value) {
	return value?.trim() ? TurnId.makeUnsafe(value) : void 0;
}
function toProviderItemId(value) {
	return value?.trim() ? ProviderItemId.makeUnsafe(value) : void 0;
}
function toTurnStatus(value) {
	switch (value) {
		case "completed":
		case "failed":
		case "cancelled":
		case "interrupted": return value;
		default: return "completed";
	}
}
function normalizeItemType(raw) {
	const type = asString(raw);
	if (!type) return "item";
	return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._/-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function toCanonicalItemType(raw) {
	const type = normalizeItemType(raw);
	if (type.includes("user")) return "user_message";
	if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
	if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
	if (type.includes("plan") || type.includes("todo")) return "plan";
	if (type.includes("command")) return "command_execution";
	if (type.includes("file change") || type.includes("patch") || type.includes("edit")) return "file_change";
	if (type.includes("mcp")) return "mcp_tool_call";
	if (type.includes("dynamic tool")) return "dynamic_tool_call";
	if (type.includes("collab")) return "collab_agent_tool_call";
	if (type.includes("web search")) return "web_search";
	if (type.includes("image")) return "image_view";
	if (type.includes("review entered")) return "review_entered";
	if (type.includes("review exited")) return "review_exited";
	if (type.includes("compact")) return "context_compaction";
	if (type.includes("error")) return "error";
	return "unknown";
}
function itemTitle(itemType) {
	switch (itemType) {
		case "assistant_message": return "Assistant message";
		case "user_message": return "User message";
		case "reasoning": return "Reasoning";
		case "plan": return "Plan";
		case "command_execution": return "Ran command";
		case "file_change": return "File change";
		case "mcp_tool_call": return "MCP tool call";
		case "dynamic_tool_call": return "Tool call";
		case "web_search": return "Web search";
		case "image_view": return "Image view";
		case "error": return "Error";
		default: return;
	}
}
function itemDetail(item, payload) {
	const nestedResult = asObject(item.result);
	const candidates = [
		asString(item.command),
		asString(item.title),
		asString(item.summary),
		asString(item.text),
		asString(item.path),
		asString(item.prompt),
		asString(nestedResult?.command),
		asString(payload.command),
		asString(payload.message),
		asString(payload.prompt)
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const trimmed = candidate.trim();
		if (trimmed.length === 0) continue;
		return trimmed;
	}
}
function toRequestTypeFromMethod(method) {
	switch (method) {
		case "item/commandExecution/requestApproval": return "command_execution_approval";
		case "item/fileRead/requestApproval": return "file_read_approval";
		case "item/fileChange/requestApproval": return "file_change_approval";
		case "applyPatchApproval": return "apply_patch_approval";
		case "execCommandApproval": return "exec_command_approval";
		case "item/tool/requestUserInput": return "tool_user_input";
		case "item/tool/call": return "dynamic_tool_call";
		case "account/chatgptAuthTokens/refresh": return "auth_tokens_refresh";
		default: return "unknown";
	}
}
function toRequestTypeFromKind(kind) {
	switch (kind) {
		case "command": return "command_execution_approval";
		case "file-read": return "file_read_approval";
		case "file-change": return "file_change_approval";
		default: return "unknown";
	}
}
function toRequestTypeFromResolvedPayload(payload) {
	const request = asObject(payload?.request);
	const method = asString(request?.method) ?? asString(payload?.method);
	if (method) return toRequestTypeFromMethod(method);
	const requestKind = asString(request?.kind) ?? asString(payload?.requestKind);
	if (requestKind) return toRequestTypeFromKind(requestKind);
	return "unknown";
}
function toCanonicalUserInputAnswers(answers) {
	if (!answers) return {};
	return Object.fromEntries(Object.entries(answers).flatMap(([questionId, value]) => {
		if (typeof value === "string") return [[questionId, value]];
		if (Array.isArray(value)) {
			const normalized = value.filter((entry) => typeof entry === "string");
			return [[questionId, normalized.length === 1 ? normalized[0] : normalized]];
		}
		const answerList = asArray(asObject(value)?.answers)?.filter((entry) => typeof entry === "string");
		if (!answerList) return [];
		return [[questionId, answerList.length === 1 ? answerList[0] : answerList]];
	}));
}
function toUserInputQuestions(payload) {
	const questions = asArray(payload?.questions);
	if (!questions) return;
	const parsedQuestions = questions.map((entry) => {
		const question = asObject(entry);
		if (!question) return void 0;
		const options = asArray(question.options)?.map((option) => {
			const optionRecord = asObject(option);
			if (!optionRecord) return void 0;
			const label = asString(optionRecord.label)?.trim();
			const description = asString(optionRecord.description)?.trim();
			if (!label || !description) return;
			return {
				label,
				description
			};
		}).filter((option) => option !== void 0);
		const id = asString(question.id)?.trim();
		const header = asString(question.header)?.trim();
		const prompt = asString(question.question)?.trim();
		if (!id || !header || !prompt || !options || options.length === 0) return;
		return {
			id,
			header,
			question: prompt,
			options
		};
	}).filter((question) => question !== void 0);
	return parsedQuestions.length > 0 ? parsedQuestions : void 0;
}
function toThreadState(value) {
	switch (value) {
		case "idle": return "idle";
		case "archived": return "archived";
		case "closed": return "closed";
		case "compacted": return "compacted";
		case "error":
		case "failed": return "error";
		default: return "active";
	}
}
function contentStreamKindFromMethod(method) {
	switch (method) {
		case "item/agentMessage/delta": return "assistant_text";
		case "item/reasoning/textDelta": return "reasoning_text";
		case "item/reasoning/summaryTextDelta": return "reasoning_summary_text";
		case "item/commandExecution/outputDelta": return "command_output";
		case "item/fileChange/outputDelta": return "file_change_output";
		default: return "assistant_text";
	}
}
const PROPOSED_PLAN_BLOCK_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i;
function extractProposedPlanMarkdown(text) {
	const planMarkdown = (text ? PROPOSED_PLAN_BLOCK_REGEX.exec(text) : null)?.[1]?.trim();
	return planMarkdown && planMarkdown.length > 0 ? planMarkdown : void 0;
}
function asRuntimeItemId$1(itemId) {
	return RuntimeItemId.makeUnsafe(itemId);
}
function asRuntimeRequestId$1(requestId) {
	return RuntimeRequestId.makeUnsafe(requestId);
}
function asRuntimeTaskId(taskId) {
	return RuntimeTaskId.makeUnsafe(taskId);
}
function codexEventMessage(payload) {
	return asObject(payload?.msg);
}
function codexEventBase(event, canonicalThreadId) {
	const msg = codexEventMessage(asObject(event.payload));
	const turnId = event.turnId ?? toTurnId$2(asString(msg?.turn_id) ?? asString(msg?.turnId));
	const itemId = event.itemId ?? toProviderItemId(asString(msg?.item_id) ?? asString(msg?.itemId));
	const requestId = asString(msg?.request_id) ?? asString(msg?.requestId);
	const base = runtimeEventBase(event, canonicalThreadId);
	const providerRefs = base.providerRefs ? {
		...base.providerRefs,
		...turnId ? { providerTurnId: turnId } : {},
		...itemId ? { providerItemId: itemId } : {},
		...requestId ? { providerRequestId: requestId } : {}
	} : {
		...turnId ? { providerTurnId: turnId } : {},
		...itemId ? { providerItemId: itemId } : {},
		...requestId ? { providerRequestId: requestId } : {}
	};
	return {
		...base,
		...turnId ? { turnId } : {},
		...itemId ? { itemId: asRuntimeItemId$1(itemId) } : {},
		...requestId ? { requestId: asRuntimeRequestId$1(requestId) } : {},
		...Object.keys(providerRefs).length > 0 ? { providerRefs } : {}
	};
}
function eventRawSource(event) {
	return event.kind === "request" ? "codex.app-server.request" : "codex.app-server.notification";
}
function providerRefsFromEvent(event) {
	const refs = {};
	if (event.turnId) refs.providerTurnId = event.turnId;
	if (event.itemId) refs.providerItemId = event.itemId;
	if (event.requestId) refs.providerRequestId = event.requestId;
	return Object.keys(refs).length > 0 ? refs : void 0;
}
function runtimeEventBase(event, canonicalThreadId) {
	const refs = providerRefsFromEvent(event);
	return {
		eventId: event.id,
		provider: event.provider,
		threadId: canonicalThreadId,
		createdAt: event.createdAt,
		...event.turnId ? { turnId: event.turnId } : {},
		...event.itemId ? { itemId: asRuntimeItemId$1(event.itemId) } : {},
		...event.requestId ? { requestId: asRuntimeRequestId$1(event.requestId) } : {},
		...refs ? { providerRefs: refs } : {},
		raw: {
			source: eventRawSource(event),
			method: event.method,
			payload: event.payload ?? {}
		}
	};
}
function mapItemLifecycle(event, canonicalThreadId, lifecycle) {
	const payload = asObject(event.payload);
	const source = asObject(payload?.item) ?? payload;
	if (!source) return;
	const itemType = toCanonicalItemType(source.type ?? source.kind);
	if (itemType === "unknown" && lifecycle !== "item.updated") return;
	const detail = itemDetail(source, payload ?? {});
	const status = lifecycle === "item.started" ? "inProgress" : lifecycle === "item.completed" ? "completed" : void 0;
	return {
		...runtimeEventBase(event, canonicalThreadId),
		type: lifecycle,
		payload: {
			itemType,
			...status ? { status } : {},
			...itemTitle(itemType) ? { title: itemTitle(itemType) } : {},
			...detail ? { detail } : {},
			...event.payload !== void 0 ? { data: event.payload } : {}
		}
	};
}
function mapToRuntimeEvents(event, canonicalThreadId) {
	const payload = asObject(event.payload);
	const turn = asObject(payload?.turn);
	if (event.kind === "error") {
		if (!event.message) return [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "runtime.error",
			payload: {
				message: event.message,
				class: "provider_error",
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		}];
	}
	if (event.kind === "request") {
		if (event.method === "item/tool/requestUserInput") {
			const questions = toUserInputQuestions(payload);
			if (!questions) return [];
			return [{
				...runtimeEventBase(event, canonicalThreadId),
				type: "user-input.requested",
				payload: { questions }
			}];
		}
		const detail = asString(payload?.command) ?? asString(payload?.reason) ?? asString(payload?.prompt);
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "request.opened",
			payload: {
				requestType: toRequestTypeFromMethod(event.method),
				...detail ? { detail } : {},
				...event.payload !== void 0 ? { args: event.payload } : {}
			}
		}];
	}
	if (event.method === "item/requestApproval/decision" && event.requestId) {
		const decision = Schema.decodeUnknownSync(ProviderApprovalDecision)(payload?.decision);
		const requestType = event.requestKind !== void 0 ? toRequestTypeFromKind(event.requestKind) : toRequestTypeFromMethod(event.method);
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "request.resolved",
			payload: {
				requestType,
				...decision ? { decision } : {},
				...event.payload !== void 0 ? { resolution: event.payload } : {}
			}
		}];
	}
	if (event.method === "session/connecting") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "session.state.changed",
		payload: {
			state: "starting",
			...event.message ? { reason: event.message } : {}
		}
	}];
	if (event.method === "session/ready") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "session.state.changed",
		payload: {
			state: "ready",
			...event.message ? { reason: event.message } : {}
		}
	}];
	if (event.method === "session/started") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "session.started",
		payload: {
			...event.message ? { message: event.message } : {},
			...event.payload !== void 0 ? { resume: event.payload } : {}
		}
	}];
	if (event.method === "session/exited" || event.method === "session/closed") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "session.exited",
		payload: {
			...event.message ? { reason: event.message } : {},
			...event.method === "session/closed" ? { exitKind: "graceful" } : {}
		}
	}];
	if (event.method === "thread/started") {
		const providerThreadId = asString(asObject(payload?.thread)?.id) ?? asString(payload?.threadId);
		if (!providerThreadId) return [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "thread.started",
			payload: { providerThreadId }
		}];
	}
	if (event.method === "thread/status/changed" || event.method === "thread/archived" || event.method === "thread/unarchived" || event.method === "thread/closed" || event.method === "thread/compacted") return [{
		type: "thread.state.changed",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			state: event.method === "thread/archived" ? "archived" : event.method === "thread/closed" ? "closed" : event.method === "thread/compacted" ? "compacted" : toThreadState(asObject(payload?.thread)?.state ?? payload?.state),
			...event.payload !== void 0 ? { detail: event.payload } : {}
		}
	}];
	if (event.method === "thread/name/updated") return [{
		type: "thread.metadata.updated",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			...asString(payload?.threadName) ? { name: asString(payload?.threadName) } : {},
			...event.payload !== void 0 ? { metadata: asObject(event.payload) } : {}
		}
	}];
	if (event.method === "thread/tokenUsage/updated") {
		const normalizedUsage = normalizeCodexTokenUsage(asObject(payload?.tokenUsage) ?? event.payload);
		if (!normalizedUsage) return [];
		return [{
			type: "thread.token-usage.updated",
			...runtimeEventBase(event, canonicalThreadId),
			payload: { usage: normalizedUsage }
		}];
	}
	if (event.method === "turn/started") {
		const turnId = event.turnId;
		if (!turnId) return [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			turnId,
			type: "turn.started",
			payload: {
				...asString(turn?.model) ? { model: asString(turn?.model) } : {},
				...asString(turn?.effort) ? { effort: asString(turn?.effort) } : {}
			}
		}];
	}
	if (event.method === "turn/completed") {
		const errorMessage = asString(asObject(turn?.error)?.message);
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "turn.completed",
			payload: {
				state: toTurnStatus(turn?.status),
				...asString(turn?.stopReason) ? { stopReason: asString(turn?.stopReason) } : {},
				...turn?.usage !== void 0 ? { usage: turn.usage } : {},
				...asObject(turn?.modelUsage) ? { modelUsage: asObject(turn?.modelUsage) } : {},
				...asNumber(turn?.totalCostUsd) !== void 0 ? { totalCostUsd: asNumber(turn?.totalCostUsd) } : {},
				...errorMessage ? { errorMessage } : {}
			}
		}];
	}
	if (event.method === "turn/aborted") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "turn.aborted",
		payload: { reason: event.message ?? "Turn aborted" }
	}];
	if (event.method === "turn/plan/updated") {
		const steps = Array.isArray(payload?.plan) ? payload.plan : [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "turn.plan.updated",
			payload: {
				...asString(payload?.explanation) ? { explanation: asString(payload?.explanation) } : {},
				plan: steps.map((entry) => asObject(entry)).filter((entry) => entry !== void 0).map((entry) => ({
					step: asString(entry.step) ?? "step",
					status: entry.status === "completed" || entry.status === "inProgress" ? entry.status : "pending"
				}))
			}
		}];
	}
	if (event.method === "turn/diff/updated") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "turn.diff.updated",
		payload: { unifiedDiff: asString(payload?.unifiedDiff) ?? asString(payload?.diff) ?? asString(payload?.patch) ?? "" }
	}];
	if (event.method === "item/started") {
		const started = mapItemLifecycle(event, canonicalThreadId, "item.started");
		return started ? [started] : [];
	}
	if (event.method === "item/completed") {
		const payload = asObject(event.payload);
		const source = asObject(payload?.item) ?? payload;
		if (!source) return [];
		if ((source ? toCanonicalItemType(source.type ?? source.kind) : "unknown") === "plan") {
			const detail = itemDetail(source, payload ?? {});
			if (!detail) return [];
			return [{
				...runtimeEventBase(event, canonicalThreadId),
				type: "turn.proposed.completed",
				payload: { planMarkdown: detail }
			}];
		}
		const completed = mapItemLifecycle(event, canonicalThreadId, "item.completed");
		return completed ? [completed] : [];
	}
	if (event.method === "item/reasoning/summaryPartAdded" || event.method === "item/commandExecution/terminalInteraction") {
		const updated = mapItemLifecycle(event, canonicalThreadId, "item.updated");
		return updated ? [updated] : [];
	}
	if (event.method === "item/plan/delta") {
		const delta = event.textDelta ?? asString(payload?.delta) ?? asString(payload?.text) ?? asString(asObject(payload?.content)?.text);
		if (!delta || delta.length === 0) return [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "turn.proposed.delta",
			payload: { delta }
		}];
	}
	if (event.method === "item/agentMessage/delta" || event.method === "item/commandExecution/outputDelta" || event.method === "item/fileChange/outputDelta" || event.method === "item/reasoning/summaryTextDelta" || event.method === "item/reasoning/textDelta") {
		const delta = event.textDelta ?? asString(payload?.delta) ?? asString(payload?.text) ?? asString(asObject(payload?.content)?.text);
		if (!delta || delta.length === 0) return [];
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "content.delta",
			payload: {
				streamKind: contentStreamKindFromMethod(event.method),
				delta,
				...typeof payload?.contentIndex === "number" ? { contentIndex: payload.contentIndex } : {},
				...typeof payload?.summaryIndex === "number" ? { summaryIndex: payload.summaryIndex } : {}
			}
		}];
	}
	if (event.method === "item/mcpToolCall/progress") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "tool.progress",
		payload: {
			...asString(payload?.toolUseId) ? { toolUseId: asString(payload?.toolUseId) } : {},
			...asString(payload?.toolName) ? { toolName: asString(payload?.toolName) } : {},
			...asString(payload?.summary) ? { summary: asString(payload?.summary) } : {},
			...asNumber(payload?.elapsedSeconds) !== void 0 ? { elapsedSeconds: asNumber(payload?.elapsedSeconds) } : {}
		}
	}];
	if (event.method === "serverRequest/resolved") {
		const requestType = toRequestTypeFromResolvedPayload(payload) !== "unknown" ? toRequestTypeFromResolvedPayload(payload) : event.requestId && event.requestKind !== void 0 ? toRequestTypeFromKind(event.requestKind) : "unknown";
		return [{
			...runtimeEventBase(event, canonicalThreadId),
			type: "request.resolved",
			payload: {
				requestType,
				...event.payload !== void 0 ? { resolution: event.payload } : {}
			}
		}];
	}
	if (event.method === "item/tool/requestUserInput/answered") return [{
		...runtimeEventBase(event, canonicalThreadId),
		type: "user-input.resolved",
		payload: { answers: toCanonicalUserInputAnswers(asObject(event.payload)?.answers) }
	}];
	if (event.method === "codex/event/task_started") {
		const msg = codexEventMessage(payload);
		const taskId = asString(payload?.id) ?? asString(msg?.turn_id);
		if (!taskId) return [];
		return [{
			...codexEventBase(event, canonicalThreadId),
			type: "task.started",
			payload: {
				taskId: asRuntimeTaskId(taskId),
				...asString(msg?.collaboration_mode_kind) ? { taskType: asString(msg?.collaboration_mode_kind) } : {}
			}
		}];
	}
	if (event.method === "codex/event/task_complete") {
		const msg = codexEventMessage(payload);
		const taskId = asString(payload?.id) ?? asString(msg?.turn_id);
		const proposedPlanMarkdown = extractProposedPlanMarkdown(asString(msg?.last_agent_message));
		if (!taskId) {
			if (!proposedPlanMarkdown) return [];
			return [{
				...codexEventBase(event, canonicalThreadId),
				type: "turn.proposed.completed",
				payload: { planMarkdown: proposedPlanMarkdown }
			}];
		}
		const events = [{
			...codexEventBase(event, canonicalThreadId),
			type: "task.completed",
			payload: {
				taskId: asRuntimeTaskId(taskId),
				status: "completed",
				...asString(msg?.last_agent_message) ? { summary: asString(msg?.last_agent_message) } : {}
			}
		}];
		if (proposedPlanMarkdown) events.push({
			...codexEventBase(event, canonicalThreadId),
			type: "turn.proposed.completed",
			payload: { planMarkdown: proposedPlanMarkdown }
		});
		return events;
	}
	if (event.method === "codex/event/agent_reasoning") {
		const msg = codexEventMessage(payload);
		const taskId = asString(payload?.id);
		const description = asString(msg?.text);
		if (!taskId || !description) return [];
		return [{
			...codexEventBase(event, canonicalThreadId),
			type: "task.progress",
			payload: {
				taskId: asRuntimeTaskId(taskId),
				description
			}
		}];
	}
	if (event.method === "codex/event/reasoning_content_delta") {
		const msg = codexEventMessage(payload);
		const delta = asString(msg?.delta);
		if (!delta) return [];
		return [{
			...codexEventBase(event, canonicalThreadId),
			type: "content.delta",
			payload: {
				streamKind: asNumber(msg?.summary_index) !== void 0 ? "reasoning_summary_text" : "reasoning_text",
				delta,
				...asNumber(msg?.summary_index) !== void 0 ? { summaryIndex: asNumber(msg?.summary_index) } : {}
			}
		}];
	}
	if (event.method === "model/rerouted") return [{
		type: "model.rerouted",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			fromModel: asString(payload?.fromModel) ?? "unknown",
			toModel: asString(payload?.toModel) ?? "unknown",
			reason: asString(payload?.reason) ?? "unknown"
		}
	}];
	if (event.method === "deprecationNotice") return [{
		type: "deprecation.notice",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			summary: asString(payload?.summary) ?? "Deprecation notice",
			...asString(payload?.details) ? { details: asString(payload?.details) } : {}
		}
	}];
	if (event.method === "configWarning") return [{
		type: "config.warning",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			summary: asString(payload?.summary) ?? "Configuration warning",
			...asString(payload?.details) ? { details: asString(payload?.details) } : {},
			...asString(payload?.path) ? { path: asString(payload?.path) } : {},
			...payload?.range !== void 0 ? { range: payload.range } : {}
		}
	}];
	if (event.method === "account/updated") return [{
		type: "account.updated",
		...runtimeEventBase(event, canonicalThreadId),
		payload: { account: event.payload ?? {} }
	}];
	if (event.method === "account/rateLimits/updated") return [{
		type: "account.rate-limits.updated",
		...runtimeEventBase(event, canonicalThreadId),
		payload: { rateLimits: event.payload ?? {} }
	}];
	if (event.method === "mcpServer/oauthLogin/completed") return [{
		type: "mcp.oauth.completed",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			success: payload?.success === true,
			...asString(payload?.name) ? { name: asString(payload?.name) } : {},
			...asString(payload?.error) ? { error: asString(payload?.error) } : {}
		}
	}];
	if (event.method === "thread/realtime/started") {
		const realtimeSessionId = asString(payload?.realtimeSessionId);
		return [{
			type: "thread.realtime.started",
			...runtimeEventBase(event, canonicalThreadId),
			payload: { realtimeSessionId }
		}];
	}
	if (event.method === "thread/realtime/itemAdded") return [{
		type: "thread.realtime.item-added",
		...runtimeEventBase(event, canonicalThreadId),
		payload: { item: event.payload ?? {} }
	}];
	if (event.method === "thread/realtime/outputAudio/delta") return [{
		type: "thread.realtime.audio.delta",
		...runtimeEventBase(event, canonicalThreadId),
		payload: { audio: event.payload ?? {} }
	}];
	if (event.method === "thread/realtime/error") {
		const message = asString(payload?.message) ?? event.message ?? "Realtime error";
		return [{
			type: "thread.realtime.error",
			...runtimeEventBase(event, canonicalThreadId),
			payload: { message }
		}];
	}
	if (event.method === "thread/realtime/closed") return [{
		type: "thread.realtime.closed",
		...runtimeEventBase(event, canonicalThreadId),
		payload: { reason: event.message }
	}];
	if (event.method === "error") {
		const message = asString(asObject(payload?.error)?.message) ?? event.message ?? "Provider runtime error";
		const willRetry = payload?.willRetry === true;
		return [{
			type: willRetry ? "runtime.warning" : "runtime.error",
			...runtimeEventBase(event, canonicalThreadId),
			payload: {
				message,
				...!willRetry ? { class: "provider_error" } : {},
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		}];
	}
	if (event.method === "process/stderr") {
		const message = event.message ?? "Codex process stderr";
		return [isFatalCodexProcessStderrMessage(message) ? {
			type: "runtime.error",
			...runtimeEventBase(event, canonicalThreadId),
			payload: {
				message,
				class: "provider_error",
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		} : {
			type: "runtime.warning",
			...runtimeEventBase(event, canonicalThreadId),
			payload: {
				message,
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		}];
	}
	if (event.method === "windows/worldWritableWarning") return [{
		type: "runtime.warning",
		...runtimeEventBase(event, canonicalThreadId),
		payload: {
			message: event.message ?? "Windows world-writable warning",
			...event.payload !== void 0 ? { detail: event.payload } : {}
		}
	}];
	if (event.method === "windowsSandbox/setupCompleted") {
		const success = asObject(event.payload)?.success;
		const successMessage = event.message ?? "Windows sandbox setup completed";
		const failureMessage = event.message ?? "Windows sandbox setup failed";
		return [{
			type: "session.state.changed",
			...runtimeEventBase(event, canonicalThreadId),
			payload: {
				state: success === false ? "error" : "ready",
				reason: success === false ? failureMessage : successMessage,
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		}, ...success === false ? [{
			type: "runtime.warning",
			...runtimeEventBase(event, canonicalThreadId),
			payload: {
				message: failureMessage,
				...event.payload !== void 0 ? { detail: event.payload } : {}
			}
		}] : []];
	}
	return [];
}
const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function* (options) {
	const fileSystem = yield* FileSystem.FileSystem;
	const serverConfig = yield* Effect.service(ServerConfig);
	const nativeEventLogger = options?.nativeEventLogger ?? (options?.nativeEventLogPath !== void 0 ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" }) : void 0);
	const acquireManager = Effect.fn("acquireManager")(function* () {
		if (options?.manager) return options.manager;
		const services = yield* Effect.services();
		return options?.makeManager?.(services) ?? new CodexAppServerManager(services);
	});
	const manager = yield* Effect.acquireRelease(acquireManager(), (manager) => Effect.sync(() => {
		try {
			manager.stopAll();
		} catch {}
	}));
	const serverSettingsService = yield* ServerSettingsService;
	const startSession = Effect.fn("startSession")(function* (input) {
		if (input.provider !== void 0 && input.provider !== PROVIDER$3) return yield* new ProviderAdapterValidationError({
			provider: PROVIDER$3,
			operation: "startSession",
			issue: `Expected provider '${PROVIDER$3}' but received '${input.provider}'.`
		});
		const codexSettings = yield* serverSettingsService.getSettings.pipe(Effect.map((settings) => settings.providers.codex), Effect.mapError((error) => new ProviderAdapterProcessError({
			provider: PROVIDER$3,
			threadId: input.threadId,
			detail: error.message,
			cause: error
		})));
		const binaryPath = codexSettings.binaryPath;
		const homePath = codexSettings.homePath;
		const managerInput = {
			threadId: input.threadId,
			provider: "codex",
			...input.cwd !== void 0 ? { cwd: input.cwd } : {},
			...input.resumeCursor !== void 0 ? { resumeCursor: input.resumeCursor } : {},
			runtimeMode: input.runtimeMode,
			binaryPath,
			...homePath ? { homePath } : {},
			...input.modelSelection?.provider === "codex" ? { model: input.modelSelection.model } : {},
			...input.modelSelection?.provider === "codex" && input.modelSelection.options?.fastMode ? { serviceTier: "fast" } : {}
		};
		return yield* Effect.tryPromise({
			try: () => manager.startSession(managerInput),
			catch: (cause) => new ProviderAdapterProcessError({
				provider: PROVIDER$3,
				threadId: input.threadId,
				detail: toMessage$1(cause, "Failed to start Codex adapter session."),
				cause
			})
		});
	});
	const resolveAttachment = Effect.fn("resolveAttachment")(function* (input, attachment) {
		const attachmentPath = resolveAttachmentPath({
			attachmentsDir: serverConfig.attachmentsDir,
			attachment
		});
		if (!attachmentPath) return yield* toRequestError$1(input.threadId, "turn/start", /* @__PURE__ */ new Error(`Invalid attachment id '${attachment.id}'.`));
		const bytes = yield* fileSystem.readFile(attachmentPath).pipe(Effect.mapError((cause) => new ProviderAdapterRequestError({
			provider: PROVIDER$3,
			method: "turn/start",
			detail: toMessage$1(cause, "Failed to read attachment file."),
			cause
		})));
		return {
			type: "image",
			url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`
		};
	});
	const sendTurn = Effect.fn("sendTurn")(function* (input) {
		const codexAttachments = yield* Effect.forEach(input.attachments ?? [], (attachment) => resolveAttachment(input, attachment), { concurrency: 1 });
		return yield* Effect.tryPromise({
			try: () => {
				const managerInput = {
					threadId: input.threadId,
					...input.input !== void 0 ? { input: input.input } : {},
					...input.modelSelection?.provider === "codex" ? { model: input.modelSelection.model } : {},
					...input.modelSelection?.provider === "codex" && input.modelSelection.options?.reasoningEffort !== void 0 ? { effort: input.modelSelection.options.reasoningEffort } : {},
					...input.modelSelection?.provider === "codex" && input.modelSelection.options?.fastMode ? { serviceTier: "fast" } : {},
					...input.interactionMode !== void 0 ? { interactionMode: input.interactionMode } : {},
					...codexAttachments.length > 0 ? { attachments: codexAttachments } : {}
				};
				return manager.sendTurn(managerInput);
			},
			catch: (cause) => toRequestError$1(input.threadId, "turn/start", cause)
		}).pipe(Effect.map((result) => ({
			...result,
			threadId: input.threadId
		})));
	});
	const interruptTurn = (threadId, turnId) => Effect.tryPromise({
		try: () => manager.interruptTurn(threadId, turnId),
		catch: (cause) => toRequestError$1(threadId, "turn/interrupt", cause)
	});
	const readThread = (threadId) => Effect.tryPromise({
		try: () => manager.readThread(threadId),
		catch: (cause) => toRequestError$1(threadId, "thread/read", cause)
	}).pipe(Effect.map((snapshot) => ({
		threadId,
		turns: snapshot.turns
	})));
	const rollbackThread = (threadId, numTurns) => {
		if (!Number.isInteger(numTurns) || numTurns < 1) return Effect.fail(new ProviderAdapterValidationError({
			provider: PROVIDER$3,
			operation: "rollbackThread",
			issue: "numTurns must be an integer >= 1."
		}));
		return Effect.tryPromise({
			try: () => manager.rollbackThread(threadId, numTurns),
			catch: (cause) => toRequestError$1(threadId, "thread/rollback", cause)
		}).pipe(Effect.map((snapshot) => ({
			threadId,
			turns: snapshot.turns
		})));
	};
	const respondToRequest = (threadId, requestId, decision) => Effect.tryPromise({
		try: () => manager.respondToRequest(threadId, requestId, decision),
		catch: (cause) => toRequestError$1(threadId, "item/requestApproval/decision", cause)
	});
	const respondToUserInput = (threadId, requestId, answers) => Effect.tryPromise({
		try: () => manager.respondToUserInput(threadId, requestId, answers),
		catch: (cause) => toRequestError$1(threadId, "item/tool/requestUserInput", cause)
	});
	const stopSession = (threadId) => Effect.sync(() => {
		manager.stopSession(threadId);
	});
	const listSessions = () => Effect.sync(() => manager.listSessions());
	const hasSession = (threadId) => Effect.sync(() => manager.hasSession(threadId));
	const stopAll = () => Effect.sync(() => {
		manager.stopAll();
	});
	const runtimeEventQueue = yield* Queue.unbounded();
	const writeNativeEvent = Effect.fn("writeNativeEvent")(function* (event) {
		if (!nativeEventLogger) return;
		yield* nativeEventLogger.write(event, event.threadId);
	});
	const registerListener = Effect.fn("registerListener")(function* () {
		const services = yield* Effect.services();
		const listenerEffect = Effect.fn("listener")(function* (event) {
			yield* writeNativeEvent(event);
			const runtimeEvents = mapToRuntimeEvents(event, event.threadId);
			if (runtimeEvents.length === 0) {
				yield* Effect.logDebug("ignoring unhandled Codex provider event", {
					method: event.method,
					threadId: event.threadId,
					turnId: event.turnId,
					itemId: event.itemId
				});
				return;
			}
			yield* Queue.offerAll(runtimeEventQueue, runtimeEvents);
		});
		const listener = (event) => listenerEffect(event).pipe(Effect.runPromiseWith(services));
		manager.on("event", listener);
		return listener;
	});
	const unregisterListener = Effect.fn("unregisterListener")(function* (listener) {
		yield* Effect.sync(() => {
			manager.off("event", listener);
		});
		yield* Queue.shutdown(runtimeEventQueue);
	});
	yield* Effect.acquireRelease(registerListener(), unregisterListener);
	return {
		provider: PROVIDER$3,
		capabilities: { sessionModelSwitch: "in-session" },
		startSession,
		sendTurn,
		interruptTurn,
		readThread,
		rollbackThread,
		respondToRequest,
		respondToUserInput,
		stopSession,
		listSessions,
		hasSession,
		stopAll,
		get streamEvents() {
			return Stream.fromQueue(runtimeEventQueue);
		}
	};
});
const CodexAdapterLive = Layer.effect(CodexAdapter, makeCodexAdapter());
function makeCodexAdapterLive(options) {
	return Layer.effect(CodexAdapter, makeCodexAdapter(options));
}

//#endregion
//#region src/processRunner.ts
function commandLabel$1(command, args) {
	return [command, ...args].join(" ");
}
function normalizeSpawnError(command, args, error) {
	if (!(error instanceof Error)) return /* @__PURE__ */ new Error(`Failed to run ${commandLabel$1(command, args)}.`);
	if (error.code === "ENOENT") return /* @__PURE__ */ new Error(`Command not found: ${command}`);
	return /* @__PURE__ */ new Error(`Failed to run ${commandLabel$1(command, args)}: ${error.message}`);
}
function isWindowsCommandNotFound(code, stderr) {
	if (process.platform !== "win32") return false;
	if (code === 9009) return true;
	return /is not recognized as an internal or external command/i.test(stderr);
}
function normalizeExitError(command, args, result) {
	if (isWindowsCommandNotFound(result.code, result.stderr)) return /* @__PURE__ */ new Error(`Command not found: ${command}`);
	const reason = result.timedOut ? "timed out" : `failed (code=${result.code ?? "null"}, signal=${result.signal ?? "null"})`;
	const stderr = result.stderr.trim();
	const detail = stderr.length > 0 ? ` ${stderr}` : "";
	return /* @__PURE__ */ new Error(`${commandLabel$1(command, args)} ${reason}.${detail}`);
}
function normalizeStdinError(command, args, error) {
	if (!(error instanceof Error)) return /* @__PURE__ */ new Error(`Failed to write stdin for ${commandLabel$1(command, args)}.`);
	return /* @__PURE__ */ new Error(`Failed to write stdin for ${commandLabel$1(command, args)}: ${error.message}`);
}
function normalizeBufferError(command, args, stream, maxBufferBytes) {
	return /* @__PURE__ */ new Error(`${commandLabel$1(command, args)} exceeded ${stream} buffer limit (${maxBufferBytes} bytes).`);
}
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
/**
* On Windows with `shell: true`, `child.kill()` only terminates the `cmd.exe`
* wrapper, leaving the actual command running. Use `taskkill /T` to kill the
* entire process tree instead.
*/
function killChild(child, signal = "SIGTERM") {
	if (process.platform === "win32" && child.pid !== void 0) try {
		spawnSync("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], { stdio: "ignore" });
		return;
	} catch {}
	child.kill(signal);
}
function appendChunkWithinLimit(target, currentBytes, chunk, maxBytes) {
	const remaining = maxBytes - currentBytes;
	if (remaining <= 0) return {
		next: target,
		nextBytes: currentBytes,
		truncated: true
	};
	if (chunk.length <= remaining) return {
		next: `${target}${chunk.toString()}`,
		nextBytes: currentBytes + chunk.length,
		truncated: false
	};
	return {
		next: `${target}${chunk.subarray(0, remaining).toString()}`,
		nextBytes: currentBytes + remaining,
		truncated: true
	};
}
async function runProcess(command, args, options = {}) {
	const timeoutMs = options.timeoutMs ?? 6e4;
	const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
	const outputMode = options.outputMode ?? "error";
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: "pipe",
			shell: process.platform === "win32"
		});
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutTruncated = false;
		let stderrTruncated = false;
		let timedOut = false;
		let settled = false;
		let forceKillTimer = null;
		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			killChild(child, "SIGTERM");
			forceKillTimer = setTimeout(() => {
				killChild(child, "SIGKILL");
			}, 1e3);
		}, timeoutMs);
		const finalize = (callback) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			callback();
		};
		const fail = (error) => {
			killChild(child, "SIGTERM");
			finalize(() => {
				reject(error);
			});
		};
		const appendOutput = (stream, chunk) => {
			const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			const text = chunkBuffer.toString();
			const byteLength = chunkBuffer.length;
			if (stream === "stdout") {
				if (outputMode === "truncate") {
					const appended = appendChunkWithinLimit(stdout, stdoutBytes, chunkBuffer, maxBufferBytes);
					stdout = appended.next;
					stdoutBytes = appended.nextBytes;
					stdoutTruncated = stdoutTruncated || appended.truncated;
					return null;
				}
				stdout += text;
				stdoutBytes += byteLength;
				if (stdoutBytes > maxBufferBytes) return normalizeBufferError(command, args, "stdout", maxBufferBytes);
			} else {
				if (outputMode === "truncate") {
					const appended = appendChunkWithinLimit(stderr, stderrBytes, chunkBuffer, maxBufferBytes);
					stderr = appended.next;
					stderrBytes = appended.nextBytes;
					stderrTruncated = stderrTruncated || appended.truncated;
					return null;
				}
				stderr += text;
				stderrBytes += byteLength;
				if (stderrBytes > maxBufferBytes) return normalizeBufferError(command, args, "stderr", maxBufferBytes);
			}
			return null;
		};
		child.stdout.on("data", (chunk) => {
			const error = appendOutput("stdout", chunk);
			if (error) fail(error);
		});
		child.stderr.on("data", (chunk) => {
			const error = appendOutput("stderr", chunk);
			if (error) fail(error);
		});
		child.once("error", (error) => {
			finalize(() => {
				reject(normalizeSpawnError(command, args, error));
			});
		});
		child.once("close", (code, signal) => {
			const result = {
				stdout,
				stderr,
				code,
				signal,
				timedOut,
				stdoutTruncated,
				stderrTruncated
			};
			finalize(() => {
				if (!options.allowNonZeroExit && (timedOut || code !== null && code !== 0)) {
					reject(normalizeExitError(command, args, result));
					return;
				}
				resolve(result);
			});
		});
		child.stdin.once("error", (error) => {
			fail(normalizeStdinError(command, args, error));
		});
		if (options.stdin !== void 0) {
			child.stdin.write(options.stdin, (error) => {
				if (error) {
					fail(normalizeStdinError(command, args, error));
					return;
				}
				child.stdin.end();
			});
			return;
		}
		child.stdin.end();
	});
}

//#endregion
//#region src/provider/providerSnapshot.ts
const DEFAULT_TIMEOUT_MS$2 = 4e3;
function nonEmptyTrimmed(value) {
	if (!value) return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function isCommandMissingCause(error) {
	if (!(error instanceof Error)) return false;
	const lower = error.message.toLowerCase();
	return lower.includes("enoent") || lower.includes("notfound");
}
const spawnAndCollect = (binaryPath, command) => Effect.gen(function* () {
	const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(command);
	const [stdout, stderr, exitCode] = yield* Effect.all([
		collectStreamAsString(child.stdout),
		collectStreamAsString(child.stderr),
		child.exitCode.pipe(Effect.map(Number))
	], { concurrency: "unbounded" });
	const result = {
		stdout,
		stderr,
		code: exitCode
	};
	if (isWindowsCommandNotFound(exitCode, stderr)) return yield* Effect.fail(/* @__PURE__ */ new Error(`spawn ${binaryPath} ENOENT`));
	return result;
}).pipe(Effect.scoped);
function detailFromResult(result) {
	if (result.timedOut) return "Timed out while running command.";
	const stderr = nonEmptyTrimmed(result.stderr);
	if (stderr) return stderr;
	const stdout = nonEmptyTrimmed(result.stdout);
	if (stdout) return stdout;
	if (result.code !== 0) return `Command exited with code ${result.code}.`;
}
function extractAuthBoolean(value) {
	if (globalThis.Array.isArray(value)) {
		for (const entry of value) {
			const nested = extractAuthBoolean(entry);
			if (nested !== void 0) return nested;
		}
		return;
	}
	if (!value || typeof value !== "object") return void 0;
	const record = value;
	for (const key of [
		"authenticated",
		"isAuthenticated",
		"loggedIn",
		"isLoggedIn"
	]) if (typeof record[key] === "boolean") return record[key];
	for (const key of [
		"auth",
		"status",
		"session",
		"account"
	]) {
		const nested = extractAuthBoolean(record[key]);
		if (nested !== void 0) return nested;
	}
}
function parseGenericCliVersion(output) {
	return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}
function providerModelsFromSettings(builtInModels, provider, customModels) {
	const resolvedBuiltInModels = [...builtInModels];
	const seen = new Set(resolvedBuiltInModels.map((model) => model.slug));
	const customEntries = [];
	for (const candidate of customModels) {
		const normalized = normalizeModelSlug(candidate, provider);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		customEntries.push({
			slug: normalized,
			name: normalized,
			isCustom: true,
			capabilities: null
		});
	}
	return [...resolvedBuiltInModels, ...customEntries];
}
function buildServerProvider(input) {
	return {
		provider: input.provider,
		enabled: input.enabled,
		installed: input.probe.installed,
		version: input.probe.version,
		status: input.enabled ? input.probe.status : "disabled",
		auth: input.probe.auth,
		checkedAt: input.checkedAt,
		...input.probe.message ? { message: input.probe.message } : {},
		models: input.models
	};
}
const collectStreamAsString = (stream) => stream.pipe(Stream.decodeText(), Stream.runFold(() => "", (acc, chunk) => acc + chunk));

//#endregion
//#region src/provider/makeManagedServerProvider.ts
const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* (input) {
	const refreshSemaphore = yield* Semaphore$1.make(1);
	const changesPubSub = yield* Effect.acquireRelease(PubSub.unbounded(), PubSub.shutdown);
	const initialSettings = yield* input.getSettings;
	const initialSnapshot = yield* input.checkProvider;
	const snapshotRef = yield* Ref.make(initialSnapshot);
	const settingsRef = yield* Ref.make(initialSettings);
	const applySnapshotBase = Effect.fn("applySnapshot")(function* (nextSettings, options) {
		const forceRefresh = options?.forceRefresh === true;
		const previousSettings = yield* Ref.get(settingsRef);
		if (!forceRefresh && !input.haveSettingsChanged(previousSettings, nextSettings)) {
			yield* Ref.set(settingsRef, nextSettings);
			return yield* Ref.get(snapshotRef);
		}
		const nextSnapshot = yield* input.checkProvider;
		yield* Ref.set(settingsRef, nextSettings);
		yield* Ref.set(snapshotRef, nextSnapshot);
		yield* PubSub.publish(changesPubSub, nextSnapshot);
		return nextSnapshot;
	});
	const applySnapshot = (nextSettings, options) => refreshSemaphore.withPermits(1)(applySnapshotBase(nextSettings, options));
	const refreshSnapshot = Effect.fn("refreshSnapshot")(function* () {
		return yield* applySnapshot(yield* input.getSettings, { forceRefresh: true });
	});
	yield* Stream.runForEach(input.streamSettings, (nextSettings) => Effect.asVoid(applySnapshot(nextSettings))).pipe(Effect.forkScoped);
	yield* Effect.forever(Effect.sleep(input.refreshInterval ?? "60 seconds").pipe(Effect.flatMap(() => refreshSnapshot()), Effect.ignoreCause({ log: true }))).pipe(Effect.forkScoped);
	return {
		getSnapshot: input.getSettings.pipe(Effect.flatMap(applySnapshot), Effect.tapError(Effect.logError), Effect.orDie),
		refresh: refreshSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
		get streamChanges() {
			return Stream.fromPubSub(changesPubSub);
		}
	};
});

//#endregion
//#region src/provider/Services/ClaudeProvider.ts
var ClaudeProvider = class extends ServiceMap.Service()("t3/provider/Services/ClaudeProvider") {};

//#endregion
//#region src/provider/Layers/ClaudeProvider.ts
const PROVIDER$2 = "claudeAgent";
const BUILT_IN_MODELS$1 = [
	{
		slug: "claude-opus-4-6",
		name: "Claude Opus 4.6",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "low",
					label: "Low"
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "max",
					label: "Max"
				},
				{
					value: "ultrathink",
					label: "Ultrathink"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [{
				value: "200k",
				label: "200k",
				isDefault: true
			}, {
				value: "1m",
				label: "1M"
			}],
			promptInjectedEffortLevels: ["ultrathink"]
		}
	},
	{
		slug: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "low",
					label: "Low"
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "ultrathink",
					label: "Ultrathink"
				}
			],
			supportsFastMode: false,
			supportsThinkingToggle: false,
			contextWindowOptions: [{
				value: "200k",
				label: "200k",
				isDefault: true
			}, {
				value: "1m",
				label: "1M"
			}],
			promptInjectedEffortLevels: ["ultrathink"]
		}
	},
	{
		slug: "claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [],
			supportsFastMode: false,
			supportsThinkingToggle: true,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	}
];
function getClaudeModelCapabilities(model) {
	const slug = model?.trim();
	return BUILT_IN_MODELS$1.find((candidate) => candidate.slug === slug)?.capabilities ?? {
		reasoningEffortLevels: [],
		supportsFastMode: false,
		supportsThinkingToggle: false,
		contextWindowOptions: [],
		promptInjectedEffortLevels: []
	};
}
function parseClaudeAuthStatusFromOutput(result) {
	const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
	if (lowerOutput.includes("unknown command") || lowerOutput.includes("unrecognized command") || lowerOutput.includes("unexpected argument")) return {
		status: "warning",
		auth: { status: "unknown" },
		message: "Claude Agent authentication status command is unavailable in this version of Claude."
	};
	if (lowerOutput.includes("not logged in") || lowerOutput.includes("login required") || lowerOutput.includes("authentication required") || lowerOutput.includes("run `claude login`") || lowerOutput.includes("run claude login")) return {
		status: "error",
		auth: { status: "unauthenticated" },
		message: "Claude is not authenticated. Run `claude auth login` and try again."
	};
	const parsedAuth = (() => {
		const trimmed = result.stdout.trim();
		if (!trimmed || !trimmed.startsWith("{") && !trimmed.startsWith("[")) return {
			attemptedJsonParse: false,
			auth: void 0
		};
		try {
			return {
				attemptedJsonParse: true,
				auth: extractAuthBoolean(JSON.parse(trimmed))
			};
		} catch {
			return {
				attemptedJsonParse: false,
				auth: void 0
			};
		}
	})();
	if (parsedAuth.auth === true) return {
		status: "ready",
		auth: { status: "authenticated" }
	};
	if (parsedAuth.auth === false) return {
		status: "error",
		auth: { status: "unauthenticated" },
		message: "Claude is not authenticated. Run `claude auth login` and try again."
	};
	if (parsedAuth.attemptedJsonParse) return {
		status: "warning",
		auth: { status: "unknown" },
		message: "Could not verify Claude authentication status from JSON output (missing auth marker)."
	};
	if (result.code === 0) return {
		status: "ready",
		auth: { status: "authenticated" }
	};
	const detail = detailFromResult(result);
	return {
		status: "warning",
		auth: { status: "unknown" },
		message: detail ? `Could not verify Claude authentication status. ${detail}` : "Could not verify Claude authentication status."
	};
}
/** Keys that directly hold a subscription/plan identifier. */
const SUBSCRIPTION_TYPE_KEYS = [
	"subscriptionType",
	"subscription_type",
	"plan",
	"tier",
	"planType",
	"plan_type"
];
/** Keys whose value may be a nested object containing subscription info. */
const SUBSCRIPTION_CONTAINER_KEYS = [
	"account",
	"subscription",
	"user",
	"billing"
];
const AUTH_METHOD_KEYS = ["authMethod", "auth_method"];
const AUTH_METHOD_CONTAINER_KEYS = [
	"auth",
	"account",
	"session"
];
/** Lift an unknown value into `Option<string>` if it is a non-empty string. */
const asNonEmptyString = (v) => typeof v === "string" && v.length > 0 ? Option.some(v) : Option.none();
/** Lift an unknown value into `Option<Record>` if it is a plain object. */
const asRecord = (v) => typeof v === "object" && v !== null && !globalThis.Array.isArray(v) ? Option.some(v) : Option.none();
/**
* Walk an unknown parsed JSON value looking for a subscription/plan
* identifier, returning the first match as an `Option`.
*/
function findSubscriptionType(value) {
	if (globalThis.Array.isArray(value)) return Option.firstSomeOf(value.map(findSubscriptionType));
	return asRecord(value).pipe(Option.flatMap((record) => {
		const direct = Option.firstSomeOf(SUBSCRIPTION_TYPE_KEYS.map((key) => asNonEmptyString(record[key])));
		if (Option.isSome(direct)) return direct;
		return Option.firstSomeOf(SUBSCRIPTION_CONTAINER_KEYS.map((key) => asRecord(record[key]).pipe(Option.flatMap(findSubscriptionType))));
	}));
}
function findAuthMethod(value) {
	if (globalThis.Array.isArray(value)) return Option.firstSomeOf(value.map(findAuthMethod));
	return asRecord(value).pipe(Option.flatMap((record) => {
		const direct = Option.firstSomeOf(AUTH_METHOD_KEYS.map((key) => asNonEmptyString(record[key])));
		if (Option.isSome(direct)) return direct;
		return Option.firstSomeOf(AUTH_METHOD_CONTAINER_KEYS.map((key) => asRecord(record[key]).pipe(Option.flatMap(findAuthMethod))));
	}));
}
/**
* Try to extract a subscription type from the `claude auth status` JSON
* output. This is a zero-cost operation on data we already have.
*/
const decodeUnknownJson = decodeJsonResult(Schema.Unknown);
function extractSubscriptionTypeFromOutput(result) {
	const parsed = decodeUnknownJson(result.stdout.trim());
	if (Result.isFailure(parsed)) return void 0;
	return Option.getOrUndefined(findSubscriptionType(parsed.success));
}
function extractClaudeAuthMethodFromOutput(result) {
	const parsed = decodeUnknownJson(result.stdout.trim());
	if (Result.isFailure(parsed)) return void 0;
	return Option.getOrUndefined(findAuthMethod(parsed.success));
}
/** Subscription types where the 1M context window is included in the plan. */
const PREMIUM_SUBSCRIPTION_TYPES = new Set([
	"max",
	"maxplan",
	"max5",
	"max20",
	"enterprise",
	"team"
]);
function toTitleCaseWords(value) {
	return value.split(/[\s_-]+/g).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}
function claudeSubscriptionLabel(subscriptionType) {
	const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
	if (!normalized) return void 0;
	switch (normalized) {
		case "max":
		case "maxplan":
		case "max5":
		case "max20": return "Max";
		case "enterprise": return "Enterprise";
		case "team": return "Team";
		case "pro": return "Pro";
		case "free": return "Free";
		default: return toTitleCaseWords(subscriptionType);
	}
}
function normalizeClaudeAuthMethod(authMethod) {
	const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, "");
	if (!normalized) return void 0;
	if (normalized === "apikey") return "apiKey";
}
function claudeAuthMetadata(input) {
	if (normalizeClaudeAuthMethod(input.authMethod) === "apiKey") return {
		type: "apiKey",
		label: "Claude API Key"
	};
	if (input.subscriptionType) {
		const subscriptionLabel = claudeSubscriptionLabel(input.subscriptionType);
		return {
			type: input.subscriptionType,
			label: `Claude ${subscriptionLabel ?? toTitleCaseWords(input.subscriptionType)} Subscription`
		};
	}
}
/**
* Adjust the built-in model list based on the user's detected subscription.
*
* - Premium tiers (Max, Enterprise, Team): 1M context becomes the default.
* - Other tiers (Pro, free, unknown): 200k context stays the default;
*   1M remains available as a manual option so users can still enable it.
*/
function adjustModelsForSubscription(baseModels, subscriptionType) {
	const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
	if (!normalized || !PREMIUM_SUBSCRIPTION_TYPES.has(normalized)) return baseModels;
	return baseModels.map((model) => {
		const caps = model.capabilities;
		if (!caps || caps.contextWindowOptions.length === 0) return model;
		return {
			...model,
			capabilities: {
				...caps,
				contextWindowOptions: caps.contextWindowOptions.map((opt) => opt.value === "1m" ? {
					value: opt.value,
					label: opt.label,
					isDefault: true
				} : {
					value: opt.value,
					label: opt.label
				})
			}
		};
	});
}
const CAPABILITIES_PROBE_TIMEOUT_MS$1 = 8e3;
/**
* Probe account information by spawning a lightweight Claude Agent SDK
* session and reading the initialization result.
*
* The prompt is never sent to the Anthropic API — we abort immediately
* after the local initialization phase completes. This gives us the
* user's subscription type without incurring any token cost.
*
* This is used as a fallback when `claude auth status` does not include
* subscription type information.
*/
const probeClaudeCapabilities = (binaryPath) => {
	const abort = new AbortController();
	return Effect.tryPromise(async () => {
		return { subscriptionType: (await query({
			prompt: ".",
			options: {
				persistSession: false,
				pathToClaudeCodeExecutable: binaryPath,
				abortController: abort,
				maxTurns: 0,
				settingSources: [],
				allowedTools: [],
				stderr: () => {}
			}
		}).initializationResult()).account?.subscriptionType };
	}).pipe(Effect.ensuring(Effect.sync(() => {
		if (!abort.signal.aborted) abort.abort();
	})), Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS$1), Effect.result, Effect.map((result) => {
		if (Result.isFailure(result)) return void 0;
		return Option.isSome(result.success) ? result.success.value : void 0;
	}));
};
const runClaudeCommand = Effect.fn("runClaudeCommand")(function* (args) {
	const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(Effect.flatMap((service) => service.getSettings), Effect.map((settings) => settings.providers.claudeAgent));
	const command = ChildProcess.make(claudeSettings.binaryPath, [...args], { shell: process.platform === "win32" });
	return yield* spawnAndCollect(claudeSettings.binaryPath, command);
});
const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (resolveSubscriptionType) {
	const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(Effect.flatMap((service) => service.getSettings), Effect.map((settings) => settings.providers.claudeAgent));
	const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
	const models = providerModelsFromSettings(BUILT_IN_MODELS$1, PROVIDER$2, claudeSettings.customModels);
	if (!claudeSettings.enabled) return buildServerProvider({
		provider: PROVIDER$2,
		enabled: false,
		checkedAt,
		models,
		probe: {
			installed: false,
			version: null,
			status: "warning",
			auth: { status: "unknown" },
			message: "Claude is disabled in T3 Code settings."
		}
	});
	const versionProbe = yield* runClaudeCommand(["--version"]).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS$2), Effect.result);
	if (Result.isFailure(versionProbe)) {
		const error = versionProbe.failure;
		return buildServerProvider({
			provider: PROVIDER$2,
			enabled: claudeSettings.enabled,
			checkedAt,
			models,
			probe: {
				installed: !isCommandMissingCause(error),
				version: null,
				status: "error",
				auth: { status: "unknown" },
				message: isCommandMissingCause(error) ? "Claude Agent CLI (`claude`) is not installed or not on PATH." : `Failed to execute Claude Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`
			}
		});
	}
	if (Option.isNone(versionProbe.success)) return buildServerProvider({
		provider: PROVIDER$2,
		enabled: claudeSettings.enabled,
		checkedAt,
		models,
		probe: {
			installed: true,
			version: null,
			status: "error",
			auth: { status: "unknown" },
			message: "Claude Agent CLI is installed but failed to run. Timed out while running command."
		}
	});
	const version = versionProbe.success.value;
	const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
	if (version.code !== 0) {
		const detail = detailFromResult(version);
		return buildServerProvider({
			provider: PROVIDER$2,
			enabled: claudeSettings.enabled,
			checkedAt,
			models,
			probe: {
				installed: true,
				version: parsedVersion,
				status: "error",
				auth: { status: "unknown" },
				message: detail ? `Claude Agent CLI is installed but failed to run. ${detail}` : "Claude Agent CLI is installed but failed to run."
			}
		});
	}
	const authProbe = yield* runClaudeCommand(["auth", "status"]).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS$2), Effect.result);
	let subscriptionType;
	let authMethod;
	if (Result.isSuccess(authProbe) && Option.isSome(authProbe.success)) {
		subscriptionType = extractSubscriptionTypeFromOutput(authProbe.success.value);
		authMethod = extractClaudeAuthMethodFromOutput(authProbe.success.value);
	}
	if (!subscriptionType && resolveSubscriptionType) subscriptionType = yield* resolveSubscriptionType(claudeSettings.binaryPath);
	const resolvedModels = adjustModelsForSubscription(models, subscriptionType);
	if (Result.isFailure(authProbe)) {
		const error = authProbe.failure;
		return buildServerProvider({
			provider: PROVIDER$2,
			enabled: claudeSettings.enabled,
			checkedAt,
			models: resolvedModels,
			probe: {
				installed: true,
				version: parsedVersion,
				status: "warning",
				auth: { status: "unknown" },
				message: error instanceof Error ? `Could not verify Claude authentication status: ${error.message}.` : "Could not verify Claude authentication status."
			}
		});
	}
	if (Option.isNone(authProbe.success)) return buildServerProvider({
		provider: PROVIDER$2,
		enabled: claudeSettings.enabled,
		checkedAt,
		models: resolvedModels,
		probe: {
			installed: true,
			version: parsedVersion,
			status: "warning",
			auth: { status: "unknown" },
			message: "Could not verify Claude authentication status. Timed out while running command."
		}
	});
	const parsed = parseClaudeAuthStatusFromOutput(authProbe.success.value);
	const authMetadata = claudeAuthMetadata({
		subscriptionType,
		authMethod
	});
	return buildServerProvider({
		provider: PROVIDER$2,
		enabled: claudeSettings.enabled,
		checkedAt,
		models: resolvedModels,
		probe: {
			installed: true,
			version: parsedVersion,
			status: parsed.status,
			auth: {
				...parsed.auth,
				...authMetadata ? authMetadata : {}
			},
			...parsed.message ? { message: parsed.message } : {}
		}
	});
});
const ClaudeProviderLive = Layer.effect(ClaudeProvider, Effect.gen(function* () {
	const serverSettings = yield* ServerSettingsService;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const subscriptionProbeCache = yield* Cache.make({
		capacity: 1,
		timeToLive: Duration.minutes(5),
		lookup: (binaryPath) => probeClaudeCapabilities(binaryPath).pipe(Effect.map((r) => r?.subscriptionType))
	});
	const checkProvider = checkClaudeProviderStatus((binaryPath) => Cache.get(subscriptionProbeCache, binaryPath)).pipe(Effect.provideService(ServerSettingsService, serverSettings), Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
	return yield* makeManagedServerProvider({
		getSettings: serverSettings.getSettings.pipe(Effect.map((settings) => settings.providers.claudeAgent), Effect.orDie),
		streamSettings: serverSettings.streamChanges.pipe(Stream.map((settings) => settings.providers.claudeAgent)),
		haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
		checkProvider
	});
}));

//#endregion
//#region src/provider/Services/ClaudeAdapter.ts
/**
* ClaudeAdapter - Claude Agent implementation of the generic provider adapter contract.
*
* This service owns Claude runtime/session semantics and emits canonical
* provider runtime events. It does not perform cross-provider routing, shared
* event fan-out, or checkpoint orchestration.
*
* Uses Effect `ServiceMap.Service` for dependency injection and returns the
* shared provider-adapter error channel with `provider: "claudeAgent"` context.
*
* @module ClaudeAdapter
*/
/**
* ClaudeAdapter - Service tag for Claude Agent provider adapter operations.
*/
var ClaudeAdapter = class extends ServiceMap.Service()("t3/provider/Services/ClaudeAdapter") {};

//#endregion
//#region src/provider/Layers/ClaudeAdapter.ts
/**
* ClaudeAdapterLive - Scoped live implementation for the Claude Agent provider adapter.
*
* Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
* provider adapter contract and emits canonical runtime events.
*
* @module ClaudeAdapterLive
*/
const PROVIDER$1 = "claudeAgent";
function isUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isSyntheticClaudeThreadId(value) {
	return value.startsWith("claude-thread-");
}
function toMessage(cause, fallback) {
	if (cause instanceof Error && cause.message.length > 0) return cause.message;
	return fallback;
}
function toError(cause, fallback) {
	return cause instanceof Error ? cause : new Error(toMessage(cause, fallback));
}
function normalizeClaudeStreamMessages(cause) {
	const errors = Cause.prettyErrors(cause).map((error) => error.message.trim()).filter((message) => message.length > 0);
	if (errors.length > 0) return errors;
	const squashed = toMessage(Cause.squash(cause), "").trim();
	return squashed.length > 0 ? [squashed] : [];
}
function getEffectiveClaudeCodeEffort(effort) {
	if (!effort) return null;
	return effort === "ultrathink" ? null : effort;
}
function isClaudeInterruptedMessage(message) {
	const normalized = message.toLowerCase();
	return normalized.includes("all fibers interrupted without error") || normalized.includes("request was aborted") || normalized.includes("interrupted by user");
}
function isClaudeInterruptedCause(cause) {
	return Cause.hasInterruptsOnly(cause) || normalizeClaudeStreamMessages(cause).some(isClaudeInterruptedMessage);
}
function messageFromClaudeStreamCause(cause, fallback) {
	return normalizeClaudeStreamMessages(cause)[0] ?? fallback;
}
function interruptionMessageFromClaudeCause(cause) {
	const message = messageFromClaudeStreamCause(cause, "Claude runtime interrupted.");
	return isClaudeInterruptedMessage(message) ? "Claude runtime interrupted." : message;
}
function resultErrorsText(result) {
	return "errors" in result && Array.isArray(result.errors) ? result.errors.join(" ").toLowerCase() : "";
}
function isInterruptedResult(result) {
	const errors = resultErrorsText(result);
	if (errors.includes("interrupt")) return true;
	return result.subtype === "error_during_execution" && result.is_error === false && (errors.includes("request was aborted") || errors.includes("interrupted by user") || errors.includes("aborted"));
}
function asRuntimeItemId(value) {
	return RuntimeItemId.makeUnsafe(value);
}
function maxClaudeContextWindowFromModelUsage(modelUsage) {
	if (!modelUsage || typeof modelUsage !== "object") return;
	let maxContextWindow;
	for (const value of Object.values(modelUsage)) {
		if (!value || typeof value !== "object") continue;
		const contextWindow = value.contextWindow;
		if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) continue;
		maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
	}
	return maxContextWindow;
}
function normalizeClaudeTokenUsage(usage, contextWindow) {
	if (!usage || typeof usage !== "object") return;
	const record = usage;
	const directUsedTokens = typeof record.total_tokens === "number" && Number.isFinite(record.total_tokens) ? record.total_tokens : void 0;
	const inputTokens = (typeof record.input_tokens === "number" && Number.isFinite(record.input_tokens) ? record.input_tokens : 0) + (typeof record.cache_creation_input_tokens === "number" && Number.isFinite(record.cache_creation_input_tokens) ? record.cache_creation_input_tokens : 0) + (typeof record.cache_read_input_tokens === "number" && Number.isFinite(record.cache_read_input_tokens) ? record.cache_read_input_tokens : 0);
	const outputTokens = typeof record.output_tokens === "number" && Number.isFinite(record.output_tokens) ? record.output_tokens : 0;
	const derivedUsedTokens = inputTokens + outputTokens;
	const usedTokens = directUsedTokens ?? (derivedUsedTokens > 0 ? derivedUsedTokens : void 0);
	if (usedTokens === void 0 || usedTokens <= 0) return;
	return {
		usedTokens,
		lastUsedTokens: usedTokens,
		...inputTokens > 0 ? { inputTokens } : {},
		...outputTokens > 0 ? { outputTokens } : {},
		...typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0 ? { maxTokens: contextWindow } : {},
		...typeof record.tool_uses === "number" && Number.isFinite(record.tool_uses) ? { toolUses: record.tool_uses } : {},
		...typeof record.duration_ms === "number" && Number.isFinite(record.duration_ms) ? { durationMs: record.duration_ms } : {}
	};
}
function asCanonicalTurnId(value) {
	return value;
}
function asRuntimeRequestId(value) {
	return RuntimeRequestId.makeUnsafe(value);
}
function readClaudeResumeState(resumeCursor) {
	if (!resumeCursor || typeof resumeCursor !== "object") return;
	const cursor = resumeCursor;
	const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : void 0;
	const threadId = threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate) ? ThreadId.makeUnsafe(threadIdCandidate) : void 0;
	const resumeCandidate = typeof cursor.resume === "string" ? cursor.resume : typeof cursor.sessionId === "string" ? cursor.sessionId : void 0;
	const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : void 0;
	const resumeSessionAt = typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : void 0;
	const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : void 0;
	return {
		...threadId ? { threadId } : {},
		...resume ? { resume } : {},
		...resumeSessionAt ? { resumeSessionAt } : {},
		...turnCountValue !== void 0 && Number.isInteger(turnCountValue) && turnCountValue >= 0 ? { turnCount: turnCountValue } : {}
	};
}
function classifyToolItemType(toolName) {
	const normalized = toolName.toLowerCase();
	if (normalized.includes("agent")) return "collab_agent_tool_call";
	if (normalized === "task" || normalized === "agent" || normalized.includes("subagent") || normalized.includes("sub-agent")) return "collab_agent_tool_call";
	if (normalized.includes("bash") || normalized.includes("command") || normalized.includes("shell") || normalized.includes("terminal")) return "command_execution";
	if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("file") || normalized.includes("patch") || normalized.includes("replace") || normalized.includes("create") || normalized.includes("delete")) return "file_change";
	if (normalized.includes("mcp")) return "mcp_tool_call";
	if (normalized.includes("websearch") || normalized.includes("web search")) return "web_search";
	if (normalized.includes("image")) return "image_view";
	return "dynamic_tool_call";
}
function isReadOnlyToolName(toolName) {
	const normalized = toolName.toLowerCase();
	return normalized === "read" || normalized.includes("read file") || normalized.includes("view") || normalized.includes("grep") || normalized.includes("glob") || normalized.includes("search");
}
function classifyRequestType(toolName) {
	if (isReadOnlyToolName(toolName)) return "file_read_approval";
	const itemType = classifyToolItemType(toolName);
	return itemType === "command_execution" ? "command_execution_approval" : itemType === "file_change" ? "file_change_approval" : "dynamic_tool_call";
}
function summarizeToolRequest(toolName, input) {
	const commandValue = input.command ?? input.cmd;
	const command = typeof commandValue === "string" ? commandValue : void 0;
	if (command && command.trim().length > 0) return `${toolName}: ${command.trim().slice(0, 400)}`;
	const serialized = JSON.stringify(input);
	if (serialized.length <= 400) return `${toolName}: ${serialized}`;
	return `${toolName}: ${serialized.slice(0, 397)}...`;
}
function titleForTool(itemType) {
	switch (itemType) {
		case "command_execution": return "Command run";
		case "file_change": return "File change";
		case "mcp_tool_call": return "MCP tool call";
		case "collab_agent_tool_call": return "Subagent task";
		case "web_search": return "Web search";
		case "image_view": return "Image view";
		case "dynamic_tool_call": return "Tool call";
		default: return "Item";
	}
}
const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp"
]);
const CLAUDE_SETTING_SOURCES = [
	"user",
	"project",
	"local"
];
function buildPromptText(input) {
	const rawEffort = input.modelSelection?.provider === "claudeAgent" ? input.modelSelection.options?.effort : null;
	const caps = getClaudeModelCapabilities(input.modelSelection?.provider === "claudeAgent" ? input.modelSelection.model : void 0);
	const trimmedEffort = trimOrNull(rawEffort);
	const promptEffort = trimmedEffort && caps.promptInjectedEffortLevels.includes(trimmedEffort) ? trimmedEffort : null;
	return applyClaudePromptEffortPrefix(input.input?.trim() ?? "", promptEffort);
}
function buildUserMessage(input) {
	return {
		type: "user",
		session_id: "",
		parent_tool_use_id: null,
		message: {
			role: "user",
			content: input.sdkContent
		}
	};
}
function buildClaudeImageContentBlock(input) {
	return {
		type: "image",
		source: {
			type: "base64",
			media_type: input.mimeType,
			data: Buffer.from(input.bytes).toString("base64")
		}
	};
}
const buildUserMessageEffect = Effect.fn("buildUserMessageEffect")(function* (input, dependencies) {
	const text = buildPromptText(input);
	const sdkContent = [];
	if (text.length > 0) sdkContent.push({
		type: "text",
		text
	});
	for (const attachment of input.attachments ?? []) {
		if (attachment.type !== "image") continue;
		if (!SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType)) return yield* new ProviderAdapterRequestError({
			provider: PROVIDER$1,
			method: "turn/start",
			detail: `Unsupported Claude image attachment type '${attachment.mimeType}'.`
		});
		const attachmentPath = resolveAttachmentPath({
			attachmentsDir: dependencies.attachmentsDir,
			attachment
		});
		if (!attachmentPath) return yield* new ProviderAdapterRequestError({
			provider: PROVIDER$1,
			method: "turn/start",
			detail: `Invalid attachment id '${attachment.id}'.`
		});
		const bytes = yield* dependencies.fileSystem.readFile(attachmentPath).pipe(Effect.mapError((cause) => new ProviderAdapterRequestError({
			provider: PROVIDER$1,
			method: "turn/start",
			detail: toMessage(cause, "Failed to read attachment file."),
			cause
		})));
		sdkContent.push(buildClaudeImageContentBlock({
			mimeType: attachment.mimeType,
			bytes
		}));
	}
	return buildUserMessage({ sdkContent });
});
function turnStatusFromResult(result) {
	if (result.subtype === "success") return "completed";
	const errors = resultErrorsText(result);
	if (isInterruptedResult(result)) return "interrupted";
	if (errors.includes("cancel")) return "cancelled";
	return "failed";
}
function streamKindFromDeltaType(deltaType) {
	return deltaType.includes("thinking") ? "reasoning_text" : "assistant_text";
}
function nativeProviderRefs(_context, options) {
	if (options?.providerItemId) return { providerItemId: ProviderItemId.makeUnsafe(options.providerItemId) };
	return {};
}
function extractAssistantTextBlocks(message) {
	if (message.type !== "assistant") return [];
	const content = message.message?.content;
	if (!Array.isArray(content)) return [];
	const fragments = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string" && candidate.text.length > 0) fragments.push(candidate.text);
	}
	return fragments;
}
function extractContentBlockText(block) {
	if (!block || typeof block !== "object") return "";
	const candidate = block;
	return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
}
function extractTextContent(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((entry) => extractTextContent(entry)).join("");
	if (!value || typeof value !== "object") return "";
	const record = value;
	if (typeof record.text === "string") return record.text;
	return extractTextContent(record.content);
}
function extractExitPlanModePlan(value) {
	if (!value || typeof value !== "object") return;
	const record = value;
	return typeof record.plan === "string" && record.plan.trim().length > 0 ? record.plan.trim() : void 0;
}
function exitPlanCaptureKey(input) {
	return input.toolUseId && input.toolUseId.length > 0 ? `tool:${input.toolUseId}` : `plan:${input.planMarkdown}`;
}
function tryParseJsonRecord(value) {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
function toolInputFingerprint(input) {
	try {
		return JSON.stringify(input);
	} catch {
		return;
	}
}
function toolResultStreamKind(itemType) {
	switch (itemType) {
		case "command_execution": return "command_output";
		case "file_change": return "file_change_output";
		default: return;
	}
}
function toolResultBlocksFromUserMessage(message) {
	if (message.type !== "user") return [];
	const content = message.message?.content;
	if (!Array.isArray(content)) return [];
	const blocks = [];
	for (const entry of content) {
		if (!entry || typeof entry !== "object") continue;
		const block = entry;
		if (block.type !== "tool_result") continue;
		const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : void 0;
		if (!toolUseId) continue;
		blocks.push({
			toolUseId,
			block,
			text: extractTextContent(block.content),
			isError: block.is_error === true
		});
	}
	return blocks;
}
function toSessionError(threadId, cause) {
	const normalized = toMessage(cause, "").toLowerCase();
	if (normalized.includes("unknown session") || normalized.includes("not found")) return new ProviderAdapterSessionNotFoundError({
		provider: PROVIDER$1,
		threadId,
		cause
	});
	if (normalized.includes("closed")) return new ProviderAdapterSessionClosedError({
		provider: PROVIDER$1,
		threadId,
		cause
	});
}
function toRequestError(threadId, method, cause) {
	const sessionError = toSessionError(threadId, cause);
	if (sessionError) return sessionError;
	return new ProviderAdapterRequestError({
		provider: PROVIDER$1,
		method,
		detail: toMessage(cause, `${method} failed`),
		cause
	});
}
function sdkMessageType(value) {
	if (!value || typeof value !== "object") return;
	const record = value;
	return typeof record.type === "string" ? record.type : void 0;
}
function sdkMessageSubtype(value) {
	if (!value || typeof value !== "object") return;
	const record = value;
	return typeof record.subtype === "string" ? record.subtype : void 0;
}
function sdkNativeMethod(message) {
	const subtype = sdkMessageSubtype(message);
	if (subtype) return `claude/${message.type}/${subtype}`;
	if (message.type === "stream_event") {
		const streamType = sdkMessageType(message.event);
		if (streamType) {
			const deltaType = streamType === "content_block_delta" ? sdkMessageType(message.event.delta) : void 0;
			if (deltaType) return `claude/${message.type}/${streamType}/${deltaType}`;
			return `claude/${message.type}/${streamType}`;
		}
	}
	return `claude/${message.type}`;
}
function sdkNativeItemId(message) {
	if (message.type === "assistant") {
		const maybeId = message.message.id;
		if (typeof maybeId === "string") return maybeId;
		return;
	}
	if (message.type === "user") return toolResultBlocksFromUserMessage(message)[0]?.toolUseId;
	if (message.type === "stream_event") {
		const event = message.event;
		if (event.type === "content_block_start" && typeof event.content_block?.id === "string") return event.content_block.id;
	}
}
const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function* (options) {
	const fileSystem = yield* FileSystem.FileSystem;
	const serverConfig = yield* ServerConfig;
	const nativeEventLogger = options?.nativeEventLogger ?? (options?.nativeEventLogPath !== void 0 ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" }) : void 0);
	const createQuery = options?.createQuery ?? ((input) => query({
		prompt: input.prompt,
		options: input.options
	}));
	const sessions = /* @__PURE__ */ new Map();
	const runtimeEventQueue = yield* Queue.unbounded();
	const serverSettingsService = yield* ServerSettingsService;
	const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
	const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
	const makeEventStamp = () => Effect.all({
		eventId: nextEventId,
		createdAt: nowIso
	});
	const offerRuntimeEvent = (event) => Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);
	const logNativeSdkMessage = Effect.fn("logNativeSdkMessage")(function* (context, message) {
		if (!nativeEventLogger) return;
		const observedAt = (/* @__PURE__ */ new Date()).toISOString();
		const itemId = sdkNativeItemId(message);
		yield* nativeEventLogger.write({
			observedAt,
			event: {
				id: "uuid" in message && typeof message.uuid === "string" ? message.uuid : crypto.randomUUID(),
				kind: "notification",
				provider: PROVIDER$1,
				createdAt: observedAt,
				method: sdkNativeMethod(message),
				...typeof message.session_id === "string" ? { providerThreadId: message.session_id } : {},
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				...itemId ? { itemId: ProviderItemId.makeUnsafe(itemId) } : {},
				payload: message
			}
		}, context.session.threadId);
	});
	const snapshotThread = Effect.fn("snapshotThread")(function* (context) {
		const threadId = context.session.threadId;
		if (!threadId) return yield* new ProviderAdapterValidationError({
			provider: PROVIDER$1,
			operation: "readThread",
			issue: "Session thread id is not initialized yet."
		});
		return {
			threadId,
			turns: context.turns.map((turn) => ({
				id: turn.id,
				items: [...turn.items]
			}))
		};
	});
	const updateResumeCursor = Effect.fn("updateResumeCursor")(function* (context) {
		const threadId = context.session.threadId;
		if (!threadId) return;
		const resumeCursor = {
			threadId,
			...context.resumeSessionId ? { resume: context.resumeSessionId } : {},
			...context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {},
			turnCount: context.turns.length
		};
		context.session = {
			...context.session,
			resumeCursor,
			updatedAt: yield* nowIso
		};
	});
	const ensureAssistantTextBlock = Effect.fn("ensureAssistantTextBlock")(function* (context, blockIndex, options) {
		const turnState = context.turnState;
		if (!turnState) return;
		const existing = turnState.assistantTextBlocks.get(blockIndex);
		if (existing && !existing.completionEmitted) {
			if (existing.fallbackText.length === 0 && options?.fallbackText) existing.fallbackText = options.fallbackText;
			if (options?.streamClosed) existing.streamClosed = true;
			return {
				blockIndex,
				block: existing
			};
		}
		const block = {
			itemId: yield* Random.nextUUIDv4,
			blockIndex,
			emittedTextDelta: false,
			fallbackText: options?.fallbackText ?? "",
			streamClosed: options?.streamClosed ?? false,
			completionEmitted: false
		};
		turnState.assistantTextBlocks.set(blockIndex, block);
		turnState.assistantTextBlockOrder.push(block);
		return {
			blockIndex,
			block
		};
	});
	const createSyntheticAssistantTextBlock = Effect.fn("createSyntheticAssistantTextBlock")(function* (context, fallbackText) {
		const turnState = context.turnState;
		if (!turnState) return;
		const blockIndex = turnState.nextSyntheticAssistantBlockIndex;
		turnState.nextSyntheticAssistantBlockIndex -= 1;
		return yield* ensureAssistantTextBlock(context, blockIndex, {
			fallbackText,
			streamClosed: true
		});
	});
	const completeAssistantTextBlock = Effect.fn("completeAssistantTextBlock")(function* (context, block, options) {
		const turnState = context.turnState;
		if (!turnState || block.completionEmitted) return;
		if (!options?.force && !block.streamClosed) return;
		if (!block.emittedTextDelta && block.fallbackText.length > 0) {
			const deltaStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "content.delta",
				eventId: deltaStamp.eventId,
				provider: PROVIDER$1,
				createdAt: deltaStamp.createdAt,
				threadId: context.session.threadId,
				turnId: turnState.turnId,
				itemId: asRuntimeItemId(block.itemId),
				payload: {
					streamKind: "assistant_text",
					delta: block.fallbackText
				},
				providerRefs: nativeProviderRefs(context),
				...options?.rawMethod || options?.rawPayload ? { raw: {
					source: "claude.sdk.message",
					...options.rawMethod ? { method: options.rawMethod } : {},
					payload: options?.rawPayload
				} } : {}
			});
		}
		block.completionEmitted = true;
		if (turnState.assistantTextBlocks.get(block.blockIndex) === block) turnState.assistantTextBlocks.delete(block.blockIndex);
		const stamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "item.completed",
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			itemId: asRuntimeItemId(block.itemId),
			threadId: context.session.threadId,
			turnId: turnState.turnId,
			payload: {
				itemType: "assistant_message",
				status: "completed",
				title: "Assistant message",
				...block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}
			},
			providerRefs: nativeProviderRefs(context),
			...options?.rawMethod || options?.rawPayload ? { raw: {
				source: "claude.sdk.message",
				...options.rawMethod ? { method: options.rawMethod } : {},
				payload: options?.rawPayload
			} } : {}
		});
	});
	const backfillAssistantTextBlocksFromSnapshot = Effect.fn("backfillAssistantTextBlocksFromSnapshot")(function* (context, message) {
		const turnState = context.turnState;
		if (!turnState) return;
		const snapshotTextBlocks = extractAssistantTextBlocks(message);
		if (snapshotTextBlocks.length === 0) return;
		const orderedBlocks = turnState.assistantTextBlockOrder.map((block) => ({
			blockIndex: block.blockIndex,
			block
		}));
		for (const [position, text] of snapshotTextBlocks.entries()) {
			const entry = orderedBlocks[position] ?? (yield* createSyntheticAssistantTextBlock(context, text).pipe(Effect.map((created) => {
				if (!created) return;
				orderedBlocks.push(created);
				return created;
			})));
			if (!entry) continue;
			if (entry.block.fallbackText.length === 0) entry.block.fallbackText = text;
			if (entry.block.streamClosed && !entry.block.completionEmitted) yield* completeAssistantTextBlock(context, entry.block, {
				rawMethod: "claude/assistant",
				rawPayload: message
			});
		}
	});
	const ensureThreadId = Effect.fn("ensureThreadId")(function* (context, message) {
		if (typeof message.session_id !== "string" || message.session_id.length === 0) return;
		const nextThreadId = message.session_id;
		context.resumeSessionId = message.session_id;
		yield* updateResumeCursor(context);
		if (context.lastThreadStartedId !== nextThreadId) {
			context.lastThreadStartedId = nextThreadId;
			const stamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "thread.started",
				eventId: stamp.eventId,
				provider: PROVIDER$1,
				createdAt: stamp.createdAt,
				threadId: context.session.threadId,
				payload: { providerThreadId: nextThreadId },
				providerRefs: {},
				raw: {
					source: "claude.sdk.message",
					method: "claude/thread/started",
					payload: { session_id: message.session_id }
				}
			});
		}
	});
	const emitRuntimeError = Effect.fn("emitRuntimeError")(function* (context, message, cause) {
		if (cause !== void 0) {}
		const turnState = context.turnState;
		const stamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "runtime.error",
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			...turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {},
			payload: {
				message,
				class: "provider_error",
				...cause !== void 0 ? { detail: cause } : {}
			},
			providerRefs: nativeProviderRefs(context)
		});
	});
	const emitRuntimeWarning = Effect.fn("emitRuntimeWarning")(function* (context, message, detail) {
		const turnState = context.turnState;
		const stamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "runtime.warning",
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			...turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {},
			payload: {
				message,
				...detail !== void 0 ? { detail } : {}
			},
			providerRefs: nativeProviderRefs(context)
		});
	});
	const emitProposedPlanCompleted = Effect.fn("emitProposedPlanCompleted")(function* (context, input) {
		const turnState = context.turnState;
		const planMarkdown = input.planMarkdown.trim();
		if (!turnState || planMarkdown.length === 0) return;
		const captureKey = exitPlanCaptureKey({
			toolUseId: input.toolUseId,
			planMarkdown
		});
		if (turnState.capturedProposedPlanKeys.has(captureKey)) return;
		turnState.capturedProposedPlanKeys.add(captureKey);
		const stamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "turn.proposed.completed",
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			turnId: turnState.turnId,
			payload: { planMarkdown },
			providerRefs: nativeProviderRefs(context, { providerItemId: input.toolUseId }),
			raw: {
				source: input.rawSource,
				method: input.rawMethod,
				payload: input.rawPayload
			}
		});
	});
	const completeTurn = Effect.fn("completeTurn")(function* (context, status, errorMessage, result) {
		const resultUsage = result?.usage && typeof result.usage === "object" ? { ...result.usage } : void 0;
		const resultContextWindow = maxClaudeContextWindowFromModelUsage(result?.modelUsage);
		if (resultContextWindow !== void 0) context.lastKnownContextWindow = resultContextWindow;
		const accumulatedSnapshot = normalizeClaudeTokenUsage(resultUsage, resultContextWindow ?? context.lastKnownContextWindow);
		const lastGoodUsage = context.lastKnownTokenUsage;
		const maxTokens = resultContextWindow ?? context.lastKnownContextWindow;
		const usageSnapshot = lastGoodUsage ? {
			...lastGoodUsage,
			...typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {},
			...accumulatedSnapshot && accumulatedSnapshot.usedTokens > lastGoodUsage.usedTokens ? { totalProcessedTokens: accumulatedSnapshot.usedTokens } : {}
		} : accumulatedSnapshot;
		const turnState = context.turnState;
		if (!turnState) {
			if (usageSnapshot) {
				const usageStamp = yield* makeEventStamp();
				yield* offerRuntimeEvent({
					type: "thread.token-usage.updated",
					eventId: usageStamp.eventId,
					provider: PROVIDER$1,
					createdAt: usageStamp.createdAt,
					threadId: context.session.threadId,
					payload: { usage: usageSnapshot },
					providerRefs: {}
				});
			}
			const stamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "turn.completed",
				eventId: stamp.eventId,
				provider: PROVIDER$1,
				createdAt: stamp.createdAt,
				threadId: context.session.threadId,
				payload: {
					state: status,
					...result?.stop_reason !== void 0 ? { stopReason: result.stop_reason } : {},
					...result?.usage ? { usage: result.usage } : {},
					...result?.modelUsage ? { modelUsage: result.modelUsage } : {},
					...typeof result?.total_cost_usd === "number" ? { totalCostUsd: result.total_cost_usd } : {},
					...errorMessage ? { errorMessage } : {}
				},
				providerRefs: {}
			});
			return;
		}
		for (const [index, tool] of context.inFlightTools.entries()) {
			const toolStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "item.completed",
				eventId: toolStamp.eventId,
				provider: PROVIDER$1,
				createdAt: toolStamp.createdAt,
				threadId: context.session.threadId,
				turnId: turnState.turnId,
				itemId: asRuntimeItemId(tool.itemId),
				payload: {
					itemType: tool.itemType,
					status: status === "completed" ? "completed" : "failed",
					title: tool.title,
					...tool.detail ? { detail: tool.detail } : {},
					data: {
						toolName: tool.toolName,
						input: tool.input
					}
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
				raw: {
					source: "claude.sdk.message",
					method: "claude/result",
					payload: result ?? { status }
				}
			});
			context.inFlightTools.delete(index);
		}
		context.inFlightTools.clear();
		for (const block of turnState.assistantTextBlockOrder) yield* completeAssistantTextBlock(context, block, {
			force: true,
			rawMethod: "claude/result",
			rawPayload: result ?? { status }
		});
		context.turns.push({
			id: turnState.turnId,
			items: [...turnState.items]
		});
		if (usageSnapshot) {
			const usageStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "thread.token-usage.updated",
				eventId: usageStamp.eventId,
				provider: PROVIDER$1,
				createdAt: usageStamp.createdAt,
				threadId: context.session.threadId,
				turnId: turnState.turnId,
				payload: { usage: usageSnapshot },
				providerRefs: nativeProviderRefs(context)
			});
		}
		const stamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "turn.completed",
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			turnId: turnState.turnId,
			payload: {
				state: status,
				...result?.stop_reason !== void 0 ? { stopReason: result.stop_reason } : {},
				...result?.usage ? { usage: result.usage } : {},
				...result?.modelUsage ? { modelUsage: result.modelUsage } : {},
				...typeof result?.total_cost_usd === "number" ? { totalCostUsd: result.total_cost_usd } : {},
				...errorMessage ? { errorMessage } : {}
			},
			providerRefs: nativeProviderRefs(context)
		});
		const updatedAt = yield* nowIso;
		context.turnState = void 0;
		context.session = {
			...context.session,
			status: "ready",
			activeTurnId: void 0,
			updatedAt,
			...status === "failed" && errorMessage ? { lastError: errorMessage } : {}
		};
		yield* updateResumeCursor(context);
	});
	const handleStreamEvent = Effect.fn("handleStreamEvent")(function* (context, message) {
		if (message.type !== "stream_event") return;
		const { event } = message;
		if (event.type === "content_block_delta") {
			if ((event.delta.type === "text_delta" || event.delta.type === "thinking_delta") && context.turnState) {
				const deltaText = event.delta.type === "text_delta" ? event.delta.text : typeof event.delta.thinking === "string" ? event.delta.thinking : "";
				if (deltaText.length === 0) return;
				const streamKind = streamKindFromDeltaType(event.delta.type);
				const assistantBlockEntry = event.delta.type === "text_delta" ? yield* ensureAssistantTextBlock(context, event.index) : context.turnState.assistantTextBlocks.get(event.index) ? {
					blockIndex: event.index,
					block: context.turnState.assistantTextBlocks.get(event.index)
				} : void 0;
				if (assistantBlockEntry?.block && event.delta.type === "text_delta") assistantBlockEntry.block.emittedTextDelta = true;
				const stamp = yield* makeEventStamp();
				yield* offerRuntimeEvent({
					type: "content.delta",
					eventId: stamp.eventId,
					provider: PROVIDER$1,
					createdAt: stamp.createdAt,
					threadId: context.session.threadId,
					turnId: context.turnState.turnId,
					...assistantBlockEntry?.block ? { itemId: asRuntimeItemId(assistantBlockEntry.block.itemId) } : {},
					payload: {
						streamKind,
						delta: deltaText
					},
					providerRefs: nativeProviderRefs(context),
					raw: {
						source: "claude.sdk.message",
						method: "claude/stream_event/content_block_delta",
						payload: message
					}
				});
				return;
			}
			if (event.delta.type === "input_json_delta") {
				const tool = context.inFlightTools.get(event.index);
				if (!tool || typeof event.delta.partial_json !== "string") return;
				const partialInputJson = tool.partialInputJson + event.delta.partial_json;
				const parsedInput = tryParseJsonRecord(partialInputJson);
				const detail = parsedInput ? summarizeToolRequest(tool.toolName, parsedInput) : tool.detail;
				let nextTool = {
					...tool,
					partialInputJson,
					...parsedInput ? { input: parsedInput } : {},
					...detail ? { detail } : {}
				};
				const nextFingerprint = parsedInput && Object.keys(parsedInput).length > 0 ? toolInputFingerprint(parsedInput) : void 0;
				context.inFlightTools.set(event.index, nextTool);
				if (!parsedInput || !nextFingerprint || tool.lastEmittedInputFingerprint === nextFingerprint) return;
				nextTool = {
					...nextTool,
					lastEmittedInputFingerprint: nextFingerprint
				};
				context.inFlightTools.set(event.index, nextTool);
				const stamp = yield* makeEventStamp();
				yield* offerRuntimeEvent({
					type: "item.updated",
					eventId: stamp.eventId,
					provider: PROVIDER$1,
					createdAt: stamp.createdAt,
					threadId: context.session.threadId,
					...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
					itemId: asRuntimeItemId(nextTool.itemId),
					payload: {
						itemType: nextTool.itemType,
						status: "inProgress",
						title: nextTool.title,
						...nextTool.detail ? { detail: nextTool.detail } : {},
						data: {
							toolName: nextTool.toolName,
							input: nextTool.input
						}
					},
					providerRefs: nativeProviderRefs(context, { providerItemId: nextTool.itemId }),
					raw: {
						source: "claude.sdk.message",
						method: "claude/stream_event/content_block_delta/input_json_delta",
						payload: message
					}
				});
			}
			return;
		}
		if (event.type === "content_block_start") {
			const { index, content_block: block } = event;
			if (block.type === "text") {
				yield* ensureAssistantTextBlock(context, index, { fallbackText: extractContentBlockText(block) });
				return;
			}
			if (block.type !== "tool_use" && block.type !== "server_tool_use" && block.type !== "mcp_tool_use") return;
			const toolName = block.name;
			const itemType = classifyToolItemType(toolName);
			const toolInput = typeof block.input === "object" && block.input !== null ? block.input : {};
			const itemId = block.id;
			const detail = summarizeToolRequest(toolName, toolInput);
			const inputFingerprint = Object.keys(toolInput).length > 0 ? toolInputFingerprint(toolInput) : void 0;
			const tool = {
				itemId,
				itemType,
				toolName,
				title: titleForTool(itemType),
				detail,
				input: toolInput,
				partialInputJson: "",
				...inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}
			};
			context.inFlightTools.set(index, tool);
			const stamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "item.started",
				eventId: stamp.eventId,
				provider: PROVIDER$1,
				createdAt: stamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				itemId: asRuntimeItemId(tool.itemId),
				payload: {
					itemType: tool.itemType,
					status: "inProgress",
					title: tool.title,
					...tool.detail ? { detail: tool.detail } : {},
					data: {
						toolName: tool.toolName,
						input: toolInput
					}
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
				raw: {
					source: "claude.sdk.message",
					method: "claude/stream_event/content_block_start",
					payload: message
				}
			});
			return;
		}
		if (event.type === "content_block_stop") {
			const { index } = event;
			const assistantBlock = context.turnState?.assistantTextBlocks.get(index);
			if (assistantBlock) {
				assistantBlock.streamClosed = true;
				yield* completeAssistantTextBlock(context, assistantBlock, {
					rawMethod: "claude/stream_event/content_block_stop",
					rawPayload: message
				});
				return;
			}
			if (!context.inFlightTools.get(index)) return;
		}
	});
	const handleUserMessage = Effect.fn("handleUserMessage")(function* (context, message) {
		if (message.type !== "user") return;
		if (context.turnState) context.turnState.items.push(message.message);
		for (const toolResult of toolResultBlocksFromUserMessage(message)) {
			const toolEntry = Array.from(context.inFlightTools.entries()).find(([, tool]) => tool.itemId === toolResult.toolUseId);
			if (!toolEntry) continue;
			const [index, tool] = toolEntry;
			const itemStatus = toolResult.isError ? "failed" : "completed";
			const toolData = {
				toolName: tool.toolName,
				input: tool.input,
				result: toolResult.block
			};
			const updatedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "item.updated",
				eventId: updatedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: updatedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				itemId: asRuntimeItemId(tool.itemId),
				payload: {
					itemType: tool.itemType,
					status: toolResult.isError ? "failed" : "inProgress",
					title: tool.title,
					...tool.detail ? { detail: tool.detail } : {},
					data: toolData
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
				raw: {
					source: "claude.sdk.message",
					method: "claude/user",
					payload: message
				}
			});
			const streamKind = toolResultStreamKind(tool.itemType);
			if (streamKind && toolResult.text.length > 0 && context.turnState) {
				const deltaStamp = yield* makeEventStamp();
				yield* offerRuntimeEvent({
					type: "content.delta",
					eventId: deltaStamp.eventId,
					provider: PROVIDER$1,
					createdAt: deltaStamp.createdAt,
					threadId: context.session.threadId,
					turnId: context.turnState.turnId,
					itemId: asRuntimeItemId(tool.itemId),
					payload: {
						streamKind,
						delta: toolResult.text
					},
					providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
					raw: {
						source: "claude.sdk.message",
						method: "claude/user",
						payload: message
					}
				});
			}
			const completedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "item.completed",
				eventId: completedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: completedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				itemId: asRuntimeItemId(tool.itemId),
				payload: {
					itemType: tool.itemType,
					status: itemStatus,
					title: tool.title,
					...tool.detail ? { detail: tool.detail } : {},
					data: toolData
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
				raw: {
					source: "claude.sdk.message",
					method: "claude/user",
					payload: message
				}
			});
			context.inFlightTools.delete(index);
		}
	});
	const handleAssistantMessage = Effect.fn("handleAssistantMessage")(function* (context, message) {
		if (message.type !== "assistant") return;
		if (!context.turnState) {
			const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
			const startedAt = yield* nowIso;
			context.turnState = {
				turnId,
				startedAt,
				items: [],
				assistantTextBlocks: /* @__PURE__ */ new Map(),
				assistantTextBlockOrder: [],
				capturedProposedPlanKeys: /* @__PURE__ */ new Set(),
				nextSyntheticAssistantBlockIndex: -1
			};
			context.session = {
				...context.session,
				status: "running",
				activeTurnId: turnId,
				updatedAt: startedAt
			};
			const turnStartedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "turn.started",
				eventId: turnStartedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: turnStartedStamp.createdAt,
				threadId: context.session.threadId,
				turnId,
				payload: {},
				providerRefs: {
					...nativeProviderRefs(context),
					providerTurnId: turnId
				},
				raw: {
					source: "claude.sdk.message",
					method: "claude/synthetic-turn-start",
					payload: {}
				}
			});
		}
		const content = message.message?.content;
		if (Array.isArray(content)) for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const toolUse = block;
			if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") continue;
			const planMarkdown = extractExitPlanModePlan(toolUse.input);
			if (!planMarkdown) continue;
			yield* emitProposedPlanCompleted(context, {
				planMarkdown,
				toolUseId: typeof toolUse.id === "string" ? toolUse.id : void 0,
				rawSource: "claude.sdk.message",
				rawMethod: "claude/assistant",
				rawPayload: message
			});
		}
		if (context.turnState) {
			context.turnState.items.push(message.message);
			yield* backfillAssistantTextBlocksFromSnapshot(context, message);
		}
		context.lastAssistantUuid = message.uuid;
		yield* updateResumeCursor(context);
	});
	const handleResultMessage = Effect.fn("handleResultMessage")(function* (context, message) {
		if (message.type !== "result") return;
		const status = turnStatusFromResult(message);
		const errorMessage = message.subtype === "success" ? void 0 : message.errors[0];
		if (status === "failed") yield* emitRuntimeError(context, errorMessage ?? "Claude turn failed.");
		yield* completeTurn(context, status, errorMessage, message);
	});
	const handleSystemMessage = Effect.fn("handleSystemMessage")(function* (context, message) {
		if (message.type !== "system") return;
		const stamp = yield* makeEventStamp();
		const base = {
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
			providerRefs: nativeProviderRefs(context),
			raw: {
				source: "claude.sdk.message",
				method: sdkNativeMethod(message),
				messageType: `${message.type}:${message.subtype}`,
				payload: message
			}
		};
		switch (message.subtype) {
			case "init":
				yield* offerRuntimeEvent({
					...base,
					type: "session.configured",
					payload: { config: message }
				});
				return;
			case "status":
				yield* offerRuntimeEvent({
					...base,
					type: "session.state.changed",
					payload: {
						state: message.status === "compacting" ? "waiting" : "running",
						reason: `status:${message.status ?? "active"}`,
						detail: message
					}
				});
				return;
			case "compact_boundary":
				yield* offerRuntimeEvent({
					...base,
					type: "thread.state.changed",
					payload: {
						state: "compacted",
						detail: message
					}
				});
				return;
			case "hook_started":
				yield* offerRuntimeEvent({
					...base,
					type: "hook.started",
					payload: {
						hookId: message.hook_id,
						hookName: message.hook_name,
						hookEvent: message.hook_event
					}
				});
				return;
			case "hook_progress":
				yield* offerRuntimeEvent({
					...base,
					type: "hook.progress",
					payload: {
						hookId: message.hook_id,
						output: message.output,
						stdout: message.stdout,
						stderr: message.stderr
					}
				});
				return;
			case "hook_response":
				yield* offerRuntimeEvent({
					...base,
					type: "hook.completed",
					payload: {
						hookId: message.hook_id,
						outcome: message.outcome,
						output: message.output,
						stdout: message.stdout,
						stderr: message.stderr,
						...typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}
					}
				});
				return;
			case "task_started":
				yield* offerRuntimeEvent({
					...base,
					type: "task.started",
					payload: {
						taskId: RuntimeTaskId.makeUnsafe(message.task_id),
						description: message.description,
						...message.task_type ? { taskType: message.task_type } : {}
					}
				});
				return;
			case "task_progress":
				if (message.usage) {
					const normalizedUsage = normalizeClaudeTokenUsage(message.usage, context.lastKnownContextWindow);
					if (normalizedUsage) {
						context.lastKnownTokenUsage = normalizedUsage;
						const usageStamp = yield* makeEventStamp();
						yield* offerRuntimeEvent({
							...base,
							eventId: usageStamp.eventId,
							createdAt: usageStamp.createdAt,
							type: "thread.token-usage.updated",
							payload: { usage: normalizedUsage }
						});
					}
				}
				yield* offerRuntimeEvent({
					...base,
					type: "task.progress",
					payload: {
						taskId: RuntimeTaskId.makeUnsafe(message.task_id),
						description: message.description,
						...message.summary ? { summary: message.summary } : {},
						...message.usage ? { usage: message.usage } : {},
						...message.last_tool_name ? { lastToolName: message.last_tool_name } : {}
					}
				});
				return;
			case "task_notification":
				if (message.usage) {
					const normalizedUsage = normalizeClaudeTokenUsage(message.usage, context.lastKnownContextWindow);
					if (normalizedUsage) {
						context.lastKnownTokenUsage = normalizedUsage;
						const usageStamp = yield* makeEventStamp();
						yield* offerRuntimeEvent({
							...base,
							eventId: usageStamp.eventId,
							createdAt: usageStamp.createdAt,
							type: "thread.token-usage.updated",
							payload: { usage: normalizedUsage }
						});
					}
				}
				yield* offerRuntimeEvent({
					...base,
					type: "task.completed",
					payload: {
						taskId: RuntimeTaskId.makeUnsafe(message.task_id),
						status: message.status,
						...message.summary ? { summary: message.summary } : {},
						...message.usage ? { usage: message.usage } : {}
					}
				});
				return;
			case "files_persisted":
				yield* offerRuntimeEvent({
					...base,
					type: "files.persisted",
					payload: {
						files: Array.isArray(message.files) ? message.files.map((file) => ({
							filename: file.filename,
							fileId: file.file_id
						})) : [],
						...Array.isArray(message.failed) ? { failed: message.failed.map((entry) => ({
							filename: entry.filename,
							error: entry.error
						})) } : {}
					}
				});
				return;
			default:
				yield* emitRuntimeWarning(context, `Unhandled Claude system message subtype '${message.subtype}'.`, message);
				return;
		}
	});
	const handleSdkTelemetryMessage = Effect.fn("handleSdkTelemetryMessage")(function* (context, message) {
		const stamp = yield* makeEventStamp();
		const base = {
			eventId: stamp.eventId,
			provider: PROVIDER$1,
			createdAt: stamp.createdAt,
			threadId: context.session.threadId,
			...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
			providerRefs: nativeProviderRefs(context),
			raw: {
				source: "claude.sdk.message",
				method: sdkNativeMethod(message),
				messageType: message.type,
				payload: message
			}
		};
		if (message.type === "tool_progress") {
			yield* offerRuntimeEvent({
				...base,
				type: "tool.progress",
				payload: {
					toolUseId: message.tool_use_id,
					toolName: message.tool_name,
					elapsedSeconds: message.elapsed_time_seconds,
					...message.task_id ? { summary: `task:${message.task_id}` } : {}
				}
			});
			return;
		}
		if (message.type === "tool_use_summary") {
			yield* offerRuntimeEvent({
				...base,
				type: "tool.summary",
				payload: {
					summary: message.summary,
					...message.preceding_tool_use_ids.length > 0 ? { precedingToolUseIds: message.preceding_tool_use_ids } : {}
				}
			});
			return;
		}
		if (message.type === "auth_status") {
			yield* offerRuntimeEvent({
				...base,
				type: "auth.status",
				payload: {
					isAuthenticating: message.isAuthenticating,
					output: message.output,
					...message.error ? { error: message.error } : {}
				}
			});
			return;
		}
		if (message.type === "rate_limit_event") {
			yield* offerRuntimeEvent({
				...base,
				type: "account.rate-limits.updated",
				payload: { rateLimits: message }
			});
			return;
		}
	});
	const handleSdkMessage = Effect.fn("handleSdkMessage")(function* (context, message) {
		yield* logNativeSdkMessage(context, message);
		yield* ensureThreadId(context, message);
		switch (message.type) {
			case "stream_event":
				yield* handleStreamEvent(context, message);
				return;
			case "user":
				yield* handleUserMessage(context, message);
				return;
			case "assistant":
				yield* handleAssistantMessage(context, message);
				return;
			case "result":
				yield* handleResultMessage(context, message);
				return;
			case "system":
				yield* handleSystemMessage(context, message);
				return;
			case "tool_progress":
			case "tool_use_summary":
			case "auth_status":
			case "rate_limit_event":
				yield* handleSdkTelemetryMessage(context, message);
				return;
			default:
				yield* emitRuntimeWarning(context, `Unhandled Claude SDK message type '${message.type}'.`, message);
				return;
		}
	});
	const runSdkStream = (context) => Stream.fromAsyncIterable(context.query, (cause) => toError(cause, "Claude runtime stream failed.")).pipe(Stream.takeWhile(() => !context.stopped), Stream.runForEach((message) => handleSdkMessage(context, message)));
	const handleStreamExit = Effect.fn("handleStreamExit")(function* (context, exit) {
		if (context.stopped) return;
		if (Exit.isFailure(exit)) if (isClaudeInterruptedCause(exit.cause)) {
			if (context.turnState) yield* completeTurn(context, "interrupted", interruptionMessageFromClaudeCause(exit.cause));
		} else {
			const message = messageFromClaudeStreamCause(exit.cause, "Claude runtime stream failed.");
			yield* emitRuntimeError(context, message, Cause.pretty(exit.cause));
			yield* completeTurn(context, "failed", message);
		}
		else if (context.turnState) yield* completeTurn(context, "interrupted", "Claude runtime stream ended.");
		yield* stopSessionInternal(context, { emitExitEvent: true });
	});
	const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (context, options) {
		if (context.stopped) return;
		context.stopped = true;
		for (const [requestId, pending] of context.pendingApprovals) {
			yield* Deferred.succeed(pending.decision, "cancel");
			const stamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "request.resolved",
				eventId: stamp.eventId,
				provider: PROVIDER$1,
				createdAt: stamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				requestId: asRuntimeRequestId(requestId),
				payload: {
					requestType: pending.requestType,
					decision: "cancel"
				},
				providerRefs: nativeProviderRefs(context)
			});
		}
		context.pendingApprovals.clear();
		if (context.turnState) yield* completeTurn(context, "interrupted", "Session stopped.");
		yield* Queue.shutdown(context.promptQueue);
		const streamFiber = context.streamFiber;
		context.streamFiber = void 0;
		if (streamFiber && streamFiber.pollUnsafe() === void 0) yield* Fiber.interrupt(streamFiber);
		try {
			context.query.close();
		} catch (cause) {
			yield* emitRuntimeError(context, "Failed to close Claude runtime query.", cause);
		}
		const updatedAt = yield* nowIso;
		context.session = {
			...context.session,
			status: "closed",
			activeTurnId: void 0,
			updatedAt
		};
		if (options?.emitExitEvent !== false) {
			const stamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "session.exited",
				eventId: stamp.eventId,
				provider: PROVIDER$1,
				createdAt: stamp.createdAt,
				threadId: context.session.threadId,
				payload: {
					reason: "Session stopped",
					exitKind: "graceful"
				},
				providerRefs: {}
			});
		}
		sessions.delete(context.session.threadId);
	});
	const requireSession = (threadId) => {
		const context = sessions.get(threadId);
		if (!context) return Effect.fail(new ProviderAdapterSessionNotFoundError({
			provider: PROVIDER$1,
			threadId
		}));
		if (context.stopped || context.session.status === "closed") return Effect.fail(new ProviderAdapterSessionClosedError({
			provider: PROVIDER$1,
			threadId
		}));
		return Effect.succeed(context);
	};
	const startSession = Effect.fn("startSession")(function* (input) {
		if (input.provider !== void 0 && input.provider !== PROVIDER$1) return yield* new ProviderAdapterValidationError({
			provider: PROVIDER$1,
			operation: "startSession",
			issue: `Expected provider '${PROVIDER$1}' but received '${input.provider}'.`
		});
		const startedAt = yield* nowIso;
		const resumeState = readClaudeResumeState(input.resumeCursor);
		const threadId = input.threadId;
		const existingResumeSessionId = resumeState?.resume;
		const newSessionId = existingResumeSessionId === void 0 ? yield* Random.nextUUIDv4 : void 0;
		const sessionId = existingResumeSessionId ?? newSessionId;
		const services = yield* Effect.services();
		const runFork = Effect.runForkWith(services);
		const runPromise = Effect.runPromiseWith(services);
		const promptQueue = yield* Queue.unbounded();
		const prompt = Stream.fromQueue(promptQueue).pipe(Stream.filter((item) => item.type === "message"), Stream.map((item) => item.message), Stream.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause)), Stream.toAsyncIterable);
		const pendingApprovals = /* @__PURE__ */ new Map();
		const pendingUserInputs = /* @__PURE__ */ new Map();
		const inFlightTools = /* @__PURE__ */ new Map();
		const contextRef = yield* Ref.make(void 0);
		/**
		* Handle AskUserQuestion tool calls by emitting a `user-input.requested`
		* runtime event and waiting for the user to respond via `respondToUserInput`.
		*/
		const handleAskUserQuestion = Effect.fn("handleAskUserQuestion")(function* (context, toolInput, callbackOptions) {
			const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
			const questions = (Array.isArray(toolInput.questions) ? toolInput.questions : []).map((q, idx) => ({
				id: typeof q.header === "string" ? q.header : `q-${idx}`,
				header: typeof q.header === "string" ? q.header : `Question ${idx + 1}`,
				question: typeof q.question === "string" ? q.question : "",
				options: Array.isArray(q.options) ? q.options.map((opt) => ({
					label: typeof opt.label === "string" ? opt.label : "",
					description: typeof opt.description === "string" ? opt.description : ""
				})) : [],
				multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false
			}));
			const answersDeferred = yield* Deferred.make();
			let aborted = false;
			const pendingInput = {
				questions,
				answers: answersDeferred
			};
			const requestedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "user-input.requested",
				eventId: requestedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: requestedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				requestId: asRuntimeRequestId(requestId),
				payload: { questions },
				providerRefs: nativeProviderRefs(context, { providerItemId: callbackOptions.toolUseID }),
				raw: {
					source: "claude.sdk.permission",
					method: "canUseTool/AskUserQuestion",
					payload: {
						toolName: "AskUserQuestion",
						input: toolInput
					}
				}
			});
			pendingUserInputs.set(requestId, pendingInput);
			const onAbort = () => {
				if (!pendingUserInputs.has(requestId)) return;
				aborted = true;
				pendingUserInputs.delete(requestId);
				runFork(Deferred.succeed(answersDeferred, {}));
			};
			callbackOptions.signal.addEventListener("abort", onAbort, { once: true });
			const answers = yield* Deferred.await(answersDeferred);
			pendingUserInputs.delete(requestId);
			const resolvedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "user-input.resolved",
				eventId: resolvedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: resolvedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				requestId: asRuntimeRequestId(requestId),
				payload: { answers },
				providerRefs: nativeProviderRefs(context, { providerItemId: callbackOptions.toolUseID }),
				raw: {
					source: "claude.sdk.permission",
					method: "canUseTool/AskUserQuestion/resolved",
					payload: { answers }
				}
			});
			if (aborted) return {
				behavior: "deny",
				message: "User cancelled tool execution."
			};
			return {
				behavior: "allow",
				updatedInput: {
					questions: toolInput.questions,
					answers
				}
			};
		});
		const canUseToolEffect = Effect.fn("canUseTool")(function* (toolName, toolInput, callbackOptions) {
			const context = yield* Ref.get(contextRef);
			if (!context) return {
				behavior: "deny",
				message: "Claude session context is unavailable."
			};
			if (toolName === "AskUserQuestion") return yield* handleAskUserQuestion(context, toolInput, callbackOptions);
			if (toolName === "ExitPlanMode") {
				const planMarkdown = extractExitPlanModePlan(toolInput);
				if (planMarkdown) yield* emitProposedPlanCompleted(context, {
					planMarkdown,
					toolUseId: callbackOptions.toolUseID,
					rawSource: "claude.sdk.permission",
					rawMethod: "canUseTool/ExitPlanMode",
					rawPayload: {
						toolName,
						input: toolInput
					}
				});
				return {
					behavior: "deny",
					message: "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn."
				};
			}
			if ((input.runtimeMode ?? "full-access") === "full-access") return {
				behavior: "allow",
				updatedInput: toolInput
			};
			const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
			const requestType = classifyRequestType(toolName);
			const detail = summarizeToolRequest(toolName, toolInput);
			const decisionDeferred = yield* Deferred.make();
			const pendingApproval = {
				requestType,
				detail,
				decision: decisionDeferred,
				...callbackOptions.suggestions ? { suggestions: callbackOptions.suggestions } : {}
			};
			const requestedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "request.opened",
				eventId: requestedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: requestedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				requestId: asRuntimeRequestId(requestId),
				payload: {
					requestType,
					detail,
					args: {
						toolName,
						input: toolInput,
						...callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}
					}
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: callbackOptions.toolUseID }),
				raw: {
					source: "claude.sdk.permission",
					method: "canUseTool/request",
					payload: {
						toolName,
						input: toolInput
					}
				}
			});
			pendingApprovals.set(requestId, pendingApproval);
			const onAbort = () => {
				if (!pendingApprovals.has(requestId)) return;
				pendingApprovals.delete(requestId);
				runFork(Deferred.succeed(decisionDeferred, "cancel"));
			};
			callbackOptions.signal.addEventListener("abort", onAbort, { once: true });
			const decision = yield* Deferred.await(decisionDeferred);
			pendingApprovals.delete(requestId);
			const resolvedStamp = yield* makeEventStamp();
			yield* offerRuntimeEvent({
				type: "request.resolved",
				eventId: resolvedStamp.eventId,
				provider: PROVIDER$1,
				createdAt: resolvedStamp.createdAt,
				threadId: context.session.threadId,
				...context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {},
				requestId: asRuntimeRequestId(requestId),
				payload: {
					requestType,
					decision
				},
				providerRefs: nativeProviderRefs(context, { providerItemId: callbackOptions.toolUseID }),
				raw: {
					source: "claude.sdk.permission",
					method: "canUseTool/decision",
					payload: { decision }
				}
			});
			if (decision === "accept" || decision === "acceptForSession") return {
				behavior: "allow",
				updatedInput: toolInput,
				...decision === "acceptForSession" && pendingApproval.suggestions ? { updatedPermissions: [...pendingApproval.suggestions] } : {}
			};
			return {
				behavior: "deny",
				message: decision === "cancel" ? "User cancelled tool execution." : "User declined tool execution."
			};
		});
		const canUseTool = (toolName, toolInput, callbackOptions) => runPromise(canUseToolEffect(toolName, toolInput, callbackOptions));
		const claudeBinaryPath = (yield* serverSettingsService.getSettings.pipe(Effect.map((settings) => settings.providers.claudeAgent), Effect.mapError((error) => new ProviderAdapterProcessError({
			provider: PROVIDER$1,
			threadId: input.threadId,
			detail: error.message,
			cause: error
		})))).binaryPath;
		const modelSelection = input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : void 0;
		const caps = getClaudeModelCapabilities(modelSelection?.model);
		const apiModelId = modelSelection ? resolveApiModelId(modelSelection) : void 0;
		const effort = resolveEffort(caps, modelSelection?.options?.effort) ?? null;
		const fastMode = modelSelection?.options?.fastMode === true && caps.supportsFastMode;
		const thinking = typeof modelSelection?.options?.thinking === "boolean" && caps.supportsThinkingToggle ? modelSelection.options.thinking : void 0;
		const effectiveEffort = getEffectiveClaudeCodeEffort(effort);
		const permissionMode = input.runtimeMode === "full-access" ? "bypassPermissions" : void 0;
		const settings = {
			...typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {},
			...fastMode ? { fastMode: true } : {}
		};
		const queryOptions = {
			...input.cwd ? { cwd: input.cwd } : {},
			...apiModelId ? { model: apiModelId } : {},
			pathToClaudeCodeExecutable: claudeBinaryPath,
			settingSources: [...CLAUDE_SETTING_SOURCES],
			...effectiveEffort ? { effort: effectiveEffort } : {},
			...permissionMode ? { permissionMode } : {},
			...permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {},
			...Object.keys(settings).length > 0 ? { settings } : {},
			...existingResumeSessionId ? { resume: existingResumeSessionId } : {},
			...newSessionId ? { sessionId: newSessionId } : {},
			includePartialMessages: true,
			canUseTool,
			env: process.env,
			...input.cwd ? { additionalDirectories: [input.cwd] } : {}
		};
		const queryRuntime = yield* Effect.try({
			try: () => createQuery({
				prompt,
				options: queryOptions
			}),
			catch: (cause) => new ProviderAdapterProcessError({
				provider: PROVIDER$1,
				threadId,
				detail: toMessage(cause, "Failed to start Claude runtime session."),
				cause
			})
		});
		const session = {
			threadId,
			provider: PROVIDER$1,
			status: "ready",
			runtimeMode: input.runtimeMode,
			...input.cwd ? { cwd: input.cwd } : {},
			...modelSelection?.model ? { model: modelSelection.model } : {},
			...threadId ? { threadId } : {},
			resumeCursor: {
				...threadId ? { threadId } : {},
				...sessionId ? { resume: sessionId } : {},
				...resumeState?.resumeSessionAt ? { resumeSessionAt: resumeState.resumeSessionAt } : {},
				turnCount: resumeState?.turnCount ?? 0
			},
			createdAt: startedAt,
			updatedAt: startedAt
		};
		const context = {
			session,
			promptQueue,
			query: queryRuntime,
			streamFiber: void 0,
			startedAt,
			basePermissionMode: permissionMode,
			currentApiModelId: apiModelId,
			resumeSessionId: sessionId,
			pendingApprovals,
			pendingUserInputs,
			turns: [],
			inFlightTools,
			turnState: void 0,
			lastKnownContextWindow: void 0,
			lastKnownTokenUsage: void 0,
			lastAssistantUuid: resumeState?.resumeSessionAt,
			lastThreadStartedId: void 0,
			stopped: false
		};
		yield* Ref.set(contextRef, context);
		sessions.set(threadId, context);
		const sessionStartedStamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "session.started",
			eventId: sessionStartedStamp.eventId,
			provider: PROVIDER$1,
			createdAt: sessionStartedStamp.createdAt,
			threadId,
			payload: input.resumeCursor !== void 0 ? { resume: input.resumeCursor } : {},
			providerRefs: {}
		});
		const configuredStamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "session.configured",
			eventId: configuredStamp.eventId,
			provider: PROVIDER$1,
			createdAt: configuredStamp.createdAt,
			threadId,
			payload: { config: {
				...apiModelId ? { model: apiModelId } : {},
				...input.cwd ? { cwd: input.cwd } : {},
				...effectiveEffort ? { effort: effectiveEffort } : {},
				...permissionMode ? { permissionMode } : {},
				...fastMode ? { fastMode: true } : {}
			} },
			providerRefs: {}
		});
		const readyStamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "session.state.changed",
			eventId: readyStamp.eventId,
			provider: PROVIDER$1,
			createdAt: readyStamp.createdAt,
			threadId,
			payload: { state: "ready" },
			providerRefs: {}
		});
		let streamFiber;
		streamFiber = runFork(Effect.exit(runSdkStream(context)).pipe(Effect.flatMap((exit) => {
			if (context.stopped) return Effect.void;
			if (context.streamFiber === streamFiber) context.streamFiber = void 0;
			return handleStreamExit(context, exit);
		})));
		context.streamFiber = streamFiber;
		streamFiber.addObserver(() => {
			if (context.streamFiber === streamFiber) context.streamFiber = void 0;
		});
		return { ...session };
	});
	const sendTurn = Effect.fn("sendTurn")(function* (input) {
		const context = yield* requireSession(input.threadId);
		const modelSelection = input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : void 0;
		if (context.turnState) yield* completeTurn(context, "completed");
		if (modelSelection?.model) {
			const apiModelId = resolveApiModelId(modelSelection);
			if (context.currentApiModelId !== apiModelId) {
				yield* Effect.tryPromise({
					try: () => context.query.setModel(apiModelId),
					catch: (cause) => toRequestError(input.threadId, "turn/setModel", cause)
				});
				context.currentApiModelId = apiModelId;
			}
			context.session = {
				...context.session,
				model: modelSelection.model
			};
		}
		if (input.interactionMode === "plan") yield* Effect.tryPromise({
			try: () => context.query.setPermissionMode("plan"),
			catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause)
		});
		else if (input.interactionMode === "default") yield* Effect.tryPromise({
			try: () => context.query.setPermissionMode(context.basePermissionMode ?? "bypassPermissions"),
			catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause)
		});
		const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
		const turnState = {
			turnId,
			startedAt: yield* nowIso,
			items: [],
			assistantTextBlocks: /* @__PURE__ */ new Map(),
			assistantTextBlockOrder: [],
			capturedProposedPlanKeys: /* @__PURE__ */ new Set(),
			nextSyntheticAssistantBlockIndex: -1
		};
		const updatedAt = yield* nowIso;
		context.turnState = turnState;
		context.session = {
			...context.session,
			status: "running",
			activeTurnId: turnId,
			updatedAt
		};
		const turnStartedStamp = yield* makeEventStamp();
		yield* offerRuntimeEvent({
			type: "turn.started",
			eventId: turnStartedStamp.eventId,
			provider: PROVIDER$1,
			createdAt: turnStartedStamp.createdAt,
			threadId: context.session.threadId,
			turnId,
			payload: modelSelection?.model ? { model: modelSelection.model } : {},
			providerRefs: {}
		});
		const message = yield* buildUserMessageEffect(input, {
			fileSystem,
			attachmentsDir: serverConfig.attachmentsDir
		});
		yield* Queue.offer(context.promptQueue, {
			type: "message",
			message
		}).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/start", cause)));
		return {
			threadId: context.session.threadId,
			turnId,
			...context.session.resumeCursor !== void 0 ? { resumeCursor: context.session.resumeCursor } : {}
		};
	});
	const interruptTurn = Effect.fn("interruptTurn")(function* (threadId, _turnId) {
		const context = yield* requireSession(threadId);
		yield* Effect.tryPromise({
			try: () => context.query.interrupt(),
			catch: (cause) => toRequestError(threadId, "turn/interrupt", cause)
		});
	});
	const readThread = Effect.fn("readThread")(function* (threadId) {
		return yield* snapshotThread(yield* requireSession(threadId));
	});
	const rollbackThread = Effect.fn("rollbackThread")(function* (threadId, numTurns) {
		const context = yield* requireSession(threadId);
		const nextLength = Math.max(0, context.turns.length - numTurns);
		context.turns.splice(nextLength);
		yield* updateResumeCursor(context);
		return yield* snapshotThread(context);
	});
	const respondToRequest = Effect.fn("respondToRequest")(function* (threadId, requestId, decision) {
		const context = yield* requireSession(threadId);
		const pending = context.pendingApprovals.get(requestId);
		if (!pending) return yield* new ProviderAdapterRequestError({
			provider: PROVIDER$1,
			method: "item/requestApproval/decision",
			detail: `Unknown pending approval request: ${requestId}`
		});
		context.pendingApprovals.delete(requestId);
		yield* Deferred.succeed(pending.decision, decision);
	});
	const respondToUserInput = Effect.fn("respondToUserInput")(function* (threadId, requestId, answers) {
		const context = yield* requireSession(threadId);
		const pending = context.pendingUserInputs.get(requestId);
		if (!pending) return yield* new ProviderAdapterRequestError({
			provider: PROVIDER$1,
			method: "item/tool/respondToUserInput",
			detail: `Unknown pending user-input request: ${requestId}`
		});
		context.pendingUserInputs.delete(requestId);
		yield* Deferred.succeed(pending.answers, answers);
	});
	const stopSession = Effect.fn("stopSession")(function* (threadId) {
		yield* stopSessionInternal(yield* requireSession(threadId), { emitExitEvent: true });
	});
	const listSessions = () => Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));
	const hasSession = (threadId) => Effect.sync(() => {
		const context = sessions.get(threadId);
		return context !== void 0 && !context.stopped;
	});
	const stopAll = () => Effect.forEach(sessions, ([, context]) => stopSessionInternal(context, { emitExitEvent: true }), { discard: true });
	yield* Effect.addFinalizer(() => Effect.forEach(sessions, ([, context]) => stopSessionInternal(context, { emitExitEvent: false }), { discard: true }).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue))));
	return {
		provider: PROVIDER$1,
		capabilities: { sessionModelSwitch: "in-session" },
		startSession,
		sendTurn,
		interruptTurn,
		readThread,
		rollbackThread,
		respondToRequest,
		respondToUserInput,
		stopSession,
		listSessions,
		hasSession,
		stopAll,
		get streamEvents() {
			return Stream.fromQueue(runtimeEventQueue);
		}
	};
});
const ClaudeAdapterLive = Layer.effect(ClaudeAdapter, makeClaudeAdapter());
function makeClaudeAdapterLive(options) {
	return Layer.effect(ClaudeAdapter, makeClaudeAdapter(options));
}

//#endregion
//#region src/provider/Services/ProviderAdapterRegistry.ts
/**
* ProviderAdapterRegistry - Service tag for provider adapter lookup.
*/
var ProviderAdapterRegistry = class extends ServiceMap.Service()("t3/provider/Services/ProviderAdapterRegistry") {};

//#endregion
//#region src/provider/Layers/ProviderAdapterRegistry.ts
/**
* ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
*
* Binds provider kinds (codex/claudeAgent/...) to concrete adapter services.
* This layer only performs adapter lookup; it does not route session-scoped
* calls or own provider lifecycle workflows.
*
* @module ProviderAdapterRegistryLive
*/
const makeProviderAdapterRegistry = Effect.fn("makeProviderAdapterRegistry")(function* (options) {
	const adapters = options?.adapters !== void 0 ? options.adapters : [yield* CodexAdapter, yield* ClaudeAdapter];
	const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
	const getByProvider = (provider) => {
		const adapter = byProvider.get(provider);
		if (!adapter) return Effect.fail(new ProviderUnsupportedError({ provider }));
		return Effect.succeed(adapter);
	};
	const listProviders = () => Effect.sync(() => Array.from(byProvider.keys()));
	return {
		getByProvider,
		listProviders
	};
});
const ProviderAdapterRegistryLive = Layer.effect(ProviderAdapterRegistry, makeProviderAdapterRegistry());

//#endregion
//#region src/provider/Services/ProviderService.ts
/**
* ProviderService - Service tag for provider orchestration.
*/
var ProviderService = class extends ServiceMap.Service()("t3/provider/Services/ProviderService") {};

//#endregion
//#region src/provider/Layers/ProviderService.ts
/**
* ProviderServiceLive - Cross-provider orchestration layer.
*
* Routes validated transport/API calls to provider adapters through
* `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
* unified provider event stream for subscribers.
*
* It does not implement provider protocol details (adapter concern).
*
* @module ProviderServiceLive
*/
const ProviderRollbackConversationInput = Schema.Struct({
	threadId: ThreadId,
	numTurns: NonNegativeInt
});
function toValidationError(operation, issue, cause) {
	return new ProviderValidationError({
		operation,
		issue,
		...cause !== void 0 ? { cause } : {}
	});
}
const decodeInputOrValidationError = (input) => Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(Effect.mapError((schemaError) => new ProviderValidationError({
	operation: input.operation,
	issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
	cause: schemaError
})));
function toRuntimeStatus(session) {
	switch (session.status) {
		case "connecting": return "starting";
		case "error": return "error";
		case "closed": return "stopped";
		default: return "running";
	}
}
function toRuntimePayloadFromSession(session, extra) {
	return {
		cwd: session.cwd ?? null,
		model: session.model ?? null,
		activeTurnId: session.activeTurnId ?? null,
		lastError: session.lastError ?? null,
		...extra?.modelSelection !== void 0 ? { modelSelection: extra.modelSelection } : {},
		...extra?.lastRuntimeEvent !== void 0 ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {},
		...extra?.lastRuntimeEventAt !== void 0 ? { lastRuntimeEventAt: extra.lastRuntimeEventAt } : {}
	};
}
function readPersistedModelSelection(runtimePayload) {
	if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) return;
	const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : void 0;
	return Schema.is(ModelSelection)(raw) ? raw : void 0;
}
function readPersistedCwd(runtimePayload) {
	if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) return;
	const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : void 0;
	if (typeof rawCwd !== "string") return void 0;
	const trimmed = rawCwd.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
const makeProviderService = Effect.fn("makeProviderService")(function* (options) {
	const analytics = yield* Effect.service(AnalyticsService);
	const serverSettings = yield* ServerSettingsService;
	const canonicalEventLogger = options?.canonicalEventLogger ?? (options?.canonicalEventLogPath !== void 0 ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, { stream: "canonical" }) : void 0);
	const registry = yield* ProviderAdapterRegistry;
	const directory = yield* ProviderSessionDirectory;
	const runtimeEventPubSub = yield* PubSub.unbounded();
	const publishRuntimeEvent = (event) => Effect.succeed(event).pipe(Effect.tap((canonicalEvent) => canonicalEventLogger ? canonicalEventLogger.write(canonicalEvent, null) : Effect.void), Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)), Effect.asVoid);
	const upsertSessionBinding = (session, threadId, extra) => directory.upsert({
		threadId,
		provider: session.provider,
		runtimeMode: session.runtimeMode,
		status: toRuntimeStatus(session),
		...session.resumeCursor !== void 0 ? { resumeCursor: session.resumeCursor } : {},
		runtimePayload: toRuntimePayloadFromSession(session, extra)
	});
	const providers = yield* registry.listProviders();
	const adapters = yield* Effect.forEach(providers, (provider) => registry.getByProvider(provider));
	const processRuntimeEvent = (event) => increment(providerRuntimeEventsTotal, {
		provider: event.provider,
		eventType: event.type
	}).pipe(Effect.andThen(publishRuntimeEvent(event)));
	yield* Effect.forEach(adapters, (adapter) => Stream.runForEach(adapter.streamEvents, processRuntimeEvent).pipe(Effect.forkScoped)).pipe(Effect.asVoid);
	const recoverSessionForThread = Effect.fn("recoverSessionForThread")(function* (input) {
		yield* Effect.annotateCurrentSpan({
			"provider.operation": "recover-session",
			"provider.kind": input.binding.provider,
			"provider.thread_id": input.binding.threadId
		});
		return yield* Effect.gen(function* () {
			const adapter = yield* registry.getByProvider(input.binding.provider);
			const hasResumeCursor = input.binding.resumeCursor !== null && input.binding.resumeCursor !== void 0;
			if (yield* adapter.hasSession(input.binding.threadId)) {
				const existing = (yield* adapter.listSessions()).find((session) => session.threadId === input.binding.threadId);
				if (existing) {
					yield* upsertSessionBinding(existing, input.binding.threadId);
					yield* analytics.record("provider.session.recovered", {
						provider: existing.provider,
						strategy: "adopt-existing",
						hasResumeCursor: existing.resumeCursor !== void 0
					});
					return {
						adapter,
						session: existing
					};
				}
			}
			if (!hasResumeCursor) return yield* toValidationError(input.operation, `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`);
			const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
			const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);
			const resumed = yield* adapter.startSession({
				threadId: input.binding.threadId,
				provider: input.binding.provider,
				...persistedCwd ? { cwd: persistedCwd } : {},
				...persistedModelSelection ? { modelSelection: persistedModelSelection } : {},
				...hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {},
				runtimeMode: input.binding.runtimeMode ?? "full-access"
			});
			if (resumed.provider !== adapter.provider) return yield* toValidationError(input.operation, `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`);
			yield* upsertSessionBinding(resumed, input.binding.threadId);
			yield* analytics.record("provider.session.recovered", {
				provider: resumed.provider,
				strategy: "resume-thread",
				hasResumeCursor: resumed.resumeCursor !== void 0
			});
			return {
				adapter,
				session: resumed
			};
		}).pipe(withMetrics({
			counter: providerSessionsTotal,
			attributes: providerMetricAttributes(input.binding.provider, { operation: "recover" })
		}));
	});
	const resolveRoutableSession = Effect.fn("resolveRoutableSession")(function* (input) {
		const bindingOption = yield* directory.getBinding(input.threadId);
		const binding = Option.getOrUndefined(bindingOption);
		if (!binding) return yield* toValidationError(input.operation, `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`);
		const adapter = yield* registry.getByProvider(binding.provider);
		if (yield* adapter.hasSession(input.threadId)) return {
			adapter,
			threadId: input.threadId,
			isActive: true
		};
		if (!input.allowRecovery) return {
			adapter,
			threadId: input.threadId,
			isActive: false
		};
		return {
			adapter: (yield* recoverSessionForThread({
				binding,
				operation: input.operation
			})).adapter,
			threadId: input.threadId,
			isActive: true
		};
	});
	const startSession = Effect.fn("startSession")(function* (threadId, rawInput) {
		const parsed = yield* decodeInputOrValidationError({
			operation: "ProviderService.startSession",
			schema: ProviderSessionStartInput,
			payload: rawInput
		});
		const input = {
			...parsed,
			threadId,
			provider: parsed.provider ?? "codex"
		};
		yield* Effect.annotateCurrentSpan({
			"provider.operation": "start-session",
			"provider.kind": input.provider,
			"provider.thread_id": threadId,
			"provider.runtime_mode": input.runtimeMode
		});
		return yield* Effect.gen(function* () {
			if (!(yield* serverSettings.getSettings.pipe(Effect.mapError((error) => toValidationError("ProviderService.startSession", `Failed to load provider settings: ${error.message}`, error)))).providers[input.provider].enabled) return yield* toValidationError("ProviderService.startSession", `Provider '${input.provider}' is disabled in T3 Code settings.`);
			const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
			const effectiveResumeCursor = input.resumeCursor ?? (persistedBinding?.provider === input.provider ? persistedBinding.resumeCursor : void 0);
			const adapter = yield* registry.getByProvider(input.provider);
			const session = yield* adapter.startSession({
				...input,
				...effectiveResumeCursor !== void 0 ? { resumeCursor: effectiveResumeCursor } : {}
			});
			if (session.provider !== adapter.provider) return yield* toValidationError("ProviderService.startSession", `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`);
			yield* upsertSessionBinding(session, threadId, { modelSelection: input.modelSelection });
			yield* analytics.record("provider.session.started", {
				provider: session.provider,
				runtimeMode: input.runtimeMode,
				hasResumeCursor: session.resumeCursor !== void 0,
				hasCwd: typeof input.cwd === "string" && input.cwd.trim().length > 0,
				hasModel: typeof input.modelSelection?.model === "string" && input.modelSelection.model.trim().length > 0
			});
			return session;
		}).pipe(withMetrics({
			counter: providerSessionsTotal,
			attributes: providerMetricAttributes(input.provider, { operation: "start" })
		}));
	});
	const sendTurn = Effect.fn("sendTurn")(function* (rawInput) {
		const parsed = yield* decodeInputOrValidationError({
			operation: "ProviderService.sendTurn",
			schema: ProviderSendTurnInput,
			payload: rawInput
		});
		const input = {
			...parsed,
			attachments: parsed.attachments ?? []
		};
		if (!input.input && input.attachments.length === 0) return yield* toValidationError("ProviderService.sendTurn", "Either input text or at least one attachment is required");
		yield* Effect.annotateCurrentSpan({
			"provider.operation": "send-turn",
			"provider.thread_id": input.threadId,
			"provider.interaction_mode": input.interactionMode,
			"provider.attachment_count": input.attachments.length
		});
		let metricProvider = "unknown";
		let metricModel = input.modelSelection?.model;
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.sendTurn",
				allowRecovery: true
			});
			metricProvider = routed.adapter.provider;
			metricModel = input.modelSelection?.model;
			yield* Effect.annotateCurrentSpan({
				"provider.kind": routed.adapter.provider,
				...input.modelSelection?.model ? { "provider.model": input.modelSelection.model } : {}
			});
			const turn = yield* routed.adapter.sendTurn(input);
			yield* directory.upsert({
				threadId: input.threadId,
				provider: routed.adapter.provider,
				status: "running",
				...turn.resumeCursor !== void 0 ? { resumeCursor: turn.resumeCursor } : {},
				runtimePayload: {
					...input.modelSelection !== void 0 ? { modelSelection: input.modelSelection } : {},
					activeTurnId: turn.turnId,
					lastRuntimeEvent: "provider.sendTurn",
					lastRuntimeEventAt: (/* @__PURE__ */ new Date()).toISOString()
				}
			});
			yield* analytics.record("provider.turn.sent", {
				provider: routed.adapter.provider,
				model: input.modelSelection?.model,
				interactionMode: input.interactionMode,
				attachmentCount: input.attachments.length,
				hasInput: typeof input.input === "string" && input.input.trim().length > 0
			});
			return turn;
		}).pipe(withMetrics({
			counter: providerTurnsTotal,
			timer: providerTurnDuration,
			attributes: () => providerTurnMetricAttributes({
				provider: metricProvider,
				model: metricModel,
				extra: { operation: "send" }
			})
		}));
	});
	const interruptTurn = Effect.fn("interruptTurn")(function* (rawInput) {
		const input = yield* decodeInputOrValidationError({
			operation: "ProviderService.interruptTurn",
			schema: ProviderInterruptTurnInput,
			payload: rawInput
		});
		let metricProvider = "unknown";
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.interruptTurn",
				allowRecovery: true
			});
			metricProvider = routed.adapter.provider;
			yield* Effect.annotateCurrentSpan({
				"provider.operation": "interrupt-turn",
				"provider.kind": routed.adapter.provider,
				"provider.thread_id": input.threadId,
				"provider.turn_id": input.turnId
			});
			yield* routed.adapter.interruptTurn(routed.threadId, input.turnId);
			yield* analytics.record("provider.turn.interrupted", { provider: routed.adapter.provider });
		}).pipe(withMetrics({
			counter: providerTurnsTotal,
			outcomeAttributes: () => providerMetricAttributes(metricProvider, { operation: "interrupt" })
		}));
	});
	const respondToRequest = Effect.fn("respondToRequest")(function* (rawInput) {
		const input = yield* decodeInputOrValidationError({
			operation: "ProviderService.respondToRequest",
			schema: ProviderRespondToRequestInput,
			payload: rawInput
		});
		let metricProvider = "unknown";
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.respondToRequest",
				allowRecovery: true
			});
			metricProvider = routed.adapter.provider;
			yield* Effect.annotateCurrentSpan({
				"provider.operation": "respond-to-request",
				"provider.kind": routed.adapter.provider,
				"provider.thread_id": input.threadId,
				"provider.request_id": input.requestId
			});
			yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
			yield* analytics.record("provider.request.responded", {
				provider: routed.adapter.provider,
				decision: input.decision
			});
		}).pipe(withMetrics({
			counter: providerTurnsTotal,
			outcomeAttributes: () => providerMetricAttributes(metricProvider, { operation: "approval-response" })
		}));
	});
	const respondToUserInput = Effect.fn("respondToUserInput")(function* (rawInput) {
		const input = yield* decodeInputOrValidationError({
			operation: "ProviderService.respondToUserInput",
			schema: ProviderRespondToUserInputInput,
			payload: rawInput
		});
		let metricProvider = "unknown";
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.respondToUserInput",
				allowRecovery: true
			});
			metricProvider = routed.adapter.provider;
			yield* Effect.annotateCurrentSpan({
				"provider.operation": "respond-to-user-input",
				"provider.kind": routed.adapter.provider,
				"provider.thread_id": input.threadId,
				"provider.request_id": input.requestId
			});
			yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
		}).pipe(withMetrics({
			counter: providerTurnsTotal,
			outcomeAttributes: () => providerMetricAttributes(metricProvider, { operation: "user-input-response" })
		}));
	});
	const stopSession = Effect.fn("stopSession")(function* (rawInput) {
		const input = yield* decodeInputOrValidationError({
			operation: "ProviderService.stopSession",
			schema: ProviderStopSessionInput,
			payload: rawInput
		});
		let metricProvider = "unknown";
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.stopSession",
				allowRecovery: false
			});
			metricProvider = routed.adapter.provider;
			yield* Effect.annotateCurrentSpan({
				"provider.operation": "stop-session",
				"provider.kind": routed.adapter.provider,
				"provider.thread_id": input.threadId
			});
			if (routed.isActive) yield* routed.adapter.stopSession(routed.threadId);
			yield* directory.remove(input.threadId);
			yield* analytics.record("provider.session.stopped", { provider: routed.adapter.provider });
		}).pipe(withMetrics({
			counter: providerSessionsTotal,
			outcomeAttributes: () => providerMetricAttributes(metricProvider, { operation: "stop" })
		}));
	});
	const listSessions = Effect.fn("listSessions")(function* () {
		const activeSessions = (yield* Effect.forEach(adapters, (adapter) => adapter.listSessions())).flatMap((sessions) => sessions);
		const persistedBindings = yield* directory.listThreadIds().pipe(Effect.flatMap((threadIds) => Effect.forEach(threadIds, (threadId) => directory.getBinding(threadId).pipe(Effect.orElseSucceed(() => Option.none())), { concurrency: "unbounded" })), Effect.orElseSucceed(() => []));
		const bindingsByThreadId = /* @__PURE__ */ new Map();
		for (const bindingOption of persistedBindings) {
			const binding = Option.getOrUndefined(bindingOption);
			if (binding) bindingsByThreadId.set(binding.threadId, binding);
		}
		return activeSessions.map((session) => {
			const binding = bindingsByThreadId.get(session.threadId);
			if (!binding) return session;
			const overrides = {};
			if (session.resumeCursor === void 0 && binding.resumeCursor !== void 0) overrides.resumeCursor = binding.resumeCursor;
			if (binding.runtimeMode !== void 0) overrides.runtimeMode = binding.runtimeMode;
			return Object.assign({}, session, overrides);
		});
	});
	const getCapabilities = (provider) => registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));
	const rollbackConversation = Effect.fn("rollbackConversation")(function* (rawInput) {
		const input = yield* decodeInputOrValidationError({
			operation: "ProviderService.rollbackConversation",
			schema: ProviderRollbackConversationInput,
			payload: rawInput
		});
		if (input.numTurns === 0) return;
		let metricProvider = "unknown";
		return yield* Effect.gen(function* () {
			const routed = yield* resolveRoutableSession({
				threadId: input.threadId,
				operation: "ProviderService.rollbackConversation",
				allowRecovery: true
			});
			metricProvider = routed.adapter.provider;
			yield* Effect.annotateCurrentSpan({
				"provider.operation": "rollback-conversation",
				"provider.kind": routed.adapter.provider,
				"provider.thread_id": input.threadId,
				"provider.rollback_turns": input.numTurns
			});
			yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
			yield* analytics.record("provider.conversation.rolled_back", {
				provider: routed.adapter.provider,
				turns: input.numTurns
			});
		}).pipe(withMetrics({
			counter: providerTurnsTotal,
			outcomeAttributes: () => providerMetricAttributes(metricProvider, { operation: "rollback" })
		}));
	});
	const runStopAll = Effect.fn("runStopAll")(function* () {
		const threadIds = yield* directory.listThreadIds();
		const activeSessions = yield* Effect.forEach(adapters, (adapter) => adapter.listSessions()).pipe(Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)));
		yield* Effect.forEach(activeSessions, (session) => upsertSessionBinding(session, session.threadId, {
			lastRuntimeEvent: "provider.stopAll",
			lastRuntimeEventAt: (/* @__PURE__ */ new Date()).toISOString()
		})).pipe(Effect.asVoid);
		yield* Effect.forEach(adapters, (adapter) => adapter.stopAll()).pipe(Effect.asVoid);
		yield* Effect.forEach(threadIds, (threadId) => directory.getProvider(threadId).pipe(Effect.flatMap((provider) => directory.upsert({
			threadId,
			provider,
			status: "stopped",
			runtimePayload: {
				activeTurnId: null,
				lastRuntimeEvent: "provider.stopAll",
				lastRuntimeEventAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		})))).pipe(Effect.asVoid);
		yield* analytics.record("provider.sessions.stopped_all", { sessionCount: threadIds.length });
		yield* analytics.flush;
	});
	yield* Effect.addFinalizer(() => Effect.catch(runStopAll(), (cause) => Effect.logWarning("failed to stop provider service", { cause })));
	return {
		startSession,
		sendTurn,
		interruptTurn,
		respondToRequest,
		respondToUserInput,
		stopSession,
		listSessions,
		getCapabilities,
		rollbackConversation,
		get streamEvents() {
			return Stream.fromPubSub(runtimeEventPubSub);
		}
	};
});
const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());
function makeProviderServiceLive(options) {
	return Layer.effect(ProviderService, makeProviderService(options));
}

//#endregion
//#region src/persistence/Services/OrchestrationEventStore.ts
/**
* OrchestrationEventStore - Service tag for orchestration event persistence.
*
* @example
* ```ts
* const program = Effect.gen(function* () {
*   const events = yield* OrchestrationEventStore
*   return yield* Stream.runCollect(events.readAll())
* })
* ```
*/
var OrchestrationEventStore = class extends ServiceMap.Service()("t3/persistence/Services/OrchestrationEventStore") {};

//#endregion
//#region src/persistence/Services/OrchestrationCommandReceipts.ts
/**
* OrchestrationCommandReceiptRepository - Repository interface for command receipts.
*
* Owns persistence operations for deduplication and status tracking of
* orchestration command handling.
*
* @module OrchestrationCommandReceiptRepository
*/
const OrchestrationCommandReceipt = Schema.Struct({
	commandId: CommandId,
	aggregateKind: OrchestrationAggregateKind,
	aggregateId: Schema.Union([ProjectId, ThreadId]),
	acceptedAt: IsoDateTime,
	resultSequence: NonNegativeInt,
	status: OrchestrationCommandReceiptStatus,
	error: Schema.NullOr(Schema.String)
});
const GetByCommandIdInput = Schema.Struct({ commandId: CommandId });
/**
* OrchestrationCommandReceiptRepository - Service tag for command receipt persistence.
*/
var OrchestrationCommandReceiptRepository = class extends ServiceMap.Service()("t3/persistence/Services/OrchestrationCommandReceipts/OrchestrationCommandReceiptRepository") {};

//#endregion
//#region src/orchestration/Errors.ts
var OrchestrationCommandInvariantError = class extends Schema.TaggedErrorClass()("OrchestrationCommandInvariantError", {
	commandType: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Orchestration command invariant failed (${this.commandType}): ${this.detail}`;
	}
};
var OrchestrationCommandPreviouslyRejectedError = class extends Schema.TaggedErrorClass()("OrchestrationCommandPreviouslyRejectedError", {
	commandId: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Command previously rejected (${this.commandId}): ${this.detail}`;
	}
};
var OrchestrationProjectorDecodeError = class extends Schema.TaggedErrorClass()("OrchestrationProjectorDecodeError", {
	eventType: Schema.String,
	issue: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Projector decode failed for ${this.eventType}: ${this.issue}`;
	}
};
function toProjectorDecodeError(eventType) {
	return (error) => new OrchestrationProjectorDecodeError({
		eventType,
		issue: SchemaIssue.makeFormatterDefault()(error.issue),
		cause: error
	});
}

//#endregion
//#region src/orchestration/commandInvariants.ts
function invariantError(commandType, detail) {
	return new OrchestrationCommandInvariantError({
		commandType,
		detail
	});
}
function findThreadById(readModel, threadId) {
	return readModel.threads.find((thread) => thread.id === threadId);
}
function findProjectById(readModel, projectId) {
	return readModel.projects.find((project) => project.id === projectId);
}
function requireProject(input) {
	const project = findProjectById(input.readModel, input.projectId);
	if (project) return Effect.succeed(project);
	return Effect.fail(invariantError(input.command.type, `Project '${input.projectId}' does not exist for command '${input.command.type}'.`));
}
function requireProjectAbsent(input) {
	if (!findProjectById(input.readModel, input.projectId)) return Effect.void;
	return Effect.fail(invariantError(input.command.type, `Project '${input.projectId}' already exists and cannot be created twice.`));
}
function requireThread(input) {
	const thread = findThreadById(input.readModel, input.threadId);
	if (thread) return Effect.succeed(thread);
	return Effect.fail(invariantError(input.command.type, `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`));
}
function requireThreadArchived(input) {
	return requireThread(input).pipe(Effect.flatMap((thread) => thread.archivedAt !== null ? Effect.succeed(thread) : Effect.fail(invariantError(input.command.type, `Thread '${input.threadId}' is not archived for command '${input.command.type}'.`))));
}
function requireThreadNotArchived(input) {
	return requireThread(input).pipe(Effect.flatMap((thread) => thread.archivedAt === null ? Effect.succeed(thread) : Effect.fail(invariantError(input.command.type, `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`))));
}
function requireThreadAbsent(input) {
	if (!findThreadById(input.readModel, input.threadId)) return Effect.void;
	return Effect.fail(invariantError(input.command.type, `Thread '${input.threadId}' already exists and cannot be created twice.`));
}

//#endregion
//#region src/orchestration/decider.ts
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
const defaultMetadata = {
	eventId: crypto.randomUUID(),
	aggregateKind: "thread",
	aggregateId: "",
	occurredAt: nowIso(),
	commandId: null,
	causationEventId: null,
	correlationId: null,
	metadata: {}
};
function withEventBase(input) {
	return {
		...defaultMetadata,
		eventId: crypto.randomUUID(),
		aggregateKind: input.aggregateKind,
		aggregateId: input.aggregateId,
		occurredAt: input.occurredAt,
		commandId: input.commandId,
		correlationId: input.commandId,
		metadata: input.metadata ?? {}
	};
}
const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({ command, readModel }) {
	switch (command.type) {
		case "project.create":
			yield* requireProjectAbsent({
				readModel,
				command,
				projectId: command.projectId
			});
			return {
				...withEventBase({
					aggregateKind: "project",
					aggregateId: command.projectId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "project.created",
				payload: {
					projectId: command.projectId,
					title: command.title,
					workspaceRoot: command.workspaceRoot,
					defaultModelSelection: command.defaultModelSelection ?? null,
					scripts: [],
					createdAt: command.createdAt,
					updatedAt: command.createdAt
				}
			};
		case "project.meta.update": {
			yield* requireProject({
				readModel,
				command,
				projectId: command.projectId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "project",
					aggregateId: command.projectId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "project.meta-updated",
				payload: {
					projectId: command.projectId,
					...command.title !== void 0 ? { title: command.title } : {},
					...command.workspaceRoot !== void 0 ? { workspaceRoot: command.workspaceRoot } : {},
					...command.defaultModelSelection !== void 0 ? { defaultModelSelection: command.defaultModelSelection } : {},
					...command.scripts !== void 0 ? { scripts: command.scripts } : {},
					updatedAt: occurredAt
				}
			};
		}
		case "project.delete": {
			yield* requireProject({
				readModel,
				command,
				projectId: command.projectId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "project",
					aggregateId: command.projectId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "project.deleted",
				payload: {
					projectId: command.projectId,
					deletedAt: occurredAt
				}
			};
		}
		case "thread.create":
			yield* requireProject({
				readModel,
				command,
				projectId: command.projectId
			});
			yield* requireThreadAbsent({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.created",
				payload: {
					threadId: command.threadId,
					projectId: command.projectId,
					title: command.title,
					modelSelection: command.modelSelection,
					runtimeMode: command.runtimeMode,
					interactionMode: command.interactionMode,
					branch: command.branch,
					worktreePath: command.worktreePath,
					createdAt: command.createdAt,
					updatedAt: command.createdAt
				}
			};
		case "thread.delete": {
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.deleted",
				payload: {
					threadId: command.threadId,
					deletedAt: occurredAt
				}
			};
		}
		case "thread.archive": {
			yield* requireThreadNotArchived({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.archived",
				payload: {
					threadId: command.threadId,
					archivedAt: occurredAt,
					updatedAt: occurredAt
				}
			};
		}
		case "thread.unarchive": {
			yield* requireThreadArchived({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.unarchived",
				payload: {
					threadId: command.threadId,
					updatedAt: occurredAt
				}
			};
		}
		case "thread.meta.update": {
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.meta-updated",
				payload: {
					threadId: command.threadId,
					...command.title !== void 0 ? { title: command.title } : {},
					...command.modelSelection !== void 0 ? { modelSelection: command.modelSelection } : {},
					...command.branch !== void 0 ? { branch: command.branch } : {},
					...command.worktreePath !== void 0 ? { worktreePath: command.worktreePath } : {},
					updatedAt: occurredAt
				}
			};
		}
		case "thread.runtime-mode.set": {
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.runtime-mode-set",
				payload: {
					threadId: command.threadId,
					runtimeMode: command.runtimeMode,
					updatedAt: occurredAt
				}
			};
		}
		case "thread.interaction-mode.set": {
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const occurredAt = nowIso();
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt,
					commandId: command.commandId
				}),
				type: "thread.interaction-mode-set",
				payload: {
					threadId: command.threadId,
					interactionMode: command.interactionMode,
					updatedAt: occurredAt
				}
			};
		}
		case "thread.turn.start": {
			const targetThread = yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const sourceProposedPlan = command.sourceProposedPlan;
			const sourceThread = sourceProposedPlan ? yield* requireThread({
				readModel,
				command,
				threadId: sourceProposedPlan.threadId
			}) : null;
			const sourcePlan = sourceProposedPlan && sourceThread ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId) : null;
			if (sourceProposedPlan && !sourcePlan) return yield* new OrchestrationCommandInvariantError({
				commandType: command.type,
				detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`
			});
			if (sourceThread && sourceThread.projectId !== targetThread.projectId) return yield* new OrchestrationCommandInvariantError({
				commandType: command.type,
				detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`
			});
			const userMessageEvent = {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.message-sent",
				payload: {
					threadId: command.threadId,
					messageId: command.message.messageId,
					role: "user",
					text: command.message.text,
					attachments: command.message.attachments,
					turnId: null,
					streaming: false,
					createdAt: command.createdAt,
					updatedAt: command.createdAt
				}
			};
			return [userMessageEvent, {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				causationEventId: userMessageEvent.eventId,
				type: "thread.turn-start-requested",
				payload: {
					threadId: command.threadId,
					messageId: command.message.messageId,
					...command.modelSelection !== void 0 ? { modelSelection: command.modelSelection } : {},
					...command.titleSeed !== void 0 ? { titleSeed: command.titleSeed } : {},
					runtimeMode: targetThread.runtimeMode,
					interactionMode: targetThread.interactionMode,
					...sourceProposedPlan !== void 0 ? { sourceProposedPlan } : {},
					createdAt: command.createdAt
				}
			}];
		}
		case "thread.turn.interrupt":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.turn-interrupt-requested",
				payload: {
					threadId: command.threadId,
					...command.turnId !== void 0 ? { turnId: command.turnId } : {},
					createdAt: command.createdAt
				}
			};
		case "thread.approval.respond":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId,
					metadata: { requestId: command.requestId }
				}),
				type: "thread.approval-response-requested",
				payload: {
					threadId: command.threadId,
					requestId: command.requestId,
					decision: command.decision,
					createdAt: command.createdAt
				}
			};
		case "thread.user-input.respond":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId,
					metadata: { requestId: command.requestId }
				}),
				type: "thread.user-input-response-requested",
				payload: {
					threadId: command.threadId,
					requestId: command.requestId,
					answers: command.answers,
					createdAt: command.createdAt
				}
			};
		case "thread.checkpoint.revert":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.checkpoint-revert-requested",
				payload: {
					threadId: command.threadId,
					turnCount: command.turnCount,
					createdAt: command.createdAt
				}
			};
		case "thread.session.stop":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.session-stop-requested",
				payload: {
					threadId: command.threadId,
					createdAt: command.createdAt
				}
			};
		case "thread.session.set":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId,
					metadata: {}
				}),
				type: "thread.session-set",
				payload: {
					threadId: command.threadId,
					session: command.session
				}
			};
		case "thread.message.assistant.delta":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.message-sent",
				payload: {
					threadId: command.threadId,
					messageId: command.messageId,
					role: "assistant",
					text: command.delta,
					turnId: command.turnId ?? null,
					streaming: true,
					createdAt: command.createdAt,
					updatedAt: command.createdAt
				}
			};
		case "thread.message.assistant.complete":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.message-sent",
				payload: {
					threadId: command.threadId,
					messageId: command.messageId,
					role: "assistant",
					text: "",
					turnId: command.turnId ?? null,
					streaming: false,
					createdAt: command.createdAt,
					updatedAt: command.createdAt
				}
			};
		case "thread.proposed-plan.upsert":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.proposed-plan-upserted",
				payload: {
					threadId: command.threadId,
					proposedPlan: command.proposedPlan
				}
			};
		case "thread.turn.diff.complete":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.turn-diff-completed",
				payload: {
					threadId: command.threadId,
					turnId: command.turnId,
					checkpointTurnCount: command.checkpointTurnCount,
					checkpointRef: command.checkpointRef,
					status: command.status,
					files: command.files,
					assistantMessageId: command.assistantMessageId ?? null,
					completedAt: command.completedAt
				}
			};
		case "thread.revert.complete":
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId
				}),
				type: "thread.reverted",
				payload: {
					threadId: command.threadId,
					turnCount: command.turnCount
				}
			};
		case "thread.activity.append": {
			yield* requireThread({
				readModel,
				command,
				threadId: command.threadId
			});
			const requestId = typeof command.activity.payload === "object" && command.activity.payload !== null && "requestId" in command.activity.payload && typeof command.activity.payload.requestId === "string" ? command.activity.payload.requestId : void 0;
			return {
				...withEventBase({
					aggregateKind: "thread",
					aggregateId: command.threadId,
					occurredAt: command.createdAt,
					commandId: command.commandId,
					...requestId !== void 0 ? { metadata: { requestId } } : {}
				}),
				type: "thread.activity-appended",
				payload: {
					threadId: command.threadId,
					activity: command.activity
				}
			};
		}
		default: {
			const fallback = command;
			return yield* new OrchestrationCommandInvariantError({
				commandType: fallback.type,
				detail: `Unknown command type: ${fallback.type}`
			});
		}
	}
});

//#endregion
//#region src/orchestration/Schemas.ts
const ProjectCreatedPayload = ProjectCreatedPayload$1;
const ProjectMetaUpdatedPayload = ProjectMetaUpdatedPayload$1;
const ProjectDeletedPayload = ProjectDeletedPayload$1;
const ThreadCreatedPayload = ThreadCreatedPayload$1;
const ThreadArchivedPayload = ThreadArchivedPayload$1;
const ThreadMetaUpdatedPayload = ThreadMetaUpdatedPayload$1;
const ThreadRuntimeModeSetPayload = ThreadRuntimeModeSetPayload$1;
const ThreadInteractionModeSetPayload = ThreadInteractionModeSetPayload$1;
const ThreadDeletedPayload = ThreadDeletedPayload$1;
const ThreadUnarchivedPayload = ThreadUnarchivedPayload$1;
const MessageSentPayloadSchema = ThreadMessageSentPayload;
const ThreadProposedPlanUpsertedPayload = ThreadProposedPlanUpsertedPayload$1;
const ThreadSessionSetPayload = ThreadSessionSetPayload$1;
const ThreadTurnDiffCompletedPayload = ThreadTurnDiffCompletedPayload$1;
const ThreadRevertedPayload = ThreadRevertedPayload$1;
const ThreadActivityAppendedPayload = ThreadActivityAppendedPayload$1;

//#endregion
//#region src/orchestration/projector.ts
const MAX_THREAD_MESSAGES = 2e3;
const MAX_THREAD_CHECKPOINTS = 500;
function checkpointStatusToLatestTurnState(status) {
	if (status === "error") return "error";
	if (status === "missing") return "interrupted";
	return "completed";
}
function updateThread(threads, threadId, patch) {
	return threads.map((thread) => thread.id === threadId ? {
		...thread,
		...patch
	} : thread);
}
function decodeForEvent(schema, value, eventType, field) {
	return Effect.try({
		try: () => Schema.decodeUnknownSync(schema)(value),
		catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error)
	});
}
function retainThreadMessagesAfterRevert(messages, retainedTurnIds, turnCount) {
	const retainedMessageIds = /* @__PURE__ */ new Set();
	for (const message of messages) {
		if (message.role === "system") {
			retainedMessageIds.add(message.id);
			continue;
		}
		if (message.turnId !== null && retainedTurnIds.has(message.turnId)) retainedMessageIds.add(message.id);
	}
	const retainedUserCount = messages.filter((message) => message.role === "user" && retainedMessageIds.has(message.id)).length;
	const missingUserCount = Math.max(0, turnCount - retainedUserCount);
	if (missingUserCount > 0) {
		const fallbackUserMessages = messages.filter((message) => message.role === "user" && !retainedMessageIds.has(message.id) && (message.turnId === null || retainedTurnIds.has(message.turnId))).toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).slice(0, missingUserCount);
		for (const message of fallbackUserMessages) retainedMessageIds.add(message.id);
	}
	const retainedAssistantCount = messages.filter((message) => message.role === "assistant" && retainedMessageIds.has(message.id)).length;
	const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
	if (missingAssistantCount > 0) {
		const fallbackAssistantMessages = messages.filter((message) => message.role === "assistant" && !retainedMessageIds.has(message.id) && (message.turnId === null || retainedTurnIds.has(message.turnId))).toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).slice(0, missingAssistantCount);
		for (const message of fallbackAssistantMessages) retainedMessageIds.add(message.id);
	}
	return messages.filter((message) => retainedMessageIds.has(message.id));
}
function retainThreadActivitiesAfterRevert(activities, retainedTurnIds) {
	return activities.filter((activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId));
}
function retainThreadProposedPlansAfterRevert(proposedPlans, retainedTurnIds) {
	return proposedPlans.filter((proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId));
}
function compareThreadActivities(left, right) {
	if (left.sequence !== void 0 && right.sequence !== void 0) {
		if (left.sequence !== right.sequence) return left.sequence - right.sequence;
	} else if (left.sequence !== void 0) return 1;
	else if (right.sequence !== void 0) return -1;
	return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
function createEmptyReadModel(nowIso) {
	return {
		snapshotSequence: 0,
		projects: [],
		threads: [],
		updatedAt: nowIso
	};
}
function projectEvent(model, event) {
	const nextBase = {
		...model,
		snapshotSequence: event.sequence,
		updatedAt: event.occurredAt
	};
	switch (event.type) {
		case "project.created": return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => {
			const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
			const nextProject = {
				id: payload.projectId,
				title: payload.title,
				workspaceRoot: payload.workspaceRoot,
				defaultModelSelection: payload.defaultModelSelection,
				scripts: payload.scripts,
				createdAt: payload.createdAt,
				updatedAt: payload.updatedAt,
				deletedAt: null
			};
			return {
				...nextBase,
				projects: existing ? nextBase.projects.map((entry) => entry.id === payload.projectId ? nextProject : entry) : [...nextBase.projects, nextProject]
			};
		}));
		case "project.meta-updated": return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			projects: nextBase.projects.map((project) => project.id === payload.projectId ? {
				...project,
				...payload.title !== void 0 ? { title: payload.title } : {},
				...payload.workspaceRoot !== void 0 ? { workspaceRoot: payload.workspaceRoot } : {},
				...payload.defaultModelSelection !== void 0 ? { defaultModelSelection: payload.defaultModelSelection } : {},
				...payload.scripts !== void 0 ? { scripts: payload.scripts } : {},
				updatedAt: payload.updatedAt
			} : project)
		})));
		case "project.deleted": return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			projects: nextBase.projects.map((project) => project.id === payload.projectId ? {
				...project,
				deletedAt: payload.deletedAt,
				updatedAt: payload.deletedAt
			} : project)
		})));
		case "thread.created": return Effect.gen(function* () {
			const payload = yield* decodeForEvent(ThreadCreatedPayload, event.payload, event.type, "payload");
			const thread = yield* decodeForEvent(OrchestrationThread, {
				id: payload.threadId,
				projectId: payload.projectId,
				title: payload.title,
				modelSelection: payload.modelSelection,
				runtimeMode: payload.runtimeMode,
				interactionMode: payload.interactionMode,
				branch: payload.branch,
				worktreePath: payload.worktreePath,
				latestTurn: null,
				createdAt: payload.createdAt,
				updatedAt: payload.updatedAt,
				archivedAt: null,
				deletedAt: null,
				messages: [],
				activities: [],
				checkpoints: [],
				session: null
			}, event.type, "thread");
			const existing = nextBase.threads.find((entry) => entry.id === thread.id);
			return {
				...nextBase,
				threads: existing ? nextBase.threads.map((entry) => entry.id === thread.id ? thread : entry) : [...nextBase.threads, thread]
			};
		});
		case "thread.deleted": return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				deletedAt: payload.deletedAt,
				updatedAt: payload.deletedAt
			})
		})));
		case "thread.archived": return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				archivedAt: payload.archivedAt,
				updatedAt: payload.updatedAt
			})
		})));
		case "thread.unarchived": return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				archivedAt: null,
				updatedAt: payload.updatedAt
			})
		})));
		case "thread.meta-updated": return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				...payload.title !== void 0 ? { title: payload.title } : {},
				...payload.modelSelection !== void 0 ? { modelSelection: payload.modelSelection } : {},
				...payload.branch !== void 0 ? { branch: payload.branch } : {},
				...payload.worktreePath !== void 0 ? { worktreePath: payload.worktreePath } : {},
				updatedAt: payload.updatedAt
			})
		})));
		case "thread.runtime-mode-set": return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				runtimeMode: payload.runtimeMode,
				updatedAt: payload.updatedAt
			})
		})));
		case "thread.interaction-mode-set": return decodeForEvent(ThreadInteractionModeSetPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => ({
			...nextBase,
			threads: updateThread(nextBase.threads, payload.threadId, {
				interactionMode: payload.interactionMode,
				updatedAt: payload.updatedAt
			})
		})));
		case "thread.message-sent": return Effect.gen(function* () {
			const payload = yield* decodeForEvent(MessageSentPayloadSchema, event.payload, event.type, "payload");
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const message = yield* decodeForEvent(OrchestrationMessage, {
				id: payload.messageId,
				role: payload.role,
				text: payload.text,
				...payload.attachments !== void 0 ? { attachments: payload.attachments } : {},
				turnId: payload.turnId,
				streaming: payload.streaming,
				createdAt: payload.createdAt,
				updatedAt: payload.updatedAt
			}, event.type, "message");
			const cappedMessages = (thread.messages.find((entry) => entry.id === message.id) ? thread.messages.map((entry) => entry.id === message.id ? {
				...entry,
				text: message.streaming ? `${entry.text}${message.text}` : message.text.length > 0 ? message.text : entry.text,
				streaming: message.streaming,
				updatedAt: message.updatedAt,
				turnId: message.turnId,
				...message.attachments !== void 0 ? { attachments: message.attachments } : {}
			} : entry) : [...thread.messages, message]).slice(-MAX_THREAD_MESSAGES);
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					messages: cappedMessages,
					updatedAt: event.occurredAt
				})
			};
		});
		case "thread.session-set": return Effect.gen(function* () {
			const payload = yield* decodeForEvent(ThreadSessionSetPayload, event.payload, event.type, "payload");
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const session = yield* decodeForEvent(OrchestrationSession, payload.session, event.type, "session");
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					session,
					latestTurn: session.status === "running" && session.activeTurnId !== null ? {
						turnId: session.activeTurnId,
						state: "running",
						requestedAt: thread.latestTurn?.turnId === session.activeTurnId ? thread.latestTurn.requestedAt : session.updatedAt,
						startedAt: thread.latestTurn?.turnId === session.activeTurnId ? thread.latestTurn.startedAt ?? session.updatedAt : session.updatedAt,
						completedAt: null,
						assistantMessageId: thread.latestTurn?.turnId === session.activeTurnId ? thread.latestTurn.assistantMessageId : null
					} : thread.latestTurn,
					updatedAt: event.occurredAt
				})
			};
		});
		case "thread.proposed-plan-upserted": return Effect.gen(function* () {
			const payload = yield* decodeForEvent(ThreadProposedPlanUpsertedPayload, event.payload, event.type, "payload");
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const proposedPlans = [...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id), payload.proposedPlan].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).slice(-200);
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					proposedPlans,
					updatedAt: event.occurredAt
				})
			};
		});
		case "thread.turn-diff-completed": return Effect.gen(function* () {
			const payload = yield* decodeForEvent(ThreadTurnDiffCompletedPayload, event.payload, event.type, "payload");
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const checkpoint = yield* decodeForEvent(OrchestrationCheckpointSummary, {
				turnId: payload.turnId,
				checkpointTurnCount: payload.checkpointTurnCount,
				checkpointRef: payload.checkpointRef,
				status: payload.status,
				files: payload.files,
				assistantMessageId: payload.assistantMessageId,
				completedAt: payload.completedAt
			}, event.type, "checkpoint");
			const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
			if (existing && existing.status !== "missing" && checkpoint.status === "missing") return nextBase;
			const checkpoints = [...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId), checkpoint].toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount).slice(-MAX_THREAD_CHECKPOINTS);
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					checkpoints,
					latestTurn: {
						turnId: payload.turnId,
						state: checkpointStatusToLatestTurnState(payload.status),
						requestedAt: thread.latestTurn?.turnId === payload.turnId ? thread.latestTurn.requestedAt : payload.completedAt,
						startedAt: thread.latestTurn?.turnId === payload.turnId ? thread.latestTurn.startedAt ?? payload.completedAt : payload.completedAt,
						completedAt: payload.completedAt,
						assistantMessageId: payload.assistantMessageId
					},
					updatedAt: event.occurredAt
				})
			};
		});
		case "thread.reverted": return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => {
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const checkpoints = thread.checkpoints.filter((entry) => entry.checkpointTurnCount <= payload.turnCount).toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount).slice(-MAX_THREAD_CHECKPOINTS);
			const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
			const messages = retainThreadMessagesAfterRevert(thread.messages, retainedTurnIds, payload.turnCount).slice(-MAX_THREAD_MESSAGES);
			const proposedPlans = retainThreadProposedPlansAfterRevert(thread.proposedPlans, retainedTurnIds).slice(-200);
			const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
			const latestCheckpoint = checkpoints.at(-1) ?? null;
			const latestTurn = latestCheckpoint === null ? null : {
				turnId: latestCheckpoint.turnId,
				state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
				requestedAt: latestCheckpoint.completedAt,
				startedAt: latestCheckpoint.completedAt,
				completedAt: latestCheckpoint.completedAt,
				assistantMessageId: latestCheckpoint.assistantMessageId
			};
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					checkpoints,
					messages,
					proposedPlans,
					activities,
					latestTurn,
					updatedAt: event.occurredAt
				})
			};
		}));
		case "thread.activity-appended": return decodeForEvent(ThreadActivityAppendedPayload, event.payload, event.type, "payload").pipe(Effect.map((payload) => {
			const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
			if (!thread) return nextBase;
			const activities = [...thread.activities.filter((entry) => entry.id !== payload.activity.id), payload.activity].toSorted(compareThreadActivities).slice(-500);
			return {
				...nextBase,
				threads: updateThread(nextBase.threads, payload.threadId, {
					activities,
					updatedAt: event.occurredAt
				})
			};
		}));
		default: return Effect.succeed(nextBase);
	}
}

//#endregion
//#region src/orchestration/Services/ProjectionPipeline.ts
/**
* OrchestrationProjectionPipeline - Service tag for orchestration projections.
*/
var OrchestrationProjectionPipeline = class extends ServiceMap.Service()("t3/orchestration/Services/ProjectionPipeline/OrchestrationProjectionPipeline") {};

//#endregion
//#region src/orchestration/Layers/OrchestrationEngine.ts
function commandToAggregateRef(command) {
	switch (command.type) {
		case "project.create":
		case "project.meta.update":
		case "project.delete": return {
			aggregateKind: "project",
			aggregateId: command.projectId
		};
		default: return {
			aggregateKind: "thread",
			aggregateId: command.threadId
		};
	}
}
const makeOrchestrationEngine = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const eventStore = yield* OrchestrationEventStore;
	const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
	const projectionPipeline = yield* OrchestrationProjectionPipeline;
	const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
	let readModel = createEmptyReadModel((/* @__PURE__ */ new Date()).toISOString());
	const commandQueue = yield* Queue.unbounded();
	const eventPubSub = yield* PubSub.unbounded();
	const processEnvelope = (envelope) => {
		const dispatchStartSequence = readModel.snapshotSequence;
		const processingStartedAtMs = Date.now();
		const aggregateRef = commandToAggregateRef(envelope.command);
		const baseMetricAttributes = {
			commandType: envelope.command.type,
			aggregateKind: aggregateRef.aggregateKind
		};
		const reconcileReadModelAfterDispatchFailure = Effect.gen(function* () {
			const persistedEvents = yield* Stream.runCollect(eventStore.readFromSequence(dispatchStartSequence)).pipe(Effect.map((chunk) => Array.from(chunk)));
			if (persistedEvents.length === 0) return;
			let nextReadModel = readModel;
			for (const persistedEvent of persistedEvents) nextReadModel = yield* projectEvent(nextReadModel, persistedEvent);
			readModel = nextReadModel;
			for (const persistedEvent of persistedEvents) yield* PubSub.publish(eventPubSub, persistedEvent);
		});
		return Effect.exit(Effect.gen(function* () {
			yield* Effect.annotateCurrentSpan({
				"orchestration.command_id": envelope.command.commandId,
				"orchestration.command_type": envelope.command.type,
				"orchestration.aggregate_kind": aggregateRef.aggregateKind,
				"orchestration.aggregate_id": aggregateRef.aggregateId
			});
			const existingReceipt = yield* commandReceiptRepository.getByCommandId({ commandId: envelope.command.commandId });
			if (Option.isSome(existingReceipt)) {
				if (existingReceipt.value.status === "accepted") return { sequence: existingReceipt.value.resultSequence };
				return yield* new OrchestrationCommandPreviouslyRejectedError({
					commandId: envelope.command.commandId,
					detail: existingReceipt.value.error ?? "Previously rejected."
				});
			}
			const eventBase = yield* decideOrchestrationCommand({
				command: envelope.command,
				readModel
			});
			const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
			const committedCommand = yield* sql.withTransaction(Effect.gen(function* () {
				const committedEvents = [];
				let nextReadModel = readModel;
				for (const nextEvent of eventBases) {
					const savedEvent = yield* eventStore.append(nextEvent);
					nextReadModel = yield* projectEvent(nextReadModel, savedEvent);
					yield* projectionPipeline.projectEvent(savedEvent);
					committedEvents.push(savedEvent);
				}
				const lastSavedEvent = committedEvents.at(-1) ?? null;
				if (lastSavedEvent === null) return yield* new OrchestrationCommandInvariantError({
					commandType: envelope.command.type,
					detail: "Command produced no events."
				});
				yield* commandReceiptRepository.upsert({
					commandId: envelope.command.commandId,
					aggregateKind: lastSavedEvent.aggregateKind,
					aggregateId: lastSavedEvent.aggregateId,
					acceptedAt: lastSavedEvent.occurredAt,
					resultSequence: lastSavedEvent.sequence,
					status: "accepted",
					error: null
				});
				return {
					committedEvents,
					lastSequence: lastSavedEvent.sequence,
					nextReadModel
				};
			})).pipe(Effect.catchTag("SqlError", (sqlError) => Effect.fail(toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError))));
			readModel = committedCommand.nextReadModel;
			for (const [index, event] of committedCommand.committedEvents.entries()) {
				yield* PubSub.publish(eventPubSub, event);
				if (index === 0) yield* Metric.update(Metric.withAttributes(orchestrationCommandAckDuration, metricAttributes({
					...baseMetricAttributes,
					ackEventType: event.type
				})), Duration.millis(Math.max(0, Date.now() - envelope.startedAtMs)));
			}
			return { sequence: committedCommand.lastSequence };
		}).pipe(Effect.withSpan(`orchestration.command.${envelope.command.type}`))).pipe(Effect.flatMap((exit) => Effect.gen(function* () {
			const outcome = Exit.isSuccess(exit) ? "success" : Cause.hasInterruptsOnly(exit.cause) ? "interrupt" : "failure";
			yield* Metric.update(Metric.withAttributes(orchestrationCommandDuration, metricAttributes(baseMetricAttributes)), Duration.millis(Math.max(0, Date.now() - processingStartedAtMs)));
			yield* Metric.update(Metric.withAttributes(orchestrationCommandsTotal, metricAttributes({
				...baseMetricAttributes,
				outcome
			})), 1);
			if (Exit.isSuccess(exit)) {
				yield* Deferred.succeed(envelope.result, exit.value);
				return;
			}
			const error = Cause.squash(exit.cause);
			if (!Schema.is(OrchestrationCommandPreviouslyRejectedError)(error)) {
				yield* reconcileReadModelAfterDispatchFailure.pipe(Effect.catch(() => Effect.logWarning("failed to reconcile orchestration read model after dispatch failure").pipe(Effect.annotateLogs({
					commandId: envelope.command.commandId,
					snapshotSequence: readModel.snapshotSequence
				}))));
				if (Schema.is(OrchestrationCommandInvariantError)(error)) yield* commandReceiptRepository.upsert({
					commandId: envelope.command.commandId,
					aggregateKind: aggregateRef.aggregateKind,
					aggregateId: aggregateRef.aggregateId,
					acceptedAt: (/* @__PURE__ */ new Date()).toISOString(),
					resultSequence: readModel.snapshotSequence,
					status: "rejected",
					error: error.message
				}).pipe(Effect.catch(() => Effect.void));
			}
			yield* Deferred.fail(envelope.result, error);
		})));
	};
	yield* projectionPipeline.bootstrap;
	readModel = yield* projectionSnapshotQuery.getSnapshot();
	const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
	yield* Effect.forkScoped(worker);
	yield* Effect.logDebug("orchestration engine started").pipe(Effect.annotateLogs({ sequence: readModel.snapshotSequence }));
	const getReadModel = () => Effect.sync(() => readModel);
	const readEvents = (fromSequenceExclusive) => eventStore.readFromSequence(fromSequenceExclusive);
	const dispatch = (command) => Effect.gen(function* () {
		const result = yield* Deferred.make();
		yield* Queue.offer(commandQueue, {
			command,
			result,
			startedAtMs: Date.now()
		});
		return yield* Deferred.await(result);
	});
	return {
		getReadModel,
		readEvents,
		dispatch,
		get streamDomainEvents() {
			return Stream.fromPubSub(eventPubSub);
		}
	};
});
const OrchestrationEngineLive = Layer.effect(OrchestrationEngineService, makeOrchestrationEngine);

//#endregion
//#region src/persistence/Services/ProjectionPendingApprovals.ts
/**
* ProjectionPendingApprovalRepository - Repository interface for pending approvals.
*
* Owns persistence operations for projected approval requests awaiting user
* decisions.
*
* @module ProjectionPendingApprovalRepository
*/
const ProjectionPendingApproval = Schema.Struct({
	requestId: ApprovalRequestId,
	threadId: ThreadId,
	turnId: Schema.NullOr(TurnId),
	status: ProjectionPendingApprovalStatus,
	decision: ProjectionPendingApprovalDecision,
	createdAt: IsoDateTime,
	resolvedAt: Schema.NullOr(IsoDateTime)
});
const ListProjectionPendingApprovalsInput = Schema.Struct({ threadId: ThreadId });
const GetProjectionPendingApprovalInput = Schema.Struct({ requestId: ApprovalRequestId });
const DeleteProjectionPendingApprovalInput = Schema.Struct({ requestId: ApprovalRequestId });
/**
* ProjectionPendingApprovalRepository - Service tag for pending approval persistence.
*/
var ProjectionPendingApprovalRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionPendingApprovals/ProjectionPendingApprovalRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionProjects.ts
/**
* ProjectionProjectRepository - Projection repository interface for projects.
*
* Owns persistence operations for project rows in the orchestration projection
* read model.
*
* @module ProjectionProjectRepository
*/
const ProjectionProject = Schema.Struct({
	projectId: ProjectId,
	title: Schema.String,
	workspaceRoot: Schema.String,
	defaultModelSelection: Schema.NullOr(ModelSelection),
	scripts: Schema.Array(ProjectScript),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime)
});
const GetProjectionProjectInput = Schema.Struct({ projectId: ProjectId });
const DeleteProjectionProjectInput = Schema.Struct({ projectId: ProjectId });
/**
* ProjectionProjectRepository - Service tag for project projection persistence.
*/
var ProjectionProjectRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionProjects/ProjectionProjectRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionState.ts
/**
* ProjectionStateRepository - Projection repository interface for projector cursors.
*
* Owns persistence operations for projection cursor state used to resume
* incremental event projection.
*
* @module ProjectionStateRepository
*/
const ProjectionState = Schema.Struct({
	projector: Schema.String,
	lastAppliedSequence: NonNegativeInt,
	updatedAt: IsoDateTime
});
const GetProjectionStateInput = Schema.Struct({ projector: Schema.String });
/**
* ProjectionStateRepository - Service tag for projection cursor persistence.
*/
var ProjectionStateRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionState/ProjectionStateRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionThreadActivities.ts
/**
* ProjectionThreadActivityRepository - Projection repository interface for thread activity.
*
* Owns persistence operations for activity timeline entries projected from
* orchestration events.
*
* @module ProjectionThreadActivityRepository
*/
const ProjectionThreadActivity = Schema.Struct({
	activityId: EventId,
	threadId: ThreadId,
	turnId: Schema.NullOr(TurnId),
	tone: OrchestrationThreadActivityTone,
	kind: Schema.String,
	summary: Schema.String,
	payload: Schema.Unknown,
	sequence: Schema.optional(NonNegativeInt),
	createdAt: IsoDateTime
});
const ListProjectionThreadActivitiesInput = Schema.Struct({ threadId: ThreadId });
const DeleteProjectionThreadActivitiesInput = Schema.Struct({ threadId: ThreadId });
/**
* ProjectionThreadActivityRepository - Service tag for thread activity persistence.
*/
var ProjectionThreadActivityRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionThreadActivities/ProjectionThreadActivityRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionThreadMessages.ts
/**
* ProjectionThreadMessageRepository - Projection repository interface for messages.
*
* Owns persistence operations for projected thread messages rendered in the
* orchestration read model.
*
* @module ProjectionThreadMessageRepository
*/
const ProjectionThreadMessage = Schema.Struct({
	messageId: MessageId,
	threadId: ThreadId,
	turnId: Schema.NullOr(TurnId),
	role: OrchestrationMessageRole,
	text: Schema.String,
	attachments: Schema.optional(Schema.Array(ChatAttachment)),
	isStreaming: Schema.Boolean,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ListProjectionThreadMessagesInput = Schema.Struct({ threadId: ThreadId });
const GetProjectionThreadMessageInput = Schema.Struct({ messageId: MessageId });
const DeleteProjectionThreadMessagesInput = Schema.Struct({ threadId: ThreadId });
/**
* ProjectionThreadMessageRepository - Service tag for message projection persistence.
*/
var ProjectionThreadMessageRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionThreadMessages/ProjectionThreadMessageRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionThreadProposedPlans.ts
const ProjectionThreadProposedPlan = Schema.Struct({
	planId: OrchestrationProposedPlanId,
	threadId: ThreadId,
	turnId: Schema.NullOr(TurnId),
	planMarkdown: TrimmedNonEmptyString,
	implementedAt: Schema.NullOr(IsoDateTime),
	implementationThreadId: Schema.NullOr(ThreadId),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime
});
const ListProjectionThreadProposedPlansInput = Schema.Struct({ threadId: ThreadId });
const DeleteProjectionThreadProposedPlansInput = Schema.Struct({ threadId: ThreadId });
var ProjectionThreadProposedPlanRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionThreadProposedPlans/ProjectionThreadProposedPlanRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionThreadSessions.ts
/**
* ProjectionThreadSessionRepository - Repository interface for thread sessions.
*
* Owns persistence operations for projected provider-session linkage and
* runtime status for each thread.
*
* @module ProjectionThreadSessionRepository
*/
const ProjectionThreadSession = Schema.Struct({
	threadId: ThreadId,
	status: OrchestrationSessionStatus,
	providerName: Schema.NullOr(Schema.String),
	runtimeMode: RuntimeMode$1,
	activeTurnId: Schema.NullOr(TurnId),
	lastError: Schema.NullOr(Schema.String),
	updatedAt: IsoDateTime
});
const GetProjectionThreadSessionInput = Schema.Struct({ threadId: ThreadId });
const DeleteProjectionThreadSessionInput = Schema.Struct({ threadId: ThreadId });
/**
* ProjectionThreadSessionRepository - Service tag for thread-session persistence.
*/
var ProjectionThreadSessionRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionThreadSessions/ProjectionThreadSessionRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionTurns.ts
/**
* ProjectionTurnRepository - Projection repository interface for unified turn state.
*
* Owns persistence operations for pending starts, running/completed turn lifecycle,
* and checkpoint metadata in a single projection table.
*
* @module ProjectionTurnRepository
*/
const ProjectionTurnState = Schema.Literals([
	"pending",
	"running",
	"interrupted",
	"completed",
	"error"
]);
const ProjectionTurn = Schema.Struct({
	threadId: ThreadId,
	turnId: Schema.NullOr(TurnId),
	pendingMessageId: Schema.NullOr(MessageId),
	sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
	sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
	assistantMessageId: Schema.NullOr(MessageId),
	state: ProjectionTurnState,
	requestedAt: IsoDateTime,
	startedAt: Schema.NullOr(IsoDateTime),
	completedAt: Schema.NullOr(IsoDateTime),
	checkpointTurnCount: Schema.NullOr(NonNegativeInt),
	checkpointRef: Schema.NullOr(CheckpointRef),
	checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
	checkpointFiles: Schema.Array(OrchestrationCheckpointFile)
});
const ProjectionTurnById = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	pendingMessageId: Schema.NullOr(MessageId),
	sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
	sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
	assistantMessageId: Schema.NullOr(MessageId),
	state: ProjectionTurnState,
	requestedAt: IsoDateTime,
	startedAt: Schema.NullOr(IsoDateTime),
	completedAt: Schema.NullOr(IsoDateTime),
	checkpointTurnCount: Schema.NullOr(NonNegativeInt),
	checkpointRef: Schema.NullOr(CheckpointRef),
	checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
	checkpointFiles: Schema.Array(OrchestrationCheckpointFile)
});
const ProjectionPendingTurnStart = Schema.Struct({
	threadId: ThreadId,
	messageId: MessageId,
	sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
	sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
	requestedAt: IsoDateTime
});
const ListProjectionTurnsByThreadInput = Schema.Struct({ threadId: ThreadId });
const GetProjectionTurnByTurnIdInput = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId
});
const GetProjectionPendingTurnStartInput = Schema.Struct({ threadId: ThreadId });
const DeleteProjectionTurnsByThreadInput = Schema.Struct({ threadId: ThreadId });
const ClearCheckpointTurnConflictInput = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt
});
var ProjectionTurnRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionTurns/ProjectionTurnRepository") {};

//#endregion
//#region src/persistence/Services/ProjectionThreads.ts
/**
* ProjectionThreadRepository - Projection repository interface for threads.
*
* Owns persistence operations for projected thread records in the
* orchestration read model.
*
* @module ProjectionThreadRepository
*/
const ProjectionThread = Schema.Struct({
	threadId: ThreadId,
	projectId: ProjectId,
	title: Schema.String,
	modelSelection: ModelSelection,
	runtimeMode: RuntimeMode$1,
	interactionMode: ProviderInteractionMode,
	branch: Schema.NullOr(Schema.String),
	worktreePath: Schema.NullOr(Schema.String),
	latestTurnId: Schema.NullOr(TurnId),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	archivedAt: Schema.NullOr(IsoDateTime),
	deletedAt: Schema.NullOr(IsoDateTime)
});
const GetProjectionThreadInput = Schema.Struct({ threadId: ThreadId });
const DeleteProjectionThreadInput = Schema.Struct({ threadId: ThreadId });
const ListProjectionThreadsByProjectInput = Schema.Struct({ projectId: ProjectId });
/**
* ProjectionThreadRepository - Service tag for thread projection persistence.
*/
var ProjectionThreadRepository = class extends ServiceMap.Service()("t3/persistence/Services/ProjectionThreads/ProjectionThreadRepository") {};

//#endregion
//#region src/persistence/Layers/ProjectionPendingApprovals.ts
const makeProjectionPendingApprovalRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionPendingApprovalRow = SqlSchema.void({
		Request: ProjectionPendingApproval,
		execute: (row) => sql`
        INSERT INTO projection_pending_approvals (
          request_id,
          thread_id,
          turn_id,
          status,
          decision,
          created_at,
          resolved_at
        )
        VALUES (
          ${row.requestId},
          ${row.threadId},
          ${row.turnId},
          ${row.status},
          ${row.decision},
          ${row.createdAt},
          ${row.resolvedAt}
        )
        ON CONFLICT (request_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          status = excluded.status,
          decision = excluded.decision,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `
	});
	const listProjectionPendingApprovalRows = SqlSchema.findAll({
		Request: ListProjectionPendingApprovalsInput,
		Result: ProjectionPendingApproval,
		execute: ({ threadId }) => sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, request_id ASC
      `
	});
	const getProjectionPendingApprovalRow = SqlSchema.findOneOption({
		Request: GetProjectionPendingApprovalInput,
		Result: ProjectionPendingApproval,
		execute: ({ requestId }) => sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `
	});
	const deleteProjectionPendingApprovalRow = SqlSchema.void({
		Request: DeleteProjectionPendingApprovalInput,
		execute: ({ requestId }) => sql`
        DELETE FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `
	});
	const upsert = (row) => upsertProjectionPendingApprovalRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.upsert:query")));
	const listByThreadId = (input) => listProjectionPendingApprovalRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.listByThreadId:query")));
	const getByRequestId = (input) => getProjectionPendingApprovalRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.getByRequestId:query")));
	const deleteByRequestId = (input) => deleteProjectionPendingApprovalRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.deleteByRequestId:query")));
	return {
		upsert,
		listByThreadId,
		getByRequestId,
		deleteByRequestId
	};
});
const ProjectionPendingApprovalRepositoryLive = Layer.effect(ProjectionPendingApprovalRepository, makeProjectionPendingApprovalRepository);

//#endregion
//#region src/persistence/Layers/ProjectionProjects.ts
const ProjectionProjectDbRow = ProjectionProject.mapFields(Struct.assign({
	defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
	scripts: Schema.fromJsonString(Schema.Array(ProjectScript))
}));
const makeProjectionProjectRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionProjectRow = SqlSchema.void({
		Request: ProjectionProject,
		execute: (row) => sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.projectId},
          ${row.title},
          ${row.workspaceRoot},
          ${row.defaultModelSelection !== null ? JSON.stringify(row.defaultModelSelection) : null},
          ${JSON.stringify(row.scripts)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          title = excluded.title,
          workspace_root = excluded.workspace_root,
          default_model_selection_json = excluded.default_model_selection_json,
          scripts_json = excluded.scripts_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `
	});
	const getProjectionProjectRow = SqlSchema.findOneOption({
		Request: GetProjectionProjectInput,
		Result: ProjectionProjectDbRow,
		execute: ({ projectId }) => sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
      `
	});
	const listProjectionProjectRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionProjectDbRow,
		execute: () => sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `
	});
	const deleteProjectionProjectRow = SqlSchema.void({
		Request: DeleteProjectionProjectInput,
		execute: ({ projectId }) => sql`
        DELETE FROM projection_projects
        WHERE project_id = ${projectId}
      `
	});
	const upsert = (row) => upsertProjectionProjectRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.upsert:query")));
	const getById = (input) => getProjectionProjectRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.getById:query")));
	const listAll = () => listProjectionProjectRows().pipe(Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.listAll:query")));
	const deleteById = (input) => deleteProjectionProjectRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.deleteById:query")));
	return {
		upsert,
		getById,
		listAll,
		deleteById
	};
});
const ProjectionProjectRepositoryLive = Layer.effect(ProjectionProjectRepository, makeProjectionProjectRepository);

//#endregion
//#region src/persistence/Layers/ProjectionState.ts
const MinLastAppliedSequenceRowSchema = Schema.Struct({ minLastAppliedSequence: Schema.NullOr(NonNegativeInt) });
const makeProjectionStateRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionStateRow = SqlSchema.void({
		Request: ProjectionState,
		execute: (row) => sql`
        INSERT INTO projection_state (
          projector,
          last_applied_sequence,
          updated_at
        )
        VALUES (
          ${row.projector},
          ${row.lastAppliedSequence},
          ${row.updatedAt}
        )
        ON CONFLICT (projector)
        DO UPDATE SET
          last_applied_sequence = excluded.last_applied_sequence,
          updated_at = excluded.updated_at
      `
	});
	const getProjectionStateRow = SqlSchema.findOneOption({
		Request: GetProjectionStateInput,
		Result: ProjectionState,
		execute: ({ projector }) => sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
        WHERE projector = ${projector}
      `
	});
	const listProjectionStateRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionState,
		execute: () => sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
        ORDER BY projector ASC
      `
	});
	const readMinLastAppliedSequence = SqlSchema.findOne({
		Request: Schema.Void,
		Result: MinLastAppliedSequenceRowSchema,
		execute: () => sql`
        SELECT
          MIN(last_applied_sequence) AS "minLastAppliedSequence"
        FROM projection_state
      `
	});
	const upsert = (row) => upsertProjectionStateRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.upsert:query")));
	const getByProjector = (input) => getProjectionStateRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.getByProjector:query")));
	const listAll = () => listProjectionStateRows(void 0).pipe(Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.listAll:query")));
	const minLastAppliedSequence = () => readMinLastAppliedSequence(void 0).pipe(Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.minLastAppliedSequence:query")), Effect.map((row) => row.minLastAppliedSequence));
	return {
		upsert,
		getByProjector,
		listAll,
		minLastAppliedSequence
	};
});
const ProjectionStateRepositoryLive = Layer.effect(ProjectionStateRepository, makeProjectionStateRepository);

//#endregion
//#region src/persistence/Layers/ProjectionThreadActivities.ts
const ProjectionThreadActivityDbRowSchema$1 = ProjectionThreadActivity.mapFields(Struct.assign({
	payload: Schema.fromJsonString(Schema.Unknown),
	sequence: Schema.NullOr(NonNegativeInt)
}));
function toPersistenceSqlOrDecodeError$3(sqlOperation, decodeOperation) {
	return (cause) => Schema.isSchemaError(cause) ? toPersistenceDecodeError(decodeOperation)(cause) : toPersistenceSqlError(sqlOperation)(cause);
}
const makeProjectionThreadActivityRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionThreadActivityRow = SqlSchema.void({
		Request: ProjectionThreadActivity,
		execute: (row) => sql`
            INSERT INTO projection_thread_activities (
              activity_id,
              thread_id,
              turn_id,
              tone,
              kind,
              summary,
              payload_json,
              sequence,
              created_at
            )
            VALUES (
              ${row.activityId},
              ${row.threadId},
              ${row.turnId},
              ${row.tone},
              ${row.kind},
              ${row.summary},
              ${JSON.stringify(row.payload)},
              ${row.sequence ?? null},
              ${row.createdAt}
            )
            ON CONFLICT (activity_id)
            DO UPDATE SET
              thread_id = excluded.thread_id,
              turn_id = excluded.turn_id,
              tone = excluded.tone,
              kind = excluded.kind,
              summary = excluded.summary,
              payload_json = excluded.payload_json,
              sequence = excluded.sequence,
              created_at = excluded.created_at
          `
	});
	const listProjectionThreadActivityRows = SqlSchema.findAll({
		Request: ListProjectionThreadActivitiesInput,
		Result: ProjectionThreadActivityDbRowSchema$1,
		execute: ({ threadId }) => sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `
	});
	const deleteProjectionThreadActivityRows = SqlSchema.void({
		Request: DeleteProjectionThreadActivitiesInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id = ${threadId}
      `
	});
	const upsert = (row) => upsertProjectionThreadActivityRow(row).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$3("ProjectionThreadActivityRepository.upsert:query", "ProjectionThreadActivityRepository.upsert:encodeRequest")));
	const listByThreadId = (input) => listProjectionThreadActivityRows(input).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$3("ProjectionThreadActivityRepository.listByThreadId:query", "ProjectionThreadActivityRepository.listByThreadId:decodeRows")), Effect.map((rows) => rows.map((row) => ({
		activityId: row.activityId,
		threadId: row.threadId,
		turnId: row.turnId,
		tone: row.tone,
		kind: row.kind,
		summary: row.summary,
		payload: row.payload,
		...row.sequence !== null ? { sequence: row.sequence } : {},
		createdAt: row.createdAt
	}))));
	const deleteByThreadId = (input) => deleteProjectionThreadActivityRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadActivityRepository.deleteByThreadId:query")));
	return {
		upsert,
		listByThreadId,
		deleteByThreadId
	};
});
const ProjectionThreadActivityRepositoryLive = Layer.effect(ProjectionThreadActivityRepository, makeProjectionThreadActivityRepository);

//#endregion
//#region src/persistence/Layers/ProjectionThreadMessages.ts
const ProjectionThreadMessageDbRowSchema$1 = ProjectionThreadMessage.mapFields(Struct.assign({
	isStreaming: Schema.Number,
	attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment)))
}));
function toProjectionThreadMessage(row) {
	return {
		messageId: row.messageId,
		threadId: row.threadId,
		turnId: row.turnId,
		role: row.role,
		text: row.text,
		isStreaming: row.isStreaming === 1,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...row.attachments !== null ? { attachments: row.attachments } : {}
	};
}
const makeProjectionThreadMessageRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionThreadMessageRow = SqlSchema.void({
		Request: ProjectionThreadMessage,
		execute: (row) => {
			const nextAttachmentsJson = row.attachments !== void 0 ? JSON.stringify(row.attachments) : null;
			return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.isStreaming ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          is_streaming = excluded.is_streaming,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
		}
	});
	const getProjectionThreadMessageRow = SqlSchema.findOneOption({
		Request: GetProjectionThreadMessageInput,
		Result: ProjectionThreadMessageDbRowSchema$1,
		execute: ({ messageId }) => sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `
	});
	const listProjectionThreadMessageRows = SqlSchema.findAll({
		Request: ListProjectionThreadMessagesInput,
		Result: ProjectionThreadMessageDbRowSchema$1,
		execute: ({ threadId }) => sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `
	});
	const deleteProjectionThreadMessageRows = SqlSchema.void({
		Request: DeleteProjectionThreadMessagesInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `
	});
	const upsert = (row) => upsertProjectionThreadMessageRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.upsert:query")));
	const getByMessageId = (input) => getProjectionThreadMessageRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.getByMessageId:query")), Effect.map(Option.map(toProjectionThreadMessage)));
	const listByThreadId = (input) => listProjectionThreadMessageRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.listByThreadId:query")), Effect.map((rows) => rows.map(toProjectionThreadMessage)));
	const deleteByThreadId = (input) => deleteProjectionThreadMessageRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByThreadId:query")));
	return {
		upsert,
		getByMessageId,
		listByThreadId,
		deleteByThreadId
	};
});
const ProjectionThreadMessageRepositoryLive = Layer.effect(ProjectionThreadMessageRepository, makeProjectionThreadMessageRepository);

//#endregion
//#region src/persistence/Layers/ProjectionThreadProposedPlans.ts
const makeProjectionThreadProposedPlanRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionThreadProposedPlanRow = SqlSchema.void({
		Request: ProjectionThreadProposedPlan,
		execute: (row) => sql`
      INSERT INTO projection_thread_proposed_plans (
        plan_id,
        thread_id,
        turn_id,
        plan_markdown,
        implemented_at,
        implementation_thread_id,
        created_at,
        updated_at
      )
      VALUES (
        ${row.planId},
        ${row.threadId},
        ${row.turnId},
        ${row.planMarkdown},
        ${row.implementedAt},
        ${row.implementationThreadId},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (plan_id)
      DO UPDATE SET
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        plan_markdown = excluded.plan_markdown,
        implemented_at = excluded.implemented_at,
        implementation_thread_id = excluded.implementation_thread_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `
	});
	const listProjectionThreadProposedPlanRows = SqlSchema.findAll({
		Request: ListProjectionThreadProposedPlansInput,
		Result: ProjectionThreadProposedPlan,
		execute: ({ threadId }) => sql`
      SELECT
        plan_id AS "planId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        plan_markdown AS "planMarkdown",
        implemented_at AS "implementedAt",
        implementation_thread_id AS "implementationThreadId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_proposed_plans
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC, plan_id ASC
    `
	});
	const deleteProjectionThreadProposedPlanRows = SqlSchema.void({
		Request: DeleteProjectionThreadProposedPlansInput,
		execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_proposed_plans
      WHERE thread_id = ${threadId}
    `
	});
	const upsert = (row) => upsertProjectionThreadProposedPlanRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadProposedPlanRepository.upsert:query")));
	const listByThreadId = (input) => listProjectionThreadProposedPlanRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadProposedPlanRepository.listByThreadId:query")));
	const deleteByThreadId = (input) => deleteProjectionThreadProposedPlanRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadProposedPlanRepository.deleteByThreadId:query")));
	return {
		upsert,
		listByThreadId,
		deleteByThreadId
	};
});
const ProjectionThreadProposedPlanRepositoryLive = Layer.effect(ProjectionThreadProposedPlanRepository, makeProjectionThreadProposedPlanRepository);

//#endregion
//#region src/persistence/Layers/ProjectionThreadSessions.ts
const makeProjectionThreadSessionRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionThreadSessionRow = SqlSchema.void({
		Request: ProjectionThreadSession,
		execute: (row) => sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.status},
          ${row.providerName},
          ${row.runtimeMode},
          ${row.activeTurnId},
          ${row.lastError},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          status = excluded.status,
          provider_name = excluded.provider_name,
          runtime_mode = excluded.runtime_mode,
          active_turn_id = excluded.active_turn_id,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `
	});
	const getProjectionThreadSessionRow = SqlSchema.findOneOption({
		Request: GetProjectionThreadSessionInput,
		Result: ProjectionThreadSession,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
      `
	});
	const deleteProjectionThreadSessionRow = SqlSchema.void({
		Request: DeleteProjectionThreadSessionInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
      `
	});
	const upsert = (row) => upsertProjectionThreadSessionRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadSessionRepository.upsert:query")));
	const getByThreadId = (input) => getProjectionThreadSessionRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadSessionRepository.getByThreadId:query")));
	const deleteByThreadId = (input) => deleteProjectionThreadSessionRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadSessionRepository.deleteByThreadId:query")));
	return {
		upsert,
		getByThreadId,
		deleteByThreadId
	};
});
const ProjectionThreadSessionRepositoryLive = Layer.effect(ProjectionThreadSessionRepository, makeProjectionThreadSessionRepository);

//#endregion
//#region src/persistence/Layers/ProjectionTurns.ts
const ProjectionTurnDbRowSchema = ProjectionTurn.mapFields(Struct.assign({ checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)) }));
const ProjectionTurnByIdDbRowSchema = ProjectionTurnById.mapFields(Struct.assign({ checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)) }));
function toPersistenceSqlOrDecodeError$2(sqlOperation, decodeOperation) {
	return (cause) => Schema.isSchemaError(cause) ? toPersistenceDecodeError(decodeOperation)(cause) : toPersistenceSqlError(sqlOperation)(cause);
}
const makeProjectionTurnRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionTurnById = SqlSchema.void({
		Request: ProjectionTurnByIdDbRowSchema,
		execute: (row) => sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.pendingMessageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.assistantMessageId},
          ${row.state},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.checkpointStatus},
          ${row.checkpointFiles}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          pending_message_id = excluded.pending_message_id,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `
	});
	const clearPendingProjectionTurnsByThread = SqlSchema.void({
		Request: DeleteProjectionTurnsByThreadInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND checkpoint_turn_count IS NULL
      `
	});
	const insertPendingProjectionTurn = SqlSchema.void({
		Request: ProjectionPendingTurnStart,
		execute: (row) => sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          ${row.threadId},
          NULL,
          ${row.messageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          NULL,
          'pending',
          ${row.requestedAt},
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '[]'
        )
      `
	});
	const getPendingProjectionTurn = SqlSchema.findOneOption({
		Request: GetProjectionPendingTurnStartInput,
		Result: ProjectionPendingTurnStart,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          pending_message_id AS "messageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND pending_message_id IS NOT NULL
          AND checkpoint_turn_count IS NULL
        ORDER BY requested_at DESC
        LIMIT 1
      `
	});
	const listProjectionTurnsByThread = SqlSchema.findAll({
		Request: ListProjectionTurnsByThreadInput,
		Result: ProjectionTurnDbRowSchema,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE
            WHEN checkpoint_turn_count IS NULL THEN 1
            ELSE 0
          END ASC,
          checkpoint_turn_count ASC,
          requested_at ASC,
          turn_id ASC
      `
	});
	const getProjectionTurnByTurnId = SqlSchema.findOneOption({
		Request: GetProjectionTurnByTurnIdInput,
		Result: ProjectionTurnByIdDbRowSchema,
		execute: ({ threadId, turnId }) => sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
        LIMIT 1
      `
	});
	const clearCheckpointTurnConflictRow = SqlSchema.void({
		Request: ClearCheckpointTurnConflictInput,
		execute: ({ threadId, turnId, checkpointTurnCount }) => sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
          AND (turn_id IS NULL OR turn_id <> ${turnId})
      `
	});
	const deleteProjectionTurnsByThread = SqlSchema.void({
		Request: DeleteProjectionTurnsByThreadInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
      `
	});
	const upsertByTurnId = (row) => upsertProjectionTurnById(row).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$2("ProjectionTurnRepository.upsertByTurnId:query", "ProjectionTurnRepository.upsertByTurnId:encodeRequest")));
	const replacePendingTurnStart = (row) => sql.withTransaction(clearPendingProjectionTurnsByThread({ threadId: row.threadId }).pipe(Effect.flatMap(() => insertPendingProjectionTurn(row)))).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$2("ProjectionTurnRepository.replacePendingTurnStart:query", "ProjectionTurnRepository.replacePendingTurnStart:encodeRequest")));
	const getPendingTurnStartByThreadId = (input) => getPendingProjectionTurn(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.getPendingTurnStartByThreadId:query")));
	const deletePendingTurnStartByThreadId = (input) => clearPendingProjectionTurnsByThread(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.deletePendingTurnStartByThreadId:query")));
	const listByThreadId = (input) => listProjectionTurnsByThread(input).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$2("ProjectionTurnRepository.listByThreadId:query", "ProjectionTurnRepository.listByThreadId:decodeRows")), Effect.map((rows) => rows));
	const getByTurnId = (input) => getProjectionTurnByTurnId(input).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$2("ProjectionTurnRepository.getByTurnId:query", "ProjectionTurnRepository.getByTurnId:decodeRow")), Effect.flatMap((rowOption) => Option.match(rowOption, {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => Effect.succeed(Option.some(row))
	})));
	const clearCheckpointTurnConflict = (input) => clearCheckpointTurnConflictRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.clearCheckpointTurnConflict:query")));
	const deleteByThreadId = (input) => deleteProjectionTurnsByThread(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.deleteByThreadId:query")));
	return {
		upsertByTurnId,
		replacePendingTurnStart,
		getPendingTurnStartByThreadId,
		deletePendingTurnStartByThreadId,
		listByThreadId,
		getByTurnId,
		clearCheckpointTurnConflict,
		deleteByThreadId
	};
});
const ProjectionTurnRepositoryLive = Layer.effect(ProjectionTurnRepository, makeProjectionTurnRepository);

//#endregion
//#region src/persistence/Layers/ProjectionThreads.ts
const ProjectionThreadDbRow = ProjectionThread.mapFields(Struct.assign({ modelSelection: Schema.fromJsonString(ModelSelection) }));
const makeProjectionThreadRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertProjectionThreadRow = SqlSchema.void({
		Request: ProjectionThread,
		execute: (row) => sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.branch},
          ${row.worktreePath},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          deleted_at = excluded.deleted_at
      `
	});
	const getProjectionThreadRow = SqlSchema.findOneOption({
		Request: GetProjectionThreadInput,
		Result: ProjectionThreadDbRow,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `
	});
	const listProjectionThreadRows = SqlSchema.findAll({
		Request: ListProjectionThreadsByProjectInput,
		Result: ProjectionThreadDbRow,
		execute: ({ projectId }) => sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, thread_id ASC
      `
	});
	const deleteProjectionThreadRow = SqlSchema.void({
		Request: DeleteProjectionThreadInput,
		execute: ({ threadId }) => sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${threadId}
      `
	});
	const upsert = (row) => upsertProjectionThreadRow(row).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.upsert:query")));
	const getById = (input) => getProjectionThreadRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.getById:query")));
	const listByProjectId = (input) => listProjectionThreadRows(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listByProjectId:query")));
	const deleteById = (input) => deleteProjectionThreadRow(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.deleteById:query")));
	return {
		upsert,
		getById,
		listByProjectId,
		deleteById
	};
});
const ProjectionThreadRepositoryLive = Layer.effect(ProjectionThreadRepository, makeProjectionThreadRepository);

//#endregion
//#region src/orchestration/Layers/ProjectionPipeline.ts
const ORCHESTRATION_PROJECTOR_NAMES = {
	projects: "projection.projects",
	threads: "projection.threads",
	threadMessages: "projection.thread-messages",
	threadProposedPlans: "projection.thread-proposed-plans",
	threadActivities: "projection.thread-activities",
	threadSessions: "projection.thread-sessions",
	threadTurns: "projection.thread-turns",
	checkpoints: "projection.checkpoints",
	pendingApprovals: "projection.pending-approvals"
};
const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")((input) => Effect.succeed(input.attachments.length === 0 ? [] : input.attachments));
function extractActivityRequestId(payload) {
	if (typeof payload !== "object" || payload === null) return null;
	const requestId = payload.requestId;
	return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}
function retainProjectionMessagesAfterRevert(messages, turns, turnCount) {
	const retainedMessageIds = /* @__PURE__ */ new Set();
	const retainedTurnIds = /* @__PURE__ */ new Set();
	const keptTurns = turns.filter((turn) => turn.turnId !== null && turn.checkpointTurnCount !== null && turn.checkpointTurnCount <= turnCount);
	for (const turn of keptTurns) {
		if (turn.turnId !== null) retainedTurnIds.add(turn.turnId);
		if (turn.pendingMessageId !== null) retainedMessageIds.add(turn.pendingMessageId);
		if (turn.assistantMessageId !== null) retainedMessageIds.add(turn.assistantMessageId);
	}
	for (const message of messages) {
		if (message.role === "system") {
			retainedMessageIds.add(message.messageId);
			continue;
		}
		if (message.turnId !== null && retainedTurnIds.has(message.turnId)) retainedMessageIds.add(message.messageId);
	}
	const retainedUserCount = messages.filter((message) => message.role === "user" && retainedMessageIds.has(message.messageId)).length;
	const missingUserCount = Math.max(0, turnCount - retainedUserCount);
	if (missingUserCount > 0) {
		const fallbackUserMessages = messages.filter((message) => message.role === "user" && !retainedMessageIds.has(message.messageId) && (message.turnId === null || retainedTurnIds.has(message.turnId))).toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId)).slice(0, missingUserCount);
		for (const message of fallbackUserMessages) retainedMessageIds.add(message.messageId);
	}
	const retainedAssistantCount = messages.filter((message) => message.role === "assistant" && retainedMessageIds.has(message.messageId)).length;
	const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
	if (missingAssistantCount > 0) {
		const fallbackAssistantMessages = messages.filter((message) => message.role === "assistant" && !retainedMessageIds.has(message.messageId) && (message.turnId === null || retainedTurnIds.has(message.turnId))).toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId)).slice(0, missingAssistantCount);
		for (const message of fallbackAssistantMessages) retainedMessageIds.add(message.messageId);
	}
	return messages.filter((message) => retainedMessageIds.has(message.messageId));
}
function retainProjectionActivitiesAfterRevert(activities, turns, turnCount) {
	const retainedTurnIds = new Set(turns.filter((turn) => turn.turnId !== null && turn.checkpointTurnCount !== null && turn.checkpointTurnCount <= turnCount).flatMap((turn) => turn.turnId === null ? [] : [turn.turnId]));
	return activities.filter((activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId));
}
function retainProjectionProposedPlansAfterRevert(proposedPlans, turns, turnCount) {
	const retainedTurnIds = new Set(turns.filter((turn) => turn.turnId !== null && turn.checkpointTurnCount !== null && turn.checkpointTurnCount <= turnCount).flatMap((turn) => turn.turnId === null ? [] : [turn.turnId]));
	return proposedPlans.filter((proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId));
}
function collectThreadAttachmentRelativePaths(threadId, messages) {
	const threadSegment = toSafeThreadAttachmentSegment(threadId);
	if (!threadSegment) return /* @__PURE__ */ new Set();
	const relativePaths = /* @__PURE__ */ new Set();
	for (const message of messages) for (const attachment of message.attachments ?? []) {
		if (attachment.type !== "image") continue;
		const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
		if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) continue;
		relativePaths.add(attachmentRelativePath(attachment));
	}
	return relativePaths;
}
const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (sideEffects) {
	const serverConfig = yield* Effect.service(ServerConfig);
	const fileSystem = yield* Effect.service(FileSystem.FileSystem);
	const path = yield* Effect.service(Path.Path);
	const attachmentsRootDir = serverConfig.attachmentsDir;
	const readAttachmentRootEntries = fileSystem.readDirectory(attachmentsRootDir, { recursive: false }).pipe(Effect.catch(() => Effect.succeed([])));
	const removeDeletedThreadAttachmentEntry = Effect.fn("removeDeletedThreadAttachmentEntry")(function* (threadSegment, entry) {
		const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
		if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) return;
		const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
		if (!attachmentId) return;
		const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
		if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) return;
		yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), { force: true });
	});
	const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (threadId) {
		const threadSegment = toSafeThreadAttachmentSegment(threadId);
		if (!threadSegment) {
			yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", { threadId });
			return;
		}
		const entries = yield* readAttachmentRootEntries;
		yield* Effect.forEach(entries, (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry), { concurrency: 1 });
	});
	const pruneThreadAttachmentEntry = Effect.fn("pruneThreadAttachmentEntry")(function* (threadSegment, keptThreadRelativePaths, entry) {
		const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
		if (relativePath.length === 0 || relativePath.includes("/")) return;
		const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
		if (!attachmentId) return;
		const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
		if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) return;
		const absolutePath = path.join(attachmentsRootDir, relativePath);
		const fileInfo = yield* fileSystem.stat(absolutePath).pipe(Effect.catch(() => Effect.succeed(null)));
		if (!fileInfo || fileInfo.type !== "File") return;
		if (!keptThreadRelativePaths.has(relativePath)) yield* fileSystem.remove(absolutePath, { force: true });
	});
	const pruneThreadAttachments = Effect.fn("pruneThreadAttachments")(function* (threadId, keptThreadRelativePaths) {
		if (sideEffects.deletedThreadIds.has(threadId)) return;
		const threadSegment = toSafeThreadAttachmentSegment(threadId);
		if (!threadSegment) {
			yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
			return;
		}
		const entries = yield* readAttachmentRootEntries;
		yield* Effect.forEach(entries, (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry), { concurrency: 1 });
	});
	yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, { concurrency: 1 });
	yield* Effect.forEach(sideEffects.prunedThreadRelativePaths.entries(), ([threadId, keptThreadRelativePaths]) => pruneThreadAttachments(threadId, keptThreadRelativePaths), { concurrency: 1 });
});
const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(function* () {
	const sql = yield* SqlClient.SqlClient;
	const eventStore = yield* OrchestrationEventStore;
	const projectionStateRepository = yield* ProjectionStateRepository;
	const projectionProjectRepository = yield* ProjectionProjectRepository;
	const projectionThreadRepository = yield* ProjectionThreadRepository;
	const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
	const projectionThreadProposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
	const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
	const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
	const projectionTurnRepository = yield* ProjectionTurnRepository;
	const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const serverConfig = yield* ServerConfig;
	const applyProjectsProjection = Effect.fn("applyProjectsProjection")(function* (event, _attachmentSideEffects) {
		switch (event.type) {
			case "project.created":
				yield* projectionProjectRepository.upsert({
					projectId: event.payload.projectId,
					title: event.payload.title,
					workspaceRoot: event.payload.workspaceRoot,
					defaultModelSelection: event.payload.defaultModelSelection,
					scripts: event.payload.scripts,
					createdAt: event.payload.createdAt,
					updatedAt: event.payload.updatedAt,
					deletedAt: null
				});
				return;
			case "project.meta-updated": {
				const existingRow = yield* projectionProjectRepository.getById({ projectId: event.payload.projectId });
				if (Option.isNone(existingRow)) return;
				yield* projectionProjectRepository.upsert({
					...existingRow.value,
					...event.payload.title !== void 0 ? { title: event.payload.title } : {},
					...event.payload.workspaceRoot !== void 0 ? { workspaceRoot: event.payload.workspaceRoot } : {},
					...event.payload.defaultModelSelection !== void 0 ? { defaultModelSelection: event.payload.defaultModelSelection } : {},
					...event.payload.scripts !== void 0 ? { scripts: event.payload.scripts } : {},
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "project.deleted": {
				const existingRow = yield* projectionProjectRepository.getById({ projectId: event.payload.projectId });
				if (Option.isNone(existingRow)) return;
				yield* projectionProjectRepository.upsert({
					...existingRow.value,
					deletedAt: event.payload.deletedAt,
					updatedAt: event.payload.deletedAt
				});
				return;
			}
			default: return;
		}
	});
	const applyThreadsProjection = Effect.fn("applyThreadsProjection")(function* (event, attachmentSideEffects) {
		switch (event.type) {
			case "thread.created":
				yield* projectionThreadRepository.upsert({
					threadId: event.payload.threadId,
					projectId: event.payload.projectId,
					title: event.payload.title,
					modelSelection: event.payload.modelSelection,
					runtimeMode: event.payload.runtimeMode,
					interactionMode: event.payload.interactionMode,
					branch: event.payload.branch,
					worktreePath: event.payload.worktreePath,
					latestTurnId: null,
					createdAt: event.payload.createdAt,
					updatedAt: event.payload.updatedAt,
					archivedAt: null,
					deletedAt: null
				});
				return;
			case "thread.archived": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					archivedAt: event.payload.archivedAt,
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.unarchived": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					archivedAt: null,
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.meta-updated": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					...event.payload.title !== void 0 ? { title: event.payload.title } : {},
					...event.payload.modelSelection !== void 0 ? { modelSelection: event.payload.modelSelection } : {},
					...event.payload.branch !== void 0 ? { branch: event.payload.branch } : {},
					...event.payload.worktreePath !== void 0 ? { worktreePath: event.payload.worktreePath } : {},
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.runtime-mode-set": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					runtimeMode: event.payload.runtimeMode,
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.interaction-mode-set": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					interactionMode: event.payload.interactionMode,
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.deleted": {
				attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					deletedAt: event.payload.deletedAt,
					updatedAt: event.payload.deletedAt
				});
				return;
			}
			case "thread.message-sent":
			case "thread.proposed-plan-upserted":
			case "thread.activity-appended": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					updatedAt: event.occurredAt
				});
				return;
			}
			case "thread.session-set": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					latestTurnId: event.payload.session.activeTurnId,
					updatedAt: event.occurredAt
				});
				return;
			}
			case "thread.turn-diff-completed": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					latestTurnId: event.payload.turnId,
					updatedAt: event.occurredAt
				});
				return;
			}
			case "thread.reverted": {
				const existingRow = yield* projectionThreadRepository.getById({ threadId: event.payload.threadId });
				if (Option.isNone(existingRow)) return;
				yield* projectionThreadRepository.upsert({
					...existingRow.value,
					latestTurnId: null,
					updatedAt: event.occurredAt
				});
				return;
			}
			default: return;
		}
	});
	const applyThreadMessagesProjection = Effect.fn("applyThreadMessagesProjection")(function* (event, attachmentSideEffects) {
		switch (event.type) {
			case "thread.message-sent": {
				const existingMessage = yield* projectionThreadMessageRepository.getByMessageId({ messageId: event.payload.messageId });
				const previousMessage = Option.getOrUndefined(existingMessage);
				const nextText = Option.match(existingMessage, {
					onNone: () => event.payload.text,
					onSome: (message) => {
						if (event.payload.streaming) return `${message.text}${event.payload.text}`;
						if (event.payload.text.length === 0) return message.text;
						return event.payload.text;
					}
				});
				const nextAttachments = event.payload.attachments !== void 0 ? yield* materializeAttachmentsForProjection({ attachments: event.payload.attachments }) : previousMessage?.attachments;
				yield* projectionThreadMessageRepository.upsert({
					messageId: event.payload.messageId,
					threadId: event.payload.threadId,
					turnId: event.payload.turnId,
					role: event.payload.role,
					text: nextText,
					...nextAttachments !== void 0 ? { attachments: [...nextAttachments] } : {},
					isStreaming: event.payload.streaming,
					createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
					updatedAt: event.payload.updatedAt
				});
				return;
			}
			case "thread.reverted": {
				const existingRows = yield* projectionThreadMessageRepository.listByThreadId({ threadId: event.payload.threadId });
				if (existingRows.length === 0) return;
				const keptRows = retainProjectionMessagesAfterRevert(existingRows, yield* projectionTurnRepository.listByThreadId({ threadId: event.payload.threadId }), event.payload.turnCount);
				if (keptRows.length === existingRows.length) return;
				yield* projectionThreadMessageRepository.deleteByThreadId({ threadId: event.payload.threadId });
				yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert, { concurrency: 1 }).pipe(Effect.asVoid);
				attachmentSideEffects.prunedThreadRelativePaths.set(event.payload.threadId, collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows));
				return;
			}
			default: return;
		}
	});
	const applyThreadProposedPlansProjection = Effect.fn("applyThreadProposedPlansProjection")(function* (event, _attachmentSideEffects) {
		switch (event.type) {
			case "thread.proposed-plan-upserted":
				yield* projectionThreadProposedPlanRepository.upsert({
					planId: event.payload.proposedPlan.id,
					threadId: event.payload.threadId,
					turnId: event.payload.proposedPlan.turnId,
					planMarkdown: event.payload.proposedPlan.planMarkdown,
					implementedAt: event.payload.proposedPlan.implementedAt,
					implementationThreadId: event.payload.proposedPlan.implementationThreadId,
					createdAt: event.payload.proposedPlan.createdAt,
					updatedAt: event.payload.proposedPlan.updatedAt
				});
				return;
			case "thread.reverted": {
				const existingRows = yield* projectionThreadProposedPlanRepository.listByThreadId({ threadId: event.payload.threadId });
				if (existingRows.length === 0) return;
				const keptRows = retainProjectionProposedPlansAfterRevert(existingRows, yield* projectionTurnRepository.listByThreadId({ threadId: event.payload.threadId }), event.payload.turnCount);
				if (keptRows.length === existingRows.length) return;
				yield* projectionThreadProposedPlanRepository.deleteByThreadId({ threadId: event.payload.threadId });
				yield* Effect.forEach(keptRows, projectionThreadProposedPlanRepository.upsert, { concurrency: 1 }).pipe(Effect.asVoid);
				return;
			}
			default: return;
		}
	});
	const applyThreadActivitiesProjection = Effect.fn("applyThreadActivitiesProjection")(function* (event, _attachmentSideEffects) {
		switch (event.type) {
			case "thread.activity-appended":
				yield* projectionThreadActivityRepository.upsert({
					activityId: event.payload.activity.id,
					threadId: event.payload.threadId,
					turnId: event.payload.activity.turnId,
					tone: event.payload.activity.tone,
					kind: event.payload.activity.kind,
					summary: event.payload.activity.summary,
					payload: event.payload.activity.payload,
					...event.payload.activity.sequence !== void 0 ? { sequence: event.payload.activity.sequence } : {},
					createdAt: event.payload.activity.createdAt
				});
				return;
			case "thread.reverted": {
				const existingRows = yield* projectionThreadActivityRepository.listByThreadId({ threadId: event.payload.threadId });
				if (existingRows.length === 0) return;
				const keptRows = retainProjectionActivitiesAfterRevert(existingRows, yield* projectionTurnRepository.listByThreadId({ threadId: event.payload.threadId }), event.payload.turnCount);
				if (keptRows.length === existingRows.length) return;
				yield* projectionThreadActivityRepository.deleteByThreadId({ threadId: event.payload.threadId });
				yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert, { concurrency: 1 }).pipe(Effect.asVoid);
				return;
			}
			default: return;
		}
	});
	const applyThreadSessionsProjection = Effect.fn("applyThreadSessionsProjection")(function* (event, _attachmentSideEffects) {
		if (event.type !== "thread.session-set") return;
		yield* projectionThreadSessionRepository.upsert({
			threadId: event.payload.threadId,
			status: event.payload.session.status,
			providerName: event.payload.session.providerName,
			runtimeMode: event.payload.session.runtimeMode,
			activeTurnId: event.payload.session.activeTurnId,
			lastError: event.payload.session.lastError,
			updatedAt: event.payload.session.updatedAt
		});
	});
	const applyThreadTurnsProjection = Effect.fn("applyThreadTurnsProjection")(function* (event, _attachmentSideEffects) {
		switch (event.type) {
			case "thread.turn-start-requested":
				yield* projectionTurnRepository.replacePendingTurnStart({
					threadId: event.payload.threadId,
					messageId: event.payload.messageId,
					sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
					sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
					requestedAt: event.payload.createdAt
				});
				return;
			case "thread.session-set": {
				const turnId = event.payload.session.activeTurnId;
				if (turnId === null || event.payload.session.status !== "running") return;
				const existingTurn = yield* projectionTurnRepository.getByTurnId({
					threadId: event.payload.threadId,
					turnId
				});
				const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({ threadId: event.payload.threadId });
				if (Option.isSome(existingTurn)) {
					const nextState = existingTurn.value.state === "completed" || existingTurn.value.state === "error" ? existingTurn.value.state : "running";
					yield* projectionTurnRepository.upsertByTurnId({
						...existingTurn.value,
						state: nextState,
						pendingMessageId: existingTurn.value.pendingMessageId ?? (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
						sourceProposedPlanThreadId: existingTurn.value.sourceProposedPlanThreadId ?? (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.sourceProposedPlanThreadId : null),
						sourceProposedPlanId: existingTurn.value.sourceProposedPlanId ?? (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.sourceProposedPlanId : null),
						startedAt: existingTurn.value.startedAt ?? (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.requestedAt : event.occurredAt),
						requestedAt: existingTurn.value.requestedAt ?? (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.requestedAt : event.occurredAt)
					});
				} else yield* projectionTurnRepository.upsertByTurnId({
					turnId,
					threadId: event.payload.threadId,
					pendingMessageId: Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null,
					sourceProposedPlanThreadId: Option.isSome(pendingTurnStart) ? pendingTurnStart.value.sourceProposedPlanThreadId : null,
					sourceProposedPlanId: Option.isSome(pendingTurnStart) ? pendingTurnStart.value.sourceProposedPlanId : null,
					assistantMessageId: null,
					state: "running",
					requestedAt: Option.isSome(pendingTurnStart) ? pendingTurnStart.value.requestedAt : event.occurredAt,
					startedAt: Option.isSome(pendingTurnStart) ? pendingTurnStart.value.requestedAt : event.occurredAt,
					completedAt: null,
					checkpointTurnCount: null,
					checkpointRef: null,
					checkpointStatus: null,
					checkpointFiles: []
				});
				yield* projectionTurnRepository.deletePendingTurnStartByThreadId({ threadId: event.payload.threadId });
				return;
			}
			case "thread.message-sent": {
				if (event.payload.turnId === null || event.payload.role !== "assistant") return;
				const existingTurn = yield* projectionTurnRepository.getByTurnId({
					threadId: event.payload.threadId,
					turnId: event.payload.turnId
				});
				if (Option.isSome(existingTurn)) {
					yield* projectionTurnRepository.upsertByTurnId({
						...existingTurn.value,
						assistantMessageId: event.payload.messageId,
						state: event.payload.streaming ? existingTurn.value.state : existingTurn.value.state === "interrupted" ? "interrupted" : existingTurn.value.state === "error" ? "error" : "completed",
						completedAt: event.payload.streaming ? existingTurn.value.completedAt : existingTurn.value.completedAt ?? event.payload.updatedAt,
						startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
						requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt
					});
					return;
				}
				yield* projectionTurnRepository.upsertByTurnId({
					turnId: event.payload.turnId,
					threadId: event.payload.threadId,
					pendingMessageId: null,
					sourceProposedPlanThreadId: null,
					sourceProposedPlanId: null,
					assistantMessageId: event.payload.messageId,
					state: event.payload.streaming ? "running" : "completed",
					requestedAt: event.payload.createdAt,
					startedAt: event.payload.createdAt,
					completedAt: event.payload.streaming ? null : event.payload.updatedAt,
					checkpointTurnCount: null,
					checkpointRef: null,
					checkpointStatus: null,
					checkpointFiles: []
				});
				return;
			}
			case "thread.turn-interrupt-requested": {
				if (event.payload.turnId === void 0) return;
				const existingTurn = yield* projectionTurnRepository.getByTurnId({
					threadId: event.payload.threadId,
					turnId: event.payload.turnId
				});
				if (Option.isSome(existingTurn)) {
					yield* projectionTurnRepository.upsertByTurnId({
						...existingTurn.value,
						state: "interrupted",
						completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
						startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
						requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt
					});
					return;
				}
				yield* projectionTurnRepository.upsertByTurnId({
					turnId: event.payload.turnId,
					threadId: event.payload.threadId,
					pendingMessageId: null,
					sourceProposedPlanThreadId: null,
					sourceProposedPlanId: null,
					assistantMessageId: null,
					state: "interrupted",
					requestedAt: event.payload.createdAt,
					startedAt: event.payload.createdAt,
					completedAt: event.payload.createdAt,
					checkpointTurnCount: null,
					checkpointRef: null,
					checkpointStatus: null,
					checkpointFiles: []
				});
				return;
			}
			case "thread.turn-diff-completed": {
				const existingTurn = yield* projectionTurnRepository.getByTurnId({
					threadId: event.payload.threadId,
					turnId: event.payload.turnId
				});
				const nextState = event.payload.status === "error" ? "error" : "completed";
				yield* projectionTurnRepository.clearCheckpointTurnConflict({
					threadId: event.payload.threadId,
					turnId: event.payload.turnId,
					checkpointTurnCount: event.payload.checkpointTurnCount
				});
				if (Option.isSome(existingTurn)) {
					yield* projectionTurnRepository.upsertByTurnId({
						...existingTurn.value,
						assistantMessageId: event.payload.assistantMessageId,
						state: nextState,
						checkpointTurnCount: event.payload.checkpointTurnCount,
						checkpointRef: event.payload.checkpointRef,
						checkpointStatus: event.payload.status,
						checkpointFiles: event.payload.files,
						startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
						requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
						completedAt: event.payload.completedAt
					});
					return;
				}
				yield* projectionTurnRepository.upsertByTurnId({
					turnId: event.payload.turnId,
					threadId: event.payload.threadId,
					pendingMessageId: null,
					sourceProposedPlanThreadId: null,
					sourceProposedPlanId: null,
					assistantMessageId: event.payload.assistantMessageId,
					state: nextState,
					requestedAt: event.payload.completedAt,
					startedAt: event.payload.completedAt,
					completedAt: event.payload.completedAt,
					checkpointTurnCount: event.payload.checkpointTurnCount,
					checkpointRef: event.payload.checkpointRef,
					checkpointStatus: event.payload.status,
					checkpointFiles: event.payload.files
				});
				return;
			}
			case "thread.reverted": {
				const keptTurns = (yield* projectionTurnRepository.listByThreadId({ threadId: event.payload.threadId })).filter((turn) => turn.turnId !== null && turn.checkpointTurnCount !== null && turn.checkpointTurnCount <= event.payload.turnCount);
				yield* projectionTurnRepository.deleteByThreadId({ threadId: event.payload.threadId });
				yield* Effect.forEach(keptTurns, (turn) => turn.turnId === null ? Effect.void : projectionTurnRepository.upsertByTurnId({
					...turn,
					turnId: turn.turnId
				}), { concurrency: 1 }).pipe(Effect.asVoid);
				return;
			}
			default: return;
		}
	});
	const applyCheckpointsProjection = () => Effect.void;
	const applyPendingApprovalsProjection = Effect.fn("applyPendingApprovalsProjection")(function* (event, _attachmentSideEffects) {
		switch (event.type) {
			case "thread.activity-appended": {
				const requestId = extractActivityRequestId(event.payload.activity.payload) ?? event.metadata.requestId ?? null;
				if (requestId === null) return;
				const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({ requestId });
				if (event.payload.activity.kind === "approval.resolved") {
					const resolvedDecisionRaw = typeof event.payload.activity.payload === "object" && event.payload.activity.payload !== null && "decision" in event.payload.activity.payload ? event.payload.activity.payload.decision : null;
					const resolvedDecision = resolvedDecisionRaw === "accept" || resolvedDecisionRaw === "acceptForSession" || resolvedDecisionRaw === "decline" || resolvedDecisionRaw === "cancel" ? resolvedDecisionRaw : null;
					yield* projectionPendingApprovalRepository.upsert({
						requestId,
						threadId: Option.isSome(existingRow) ? existingRow.value.threadId : event.payload.threadId,
						turnId: Option.isSome(existingRow) ? existingRow.value.turnId : event.payload.activity.turnId,
						status: "resolved",
						decision: resolvedDecision,
						createdAt: Option.isSome(existingRow) ? existingRow.value.createdAt : event.payload.activity.createdAt,
						resolvedAt: event.payload.activity.createdAt
					});
					return;
				}
				if (Option.isSome(existingRow) && existingRow.value.status === "resolved") return;
				yield* projectionPendingApprovalRepository.upsert({
					requestId,
					threadId: event.payload.threadId,
					turnId: event.payload.activity.turnId,
					status: "pending",
					decision: null,
					createdAt: Option.isSome(existingRow) ? existingRow.value.createdAt : event.payload.activity.createdAt,
					resolvedAt: null
				});
				return;
			}
			case "thread.approval-response-requested": {
				const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({ requestId: event.payload.requestId });
				yield* projectionPendingApprovalRepository.upsert({
					requestId: event.payload.requestId,
					threadId: Option.isSome(existingRow) ? existingRow.value.threadId : event.payload.threadId,
					turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
					status: "resolved",
					decision: event.payload.decision,
					createdAt: Option.isSome(existingRow) ? existingRow.value.createdAt : event.payload.createdAt,
					resolvedAt: event.payload.createdAt
				});
				return;
			}
			default: return;
		}
	});
	const projectors = [
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.projects,
			apply: applyProjectsProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
			apply: applyThreadMessagesProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
			apply: applyThreadProposedPlansProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
			apply: applyThreadActivitiesProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
			apply: applyThreadSessionsProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
			apply: applyThreadTurnsProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
			apply: applyCheckpointsProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
			apply: applyPendingApprovalsProjection
		},
		{
			name: ORCHESTRATION_PROJECTOR_NAMES.threads,
			apply: applyThreadsProjection
		}
	];
	const runProjectorForEvent = Effect.fn("runProjectorForEvent")(function* (projector, event) {
		const attachmentSideEffects = {
			deletedThreadIds: /* @__PURE__ */ new Set(),
			prunedThreadRelativePaths: /* @__PURE__ */ new Map()
		};
		yield* sql.withTransaction(projector.apply(event, attachmentSideEffects).pipe(Effect.flatMap(() => projectionStateRepository.upsert({
			projector: projector.name,
			lastAppliedSequence: event.sequence,
			updatedAt: event.occurredAt
		}))));
		yield* runAttachmentSideEffects(attachmentSideEffects).pipe(Effect.catch((cause) => Effect.logWarning("failed to apply projected attachment side-effects", {
			projector: projector.name,
			sequence: event.sequence,
			eventType: event.type,
			cause
		})));
	});
	const bootstrapProjector = (projector) => projectionStateRepository.getByProjector({ projector: projector.name }).pipe(Effect.flatMap((stateRow) => Stream.runForEach(eventStore.readFromSequence(Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0), (event) => runProjectorForEvent(projector, event))));
	const projectEvent = (event) => Effect.forEach(projectors, (projector) => runProjectorForEvent(projector, event), { concurrency: 1 }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path), Effect.provideService(ServerConfig, serverConfig), Effect.asVoid, Effect.catchTag("SqlError", (sqlError) => Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError))));
	return {
		bootstrap: Effect.forEach(projectors, bootstrapProjector, { concurrency: 1 }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path), Effect.provideService(ServerConfig, serverConfig), Effect.asVoid, Effect.tap(() => Effect.logDebug("orchestration projection pipeline bootstrapped").pipe(Effect.annotateLogs({ projectors: projectors.length }))), Effect.catchTag("SqlError", (sqlError) => Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)))),
		projectEvent
	};
});
const OrchestrationProjectionPipelineLive = Layer.effect(OrchestrationProjectionPipeline, makeOrchestrationProjectionPipeline()).pipe(Layer.provideMerge(ProjectionProjectRepositoryLive), Layer.provideMerge(ProjectionThreadRepositoryLive), Layer.provideMerge(ProjectionThreadMessageRepositoryLive), Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive), Layer.provideMerge(ProjectionThreadActivityRepositoryLive), Layer.provideMerge(ProjectionThreadSessionRepositoryLive), Layer.provideMerge(ProjectionTurnRepositoryLive), Layer.provideMerge(ProjectionPendingApprovalRepositoryLive), Layer.provideMerge(ProjectionStateRepositoryLive));

//#endregion
//#region src/persistence/Layers/OrchestrationEventStore.ts
const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const EventMetadataFromJsonString = Schema.fromJsonString(OrchestrationEventMetadata);
const AppendEventRequestSchema = Schema.Struct({
	eventId: EventId,
	aggregateKind: OrchestrationAggregateKind,
	streamId: Schema.Union([ProjectId, ThreadId]),
	type: OrchestrationEventType,
	causationEventId: Schema.NullOr(EventId),
	correlationId: Schema.NullOr(CommandId),
	actorKind: OrchestrationActorKind,
	occurredAt: IsoDateTime,
	commandId: Schema.NullOr(CommandId),
	payloadJson: UnknownFromJsonString,
	metadataJson: EventMetadataFromJsonString
});
const OrchestrationEventPersistedRowSchema = Schema.Struct({
	sequence: NonNegativeInt,
	eventId: EventId,
	type: OrchestrationEventType,
	aggregateKind: OrchestrationAggregateKind,
	aggregateId: Schema.Union([ProjectId, ThreadId]),
	occurredAt: IsoDateTime,
	commandId: Schema.NullOr(CommandId),
	causationEventId: Schema.NullOr(EventId),
	correlationId: Schema.NullOr(CommandId),
	payload: UnknownFromJsonString,
	metadata: EventMetadataFromJsonString
});
const ReadFromSequenceRequestSchema = Schema.Struct({
	sequenceExclusive: NonNegativeInt,
	limit: Schema.Number
});
const DEFAULT_READ_FROM_SEQUENCE_LIMIT = 1e3;
const READ_PAGE_SIZE = 500;
function inferActorKind(event) {
	if (event.commandId !== null && event.commandId.startsWith("provider:")) return "provider";
	if (event.commandId !== null && event.commandId.startsWith("server:")) return "server";
	if (event.metadata.providerTurnId !== void 0 || event.metadata.providerItemId !== void 0 || event.metadata.adapterKey !== void 0) return "provider";
	if (event.commandId === null) return "server";
	return "client";
}
function toPersistenceSqlOrDecodeError$1(sqlOperation, decodeOperation) {
	return (cause) => Schema.isSchemaError(cause) ? toPersistenceDecodeError(decodeOperation)(cause) : toPersistenceSqlError(sqlOperation)(cause);
}
const makeEventStore = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const appendEventRow = SqlSchema.findOne({
		Request: AppendEventRequestSchema,
		Result: OrchestrationEventPersistedRowSchema,
		execute: (request) => sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${request.eventId},
          ${request.aggregateKind},
          ${request.streamId},
          COALESCE(
            (
              SELECT stream_version + 1
              FROM orchestration_events
              WHERE aggregate_kind = ${request.aggregateKind}
                AND stream_id = ${request.streamId}
              ORDER BY stream_version DESC
              LIMIT 1
            ),
            0
          ),
          ${request.type},
          ${request.occurredAt},
          ${request.commandId},
          ${request.causationEventId},
          ${request.correlationId},
          ${request.actorKind},
          ${request.payloadJson},
          ${request.metadataJson}
        )
        RETURNING
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
      `
	});
	const readEventRowsFromSequence = SqlSchema.findAll({
		Request: ReadFromSequenceRequestSchema,
		Result: OrchestrationEventPersistedRowSchema,
		execute: (request) => sql`
        SELECT
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
        FROM orchestration_events
        WHERE sequence > ${request.sequenceExclusive}
        ORDER BY sequence ASC
        LIMIT ${request.limit}
      `
	});
	const append = (event) => appendEventRow({
		eventId: event.eventId,
		aggregateKind: event.aggregateKind,
		streamId: event.aggregateId,
		type: event.type,
		causationEventId: event.causationEventId,
		correlationId: event.correlationId,
		actorKind: inferActorKind(event),
		occurredAt: event.occurredAt,
		commandId: event.commandId,
		payloadJson: event.payload,
		metadataJson: event.metadata
	}).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$1("OrchestrationEventStore.append:insert", "OrchestrationEventStore.append:decodeRow")), Effect.flatMap((row) => decodeEvent(row).pipe(Effect.mapError(toPersistenceDecodeError("OrchestrationEventStore.append:rowToEvent")))));
	const readFromSequence = (sequenceExclusive, limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT) => {
		const normalizedLimit = Math.max(0, Math.floor(limit));
		if (normalizedLimit === 0) return Stream.empty;
		const readPage = (cursor, remaining) => Stream.fromEffect(readEventRowsFromSequence({
			sequenceExclusive: cursor,
			limit: Math.min(remaining, READ_PAGE_SIZE)
		}).pipe(Effect.mapError(toPersistenceSqlOrDecodeError$1("OrchestrationEventStore.readFromSequence:query", "OrchestrationEventStore.readFromSequence:decodeRows")), Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeEvent(row).pipe(Effect.mapError(toPersistenceDecodeError("OrchestrationEventStore.readFromSequence:rowToEvent"))))))).pipe(Stream.flatMap((events) => {
			if (events.length === 0) return Stream.empty;
			const nextRemaining = remaining - events.length;
			if (nextRemaining <= 0) return Stream.fromIterable(events);
			return Stream.concat(Stream.fromIterable(events), readPage(events[events.length - 1].sequence, nextRemaining));
		}));
		return readPage(sequenceExclusive, normalizedLimit);
	};
	return {
		append,
		readFromSequence,
		readAll: () => readFromSequence(0, Number.MAX_SAFE_INTEGER)
	};
});
const OrchestrationEventStoreLive = Layer.effect(OrchestrationEventStore, makeEventStore);

//#endregion
//#region src/persistence/Layers/OrchestrationCommandReceipts.ts
const makeOrchestrationCommandReceiptRepository = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const upsertReceiptRow = SqlSchema.void({
		Request: OrchestrationCommandReceipt,
		execute: (receipt) => sql`
        INSERT INTO orchestration_command_receipts (
          command_id,
          aggregate_kind,
          aggregate_id,
          accepted_at,
          result_sequence,
          status,
          error
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateKind},
          ${receipt.aggregateId},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${receipt.error}
        )
        ON CONFLICT (command_id)
        DO UPDATE SET
          aggregate_kind = excluded.aggregate_kind,
          aggregate_id = excluded.aggregate_id,
          accepted_at = excluded.accepted_at,
          result_sequence = excluded.result_sequence,
          status = excluded.status,
          error = excluded.error
      `
	});
	const findReceiptByCommandId = SqlSchema.findOneOption({
		Request: GetByCommandIdInput,
		Result: OrchestrationCommandReceipt,
		execute: ({ commandId }) => sql`
        SELECT
          command_id AS "commandId",
          aggregate_kind AS "aggregateKind",
          aggregate_id AS "aggregateId",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
      `
	});
	const upsert = (receipt) => upsertReceiptRow(receipt).pipe(Effect.mapError(toPersistenceSqlError("OrchestrationCommandReceiptRepository.upsert:query")));
	const getByCommandId = (input) => findReceiptByCommandId(input).pipe(Effect.mapError(toPersistenceSqlError("OrchestrationCommandReceiptRepository.getByCommandId:query")));
	return {
		upsert,
		getByCommandId
	};
});
const OrchestrationCommandReceiptRepositoryLive = Layer.effect(OrchestrationCommandReceiptRepository, makeOrchestrationCommandReceiptRepository);

//#endregion
//#region src/checkpointing/Errors.ts
/**
* CheckpointUnavailableError - Expected checkpoint does not exist.
*/
var CheckpointUnavailableError = class extends Schema.TaggedErrorClass()("CheckpointUnavailableError", {
	threadId: Schema.String,
	turnCount: Schema.Number,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Checkpoint unavailable for thread ${this.threadId} turn ${this.turnCount}: ${this.detail}`;
	}
};
/**
* CheckpointInvariantError - Inconsistent provider/filesystem/catalog state.
*/
var CheckpointInvariantError = class extends Schema.TaggedErrorClass()("CheckpointInvariantError", {
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {
	get message() {
		return `Checkpoint invariant violation in ${this.operation}: ${this.detail}`;
	}
};

//#endregion
//#region src/checkpointing/Utils.ts
const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";
function checkpointRefForThreadTurn(threadId, turnCount) {
	return CheckpointRef.makeUnsafe(`${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`);
}
function resolveThreadWorkspaceCwd(input) {
	const worktreeCwd = input.thread.worktreePath ?? void 0;
	if (worktreeCwd) return worktreeCwd;
	return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}

//#endregion
//#region src/checkpointing/Services/CheckpointStore.ts
/**
* CheckpointStore - Repository interface for filesystem-backed workspace checkpoints.
*
* Owns hidden Git-ref checkpoint capture/restore and diff computation for a
* workspace thread timeline. It does not store user-facing checkpoint metadata
* and does not coordinate provider conversation rollback.
*
* Uses Effect `ServiceMap.Service` for dependency injection and exposes typed
* domain errors for checkpoint storage operations.
*
* @module CheckpointStore
*/
/**
* CheckpointStore - Service tag for checkpoint persistence and restore operations.
*/
var CheckpointStore = class extends ServiceMap.Service()("t3/checkpointing/Services/CheckpointStore") {};

//#endregion
//#region src/checkpointing/Layers/CheckpointDiffQuery.ts
const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);
const make$3 = Effect.gen(function* () {
	const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
	const checkpointStore = yield* CheckpointStore;
	const getTurnDiff = Effect.fn("getTurnDiff")(function* (input) {
		const operation = "CheckpointDiffQuery.getTurnDiff";
		if (input.fromTurnCount === input.toTurnCount) {
			const emptyDiff = {
				threadId: input.threadId,
				fromTurnCount: input.fromTurnCount,
				toTurnCount: input.toTurnCount,
				diff: ""
			};
			if (!isTurnDiffResult(emptyDiff)) return yield* new CheckpointInvariantError({
				operation,
				detail: "Computed turn diff result does not satisfy contract schema."
			});
			return emptyDiff;
		}
		const threadContext = yield* projectionSnapshotQuery.getThreadCheckpointContext(input.threadId);
		if (Option.isNone(threadContext)) return yield* new CheckpointInvariantError({
			operation,
			detail: `Thread '${input.threadId}' not found.`
		});
		const maxTurnCount = threadContext.value.checkpoints.reduce((max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount), 0);
		if (input.toTurnCount > maxTurnCount) return yield* new CheckpointUnavailableError({
			threadId: input.threadId,
			turnCount: input.toTurnCount,
			detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`
		});
		const workspaceCwd = threadContext.value.worktreePath ?? threadContext.value.workspaceRoot;
		if (!workspaceCwd) return yield* new CheckpointInvariantError({
			operation,
			detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`
		});
		const fromCheckpointRef = input.fromTurnCount === 0 ? checkpointRefForThreadTurn(input.threadId, 0) : threadContext.value.checkpoints.find((checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount)?.checkpointRef;
		if (!fromCheckpointRef) return yield* new CheckpointUnavailableError({
			threadId: input.threadId,
			turnCount: input.fromTurnCount,
			detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`
		});
		const toCheckpointRef = threadContext.value.checkpoints.find((checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount)?.checkpointRef;
		if (!toCheckpointRef) return yield* new CheckpointUnavailableError({
			threadId: input.threadId,
			turnCount: input.toTurnCount,
			detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`
		});
		const [fromExists, toExists] = yield* Effect.all([checkpointStore.hasCheckpointRef({
			cwd: workspaceCwd,
			checkpointRef: fromCheckpointRef
		}), checkpointStore.hasCheckpointRef({
			cwd: workspaceCwd,
			checkpointRef: toCheckpointRef
		})], { concurrency: "unbounded" });
		if (!fromExists) return yield* new CheckpointUnavailableError({
			threadId: input.threadId,
			turnCount: input.fromTurnCount,
			detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`
		});
		if (!toExists) return yield* new CheckpointUnavailableError({
			threadId: input.threadId,
			turnCount: input.toTurnCount,
			detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`
		});
		const diff = yield* checkpointStore.diffCheckpoints({
			cwd: workspaceCwd,
			fromCheckpointRef,
			toCheckpointRef,
			fallbackFromToHead: false
		});
		const turnDiff = {
			threadId: input.threadId,
			fromTurnCount: input.fromTurnCount,
			toTurnCount: input.toTurnCount,
			diff
		};
		if (!isTurnDiffResult(turnDiff)) return yield* new CheckpointInvariantError({
			operation,
			detail: "Computed turn diff result does not satisfy contract schema."
		});
		return turnDiff;
	});
	const getFullThreadDiff = (input) => getTurnDiff({
		threadId: input.threadId,
		fromTurnCount: 0,
		toTurnCount: input.toTurnCount
	}).pipe(Effect.map((result) => result));
	return {
		getTurnDiff,
		getFullThreadDiff
	};
});
const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make$3);

//#endregion
//#region src/persistence/Services/ProjectionCheckpoints.ts
/**
* ProjectionCheckpointRepository - Projection repository interface for checkpoints.
*
* Owns persistence operations for projected checkpoint summaries in thread
* timelines.
*
* @module ProjectionCheckpointRepository
*/
const ProjectionCheckpoint = Schema.Struct({
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	status: OrchestrationCheckpointStatus,
	files: Schema.Array(OrchestrationCheckpointFile),
	assistantMessageId: Schema.NullOr(MessageId),
	completedAt: IsoDateTime
});
const ListByThreadIdInput = Schema.Struct({ threadId: ThreadId });
const GetByThreadAndTurnCountInput = Schema.Struct({
	threadId: ThreadId,
	checkpointTurnCount: NonNegativeInt
});
const DeleteByThreadIdInput = Schema.Struct({ threadId: ThreadId });

//#endregion
//#region src/orchestration/Layers/ProjectionSnapshotQuery.ts
const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(Struct.assign({
	defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
	scripts: Schema.fromJsonString(Schema.Array(ProjectScript))
}));
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(Struct.assign({
	isStreaming: Schema.Number,
	attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment)))
}));
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(Struct.assign({ modelSelection: Schema.fromJsonString(ModelSelection) }));
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(Struct.assign({
	payload: Schema.fromJsonString(Schema.Unknown),
	sequence: Schema.NullOr(NonNegativeInt)
}));
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(Struct.assign({ files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)) }));
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
	threadId: ProjectionThread.fields.threadId,
	turnId: TurnId,
	state: Schema.String,
	requestedAt: IsoDateTime,
	startedAt: Schema.NullOr(IsoDateTime),
	completedAt: Schema.NullOr(IsoDateTime),
	assistantMessageId: Schema.NullOr(MessageId),
	sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
	sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId)
});
const ProjectionStateDbRowSchema = ProjectionState;
const ProjectionCountsRowSchema = Schema.Struct({
	projectCount: Schema.Number,
	threadCount: Schema.Number
});
const WorkspaceRootLookupInput = Schema.Struct({ workspaceRoot: Schema.String });
const ProjectIdLookupInput = Schema.Struct({ projectId: ProjectId });
const ThreadIdLookupInput = Schema.Struct({ threadId: ThreadId });
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionThreadIdLookupRowSchema = Schema.Struct({ threadId: ThreadId });
const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
	threadId: ThreadId,
	projectId: ProjectId,
	workspaceRoot: Schema.String,
	worktreePath: Schema.NullOr(Schema.String)
});
const REQUIRED_SNAPSHOT_PROJECTORS = [
	ORCHESTRATION_PROJECTOR_NAMES.projects,
	ORCHESTRATION_PROJECTOR_NAMES.threads,
	ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
	ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
	ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
	ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
	ORCHESTRATION_PROJECTOR_NAMES.checkpoints
];
function maxIso(left, right) {
	if (left === null) return right;
	return left > right ? left : right;
}
function computeSnapshotSequence(stateRows) {
	if (stateRows.length === 0) return 0;
	const sequenceByProjector = new Map(stateRows.map((row) => [row.projector, row.lastAppliedSequence]));
	let minSequence = Number.POSITIVE_INFINITY;
	for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
		const sequence = sequenceByProjector.get(projector);
		if (sequence === void 0) return 0;
		if (sequence < minSequence) minSequence = sequence;
	}
	return Number.isFinite(minSequence) ? minSequence : 0;
}
function toPersistenceSqlOrDecodeError(sqlOperation, decodeOperation) {
	return (cause) => Schema.isSchemaError(cause) ? toPersistenceDecodeError(decodeOperation)(cause) : toPersistenceSqlError(sqlOperation)(cause);
}
const makeProjectionSnapshotQuery = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const listProjectRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionProjectDbRowSchema,
		execute: () => sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `
	});
	const listThreadRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionThreadDbRowSchema,
		execute: () => sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `
	});
	const listThreadMessageRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionThreadMessageDbRowSchema,
		execute: () => sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `
	});
	const listThreadProposedPlanRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionThreadProposedPlanDbRowSchema,
		execute: () => sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `
	});
	const listThreadActivityRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionThreadActivityDbRowSchema,
		execute: () => sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `
	});
	const listThreadSessionRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionThreadSessionDbRowSchema,
		execute: () => sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `
	});
	const listCheckpointRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionCheckpointDbRowSchema,
		execute: () => sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `
	});
	const listLatestTurnRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionLatestTurnDbRowSchema,
		execute: () => sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `
	});
	const listProjectionStateRows = SqlSchema.findAll({
		Request: Schema.Void,
		Result: ProjectionStateDbRowSchema,
		execute: () => sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `
	});
	const readProjectionCounts = SqlSchema.findOne({
		Request: Schema.Void,
		Result: ProjectionCountsRowSchema,
		execute: () => sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `
	});
	const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
		Request: WorkspaceRootLookupInput,
		Result: ProjectionProjectLookupRowSchema,
		execute: ({ workspaceRoot }) => sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `
	});
	const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
		Request: ProjectIdLookupInput,
		Result: ProjectionThreadIdLookupRowSchema,
		execute: ({ projectId }) => sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `
	});
	const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
		Request: ThreadIdLookupInput,
		Result: ProjectionThreadCheckpointContextThreadRowSchema,
		execute: ({ threadId }) => sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `
	});
	const listCheckpointRowsByThread = SqlSchema.findAll({
		Request: ThreadIdLookupInput,
		Result: ProjectionCheckpointDbRowSchema,
		execute: ({ threadId }) => sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `
	});
	const getSnapshot = () => sql.withTransaction(Effect.gen(function* () {
		const [projectRows, threadRows, messageRows, proposedPlanRows, activityRows, sessionRows, checkpointRows, latestTurnRows, stateRows] = yield* Effect.all([
			listProjectRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listProjects:query", "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows"))),
			listThreadRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listThreads:query", "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows"))),
			listThreadMessageRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query", "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows"))),
			listThreadProposedPlanRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query", "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows"))),
			listThreadActivityRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query", "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows"))),
			listThreadSessionRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query", "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows"))),
			listCheckpointRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query", "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows"))),
			listLatestTurnRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query", "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows"))),
			listProjectionStateRows(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getSnapshot:listProjectionState:query", "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows")))
		]);
		const messagesByThread = /* @__PURE__ */ new Map();
		const proposedPlansByThread = /* @__PURE__ */ new Map();
		const activitiesByThread = /* @__PURE__ */ new Map();
		const checkpointsByThread = /* @__PURE__ */ new Map();
		const sessionsByThread = /* @__PURE__ */ new Map();
		const latestTurnByThread = /* @__PURE__ */ new Map();
		let updatedAt = null;
		for (const row of projectRows) updatedAt = maxIso(updatedAt, row.updatedAt);
		for (const row of threadRows) updatedAt = maxIso(updatedAt, row.updatedAt);
		for (const row of stateRows) updatedAt = maxIso(updatedAt, row.updatedAt);
		for (const row of messageRows) {
			updatedAt = maxIso(updatedAt, row.updatedAt);
			const threadMessages = messagesByThread.get(row.threadId) ?? [];
			threadMessages.push({
				id: row.messageId,
				role: row.role,
				text: row.text,
				...row.attachments !== null ? { attachments: row.attachments } : {},
				turnId: row.turnId,
				streaming: row.isStreaming === 1,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			});
			messagesByThread.set(row.threadId, threadMessages);
		}
		for (const row of proposedPlanRows) {
			updatedAt = maxIso(updatedAt, row.updatedAt);
			const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
			threadProposedPlans.push({
				id: row.planId,
				turnId: row.turnId,
				planMarkdown: row.planMarkdown,
				implementedAt: row.implementedAt,
				implementationThreadId: row.implementationThreadId,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			});
			proposedPlansByThread.set(row.threadId, threadProposedPlans);
		}
		for (const row of activityRows) {
			updatedAt = maxIso(updatedAt, row.createdAt);
			const threadActivities = activitiesByThread.get(row.threadId) ?? [];
			threadActivities.push({
				id: row.activityId,
				tone: row.tone,
				kind: row.kind,
				summary: row.summary,
				payload: row.payload,
				turnId: row.turnId,
				...row.sequence !== null ? { sequence: row.sequence } : {},
				createdAt: row.createdAt
			});
			activitiesByThread.set(row.threadId, threadActivities);
		}
		for (const row of checkpointRows) {
			updatedAt = maxIso(updatedAt, row.completedAt);
			const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
			threadCheckpoints.push({
				turnId: row.turnId,
				checkpointTurnCount: row.checkpointTurnCount,
				checkpointRef: row.checkpointRef,
				status: row.status,
				files: row.files,
				assistantMessageId: row.assistantMessageId,
				completedAt: row.completedAt
			});
			checkpointsByThread.set(row.threadId, threadCheckpoints);
		}
		for (const row of latestTurnRows) {
			updatedAt = maxIso(updatedAt, row.requestedAt);
			if (row.startedAt !== null) updatedAt = maxIso(updatedAt, row.startedAt);
			if (row.completedAt !== null) updatedAt = maxIso(updatedAt, row.completedAt);
			if (latestTurnByThread.has(row.threadId)) continue;
			latestTurnByThread.set(row.threadId, {
				turnId: row.turnId,
				state: row.state === "error" ? "error" : row.state === "interrupted" ? "interrupted" : row.state === "completed" ? "completed" : "running",
				requestedAt: row.requestedAt,
				startedAt: row.startedAt,
				completedAt: row.completedAt,
				assistantMessageId: row.assistantMessageId,
				...row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null ? { sourceProposedPlan: {
					threadId: row.sourceProposedPlanThreadId,
					planId: row.sourceProposedPlanId
				} } : {}
			});
		}
		for (const row of sessionRows) {
			updatedAt = maxIso(updatedAt, row.updatedAt);
			sessionsByThread.set(row.threadId, {
				threadId: row.threadId,
				status: row.status,
				providerName: row.providerName,
				runtimeMode: row.runtimeMode,
				activeTurnId: row.activeTurnId,
				lastError: row.lastError,
				updatedAt: row.updatedAt
			});
		}
		const projects = projectRows.map((row) => ({
			id: row.projectId,
			title: row.title,
			workspaceRoot: row.workspaceRoot,
			defaultModelSelection: row.defaultModelSelection,
			scripts: row.scripts,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			deletedAt: row.deletedAt
		}));
		const threads = threadRows.map((row) => ({
			id: row.threadId,
			projectId: row.projectId,
			title: row.title,
			modelSelection: row.modelSelection,
			runtimeMode: row.runtimeMode,
			interactionMode: row.interactionMode,
			branch: row.branch,
			worktreePath: row.worktreePath,
			latestTurn: latestTurnByThread.get(row.threadId) ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			archivedAt: row.archivedAt,
			deletedAt: row.deletedAt,
			messages: messagesByThread.get(row.threadId) ?? [],
			proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
			activities: activitiesByThread.get(row.threadId) ?? [],
			checkpoints: checkpointsByThread.get(row.threadId) ?? [],
			session: sessionsByThread.get(row.threadId) ?? null
		}));
		return yield* decodeReadModel({
			snapshotSequence: computeSnapshotSequence(stateRows),
			projects,
			threads,
			updatedAt: updatedAt ?? (/* @__PURE__ */ new Date(0)).toISOString()
		}).pipe(Effect.mapError(toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel")));
	})).pipe(Effect.mapError((error) => {
		if (isPersistenceError(error)) return error;
		return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
	}));
	const getCounts = () => readProjectionCounts(void 0).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getCounts:query", "ProjectionSnapshotQuery.getCounts:decodeRow")), Effect.map((row) => ({
		projectCount: row.projectCount,
		threadCount: row.threadCount
	})));
	const getActiveProjectByWorkspaceRoot = (workspaceRoot) => getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query", "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow")), Effect.map(Option.map((row) => ({
		id: row.projectId,
		title: row.title,
		workspaceRoot: row.workspaceRoot,
		defaultModelSelection: row.defaultModelSelection,
		scripts: row.scripts,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt
	}))));
	const getFirstActiveThreadIdByProjectId = (projectId) => getFirstActiveThreadIdByProject({ projectId }).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query", "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow")), Effect.map(Option.map((row) => row.threadId)));
	const getThreadCheckpointContext = (threadId) => Effect.gen(function* () {
		const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query", "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow")));
		if (Option.isNone(threadRow)) return Option.none();
		const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(Effect.mapError(toPersistenceSqlOrDecodeError("ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query", "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows")));
		return Option.some({
			threadId: threadRow.value.threadId,
			projectId: threadRow.value.projectId,
			workspaceRoot: threadRow.value.workspaceRoot,
			worktreePath: threadRow.value.worktreePath,
			checkpoints: checkpointRows.map((row) => ({
				turnId: row.turnId,
				checkpointTurnCount: row.checkpointTurnCount,
				checkpointRef: row.checkpointRef,
				status: row.status,
				files: row.files,
				assistantMessageId: row.assistantMessageId,
				completedAt: row.completedAt
			}))
		});
	});
	return {
		getSnapshot,
		getCounts,
		getActiveProjectByWorkspaceRoot,
		getFirstActiveThreadIdByProjectId,
		getThreadCheckpointContext
	};
});
const OrchestrationProjectionSnapshotQueryLive = Layer.effect(ProjectionSnapshotQuery, makeProjectionSnapshotQuery);

//#endregion
//#region src/checkpointing/Layers/CheckpointStore.ts
/**
* CheckpointStoreLive - Filesystem checkpoint store adapter layer.
*
* Implements hidden Git-ref checkpoint capture/restore directly with
* Effect-native child process execution (`effect/unstable/process`).
*
* This layer owns filesystem/Git interactions only; it does not persist
* checkpoint metadata and does not coordinate provider rollback semantics.
*
* @module CheckpointStoreLive
*/
const makeCheckpointStore = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const git = yield* GitCore;
	const resolveHeadCommit = (cwd) => git.execute({
		operation: "CheckpointStore.resolveHeadCommit",
		cwd,
		args: [
			"rev-parse",
			"--verify",
			"--quiet",
			"HEAD^{commit}"
		],
		allowNonZeroExit: true
	}).pipe(Effect.map((result) => {
		if (result.code !== 0) return null;
		const commit = result.stdout.trim();
		return commit.length > 0 ? commit : null;
	}));
	const hasHeadCommit = (cwd) => git.execute({
		operation: "CheckpointStore.hasHeadCommit",
		cwd,
		args: [
			"rev-parse",
			"--verify",
			"HEAD"
		],
		allowNonZeroExit: true
	}).pipe(Effect.map((result) => result.code === 0));
	const resolveCheckpointCommit = (cwd, checkpointRef) => git.execute({
		operation: "CheckpointStore.resolveCheckpointCommit",
		cwd,
		args: [
			"rev-parse",
			"--verify",
			"--quiet",
			`${checkpointRef}^{commit}`
		],
		allowNonZeroExit: true
	}).pipe(Effect.map((result) => {
		if (result.code !== 0) return null;
		const commit = result.stdout.trim();
		return commit.length > 0 ? commit : null;
	}));
	const isGitRepository = (cwd) => git.execute({
		operation: "CheckpointStore.isGitRepository",
		cwd,
		args: ["rev-parse", "--is-inside-work-tree"],
		allowNonZeroExit: true
	}).pipe(Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"), Effect.catch(() => Effect.succeed(false)));
	const captureCheckpoint = Effect.fn("captureCheckpoint")(function* (input) {
		const operation = "CheckpointStore.captureCheckpoint";
		yield* Effect.acquireUseRelease(fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }), Effect.fn("captureCheckpoint.withTempDirectory")(function* (tempDir) {
			const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
			const commitEnv = {
				...process.env,
				GIT_INDEX_FILE: tempIndexPath,
				GIT_AUTHOR_NAME: "T3 Code",
				GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
				GIT_COMMITTER_NAME: "T3 Code",
				GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com"
			};
			if (yield* hasHeadCommit(input.cwd)) yield* git.execute({
				operation,
				cwd: input.cwd,
				args: ["read-tree", "HEAD"],
				env: commitEnv
			});
			yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"add",
					"-A",
					"--",
					"."
				],
				env: commitEnv
			});
			const treeOid = (yield* git.execute({
				operation,
				cwd: input.cwd,
				args: ["write-tree"],
				env: commitEnv
			})).stdout.trim();
			if (treeOid.length === 0) return yield* new GitCommandError({
				operation,
				command: "git write-tree",
				cwd: input.cwd,
				detail: "git write-tree returned an empty tree oid."
			});
			const message = `t3 checkpoint ref=${input.checkpointRef}`;
			const commitOid = (yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"commit-tree",
					treeOid,
					"-m",
					message
				],
				env: commitEnv
			})).stdout.trim();
			if (commitOid.length === 0) return yield* new GitCommandError({
				operation,
				command: "git commit-tree",
				cwd: input.cwd,
				detail: "git commit-tree returned an empty commit oid."
			});
			yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"update-ref",
					input.checkpointRef,
					commitOid
				]
			});
		}), (tempDir) => fs.remove(tempDir, { recursive: true })).pipe(Effect.catchTags({ PlatformError: (error) => Effect.fail(new CheckpointInvariantError({
			operation: "CheckpointStore.captureCheckpoint",
			detail: "Failed to capture checkpoint.",
			cause: error
		})) }));
	});
	const hasCheckpointRef = (input) => resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(Effect.map((commit) => commit !== null));
	return {
		isGitRepository,
		captureCheckpoint,
		hasCheckpointRef,
		restoreCheckpoint: Effect.fn("restoreCheckpoint")(function* (input) {
			const operation = "CheckpointStore.restoreCheckpoint";
			let commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);
			if (!commitOid && input.fallbackToHead === true) commitOid = yield* resolveHeadCommit(input.cwd);
			if (!commitOid) return false;
			yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"restore",
					"--source",
					commitOid,
					"--worktree",
					"--staged",
					"--",
					"."
				]
			});
			yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"clean",
					"-fd",
					"--",
					"."
				]
			});
			if (yield* hasHeadCommit(input.cwd)) yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"reset",
					"--quiet",
					"--",
					"."
				]
			});
			return true;
		}),
		diffCheckpoints: Effect.fn("diffCheckpoints")(function* (input) {
			const operation = "CheckpointStore.diffCheckpoints";
			let fromCommitOid = yield* resolveCheckpointCommit(input.cwd, input.fromCheckpointRef);
			const toCommitOid = yield* resolveCheckpointCommit(input.cwd, input.toCheckpointRef);
			if (!fromCommitOid && input.fallbackFromToHead === true) {
				const headCommit = yield* resolveHeadCommit(input.cwd);
				if (headCommit) fromCommitOid = headCommit;
			}
			if (!fromCommitOid || !toCommitOid) return yield* new GitCommandError({
				operation,
				command: "git diff",
				cwd: input.cwd,
				detail: "Checkpoint ref is unavailable for diff operation."
			});
			return (yield* git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"diff",
					"--patch",
					"--minimal",
					"--no-color",
					fromCommitOid,
					toCommitOid
				]
			})).stdout;
		}),
		deleteCheckpointRefs: Effect.fn("deleteCheckpointRefs")(function* (input) {
			const operation = "CheckpointStore.deleteCheckpointRefs";
			yield* Effect.forEach(input.checkpointRefs, (checkpointRef) => git.execute({
				operation,
				cwd: input.cwd,
				args: [
					"update-ref",
					"-d",
					checkpointRef
				],
				allowNonZeroExit: true
			}), { discard: true });
		})
	};
});
const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);

//#endregion
//#region ../../packages/shared/src/git.ts
/**
* Sanitize an arbitrary string into a valid, lowercase git branch fragment.
* Strips quotes, collapses separators, limits to 64 chars.
*/
function sanitizeBranchFragment(raw) {
	const branchFragment = raw.trim().toLowerCase().replace(/['"`]/g, "").replace(/^[./\s_-]+|[./\s_-]+$/g, "").replace(/[^a-z0-9/_-]+/g, "-").replace(/\/+/g, "/").replace(/-+/g, "-").replace(/^[./_-]+|[./_-]+$/g, "").slice(0, 64).replace(/[./_-]+$/g, "");
	return branchFragment.length > 0 ? branchFragment : "update";
}
/**
* Sanitize a string into a `feature/…` branch name.
* Preserves an existing `feature/` prefix or slash-separated namespace.
*/
function sanitizeFeatureBranchName(raw) {
	const sanitized = sanitizeBranchFragment(raw);
	if (sanitized.includes("/")) return sanitized.startsWith("feature/") ? sanitized : `feature/${sanitized}`;
	return `feature/${sanitized}`;
}
const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";
/**
* Resolve a unique `feature/…` branch name that doesn't collide with
* any existing branch. Appends a numeric suffix when needed.
*/
function resolveAutoFeatureBranchName(existingBranchNames, preferredBranch) {
	const preferred = preferredBranch?.trim();
	const resolvedBase = sanitizeFeatureBranchName(preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK);
	const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));
	if (!existingNames.has(resolvedBase)) return resolvedBase;
	let suffix = 2;
	while (existingNames.has(`${resolvedBase}-${suffix}`)) suffix += 1;
	return `${resolvedBase}-${suffix}`;
}
/**
* Strip the remote prefix from a remote ref such as `origin/feature/demo`.
*/
function deriveLocalBranchNameFromRemoteRef$1(branchName) {
	const firstSeparatorIndex = branchName.indexOf("/");
	if (firstSeparatorIndex <= 0 || firstSeparatorIndex === branchName.length - 1) return branchName;
	return branchName.slice(firstSeparatorIndex + 1);
}
function deriveLocalBranchNameCandidatesFromRemoteRef(branchName, remoteName) {
	const candidates = /* @__PURE__ */ new Set();
	const firstSlashCandidate = deriveLocalBranchNameFromRemoteRef$1(branchName);
	if (firstSlashCandidate.length > 0) candidates.add(firstSlashCandidate);
	if (remoteName) {
		const remotePrefix = `${remoteName}/`;
		if (branchName.startsWith(remotePrefix) && branchName.length > remotePrefix.length) candidates.add(branchName.slice(remotePrefix.length));
	}
	return [...candidates];
}
/**
* Hide `origin/*` remote refs when a matching local branch already exists.
*/
function dedupeRemoteBranchesWithLocalMatches(branches) {
	const localBranchNames = new Set(branches.filter((branch) => !branch.isRemote).map((branch) => branch.name));
	return branches.filter((branch) => {
		if (!branch.isRemote) return true;
		if (branch.remoteName !== "origin") return true;
		return !deriveLocalBranchNameCandidatesFromRemoteRef(branch.name, branch.remoteName).some((candidate) => localBranchNames.has(candidate));
	});
}

//#endregion
//#region src/git/remoteRefs.ts
function parseRemoteNamesInGitOrder(stdout) {
	return stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function parseRemoteNames(stdout) {
	return parseRemoteNamesInGitOrder(stdout).toSorted((a, b) => b.length - a.length);
}
function parseRemoteRefWithRemoteNames(ref, remoteNames) {
	const trimmedRef = ref.trim();
	if (trimmedRef.length === 0) return null;
	for (const remoteName of remoteNames) {
		const remotePrefix = `${remoteName}/`;
		if (!trimmedRef.startsWith(remotePrefix)) continue;
		const branchName = trimmedRef.slice(remotePrefix.length).trim();
		if (branchName.length === 0) return null;
		return {
			remoteRef: trimmedRef,
			remoteName,
			branchName
		};
	}
	return null;
}
function extractBranchNameFromRemoteRef(ref, options) {
	const normalized = ref.trim();
	if (normalized.length === 0) return "";
	if (normalized.startsWith("refs/remotes/")) return extractBranchNameFromRemoteRef(normalized.slice(13), options);
	const parsedRemoteRef = parseRemoteRefWithRemoteNames(normalized, options?.remoteName ? [options.remoteName] : options?.remoteNames ?? []);
	if (parsedRemoteRef) return parsedRemoteRef.branchName;
	const firstSlash = normalized.indexOf("/");
	if (firstSlash === -1) return normalized;
	return normalized.slice(firstSlash + 1).trim();
}

//#endregion
//#region src/git/Layers/GitCore.ts
const DEFAULT_TIMEOUT_MS$1 = 3e4;
const DEFAULT_MAX_OUTPUT_BYTES = 1e6;
const OUTPUT_TRUNCATED_MARKER = "\n\n[truncated]";
const PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES = 49e3;
const RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES = 19e3;
const RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES = 19e3;
const RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES = 59e3;
const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15);
const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(5);
const STATUS_UPSTREAM_REFRESH_FAILURE_COOLDOWN = Duration.seconds(5);
const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2048;
const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master"];
const GIT_LIST_BRANCHES_DEFAULT_LIMIT = 100;
var StatusUpstreamRefreshCacheKey = class extends Data.Class {};
function parseBranchAb(value) {
	const match = value.match(/^\+(\d+)\s+-(\d+)$/);
	if (!match) return {
		ahead: 0,
		behind: 0
	};
	return {
		ahead: Number(match[1] ?? "0"),
		behind: Number(match[2] ?? "0")
	};
}
function parseNumstatEntries(stdout) {
	const entries = [];
	for (const line of stdout.split(/\r?\n/g)) {
		if (line.trim().length === 0) continue;
		const [addedRaw, deletedRaw, ...pathParts] = line.split("	");
		const rawPath = pathParts.length > 1 ? (pathParts.at(-1) ?? "").trim() : pathParts.join("	").trim();
		if (rawPath.length === 0) continue;
		const added = Number.parseInt(addedRaw ?? "0", 10);
		const deleted = Number.parseInt(deletedRaw ?? "0", 10);
		const renameArrowIndex = rawPath.indexOf(" => ");
		const normalizedPath = renameArrowIndex >= 0 ? rawPath.slice(renameArrowIndex + 4).trim() : rawPath;
		entries.push({
			path: normalizedPath.length > 0 ? normalizedPath : rawPath,
			insertions: Number.isFinite(added) ? added : 0,
			deletions: Number.isFinite(deleted) ? deleted : 0
		});
	}
	return entries;
}
function splitNullSeparatedPaths(input, truncated) {
	const parts = input.split("\0");
	if (parts.length === 0) return [];
	if (truncated && parts[parts.length - 1]?.length) parts.pop();
	return parts.filter((value) => value.length > 0);
}
function chunkPathsForGitCheckIgnore(relativePaths) {
	const chunks = [];
	let chunk = [];
	let chunkBytes = 0;
	for (const relativePath of relativePaths) {
		const relativePathBytes = Buffer.byteLength(relativePath) + 1;
		if (chunk.length > 0 && chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
			chunks.push(chunk);
			chunk = [];
			chunkBytes = 0;
		}
		chunk.push(relativePath);
		chunkBytes += relativePathBytes;
		if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
			chunks.push(chunk);
			chunk = [];
			chunkBytes = 0;
		}
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}
function parsePorcelainPath(line) {
	if (line.startsWith("? ") || line.startsWith("! ")) {
		const simple = line.slice(2).trim();
		return simple.length > 0 ? simple : null;
	}
	if (!(line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u "))) return null;
	const tabIndex = line.indexOf("	");
	if (tabIndex >= 0) {
		const [filePath] = line.slice(tabIndex + 1).split("	");
		return filePath?.trim().length ? filePath.trim() : null;
	}
	const filePath = line.trim().split(/\s+/g).at(-1) ?? "";
	return filePath.length > 0 ? filePath : null;
}
function parseBranchLine(line) {
	const trimmed = line.trim();
	if (trimmed.length === 0) return null;
	const name = trimmed.replace(/^[*+]\s+/, "");
	if (name.includes(" -> ") || name.startsWith("(")) return null;
	return {
		name,
		current: trimmed.startsWith("* ")
	};
}
function filterBranchesForListQuery(branches, query) {
	if (!query) return branches;
	const normalizedQuery = query.toLowerCase();
	return branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery));
}
function paginateBranches(input) {
	const cursor = input.cursor ?? 0;
	const limit = input.limit ?? GIT_LIST_BRANCHES_DEFAULT_LIMIT;
	const totalCount = input.branches.length;
	const branches = input.branches.slice(cursor, cursor + limit);
	return {
		branches,
		nextCursor: cursor + branches.length < totalCount ? cursor + branches.length : null,
		totalCount
	};
}
function sanitizeRemoteName(value) {
	const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : "fork";
}
function normalizeRemoteUrl(value) {
	return value.trim().replace(/\/+$/g, "").replace(/\.git$/i, "").toLowerCase();
}
function parseRemoteFetchUrls(stdout) {
	const remotes = /* @__PURE__ */ new Map();
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
		if (!match) continue;
		const [, remoteName = "", remoteUrl = "", direction = ""] = match;
		if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) continue;
		remotes.set(remoteName, remoteUrl);
	}
	return remotes;
}
function parseUpstreamRefWithRemoteNames(upstreamRef, remoteNames) {
	const parsed = parseRemoteRefWithRemoteNames(upstreamRef, remoteNames);
	if (!parsed) return null;
	return {
		upstreamRef,
		remoteName: parsed.remoteName,
		upstreamBranch: parsed.branchName
	};
}
function parseUpstreamRefByFirstSeparator(upstreamRef) {
	const separatorIndex = upstreamRef.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === upstreamRef.length - 1) return null;
	const remoteName = upstreamRef.slice(0, separatorIndex).trim();
	const upstreamBranch = upstreamRef.slice(separatorIndex + 1).trim();
	if (remoteName.length === 0 || upstreamBranch.length === 0) return null;
	return {
		upstreamRef,
		remoteName,
		upstreamBranch
	};
}
function parseTrackingBranchByUpstreamRef(stdout, upstreamRef) {
	for (const line of stdout.split("\n")) {
		const trimmedLine = line.trim();
		if (trimmedLine.length === 0) continue;
		const [branchNameRaw, upstreamBranchRaw = ""] = trimmedLine.split("	");
		const branchName = branchNameRaw?.trim() ?? "";
		const upstreamBranch = upstreamBranchRaw.trim();
		if (branchName.length === 0 || upstreamBranch.length === 0) continue;
		if (upstreamBranch === upstreamRef) return branchName;
	}
	return null;
}
function deriveLocalBranchNameFromRemoteRef(branchName) {
	const separatorIndex = branchName.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) return null;
	const localBranch = branchName.slice(separatorIndex + 1).trim();
	return localBranch.length > 0 ? localBranch : null;
}
function commandLabel(args) {
	return `git ${args.join(" ")}`;
}
function parseDefaultBranchFromRemoteHeadRef(value, remoteName) {
	const trimmed = value.trim();
	const prefix = `refs/remotes/${remoteName}/`;
	if (!trimmed.startsWith(prefix)) return null;
	const branch = trimmed.slice(prefix.length).trim();
	return branch.length > 0 ? branch : null;
}
function createGitCommandError(operation, cwd, args, detail, cause) {
	return new GitCommandError({
		operation,
		command: commandLabel(args),
		cwd,
		detail,
		...cause !== void 0 ? { cause } : {}
	});
}
function quoteGitCommand(args) {
	return `git ${args.join(" ")}`;
}
function toGitCommandError(input, detail) {
	return (cause) => Schema.is(GitCommandError)(cause) ? cause : new GitCommandError({
		operation: input.operation,
		command: quoteGitCommand(input.args),
		cwd: input.cwd,
		detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
		...cause !== void 0 ? { cause } : {}
	});
}
const nowUnixNano = () => BigInt(Date.now()) * 1000000n;
const addCurrentSpanEvent = (name, attributes) => Effect.currentSpan.pipe(Effect.tap((span) => Effect.sync(() => {
	span.event(name, nowUnixNano(), compactTraceAttributes(attributes));
})), Effect.catch(() => Effect.void));
function trace2ChildKey(record) {
	const childId = record.child_id;
	if (typeof childId === "number" || typeof childId === "string") return String(childId);
	const hookName = record.hook_name;
	return typeof hookName === "string" && hookName.trim().length > 0 ? hookName.trim() : null;
}
const Trace2Record = Schema.Record(Schema.String, Schema.Unknown);
const createTrace2Monitor = Effect.fn("createTrace2Monitor")(function* (input, progress) {
	if (!progress?.onHookStarted && !progress?.onHookFinished) return {
		env: {},
		flush: Effect.void
	};
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const traceFilePath = yield* fs.makeTempFileScoped({
		prefix: `t3code-git-trace2-${process.pid}-`,
		suffix: ".json"
	});
	const hookStartByChildKey = /* @__PURE__ */ new Map();
	const traceTailState = yield* Ref.make({
		processedChars: 0,
		remainder: ""
	});
	const handleTraceLine = Effect.fn("handleTraceLine")(function* (line) {
		const trimmedLine = line.trim();
		if (trimmedLine.length === 0) return;
		const traceRecord = decodeJsonResult(Trace2Record)(trimmedLine);
		if (Result.isFailure(traceRecord)) {
			yield* Effect.logDebug(`GitCore.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}`, traceRecord.failure);
			return;
		}
		if (traceRecord.success.child_class !== "hook") return;
		const event = traceRecord.success.event;
		const childKey = trace2ChildKey(traceRecord.success);
		if (childKey === null) return;
		const started = hookStartByChildKey.get(childKey);
		const hookNameFromEvent = typeof traceRecord.success.hook_name === "string" ? traceRecord.success.hook_name.trim() : "";
		const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : started?.hookName ?? "";
		if (hookName.length === 0) return;
		if (event === "child_start") {
			hookStartByChildKey.set(childKey, {
				hookName,
				startedAtMs: Date.now()
			});
			yield* addCurrentSpanEvent("git.hook.started", { hookName });
			if (progress.onHookStarted) yield* progress.onHookStarted(hookName);
			return;
		}
		if (event === "child_exit") {
			hookStartByChildKey.delete(childKey);
			const code = traceRecord.success.code;
			const exitCode = typeof code === "number" && Number.isInteger(code) ? code : null;
			const durationMs = started ? Math.max(0, Date.now() - started.startedAtMs) : null;
			yield* addCurrentSpanEvent("git.hook.finished", {
				hookName: started?.hookName ?? hookName,
				exitCode,
				durationMs
			});
			if (progress.onHookFinished) yield* progress.onHookFinished({
				hookName: started?.hookName ?? hookName,
				exitCode,
				durationMs
			});
		}
	});
	const readTraceDelta = (yield* Semaphore.make(1)).withPermit(fs.readFileString(traceFilePath).pipe(Effect.flatMap((contents) => Effect.uninterruptible(Ref.modify(traceTailState, ({ processedChars, remainder }) => {
		if (contents.length <= processedChars) return [[], {
			processedChars,
			remainder
		}];
		const lines = (remainder + contents.slice(processedChars)).split("\n");
		const nextRemainder = lines.pop() ?? "";
		return [lines.map((line) => line.replace(/\r$/, "")), {
			processedChars: contents.length,
			remainder: nextRemainder
		}];
	}).pipe(Effect.flatMap((lines) => Effect.forEach(lines, handleTraceLine, { discard: true }))))), Effect.ignore({ log: true })));
	const traceFileName = path.basename(traceFilePath);
	yield* Stream.runForEach(fs.watch(traceFilePath), (event) => {
		const eventPath = event.path;
		if (!(eventPath === traceFilePath || eventPath === traceFileName || path.basename(eventPath) === traceFileName)) return Effect.void;
		return readTraceDelta;
	}).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);
	const finalizeTrace2Monitor = Effect.fn("finalizeTrace2Monitor")(function* () {
		yield* readTraceDelta;
		const finalLine = yield* Ref.modify(traceTailState, ({ processedChars, remainder }) => [remainder.trim(), {
			processedChars,
			remainder: ""
		}]);
		if (finalLine.length > 0) yield* handleTraceLine(finalLine);
	});
	yield* Effect.addFinalizer(finalizeTrace2Monitor);
	return {
		env: { GIT_TRACE2_EVENT: traceFilePath },
		flush: readTraceDelta
	};
});
const collectOutput = Effect.fn("collectOutput")(function* (input, stream, maxOutputBytes, truncateOutputAtMaxBytes, onLine) {
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	let lineBuffer = "";
	let truncated = false;
	const emitCompleteLines = Effect.fn("emitCompleteLines")(function* (flush) {
		let newlineIndex = lineBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
			lineBuffer = lineBuffer.slice(newlineIndex + 1);
			if (line.length > 0 && onLine) yield* onLine(line);
			newlineIndex = lineBuffer.indexOf("\n");
		}
		if (flush) {
			const trailing = lineBuffer.replace(/\r$/, "");
			lineBuffer = "";
			if (trailing.length > 0 && onLine) yield* onLine(trailing);
		}
	});
	const processChunk = Effect.fn("processChunk")(function* (chunk) {
		if (truncateOutputAtMaxBytes && truncated) return;
		const nextBytes = bytes + chunk.byteLength;
		if (!truncateOutputAtMaxBytes && nextBytes > maxOutputBytes) return yield* new GitCommandError({
			operation: input.operation,
			command: quoteGitCommand(input.args),
			cwd: input.cwd,
			detail: `${quoteGitCommand(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`
		});
		const chunkToDecode = truncateOutputAtMaxBytes && nextBytes > maxOutputBytes ? chunk.subarray(0, Math.max(0, maxOutputBytes - bytes)) : chunk;
		bytes += chunkToDecode.byteLength;
		truncated = truncateOutputAtMaxBytes && nextBytes > maxOutputBytes;
		const decoded = decoder.decode(chunkToDecode, { stream: !truncated });
		text += decoded;
		lineBuffer += decoded;
		yield* emitCompleteLines(false);
	});
	yield* Stream.runForEach(stream, processChunk).pipe(Effect.mapError(toGitCommandError(input, "output stream failed.")));
	const remainder = truncated ? "" : decoder.decode();
	text += remainder;
	lineBuffer += remainder;
	yield* emitCompleteLines(true);
	return {
		text,
		truncated
	};
});
const makeGitCore = Effect.fn("makeGitCore")(function* (options) {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const { worktreesDir } = yield* ServerConfig;
	let executeRaw;
	if (options?.executeOverride) executeRaw = options.executeOverride;
	else {
		const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		executeRaw = Effect.fnUntraced(function* (input) {
			const commandInput = {
				...input,
				args: [...input.args]
			};
			const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS$1;
			const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
			const truncateOutputAtMaxBytes = input.truncateOutputAtMaxBytes ?? false;
			return yield* Effect.fn("runGitCommand")(function* () {
				const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(Effect.provideService(Path.Path, path), Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.mapError(toGitCommandError(commandInput, "failed to create trace2 monitor.")));
				const child = yield* commandSpawner.spawn(ChildProcess.make("git", commandInput.args, {
					cwd: commandInput.cwd,
					env: {
						...process.env,
						...input.env,
						...trace2Monitor.env
					}
				})).pipe(Effect.mapError(toGitCommandError(commandInput, "failed to spawn.")));
				const [stdout, stderr, exitCode] = yield* Effect.all([
					collectOutput(commandInput, child.stdout, maxOutputBytes, truncateOutputAtMaxBytes, input.progress?.onStdoutLine),
					collectOutput(commandInput, child.stderr, maxOutputBytes, truncateOutputAtMaxBytes, input.progress?.onStderrLine),
					child.exitCode.pipe(Effect.map((value) => Number(value)), Effect.mapError(toGitCommandError(commandInput, "failed to report exit code."))),
					input.stdin === void 0 ? Effect.void : Stream.run(Stream.encodeText(Stream.make(input.stdin)), child.stdin).pipe(Effect.mapError(toGitCommandError(commandInput, "failed to write stdin.")))
				], { concurrency: "unbounded" }).pipe(Effect.map(([stdout, stderr, exitCode]) => [
					stdout,
					stderr,
					exitCode
				]));
				yield* trace2Monitor.flush;
				if (!input.allowNonZeroExit && exitCode !== 0) {
					const trimmedStderr = stderr.text.trim();
					return yield* new GitCommandError({
						operation: commandInput.operation,
						command: quoteGitCommand(commandInput.args),
						cwd: commandInput.cwd,
						detail: trimmedStderr.length > 0 ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}` : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`
					});
				}
				return {
					code: exitCode,
					stdout: stdout.text,
					stderr: stderr.text,
					stdoutTruncated: stdout.truncated,
					stderrTruncated: stderr.truncated
				};
			})().pipe(Effect.scoped, Effect.timeoutOption(timeoutMs), Effect.flatMap((result) => Option.match(result, {
				onNone: () => Effect.fail(new GitCommandError({
					operation: commandInput.operation,
					command: quoteGitCommand(commandInput.args),
					cwd: commandInput.cwd,
					detail: `${quoteGitCommand(commandInput.args)} timed out.`
				})),
				onSome: Effect.succeed
			})));
		});
	}
	const execute = (input) => executeRaw(input).pipe(withMetrics({
		counter: gitCommandsTotal,
		timer: gitCommandDuration,
		attributes: { operation: input.operation }
	}), Effect.withSpan(input.operation, {
		kind: "client",
		attributes: {
			"git.operation": input.operation,
			"git.cwd": input.cwd,
			"git.args_count": input.args.length
		}
	}));
	const executeGit = (operation, cwd, args, options = {}) => execute({
		operation,
		cwd,
		args,
		...options.stdin !== void 0 ? { stdin: options.stdin } : {},
		allowNonZeroExit: true,
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		...options.maxOutputBytes !== void 0 ? { maxOutputBytes: options.maxOutputBytes } : {},
		...options.truncateOutputAtMaxBytes !== void 0 ? { truncateOutputAtMaxBytes: options.truncateOutputAtMaxBytes } : {},
		...options.progress ? { progress: options.progress } : {}
	}).pipe(Effect.flatMap((result) => {
		if (options.allowNonZeroExit || result.code === 0) return Effect.succeed(result);
		const stderr = result.stderr.trim();
		if (stderr.length > 0) return Effect.fail(createGitCommandError(operation, cwd, args, stderr));
		if (options.fallbackErrorMessage) return Effect.fail(createGitCommandError(operation, cwd, args, options.fallbackErrorMessage));
		return Effect.fail(createGitCommandError(operation, cwd, args, `${commandLabel(args)} failed: code=${result.code ?? "null"}`));
	}));
	const runGit = (operation, cwd, args, allowNonZeroExit = false) => executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.asVoid);
	const runGitStdout = (operation, cwd, args, allowNonZeroExit = false) => executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.map((result) => result.stdout));
	const runGitStdoutWithOptions = (operation, cwd, args, options = {}) => executeGit(operation, cwd, args, options).pipe(Effect.map((result) => result.stdoutTruncated ? `${result.stdout}${OUTPUT_TRUNCATED_MARKER}` : result.stdout));
	const branchExists = (cwd, branch) => executeGit("GitCore.branchExists", cwd, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`
	], {
		allowNonZeroExit: true,
		timeoutMs: 5e3
	}).pipe(Effect.map((result) => result.code === 0));
	const resolveAvailableBranchName = Effect.fn("resolveAvailableBranchName")(function* (cwd, desiredBranch) {
		if (!(yield* branchExists(cwd, desiredBranch))) return desiredBranch;
		for (let suffix = 1; suffix <= 100; suffix += 1) {
			const candidate = `${desiredBranch}-${suffix}`;
			if (!(yield* branchExists(cwd, candidate))) return candidate;
		}
		return yield* createGitCommandError("GitCore.renameBranch", cwd, [
			"branch",
			"-m",
			"--",
			desiredBranch
		], `Could not find an available branch name for '${desiredBranch}'.`);
	});
	const resolveCurrentUpstream = Effect.fn("resolveCurrentUpstream")(function* (cwd) {
		const upstreamRef = yield* runGitStdout("GitCore.resolveCurrentUpstream", cwd, [
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{upstream}"
		], true).pipe(Effect.map((stdout) => stdout.trim()));
		if (upstreamRef.length === 0 || upstreamRef === "@{upstream}") return null;
		return parseUpstreamRefWithRemoteNames(upstreamRef, yield* runGitStdout("GitCore.listRemoteNames", cwd, ["remote"]).pipe(Effect.map(parseRemoteNames), Effect.catch(() => Effect.succeed([])))) ?? parseUpstreamRefByFirstSeparator(upstreamRef);
	});
	const fetchUpstreamRefForStatus = (gitCommonDir, upstream) => {
		const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`;
		return executeGit("GitCore.fetchUpstreamRefForStatus", path.basename(gitCommonDir) === ".git" ? path.dirname(gitCommonDir) : gitCommonDir, [
			"--git-dir",
			gitCommonDir,
			"fetch",
			"--quiet",
			"--no-tags",
			upstream.remoteName,
			refspec
		], {
			allowNonZeroExit: true,
			timeoutMs: Duration.toMillis(STATUS_UPSTREAM_REFRESH_TIMEOUT)
		}).pipe(Effect.asVoid);
	};
	const resolveGitCommonDir = Effect.fn("resolveGitCommonDir")(function* (cwd) {
		const gitCommonDir = yield* runGitStdout("GitCore.resolveGitCommonDir", cwd, ["rev-parse", "--git-common-dir"]).pipe(Effect.map((stdout) => stdout.trim()));
		return path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
	});
	const refreshStatusUpstreamCacheEntry = Effect.fn("refreshStatusUpstreamCacheEntry")(function* (cacheKey) {
		yield* fetchUpstreamRefForStatus(cacheKey.gitCommonDir, {
			upstreamRef: cacheKey.upstreamRef,
			remoteName: cacheKey.remoteName,
			upstreamBranch: cacheKey.upstreamBranch
		});
		return true;
	});
	const statusUpstreamRefreshCache = yield* Cache.makeWith({
		capacity: STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY,
		lookup: refreshStatusUpstreamCacheEntry,
		timeToLive: (exit) => Exit.isSuccess(exit) ? STATUS_UPSTREAM_REFRESH_INTERVAL : STATUS_UPSTREAM_REFRESH_FAILURE_COOLDOWN
	});
	const refreshStatusUpstreamIfStale = Effect.fn("refreshStatusUpstreamIfStale")(function* (cwd) {
		const upstream = yield* resolveCurrentUpstream(cwd);
		if (!upstream) return;
		const gitCommonDir = yield* resolveGitCommonDir(cwd);
		yield* Cache.get(statusUpstreamRefreshCache, new StatusUpstreamRefreshCacheKey({
			gitCommonDir,
			upstreamRef: upstream.upstreamRef,
			remoteName: upstream.remoteName,
			upstreamBranch: upstream.upstreamBranch
		}));
	});
	const resolveDefaultBranchName = (cwd, remoteName) => executeGit("GitCore.resolveDefaultBranchName", cwd, ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`], { allowNonZeroExit: true }).pipe(Effect.map((result) => {
		if (result.code !== 0) return null;
		return parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName);
	}));
	const remoteBranchExists = (cwd, remoteName, branch) => executeGit("GitCore.remoteBranchExists", cwd, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/remotes/${remoteName}/${branch}`
	], { allowNonZeroExit: true }).pipe(Effect.map((result) => result.code === 0));
	const originRemoteExists = (cwd) => executeGit("GitCore.originRemoteExists", cwd, [
		"remote",
		"get-url",
		"origin"
	], { allowNonZeroExit: true }).pipe(Effect.map((result) => result.code === 0));
	const listRemoteNames = (cwd) => runGitStdout("GitCore.listRemoteNames", cwd, ["remote"]).pipe(Effect.map(parseRemoteNamesInGitOrder));
	const resolvePrimaryRemoteName = Effect.fn("resolvePrimaryRemoteName")(function* (cwd) {
		if (yield* originRemoteExists(cwd)) return "origin";
		const [firstRemote] = yield* listRemoteNames(cwd);
		if (firstRemote) return firstRemote;
		return yield* createGitCommandError("GitCore.resolvePrimaryRemoteName", cwd, ["remote"], "No git remote is configured for this repository.");
	});
	const resolvePushRemoteName = Effect.fn("resolvePushRemoteName")(function* (cwd, branch) {
		const branchPushRemote = yield* runGitStdout("GitCore.resolvePushRemoteName.branchPushRemote", cwd, [
			"config",
			"--get",
			`branch.${branch}.pushRemote`
		], true).pipe(Effect.map((stdout) => stdout.trim()));
		if (branchPushRemote.length > 0) return branchPushRemote;
		const pushDefaultRemote = yield* runGitStdout("GitCore.resolvePushRemoteName.remotePushDefault", cwd, [
			"config",
			"--get",
			"remote.pushDefault"
		], true).pipe(Effect.map((stdout) => stdout.trim()));
		if (pushDefaultRemote.length > 0) return pushDefaultRemote;
		return yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
	});
	const ensureRemote = Effect.fn("ensureRemote")(function* (input) {
		const preferredName = sanitizeRemoteName(input.preferredName);
		const normalizedTargetUrl = normalizeRemoteUrl(input.url);
		const remoteFetchUrls = yield* runGitStdout("GitCore.ensureRemote.listRemoteUrls", input.cwd, ["remote", "-v"]).pipe(Effect.map((stdout) => parseRemoteFetchUrls(stdout)));
		for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) return remoteName;
		let remoteName = preferredName;
		let suffix = 1;
		while (remoteFetchUrls.has(remoteName)) {
			remoteName = `${preferredName}-${suffix}`;
			suffix += 1;
		}
		yield* runGit("GitCore.ensureRemote.add", input.cwd, [
			"remote",
			"add",
			remoteName,
			input.url
		]);
		return remoteName;
	});
	const resolveBaseBranchForNoUpstream = Effect.fn("resolveBaseBranchForNoUpstream")(function* (cwd, branch) {
		const configuredBaseBranch = yield* runGitStdout("GitCore.resolveBaseBranchForNoUpstream.config", cwd, [
			"config",
			"--get",
			`branch.${branch}.gh-merge-base`
		], true).pipe(Effect.map((stdout) => stdout.trim()));
		const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
		const defaultBranch = primaryRemoteName === null ? null : yield* resolveDefaultBranchName(cwd, primaryRemoteName);
		const candidates = [
			configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
			defaultBranch,
			...DEFAULT_BASE_BRANCH_CANDIDATES
		];
		for (const candidate of candidates) {
			if (!candidate) continue;
			const remotePrefix = primaryRemoteName && primaryRemoteName !== "origin" ? `${primaryRemoteName}/` : null;
			const normalizedCandidate = candidate.startsWith("origin/") ? candidate.slice(7) : remotePrefix && candidate.startsWith(remotePrefix) ? candidate.slice(remotePrefix.length) : candidate;
			if (normalizedCandidate.length === 0 || normalizedCandidate === branch) continue;
			if (yield* branchExists(cwd, normalizedCandidate)) return normalizedCandidate;
			if (primaryRemoteName && (yield* remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))) return `${primaryRemoteName}/${normalizedCandidate}`;
		}
		return null;
	});
	const computeAheadCountAgainstBase = Effect.fn("computeAheadCountAgainstBase")(function* (cwd, branch) {
		const baseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch);
		if (!baseBranch) return 0;
		const result = yield* executeGit("GitCore.computeAheadCountAgainstBase", cwd, [
			"rev-list",
			"--count",
			`${baseBranch}..HEAD`
		], { allowNonZeroExit: true });
		if (result.code !== 0) return 0;
		const parsed = Number.parseInt(result.stdout.trim(), 10);
		return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
	});
	const readBranchRecency = Effect.fn("readBranchRecency")(function* (cwd) {
		const branchRecency = yield* executeGit("GitCore.readBranchRecency", cwd, [
			"for-each-ref",
			"--format=%(refname:short)%09%(committerdate:unix)",
			"refs/heads",
			"refs/remotes"
		], {
			timeoutMs: 15e3,
			allowNonZeroExit: true
		});
		const branchLastCommit = /* @__PURE__ */ new Map();
		if (branchRecency.code !== 0) return branchLastCommit;
		for (const line of branchRecency.stdout.split("\n")) {
			if (line.length === 0) continue;
			const [name, lastCommitRaw] = line.split("	");
			if (!name) continue;
			const lastCommit = Number.parseInt(lastCommitRaw ?? "0", 10);
			branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0);
		}
		return branchLastCommit;
	});
	const statusDetails = Effect.fn("statusDetails")(function* (cwd) {
		yield* refreshStatusUpstreamIfStale(cwd).pipe(Effect.ignoreCause({ log: true }));
		const statusResult = yield* executeGit("GitCore.statusDetails.status", cwd, [
			"status",
			"--porcelain=2",
			"--branch"
		], { allowNonZeroExit: true });
		if (statusResult.code !== 0) return yield* createGitCommandError("GitCore.statusDetails.status", cwd, [
			"status",
			"--porcelain=2",
			"--branch"
		], statusResult.stderr.trim() || "git status failed");
		const [unstagedNumstatStdout, stagedNumstatStdout, defaultRefResult, hasOriginRemote] = yield* Effect.all([
			runGitStdout("GitCore.statusDetails.unstagedNumstat", cwd, ["diff", "--numstat"]),
			runGitStdout("GitCore.statusDetails.stagedNumstat", cwd, [
				"diff",
				"--cached",
				"--numstat"
			]),
			executeGit("GitCore.statusDetails.defaultRef", cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"], { allowNonZeroExit: true }),
			originRemoteExists(cwd).pipe(Effect.catch(() => Effect.succeed(false)))
		], { concurrency: "unbounded" });
		const statusStdout = statusResult.stdout;
		const defaultBranch = defaultRefResult.code === 0 ? defaultRefResult.stdout.trim().replace(/^refs\/remotes\/origin\//, "") : null;
		let branch = null;
		let upstreamRef = null;
		let aheadCount = 0;
		let behindCount = 0;
		let hasWorkingTreeChanges = false;
		const changedFilesWithoutNumstat = /* @__PURE__ */ new Set();
		for (const line of statusStdout.split(/\r?\n/g)) {
			if (line.startsWith("# branch.head ")) {
				const value = line.slice(14).trim();
				branch = value.startsWith("(") ? null : value;
				continue;
			}
			if (line.startsWith("# branch.upstream ")) {
				const value = line.slice(18).trim();
				upstreamRef = value.length > 0 ? value : null;
				continue;
			}
			if (line.startsWith("# branch.ab ")) {
				const parsed = parseBranchAb(line.slice(12).trim());
				aheadCount = parsed.ahead;
				behindCount = parsed.behind;
				continue;
			}
			if (line.trim().length > 0 && !line.startsWith("#")) {
				hasWorkingTreeChanges = true;
				const pathValue = parsePorcelainPath(line);
				if (pathValue) changedFilesWithoutNumstat.add(pathValue);
			}
		}
		if (!upstreamRef && branch) {
			aheadCount = yield* computeAheadCountAgainstBase(cwd, branch).pipe(Effect.catch(() => Effect.succeed(0)));
			behindCount = 0;
		}
		const stagedEntries = parseNumstatEntries(stagedNumstatStdout);
		const unstagedEntries = parseNumstatEntries(unstagedNumstatStdout);
		const fileStatMap = /* @__PURE__ */ new Map();
		for (const entry of [...stagedEntries, ...unstagedEntries]) {
			const existing = fileStatMap.get(entry.path) ?? {
				insertions: 0,
				deletions: 0
			};
			existing.insertions += entry.insertions;
			existing.deletions += entry.deletions;
			fileStatMap.set(entry.path, existing);
		}
		let insertions = 0;
		let deletions = 0;
		const files = Array.from(fileStatMap.entries()).map(([filePath, stat]) => {
			insertions += stat.insertions;
			deletions += stat.deletions;
			return {
				path: filePath,
				insertions: stat.insertions,
				deletions: stat.deletions
			};
		}).toSorted((a, b) => a.path.localeCompare(b.path));
		for (const filePath of changedFilesWithoutNumstat) {
			if (fileStatMap.has(filePath)) continue;
			files.push({
				path: filePath,
				insertions: 0,
				deletions: 0
			});
		}
		files.sort((a, b) => a.path.localeCompare(b.path));
		return {
			isRepo: true,
			hasOriginRemote,
			isDefaultBranch: branch !== null && (branch === defaultBranch || defaultBranch === null && (branch === "main" || branch === "master")),
			branch,
			upstreamRef,
			hasWorkingTreeChanges,
			workingTree: {
				files,
				insertions,
				deletions
			},
			hasUpstream: upstreamRef !== null,
			aheadCount,
			behindCount
		};
	});
	const status = (input) => statusDetails(input.cwd).pipe(Effect.map((details) => ({
		isRepo: details.isRepo,
		hasOriginRemote: details.hasOriginRemote,
		isDefaultBranch: details.isDefaultBranch,
		branch: details.branch,
		hasWorkingTreeChanges: details.hasWorkingTreeChanges,
		workingTree: details.workingTree,
		hasUpstream: details.hasUpstream,
		aheadCount: details.aheadCount,
		behindCount: details.behindCount,
		pr: null
	})));
	const prepareCommitContext = Effect.fn("prepareCommitContext")(function* (cwd, filePaths) {
		if (filePaths && filePaths.length > 0) {
			yield* runGit("GitCore.prepareCommitContext.reset", cwd, ["reset"]).pipe(Effect.catch(() => Effect.void));
			yield* runGit("GitCore.prepareCommitContext.addSelected", cwd, [
				"add",
				"-A",
				"--",
				...filePaths
			]);
		} else yield* runGit("GitCore.prepareCommitContext.addAll", cwd, ["add", "-A"]);
		const stagedSummary = yield* runGitStdout("GitCore.prepareCommitContext.stagedSummary", cwd, [
			"diff",
			"--cached",
			"--name-status"
		]).pipe(Effect.map((stdout) => stdout.trim()));
		if (stagedSummary.length === 0) return null;
		return {
			stagedSummary,
			stagedPatch: yield* runGitStdoutWithOptions("GitCore.prepareCommitContext.stagedPatch", cwd, [
				"diff",
				"--cached",
				"--patch",
				"--minimal"
			], {
				maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true
			})
		};
	});
	const commit = Effect.fn("commit")(function* (cwd, subject, body, options) {
		const args = [
			"commit",
			"-m",
			subject
		];
		const trimmedBody = body.trim();
		if (trimmedBody.length > 0) args.push("-m", trimmedBody);
		const progress = options?.progress?.onOutputLine === void 0 ? options?.progress : {
			...options.progress,
			onStdoutLine: (line) => options.progress?.onOutputLine?.({
				stream: "stdout",
				text: line
			}) ?? Effect.void,
			onStderrLine: (line) => options.progress?.onOutputLine?.({
				stream: "stderr",
				text: line
			}) ?? Effect.void
		};
		yield* executeGit("GitCore.commit.commit", cwd, args, {
			...options?.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
			...progress ? { progress } : {}
		}).pipe(Effect.asVoid);
		return { commitSha: yield* runGitStdout("GitCore.commit.revParseHead", cwd, ["rev-parse", "HEAD"]).pipe(Effect.map((stdout) => stdout.trim())) };
	});
	const pushCurrentBranch = Effect.fn("pushCurrentBranch")(function* (cwd, fallbackBranch) {
		const details = yield* statusDetails(cwd);
		const branch = details.branch ?? fallbackBranch;
		if (!branch) return yield* createGitCommandError("GitCore.pushCurrentBranch", cwd, ["push"], "Cannot push from detached HEAD.");
		if (details.aheadCount === 0 && details.behindCount === 0) {
			if (details.hasUpstream) return {
				status: "skipped_up_to_date",
				branch,
				...details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}
			};
			if (yield* resolveBaseBranchForNoUpstream(cwd, branch).pipe(Effect.catch(() => Effect.succeed(null)))) {
				const publishRemoteName = yield* resolvePushRemoteName(cwd, branch).pipe(Effect.catch(() => Effect.succeed(null)));
				if (!publishRemoteName) return {
					status: "skipped_up_to_date",
					branch
				};
				if (yield* remoteBranchExists(cwd, publishRemoteName, branch).pipe(Effect.catch(() => Effect.succeed(false)))) return {
					status: "skipped_up_to_date",
					branch
				};
			}
		}
		if (!details.hasUpstream) {
			const publishRemoteName = yield* resolvePushRemoteName(cwd, branch);
			if (!publishRemoteName) return yield* createGitCommandError("GitCore.pushCurrentBranch", cwd, ["push"], "Cannot push because no git remote is configured for this repository.");
			yield* runGit("GitCore.pushCurrentBranch.pushWithUpstream", cwd, [
				"push",
				"-u",
				publishRemoteName,
				`HEAD:refs/heads/${branch}`
			]);
			return {
				status: "pushed",
				branch,
				upstreamBranch: `${publishRemoteName}/${branch}`,
				setUpstream: true
			};
		}
		const currentUpstream = yield* resolveCurrentUpstream(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
		if (currentUpstream) {
			yield* runGit("GitCore.pushCurrentBranch.pushUpstream", cwd, [
				"push",
				currentUpstream.remoteName,
				`HEAD:${currentUpstream.upstreamBranch}`
			]);
			return {
				status: "pushed",
				branch,
				upstreamBranch: currentUpstream.upstreamRef,
				setUpstream: false
			};
		}
		yield* runGit("GitCore.pushCurrentBranch.push", cwd, ["push"]);
		return {
			status: "pushed",
			branch,
			...details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {},
			setUpstream: false
		};
	});
	const pullCurrentBranch = Effect.fn("pullCurrentBranch")(function* (cwd) {
		const details = yield* statusDetails(cwd);
		const branch = details.branch;
		if (!branch) return yield* createGitCommandError("GitCore.pullCurrentBranch", cwd, ["pull", "--ff-only"], "Cannot pull from detached HEAD.");
		if (!details.hasUpstream) return yield* createGitCommandError("GitCore.pullCurrentBranch", cwd, ["pull", "--ff-only"], "Current branch has no upstream configured. Push with upstream first.");
		const beforeSha = yield* runGitStdout("GitCore.pullCurrentBranch.beforeSha", cwd, ["rev-parse", "HEAD"], true).pipe(Effect.map((stdout) => stdout.trim()));
		yield* executeGit("GitCore.pullCurrentBranch.pull", cwd, ["pull", "--ff-only"], {
			timeoutMs: 3e4,
			fallbackErrorMessage: "git pull failed"
		});
		const afterSha = yield* runGitStdout("GitCore.pullCurrentBranch.afterSha", cwd, ["rev-parse", "HEAD"], true).pipe(Effect.map((stdout) => stdout.trim()));
		const refreshed = yield* statusDetails(cwd);
		return {
			status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
			branch,
			upstreamBranch: refreshed.upstreamRef
		};
	});
	const readRangeContext = Effect.fn("readRangeContext")(function* (cwd, baseBranch) {
		const range = `${baseBranch}..HEAD`;
		const [commitSummary, diffSummary, diffPatch] = yield* Effect.all([
			runGitStdoutWithOptions("GitCore.readRangeContext.log", cwd, [
				"log",
				"--oneline",
				range
			], {
				maxOutputBytes: RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true
			}),
			runGitStdoutWithOptions("GitCore.readRangeContext.diffStat", cwd, [
				"diff",
				"--stat",
				range
			], {
				maxOutputBytes: RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true
			}),
			runGitStdoutWithOptions("GitCore.readRangeContext.diffPatch", cwd, [
				"diff",
				"--patch",
				"--minimal",
				range
			], {
				maxOutputBytes: RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true
			})
		], { concurrency: "unbounded" });
		return {
			commitSummary,
			diffSummary,
			diffPatch
		};
	});
	const readConfigValue = (cwd, key) => runGitStdout("GitCore.readConfigValue", cwd, [
		"config",
		"--get",
		key
	], true).pipe(Effect.map((stdout) => stdout.trim()), Effect.map((trimmed) => trimmed.length > 0 ? trimmed : null));
	const isInsideWorkTree = (cwd) => executeGit("GitCore.isInsideWorkTree", cwd, ["rev-parse", "--is-inside-work-tree"], {
		allowNonZeroExit: true,
		timeoutMs: 5e3,
		maxOutputBytes: 4096
	}).pipe(Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"));
	const listWorkspaceFiles = (cwd) => executeGit("GitCore.listWorkspaceFiles", cwd, [
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"-z"
	], {
		allowNonZeroExit: true,
		timeoutMs: 2e4,
		maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
		truncateOutputAtMaxBytes: true
	}).pipe(Effect.flatMap((result) => result.code === 0 ? Effect.succeed({
		paths: splitNullSeparatedPaths(result.stdout, result.stdoutTruncated),
		truncated: result.stdoutTruncated
	}) : Effect.fail(createGitCommandError("GitCore.listWorkspaceFiles", cwd, [
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"-z"
	], result.stderr.trim().length > 0 ? result.stderr.trim() : "git ls-files failed"))));
	const filterIgnoredPaths = (cwd, relativePaths) => Effect.gen(function* () {
		if (relativePaths.length === 0) return relativePaths;
		const ignoredPaths = /* @__PURE__ */ new Set();
		const chunks = chunkPathsForGitCheckIgnore(relativePaths);
		for (const chunk of chunks) {
			const result = yield* executeGit("GitCore.filterIgnoredPaths", cwd, [
				"check-ignore",
				"--no-index",
				"-z",
				"--stdin"
			], {
				stdin: `${chunk.join("\0")}\0`,
				allowNonZeroExit: true,
				timeoutMs: 2e4,
				maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true
			});
			if (result.code !== 0 && result.code !== 1) return yield* createGitCommandError("GitCore.filterIgnoredPaths", cwd, [
				"check-ignore",
				"--no-index",
				"-z",
				"--stdin"
			], result.stderr.trim().length > 0 ? result.stderr.trim() : "git check-ignore failed");
			for (const ignoredPath of splitNullSeparatedPaths(result.stdout, result.stdoutTruncated)) ignoredPaths.add(ignoredPath);
		}
		if (ignoredPaths.size === 0) return relativePaths;
		return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
	});
	const listBranches = Effect.fn("listBranches")(function* (input) {
		const branchRecencyPromise = readBranchRecency(input.cwd).pipe(Effect.catch(() => Effect.succeed(/* @__PURE__ */ new Map())));
		const localBranchResult = yield* executeGit("GitCore.listBranches.branchNoColor", input.cwd, [
			"branch",
			"--no-color",
			"--no-column"
		], {
			timeoutMs: 1e4,
			allowNonZeroExit: true
		});
		if (localBranchResult.code !== 0) {
			const stderr = localBranchResult.stderr.trim();
			if (stderr.toLowerCase().includes("not a git repository")) return {
				branches: [],
				isRepo: false,
				hasOriginRemote: false,
				nextCursor: null,
				totalCount: 0
			};
			return yield* createGitCommandError("GitCore.listBranches", input.cwd, [
				"branch",
				"--no-color",
				"--no-column"
			], stderr || "git branch failed");
		}
		const remoteBranchResultEffect = executeGit("GitCore.listBranches.remoteBranches", input.cwd, [
			"branch",
			"--no-color",
			"--no-column",
			"--remotes"
		], {
			timeoutMs: 1e4,
			allowNonZeroExit: true
		}).pipe(Effect.catch((error) => Effect.logWarning(`GitCore.listBranches: remote branch lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote branch list.`).pipe(Effect.as({
			code: 1,
			stdout: "",
			stderr: ""
		}))));
		const remoteNamesResultEffect = executeGit("GitCore.listBranches.remoteNames", input.cwd, ["remote"], {
			timeoutMs: 5e3,
			allowNonZeroExit: true
		}).pipe(Effect.catch((error) => Effect.logWarning(`GitCore.listBranches: remote name lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote name list.`).pipe(Effect.as({
			code: 1,
			stdout: "",
			stderr: ""
		}))));
		const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] = yield* Effect.all([
			executeGit("GitCore.listBranches.defaultRef", input.cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"], {
				timeoutMs: 5e3,
				allowNonZeroExit: true
			}),
			executeGit("GitCore.listBranches.worktreeList", input.cwd, [
				"worktree",
				"list",
				"--porcelain"
			], {
				timeoutMs: 5e3,
				allowNonZeroExit: true
			}),
			remoteBranchResultEffect,
			remoteNamesResultEffect,
			branchRecencyPromise
		], { concurrency: "unbounded" });
		const remoteNames = remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : [];
		if (remoteBranchResult.code !== 0 && remoteBranchResult.stderr.trim().length > 0) yield* Effect.logWarning(`GitCore.listBranches: remote branch lookup returned code ${remoteBranchResult.code} for ${input.cwd}: ${remoteBranchResult.stderr.trim()}. Falling back to an empty remote branch list.`);
		if (remoteNamesResult.code !== 0 && remoteNamesResult.stderr.trim().length > 0) yield* Effect.logWarning(`GitCore.listBranches: remote name lookup returned code ${remoteNamesResult.code} for ${input.cwd}: ${remoteNamesResult.stderr.trim()}. Falling back to an empty remote name list.`);
		const defaultBranch = defaultRef.code === 0 ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "") : null;
		const worktreeMap = /* @__PURE__ */ new Map();
		if (worktreeList.code === 0) {
			let currentPath = null;
			for (const line of worktreeList.stdout.split("\n")) if (line.startsWith("worktree ")) {
				const candidatePath = line.slice(9);
				currentPath = (yield* fileSystem.stat(candidatePath).pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)))) ? candidatePath : null;
			} else if (line.startsWith("branch refs/heads/") && currentPath) worktreeMap.set(line.slice(18), currentPath);
			else if (line === "") currentPath = null;
		}
		const localBranches = localBranchResult.stdout.split("\n").map(parseBranchLine).filter((branch) => branch !== null).map((branch) => ({
			name: branch.name,
			current: branch.current,
			isRemote: false,
			isDefault: branch.name === defaultBranch,
			worktreePath: worktreeMap.get(branch.name) ?? null
		})).toSorted((a, b) => {
			const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
			const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
			if (aPriority !== bPriority) return aPriority - bPriority;
			const aLastCommit = branchLastCommit.get(a.name) ?? 0;
			const bLastCommit = branchLastCommit.get(b.name) ?? 0;
			if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
			return a.name.localeCompare(b.name);
		});
		const remoteBranches = remoteBranchResult.code === 0 ? remoteBranchResult.stdout.split("\n").map(parseBranchLine).filter((branch) => branch !== null).map((branch) => {
			const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, remoteNames);
			const remoteBranch = {
				name: branch.name,
				current: false,
				isRemote: true,
				isDefault: false,
				worktreePath: null
			};
			if (parsedRemoteRef) remoteBranch.remoteName = parsedRemoteRef.remoteName;
			return remoteBranch;
		}).toSorted((a, b) => {
			const aLastCommit = branchLastCommit.get(a.name) ?? 0;
			const bLastCommit = branchLastCommit.get(b.name) ?? 0;
			if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
			return a.name.localeCompare(b.name);
		}) : [];
		const branches = paginateBranches({
			branches: filterBranchesForListQuery(dedupeRemoteBranchesWithLocalMatches([...localBranches, ...remoteBranches]), input.query),
			cursor: input.cursor,
			limit: input.limit
		});
		return {
			branches: [...branches.branches],
			isRepo: true,
			hasOriginRemote: remoteNames.includes("origin"),
			nextCursor: branches.nextCursor,
			totalCount: branches.totalCount
		};
	});
	const createWorktree = Effect.fn("createWorktree")(function* (input) {
		const targetBranch = input.newBranch ?? input.branch;
		const sanitizedBranch = targetBranch.replace(/\//g, "-");
		const repoName = path.basename(input.cwd);
		const worktreePath = input.path ?? path.join(worktreesDir, repoName, sanitizedBranch);
		const args = input.newBranch ? [
			"worktree",
			"add",
			"-b",
			input.newBranch,
			worktreePath,
			input.branch
		] : [
			"worktree",
			"add",
			worktreePath,
			input.branch
		];
		yield* executeGit("GitCore.createWorktree", input.cwd, args, { fallbackErrorMessage: "git worktree add failed" });
		return { worktree: {
			path: worktreePath,
			branch: targetBranch
		} };
	});
	const fetchPullRequestBranch = Effect.fn("fetchPullRequestBranch")(function* (input) {
		const remoteName = yield* resolvePrimaryRemoteName(input.cwd);
		yield* executeGit("GitCore.fetchPullRequestBranch", input.cwd, [
			"fetch",
			"--quiet",
			"--no-tags",
			remoteName,
			`+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`
		], { fallbackErrorMessage: "git fetch pull request branch failed" });
	});
	const fetchRemoteBranch = Effect.fn("fetchRemoteBranch")(function* (input) {
		yield* runGit("GitCore.fetchRemoteBranch.fetch", input.cwd, [
			"fetch",
			"--quiet",
			"--no-tags",
			input.remoteName,
			`+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`
		]);
		const localBranchAlreadyExists = yield* branchExists(input.cwd, input.localBranch);
		const targetRef = `${input.remoteName}/${input.remoteBranch}`;
		yield* runGit("GitCore.fetchRemoteBranch.materialize", input.cwd, localBranchAlreadyExists ? [
			"branch",
			"--force",
			input.localBranch,
			targetRef
		] : [
			"branch",
			input.localBranch,
			targetRef
		]);
	});
	const setBranchUpstream = (input) => runGit("GitCore.setBranchUpstream", input.cwd, [
		"branch",
		"--set-upstream-to",
		`${input.remoteName}/${input.remoteBranch}`,
		input.branch
	]);
	const removeWorktree = Effect.fn("removeWorktree")(function* (input) {
		const args = ["worktree", "remove"];
		if (input.force) args.push("--force");
		args.push(input.path);
		yield* executeGit("GitCore.removeWorktree", input.cwd, args, {
			timeoutMs: 15e3,
			fallbackErrorMessage: "git worktree remove failed"
		}).pipe(Effect.mapError((error) => createGitCommandError("GitCore.removeWorktree", input.cwd, args, `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`, error)));
	});
	const renameBranch = Effect.fn("renameBranch")(function* (input) {
		if (input.oldBranch === input.newBranch) return { branch: input.newBranch };
		const targetBranch = yield* resolveAvailableBranchName(input.cwd, input.newBranch);
		yield* executeGit("GitCore.renameBranch", input.cwd, [
			"branch",
			"-m",
			"--",
			input.oldBranch,
			targetBranch
		], {
			timeoutMs: 1e4,
			fallbackErrorMessage: "git branch rename failed"
		});
		return { branch: targetBranch };
	});
	const createBranch = (input) => executeGit("GitCore.createBranch", input.cwd, ["branch", input.branch], {
		timeoutMs: 1e4,
		fallbackErrorMessage: "git branch create failed"
	}).pipe(Effect.asVoid);
	const checkoutBranch = Effect.fn("checkoutBranch")(function* (input) {
		const [localInputExists, remoteExists] = yield* Effect.all([executeGit("GitCore.checkoutBranch.localInputExists", input.cwd, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${input.branch}`
		], {
			timeoutMs: 5e3,
			allowNonZeroExit: true
		}).pipe(Effect.map((result) => result.code === 0)), executeGit("GitCore.checkoutBranch.remoteExists", input.cwd, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/remotes/${input.branch}`
		], {
			timeoutMs: 5e3,
			allowNonZeroExit: true
		}).pipe(Effect.map((result) => result.code === 0))], { concurrency: "unbounded" });
		const localTrackingBranch = remoteExists ? yield* executeGit("GitCore.checkoutBranch.localTrackingBranch", input.cwd, [
			"for-each-ref",
			"--format=%(refname:short)	%(upstream:short)",
			"refs/heads"
		], {
			timeoutMs: 5e3,
			allowNonZeroExit: true
		}).pipe(Effect.map((result) => result.code === 0 ? parseTrackingBranchByUpstreamRef(result.stdout, input.branch) : null)) : null;
		const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(input.branch);
		const localTrackedBranchTargetExists = remoteExists && localTrackedBranchCandidate ? yield* executeGit("GitCore.checkoutBranch.localTrackedBranchTargetExists", input.cwd, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${localTrackedBranchCandidate}`
		], {
			timeoutMs: 5e3,
			allowNonZeroExit: true
		}).pipe(Effect.map((result) => result.code === 0)) : false;
		const checkoutArgs = localInputExists ? ["checkout", input.branch] : remoteExists && !localTrackingBranch && localTrackedBranchTargetExists ? ["checkout", input.branch] : remoteExists && !localTrackingBranch ? [
			"checkout",
			"--track",
			input.branch
		] : remoteExists && localTrackingBranch ? ["checkout", localTrackingBranch] : ["checkout", input.branch];
		yield* executeGit("GitCore.checkoutBranch.checkout", input.cwd, checkoutArgs, {
			timeoutMs: 1e4,
			fallbackErrorMessage: "git checkout failed"
		});
	});
	const initRepo = (input) => executeGit("GitCore.initRepo", input.cwd, ["init"], {
		timeoutMs: 1e4,
		fallbackErrorMessage: "git init failed"
	}).pipe(Effect.asVoid);
	const listLocalBranchNames = (cwd) => runGitStdout("GitCore.listLocalBranchNames", cwd, [
		"branch",
		"--list",
		"--no-column",
		"--format=%(refname:short)"
	]).pipe(Effect.map((stdout) => stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)));
	return {
		execute,
		status,
		statusDetails,
		prepareCommitContext,
		commit,
		pushCurrentBranch,
		pullCurrentBranch,
		readRangeContext,
		readConfigValue,
		isInsideWorkTree,
		listWorkspaceFiles,
		filterIgnoredPaths,
		listBranches,
		createWorktree,
		fetchPullRequestBranch,
		ensureRemote,
		fetchRemoteBranch,
		setBranchUpstream,
		removeWorktree,
		renameBranch,
		createBranch,
		checkoutBranch,
		initRepo,
		listLocalBranchNames
	};
});
const GitCoreLive = Layer.effect(GitCore, makeGitCore());

//#endregion
//#region src/git/Services/GitHubCli.ts
/**
* GitHubCli - Effect service contract for `gh` process interactions.
*
* Provides thin command execution helpers used by Git workflow orchestration.
*
* @module GitHubCli
*/
/**
* GitHubCli - Service tag for GitHub CLI process execution.
*/
var GitHubCli = class extends ServiceMap.Service()("t3/git/Services/GitHubCli") {};

//#endregion
//#region src/git/Layers/GitHubCli.ts
const DEFAULT_TIMEOUT_MS = 3e4;
function normalizeGitHubCliError(operation, error) {
	if (error instanceof Error) {
		if (error.message.includes("Command not found: gh")) return new GitHubCliError({
			operation,
			detail: "GitHub CLI (`gh`) is required but not available on PATH.",
			cause: error
		});
		const lower = error.message.toLowerCase();
		if (lower.includes("authentication failed") || lower.includes("not logged in") || lower.includes("gh auth login") || lower.includes("no oauth token")) return new GitHubCliError({
			operation,
			detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
			cause: error
		});
		if (lower.includes("could not resolve to a pullrequest") || lower.includes("repository.pullrequest") || lower.includes("no pull requests found for branch") || lower.includes("pull request not found")) return new GitHubCliError({
			operation,
			detail: "Pull request not found. Check the PR number or URL and try again.",
			cause: error
		});
		return new GitHubCliError({
			operation,
			detail: `GitHub CLI command failed: ${error.message}`,
			cause: error
		});
	}
	return new GitHubCliError({
		operation,
		detail: "GitHub CLI command failed.",
		cause: error
	});
}
function normalizePullRequestState(input) {
	const mergedAt = input.mergedAt;
	const state = input.state;
	if (typeof mergedAt === "string" && mergedAt.trim().length > 0 || state === "MERGED") return "merged";
	if (state === "CLOSED") return "closed";
	return "open";
}
const RawGitHubPullRequestSchema = Schema.Struct({
	number: PositiveInt,
	title: TrimmedNonEmptyString,
	url: TrimmedNonEmptyString,
	baseRefName: TrimmedNonEmptyString,
	headRefName: TrimmedNonEmptyString,
	state: Schema.optional(Schema.NullOr(Schema.String)),
	mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
	isCrossRepository: Schema.optional(Schema.Boolean),
	headRepository: Schema.optional(Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String }))),
	headRepositoryOwner: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String })))
});
const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
	nameWithOwner: TrimmedNonEmptyString,
	url: TrimmedNonEmptyString,
	sshUrl: TrimmedNonEmptyString
});
function normalizePullRequestSummary(raw) {
	const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
	const headRepositoryOwnerLogin = raw.headRepositoryOwner?.login ?? (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/") ? headRepositoryNameWithOwner.split("/")[0] ?? null : null);
	return {
		number: raw.number,
		title: raw.title,
		url: raw.url,
		baseRefName: raw.baseRefName,
		headRefName: raw.headRefName,
		state: normalizePullRequestState(raw),
		...typeof raw.isCrossRepository === "boolean" ? { isCrossRepository: raw.isCrossRepository } : {},
		...headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {},
		...headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}
	};
}
function normalizeRepositoryCloneUrls(raw) {
	return {
		nameWithOwner: raw.nameWithOwner,
		url: raw.url,
		sshUrl: raw.sshUrl
	};
}
function decodeGitHubJson(raw, schema, operation, invalidDetail) {
	return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(Effect.mapError((error) => new GitHubCliError({
		operation,
		detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
		cause: error
	})));
}
const makeGitHubCli = Effect.sync(() => {
	const execute = (input) => Effect.tryPromise({
		try: () => runProcess("gh", input.args, {
			cwd: input.cwd,
			timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
		}),
		catch: (error) => normalizeGitHubCliError("execute", error)
	});
	return {
		execute,
		listOpenPullRequests: (input) => execute({
			cwd: input.cwd,
			args: [
				"pr",
				"list",
				"--head",
				input.headSelector,
				"--state",
				"open",
				"--limit",
				String(input.limit ?? 1),
				"--json",
				"number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner"
			]
		}).pipe(Effect.map((result) => result.stdout.trim()), Effect.flatMap((raw) => raw.length === 0 ? Effect.succeed([]) : decodeGitHubJson(raw, Schema.Array(RawGitHubPullRequestSchema), "listOpenPullRequests", "GitHub CLI returned invalid PR list JSON.")), Effect.map((pullRequests) => pullRequests.map(normalizePullRequestSummary))),
		getPullRequest: (input) => execute({
			cwd: input.cwd,
			args: [
				"pr",
				"view",
				input.reference,
				"--json",
				"number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner"
			]
		}).pipe(Effect.map((result) => result.stdout.trim()), Effect.flatMap((raw) => decodeGitHubJson(raw, RawGitHubPullRequestSchema, "getPullRequest", "GitHub CLI returned invalid pull request JSON.")), Effect.map(normalizePullRequestSummary)),
		getRepositoryCloneUrls: (input) => execute({
			cwd: input.cwd,
			args: [
				"repo",
				"view",
				input.repository,
				"--json",
				"nameWithOwner,url,sshUrl"
			]
		}).pipe(Effect.map((result) => result.stdout.trim()), Effect.flatMap((raw) => decodeGitHubJson(raw, RawGitHubRepositoryCloneUrlsSchema, "getRepositoryCloneUrls", "GitHub CLI returned invalid repository JSON.")), Effect.map(normalizeRepositoryCloneUrls)),
		createPullRequest: (input) => execute({
			cwd: input.cwd,
			args: [
				"pr",
				"create",
				"--base",
				input.baseBranch,
				"--head",
				input.headSelector,
				"--title",
				input.title,
				"--body-file",
				input.bodyFile
			]
		}).pipe(Effect.asVoid),
		getDefaultBranch: (input) => execute({
			cwd: input.cwd,
			args: [
				"repo",
				"view",
				"--json",
				"defaultBranchRef",
				"--jq",
				".defaultBranchRef.name"
			]
		}).pipe(Effect.map((value) => {
			const trimmed = value.stdout.trim();
			return trimmed.length > 0 ? trimmed : null;
		})),
		checkoutPullRequest: (input) => execute({
			cwd: input.cwd,
			args: [
				"pr",
				"checkout",
				input.reference,
				...input.force ? ["--force"] : []
			]
		}).pipe(Effect.asVoid)
	};
});
const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);

//#endregion
//#region src/git/Services/TextGeneration.ts
/**
* TextGeneration - Effect service contract for AI-generated Git content.
*
* Generates commit messages and pull request titles/bodies from repository
* context prepared by Git services.
*
* @module TextGeneration
*/
/**
* TextGeneration - Service tag for commit and PR text generation.
*/
var TextGeneration = class extends ServiceMap.Service()("t3/git/Services/TextGeneration") {};

//#endregion
//#region src/git/Utils.ts
/**
* Shared utilities for text generation layers (Codex, Claude, etc.).
*
* @module textGenerationUtils
*/
function isGitRepository(cwd) {
	return existsSync(join(cwd, ".git"));
}
/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
function toJsonSchemaObject(schema) {
	const document = Schema.toJsonSchemaDocument(schema);
	if (document.definitions && Object.keys(document.definitions).length > 0) return {
		...document.schema,
		$defs: document.definitions
	};
	return document.schema;
}
/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
function limitSection(value, maxChars) {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n\n[truncated]`;
}
/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
function sanitizeCommitSubject(raw) {
	const withoutTrailingPeriod = (raw.trim().split(/\r?\n/g)[0]?.trim() ?? "").replace(/[.]+$/g, "").trim();
	if (withoutTrailingPeriod.length === 0) return "Update project files";
	if (withoutTrailingPeriod.length <= 72) return withoutTrailingPeriod;
	return withoutTrailingPeriod.slice(0, 72).trimEnd();
}
/** Normalise a raw PR title to a single line with a sensible fallback. */
function sanitizePrTitle(raw) {
	const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
	if (singleLine.length > 0) return singleLine;
	return "Update project changes";
}
/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
function sanitizeThreadTitle(raw) {
	const normalized = raw.trim().split(/\r?\n/g)[0]?.trim().replace(/^['"`]+|['"`]+$/g, "").trim().replace(/\s+/g, " ");
	if (!normalized || normalized.trim().length === 0) return "New thread";
	if (normalized.length <= 50) return normalized;
	return `${normalized.slice(0, 47).trimEnd()}...`;
}
/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName) {
	return `${cliName.charAt(0).toUpperCase() + cliName.slice(1)} CLI (\`${cliName}\`)`;
}
/**
* Normalize an unknown error from a CLI text generation process into a
* typed `TextGenerationError`. Parameterized by CLI name so both Codex
* and Claude (and future providers) can share the same logic.
*/
function normalizeCliError(cliName, operation, error, fallback) {
	if (Schema.is(TextGenerationError)(error)) return error;
	if (error instanceof Error) {
		const lower = error.message.toLowerCase();
		if (error.message.includes(`Command not found: ${cliName}`) || lower.includes(`spawn ${cliName}`) || lower.includes("enoent")) return new TextGenerationError({
			operation,
			detail: `${cliLabel(cliName)} is required but not available on PATH.`,
			cause: error
		});
		return new TextGenerationError({
			operation,
			detail: `${fallback}: ${error.message}`,
			cause: error
		});
	}
	return new TextGenerationError({
		operation,
		detail: fallback,
		cause: error
	});
}

//#endregion
//#region src/git/Prompts.ts
/**
* Shared prompt builders for text generation providers.
*
* Extracts the prompt construction logic that is identical across
* Codex, Claude, and any future CLI-based text generation backends.
*
* @module textGenerationPrompts
*/
function buildCommitMessagePrompt(input) {
	const wantsBranch = input.includeBranch;
	const prompt = [
		"You write concise git commit messages.",
		wantsBranch ? "Return a JSON object with keys: subject, body, branch." : "Return a JSON object with keys: subject, body.",
		"Rules:",
		"- subject must be imperative, <= 72 chars, and no trailing period",
		"- body can be empty string or short bullet points",
		...wantsBranch ? ["- branch must be a short semantic git branch fragment for this change"] : [],
		"- capture the primary user-visible or developer-visible change",
		"",
		`Branch: ${input.branch ?? "(detached)"}`,
		"",
		"Staged files:",
		limitSection(input.stagedSummary, 6e3),
		"",
		"Staged patch:",
		limitSection(input.stagedPatch, 4e4)
	].join("\n");
	if (wantsBranch) return {
		prompt,
		outputSchema: Schema.Struct({
			subject: Schema.String,
			body: Schema.String,
			branch: Schema.String
		})
	};
	return {
		prompt,
		outputSchema: Schema.Struct({
			subject: Schema.String,
			body: Schema.String
		})
	};
}
function buildPrContentPrompt(input) {
	return {
		prompt: [
			"You write GitHub pull request content.",
			"Return a JSON object with keys: title, body.",
			"Rules:",
			"- title should be concise and specific",
			"- body must be markdown and include headings '## Summary' and '## Testing'",
			"- under Summary, provide short bullet points",
			"- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
			"",
			`Base branch: ${input.baseBranch}`,
			`Head branch: ${input.headBranch}`,
			"",
			"Commits:",
			limitSection(input.commitSummary, 12e3),
			"",
			"Diff stat:",
			limitSection(input.diffSummary, 12e3),
			"",
			"Diff patch:",
			limitSection(input.diffPatch, 4e4)
		].join("\n"),
		outputSchema: Schema.Struct({
			title: Schema.String,
			body: Schema.String
		})
	};
}
function buildPromptFromMessage(input) {
	const attachmentLines = (input.attachments ?? []).map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`);
	const promptSections = [
		input.instruction,
		input.responseShape,
		"Rules:",
		...input.rules.map((rule) => `- ${rule}`),
		"",
		"User message:",
		limitSection(input.message, 8e3)
	];
	if (attachmentLines.length > 0) promptSections.push("", "Attachment metadata:", limitSection(attachmentLines.join("\n"), 4e3));
	return promptSections.join("\n");
}
function buildBranchNamePrompt(input) {
	return {
		prompt: buildPromptFromMessage({
			instruction: "You generate concise git branch names.",
			responseShape: "Return a JSON object with key: branch.",
			rules: [
				"Branch should describe the requested work from the user message.",
				"Keep it short and specific (2-6 words).",
				"Use plain words only, no issue prefixes and no punctuation-heavy text.",
				"If images are attached, use them as primary context for visual/UI issues."
			],
			message: input.message,
			attachments: input.attachments
		}),
		outputSchema: Schema.Struct({ branch: Schema.String })
	};
}
function buildThreadTitlePrompt(input) {
	return {
		prompt: buildPromptFromMessage({
			instruction: "You write concise thread titles for coding conversations.",
			responseShape: "Return a JSON object with key: title.",
			rules: [
				"Title should summarize the user's request, not restate it verbatim.",
				"Keep it short and specific (3-8 words).",
				"Avoid quotes, filler, prefixes, and trailing punctuation.",
				"If images are attached, use them as primary context for visual/UI issues."
			],
			message: input.message,
			attachments: input.attachments
		}),
		outputSchema: Schema.Struct({ title: Schema.String })
	};
}

//#endregion
//#region src/provider/Services/CodexProvider.ts
var CodexProvider = class extends ServiceMap.Service()("t3/provider/Services/CodexProvider") {};

//#endregion
//#region src/provider/Layers/CodexProvider.ts
const PROVIDER = "codex";
const OPENAI_AUTH_PROVIDERS = new Set(["openai"]);
const BUILT_IN_MODELS = [
	{
		slug: "gpt-5.4",
		name: "GPT-5.4",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	},
	{
		slug: "gpt-5.4-mini",
		name: "GPT-5.4 Mini",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	},
	{
		slug: "gpt-5.3-codex",
		name: "GPT-5.3 Codex",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	},
	{
		slug: "gpt-5.3-codex-spark",
		name: "GPT-5.3 Codex Spark",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	},
	{
		slug: "gpt-5.2-codex",
		name: "GPT-5.2 Codex",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	},
	{
		slug: "gpt-5.2",
		name: "GPT-5.2",
		isCustom: false,
		capabilities: {
			reasoningEffortLevels: [
				{
					value: "xhigh",
					label: "Extra High"
				},
				{
					value: "high",
					label: "High",
					isDefault: true
				},
				{
					value: "medium",
					label: "Medium"
				},
				{
					value: "low",
					label: "Low"
				}
			],
			supportsFastMode: true,
			supportsThinkingToggle: false,
			contextWindowOptions: [],
			promptInjectedEffortLevels: []
		}
	}
];
function getCodexModelCapabilities(model) {
	const slug = model?.trim();
	return BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ?? {
		reasoningEffortLevels: [],
		supportsFastMode: false,
		supportsThinkingToggle: false,
		contextWindowOptions: [],
		promptInjectedEffortLevels: []
	};
}
function parseAuthStatusFromOutput(result) {
	const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
	if (lowerOutput.includes("unknown command") || lowerOutput.includes("unrecognized command") || lowerOutput.includes("unexpected argument")) return {
		status: "warning",
		auth: { status: "unknown" },
		message: "Codex CLI authentication status command is unavailable in this Codex version."
	};
	if (lowerOutput.includes("not logged in") || lowerOutput.includes("login required") || lowerOutput.includes("authentication required") || lowerOutput.includes("run `codex login`") || lowerOutput.includes("run codex login")) return {
		status: "error",
		auth: { status: "unauthenticated" },
		message: "Codex CLI is not authenticated. Run `codex login` and try again."
	};
	const parsedAuth = (() => {
		const trimmed = result.stdout.trim();
		if (!trimmed || !trimmed.startsWith("{") && !trimmed.startsWith("[")) return {
			attemptedJsonParse: false,
			auth: void 0
		};
		try {
			return {
				attemptedJsonParse: true,
				auth: extractAuthBoolean(JSON.parse(trimmed))
			};
		} catch {
			return {
				attemptedJsonParse: false,
				auth: void 0
			};
		}
	})();
	if (parsedAuth.auth === true) return {
		status: "ready",
		auth: { status: "authenticated" }
	};
	if (parsedAuth.auth === false) return {
		status: "error",
		auth: { status: "unauthenticated" },
		message: "Codex CLI is not authenticated. Run `codex login` and try again."
	};
	if (parsedAuth.attemptedJsonParse) return {
		status: "warning",
		auth: { status: "unknown" },
		message: "Could not verify Codex authentication status from JSON output (missing auth marker)."
	};
	if (result.code === 0) return {
		status: "ready",
		auth: { status: "authenticated" }
	};
	const detail = detailFromResult(result);
	return {
		status: "warning",
		auth: { status: "unknown" },
		message: detail ? `Could not verify Codex authentication status. ${detail}` : "Could not verify Codex authentication status."
	};
}
const readCodexConfigModelProvider = Effect.fn("readCodexConfigModelProvider")(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const codexHome = yield* (yield* ServerSettingsService).getSettings.pipe(Effect.map((settings) => settings.providers.codex.homePath || process.env.CODEX_HOME || path.join(OS.homedir(), ".codex")));
	const configPath = path.join(codexHome, "config.toml");
	const content = yield* fileSystem.readFileString(configPath).pipe(Effect.orElseSucceed(() => void 0));
	if (content === void 0) return;
	let inTopLevel = true;
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			inTopLevel = false;
			continue;
		}
		if (!inTopLevel) continue;
		const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/);
		if (match) return match[1];
	}
});
const hasCustomModelProvider = readCodexConfigModelProvider().pipe(Effect.map((provider) => provider !== void 0 && !OPENAI_AUTH_PROVIDERS.has(provider)), Effect.orElseSucceed(() => false));
const CAPABILITIES_PROBE_TIMEOUT_MS = 8e3;
const probeCodexCapabilities = (input) => Effect.tryPromise((signal) => probeCodexAccount({
	...input,
	signal
})).pipe(Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS), Effect.result, Effect.map((result) => {
	if (Result.isFailure(result)) return void 0;
	return Option.isSome(result.success) ? result.success.value : void 0;
}));
const runCodexCommand = Effect.fn("runCodexCommand")(function* (args) {
	const codexSettings = yield* (yield* ServerSettingsService).getSettings.pipe(Effect.map((settings) => settings.providers.codex));
	const command = ChildProcess.make(codexSettings.binaryPath, [...args], {
		shell: process.platform === "win32",
		env: {
			...process.env,
			...codexSettings.homePath ? { CODEX_HOME: codexSettings.homePath } : {}
		}
	});
	return yield* spawnAndCollect(codexSettings.binaryPath, command);
});
const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (resolveAccount) {
	const codexSettings = yield* Effect.service(ServerSettingsService).pipe(Effect.flatMap((service) => service.getSettings), Effect.map((settings) => settings.providers.codex));
	const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
	const models = providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, codexSettings.customModels);
	if (!codexSettings.enabled) return buildServerProvider({
		provider: PROVIDER,
		enabled: false,
		checkedAt,
		models,
		probe: {
			installed: false,
			version: null,
			status: "warning",
			auth: { status: "unknown" },
			message: "Codex is disabled in T3 Code settings."
		}
	});
	const versionProbe = yield* runCodexCommand(["--version"]).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS$2), Effect.result);
	if (Result.isFailure(versionProbe)) {
		const error = versionProbe.failure;
		return buildServerProvider({
			provider: PROVIDER,
			enabled: codexSettings.enabled,
			checkedAt,
			models,
			probe: {
				installed: !isCommandMissingCause(error),
				version: null,
				status: "error",
				auth: { status: "unknown" },
				message: isCommandMissingCause(error) ? "Codex CLI (`codex`) is not installed or not on PATH." : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`
			}
		});
	}
	if (Option.isNone(versionProbe.success)) return buildServerProvider({
		provider: PROVIDER,
		enabled: codexSettings.enabled,
		checkedAt,
		models,
		probe: {
			installed: true,
			version: null,
			status: "error",
			auth: { status: "unknown" },
			message: "Codex CLI is installed but failed to run. Timed out while running command."
		}
	});
	const version = versionProbe.success.value;
	const parsedVersion = parseCodexCliVersion(`${version.stdout}\n${version.stderr}`) ?? parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
	if (version.code !== 0) {
		const detail = detailFromResult(version);
		return buildServerProvider({
			provider: PROVIDER,
			enabled: codexSettings.enabled,
			checkedAt,
			models,
			probe: {
				installed: true,
				version: parsedVersion,
				status: "error",
				auth: { status: "unknown" },
				message: detail ? `Codex CLI is installed but failed to run. ${detail}` : "Codex CLI is installed but failed to run."
			}
		});
	}
	if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) return buildServerProvider({
		provider: PROVIDER,
		enabled: codexSettings.enabled,
		checkedAt,
		models,
		probe: {
			installed: true,
			version: parsedVersion,
			status: "error",
			auth: { status: "unknown" },
			message: formatCodexCliUpgradeMessage(parsedVersion)
		}
	});
	if (yield* hasCustomModelProvider) return buildServerProvider({
		provider: PROVIDER,
		enabled: codexSettings.enabled,
		checkedAt,
		models,
		probe: {
			installed: true,
			version: parsedVersion,
			status: "ready",
			auth: { status: "unknown" },
			message: "Using a custom Codex model provider; OpenAI login check skipped."
		}
	});
	const authProbe = yield* runCodexCommand(["login", "status"]).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS$2), Effect.result);
	const account = resolveAccount ? yield* resolveAccount({
		binaryPath: codexSettings.binaryPath,
		homePath: codexSettings.homePath
	}) : void 0;
	const resolvedModels = adjustCodexModelsForAccount(models, account);
	if (Result.isFailure(authProbe)) {
		const error = authProbe.failure;
		return buildServerProvider({
			provider: PROVIDER,
			enabled: codexSettings.enabled,
			checkedAt,
			models: resolvedModels,
			probe: {
				installed: true,
				version: parsedVersion,
				status: "warning",
				auth: { status: "unknown" },
				message: error instanceof Error ? `Could not verify Codex authentication status: ${error.message}.` : "Could not verify Codex authentication status."
			}
		});
	}
	if (Option.isNone(authProbe.success)) return buildServerProvider({
		provider: PROVIDER,
		enabled: codexSettings.enabled,
		checkedAt,
		models: resolvedModels,
		probe: {
			installed: true,
			version: parsedVersion,
			status: "warning",
			auth: { status: "unknown" },
			message: "Could not verify Codex authentication status. Timed out while running command."
		}
	});
	const parsed = parseAuthStatusFromOutput(authProbe.success.value);
	const authType = codexAuthSubType(account);
	const authLabel = codexAuthSubLabel(account);
	return buildServerProvider({
		provider: PROVIDER,
		enabled: codexSettings.enabled,
		checkedAt,
		models: resolvedModels,
		probe: {
			installed: true,
			version: parsedVersion,
			status: parsed.status,
			auth: {
				...parsed.auth,
				...authType ? { type: authType } : {},
				...authLabel ? { label: authLabel } : {}
			},
			...parsed.message ? { message: parsed.message } : {}
		}
	});
});
const CodexProviderLive = Layer.effect(CodexProvider, Effect.gen(function* () {
	const serverSettings = yield* ServerSettingsService;
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const accountProbeCache = yield* Cache.make({
		capacity: 4,
		timeToLive: Duration.minutes(5),
		lookup: (key) => {
			const [binaryPath, homePath] = JSON.parse(key);
			return probeCodexCapabilities({
				binaryPath,
				...homePath ? { homePath } : {}
			});
		}
	});
	const checkProvider = checkCodexProviderStatus((input) => Cache.get(accountProbeCache, JSON.stringify([input.binaryPath, input.homePath]))).pipe(Effect.provideService(ServerSettingsService, serverSettings), Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, path), Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
	return yield* makeManagedServerProvider({
		getSettings: serverSettings.getSettings.pipe(Effect.map((settings) => settings.providers.codex), Effect.orDie),
		streamSettings: serverSettings.streamChanges.pipe(Stream.map((settings) => settings.providers.codex)),
		haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
		checkProvider
	});
}));

//#endregion
//#region src/git/Layers/CodexTextGeneration.ts
const CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 18e4;
const makeCodexTextGeneration = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const serverConfig = yield* Effect.service(ServerConfig);
	const serverSettingsService = yield* Effect.service(ServerSettingsService);
	const readStreamAsString = (operation, stream) => stream.pipe(Stream.decodeText(), Stream.runFold(() => "", (acc, chunk) => acc + chunk), Effect.mapError((cause) => normalizeCliError("codex", operation, cause, "Failed to collect process output")));
	const writeTempFile = (operation, prefix, content) => {
		return fileSystem.makeTempFileScoped({ prefix: `t3code-${prefix}-${process.pid}-${randomUUID()}.tmp` }).pipe(Effect.tap((filePath) => fileSystem.writeFileString(filePath, content)), Effect.mapError((cause) => new TextGenerationError({
			operation,
			detail: `Failed to write temp file`,
			cause
		})));
	};
	const safeUnlink = (filePath) => fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));
	const materializeImageAttachments = Effect.fn("materializeImageAttachments")(function* (_operation, attachments) {
		if (!attachments || attachments.length === 0) return { imagePaths: [] };
		const imagePaths = [];
		for (const attachment of attachments) {
			if (attachment.type !== "image") continue;
			const resolvedPath = resolveAttachmentPath({
				attachmentsDir: serverConfig.attachmentsDir,
				attachment
			});
			if (!resolvedPath || !path.isAbsolute(resolvedPath)) continue;
			const fileInfo = yield* fileSystem.stat(resolvedPath).pipe(Effect.catch(() => Effect.succeed(null)));
			if (!fileInfo || fileInfo.type !== "File") continue;
			imagePaths.push(resolvedPath);
		}
		return { imagePaths };
	});
	const runCodexJson = Effect.fn("runCodexJson")(function* ({ operation, cwd, prompt, outputSchemaJson, imagePaths = [], cleanupPaths = [], modelSelection }) {
		const schemaPath = yield* writeTempFile(operation, "codex-schema", JSON.stringify(toJsonSchemaObject(outputSchemaJson)));
		const outputPath = yield* writeTempFile(operation, "codex-output", "");
		const codexSettings = yield* Effect.map(serverSettingsService.getSettings, (settings) => settings.providers.codex).pipe(Effect.catch(() => Effect.undefined));
		const runCodexCommand = Effect.fn("runCodexJson.runCodexCommand")(function* () {
			const normalizedOptions = normalizeCodexModelOptionsWithCapabilities(getCodexModelCapabilities(modelSelection.model), modelSelection.options);
			const reasoningEffort = modelSelection.options?.reasoningEffort ?? CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT;
			const command = ChildProcess.make(codexSettings?.binaryPath || "codex", [
				"exec",
				"--ephemeral",
				"-s",
				"read-only",
				"--model",
				modelSelection.model,
				"--config",
				`model_reasoning_effort="${reasoningEffort}"`,
				...normalizedOptions?.fastMode ? ["--config", `service_tier="fast"`] : [],
				"--output-schema",
				schemaPath,
				"--output-last-message",
				outputPath,
				...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
				"-"
			], {
				env: {
					...process.env,
					...codexSettings?.homePath ? { CODEX_HOME: codexSettings.homePath } : {}
				},
				cwd,
				shell: process.platform === "win32",
				stdin: { stream: Stream.encodeText(Stream.make(prompt)) }
			});
			const child = yield* commandSpawner.spawn(command).pipe(Effect.mapError((cause) => normalizeCliError("codex", operation, cause, "Failed to spawn Codex CLI process")));
			const [stdout, stderr, exitCode] = yield* Effect.all([
				readStreamAsString(operation, child.stdout),
				readStreamAsString(operation, child.stderr),
				child.exitCode.pipe(Effect.mapError((cause) => normalizeCliError("codex", operation, cause, "Failed to read Codex CLI exit code")))
			], { concurrency: "unbounded" });
			if (exitCode !== 0) {
				const stderrDetail = stderr.trim();
				const stdoutDetail = stdout.trim();
				const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
				return yield* new TextGenerationError({
					operation,
					detail: detail.length > 0 ? `Codex CLI command failed: ${detail}` : `Codex CLI command failed with code ${exitCode}.`
				});
			}
		});
		const cleanup = Effect.all([
			schemaPath,
			outputPath,
			...cleanupPaths
		].map((filePath) => safeUnlink(filePath)), { concurrency: "unbounded" }).pipe(Effect.asVoid);
		return yield* Effect.gen(function* () {
			yield* runCodexCommand().pipe(Effect.scoped, Effect.timeoutOption(CODEX_TIMEOUT_MS), Effect.flatMap(Option.match({
				onNone: () => Effect.fail(new TextGenerationError({
					operation,
					detail: "Codex CLI request timed out."
				})),
				onSome: () => Effect.void
			})));
			return yield* fileSystem.readFileString(outputPath).pipe(Effect.mapError((cause) => new TextGenerationError({
				operation,
				detail: "Failed to read Codex output file.",
				cause
			})), Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))), Effect.catchTag("SchemaError", (cause) => Effect.fail(new TextGenerationError({
				operation,
				detail: "Codex returned invalid structured output.",
				cause
			}))));
		}).pipe(Effect.ensuring(cleanup));
	});
	return {
		generateCommitMessage: Effect.fn("CodexTextGeneration.generateCommitMessage")(function* (input) {
			const { prompt, outputSchema } = buildCommitMessagePrompt({
				branch: input.branch,
				stagedSummary: input.stagedSummary,
				stagedPatch: input.stagedPatch,
				includeBranch: input.includeBranch === true
			});
			if (input.modelSelection.provider !== "codex") return yield* new TextGenerationError({
				operation: "generateCommitMessage",
				detail: "Invalid model selection."
			});
			const generated = yield* runCodexJson({
				operation: "generateCommitMessage",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			});
			return {
				subject: sanitizeCommitSubject(generated.subject),
				body: generated.body.trim(),
				..."branch" in generated && typeof generated.branch === "string" ? { branch: sanitizeFeatureBranchName(generated.branch) } : {}
			};
		}),
		generatePrContent: Effect.fn("CodexTextGeneration.generatePrContent")(function* (input) {
			const { prompt, outputSchema } = buildPrContentPrompt({
				baseBranch: input.baseBranch,
				headBranch: input.headBranch,
				commitSummary: input.commitSummary,
				diffSummary: input.diffSummary,
				diffPatch: input.diffPatch
			});
			if (input.modelSelection.provider !== "codex") return yield* new TextGenerationError({
				operation: "generatePrContent",
				detail: "Invalid model selection."
			});
			const generated = yield* runCodexJson({
				operation: "generatePrContent",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			});
			return {
				title: sanitizePrTitle(generated.title),
				body: generated.body.trim()
			};
		}),
		generateBranchName: Effect.fn("CodexTextGeneration.generateBranchName")(function* (input) {
			const { imagePaths } = yield* materializeImageAttachments("generateBranchName", input.attachments);
			const { prompt, outputSchema } = buildBranchNamePrompt({
				message: input.message,
				attachments: input.attachments
			});
			if (input.modelSelection.provider !== "codex") return yield* new TextGenerationError({
				operation: "generateBranchName",
				detail: "Invalid model selection."
			});
			return { branch: sanitizeBranchFragment((yield* runCodexJson({
				operation: "generateBranchName",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				imagePaths,
				modelSelection: input.modelSelection
			})).branch) };
		}),
		generateThreadTitle: Effect.fn("CodexTextGeneration.generateThreadTitle")(function* (input) {
			const { imagePaths } = yield* materializeImageAttachments("generateThreadTitle", input.attachments);
			const { prompt, outputSchema } = buildThreadTitlePrompt({
				message: input.message,
				attachments: input.attachments
			});
			if (input.modelSelection.provider !== "codex") return yield* new TextGenerationError({
				operation: "generateThreadTitle",
				detail: "Invalid model selection."
			});
			return { title: sanitizeThreadTitle((yield* runCodexJson({
				operation: "generateThreadTitle",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				imagePaths,
				modelSelection: input.modelSelection
			})).title) };
		})
	};
});
const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);

//#endregion
//#region src/git/Layers/ClaudeTextGeneration.ts
/**
* ClaudeTextGeneration – Text generation layer using the Claude CLI.
*
* Implements the same TextGenerationShape contract as CodexTextGeneration but
* delegates to the `claude` CLI (`claude -p`) with structured JSON output
* instead of the `codex exec` CLI.
*
* @module ClaudeTextGeneration
*/
const CLAUDE_TIMEOUT_MS = 18e4;
/**
* Schema for the wrapper JSON returned by `claude -p --output-format json`.
* We only care about `structured_output`.
*/
const ClaudeOutputEnvelope = Schema.Struct({ structured_output: Schema.Unknown });
const makeClaudeTextGeneration = Effect.gen(function* () {
	const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const serverSettingsService = yield* Effect.service(ServerSettingsService);
	const readStreamAsString = (operation, stream) => stream.pipe(Stream.decodeText(), Stream.runFold(() => "", (acc, chunk) => acc + chunk), Effect.mapError((cause) => normalizeCliError("claude", operation, cause, "Failed to collect process output")));
	/**
	* Spawn the Claude CLI with structured JSON output and return the parsed,
	* schema-validated result.
	*/
	const runClaudeJson = Effect.fn("runClaudeJson")(function* ({ operation, cwd, prompt, outputSchemaJson, modelSelection }) {
		const jsonSchemaStr = JSON.stringify(toJsonSchemaObject(outputSchemaJson));
		const normalizedOptions = normalizeClaudeModelOptionsWithCapabilities(getClaudeModelCapabilities(modelSelection.model), modelSelection.options);
		const settings = {
			...typeof normalizedOptions?.thinking === "boolean" ? { alwaysThinkingEnabled: normalizedOptions.thinking } : {},
			...normalizedOptions?.fastMode ? { fastMode: true } : {}
		};
		const claudeSettings = yield* Effect.map(serverSettingsService.getSettings, (settings) => settings.providers.claudeAgent).pipe(Effect.catch(() => Effect.undefined));
		const rawStdout = yield* Effect.fn("runClaudeJson.runClaudeCommand")(function* () {
			const command = ChildProcess.make(claudeSettings?.binaryPath || "claude", [
				"-p",
				"--output-format",
				"json",
				"--json-schema",
				jsonSchemaStr,
				"--model",
				resolveApiModelId(modelSelection),
				...normalizedOptions?.effort ? ["--effort", normalizedOptions.effort] : [],
				...Object.keys(settings).length > 0 ? ["--settings", JSON.stringify(settings)] : [],
				"--dangerously-skip-permissions"
			], {
				cwd,
				shell: process.platform === "win32",
				stdin: { stream: Stream.encodeText(Stream.make(prompt)) }
			});
			const child = yield* commandSpawner.spawn(command).pipe(Effect.mapError((cause) => normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process")));
			const [stdout, stderr, exitCode] = yield* Effect.all([
				readStreamAsString(operation, child.stdout),
				readStreamAsString(operation, child.stderr),
				child.exitCode.pipe(Effect.mapError((cause) => normalizeCliError("claude", operation, cause, "Failed to read Claude CLI exit code")))
			], { concurrency: "unbounded" });
			if (exitCode !== 0) {
				const stderrDetail = stderr.trim();
				const stdoutDetail = stdout.trim();
				const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
				return yield* new TextGenerationError({
					operation,
					detail: detail.length > 0 ? `Claude CLI command failed: ${detail}` : `Claude CLI command failed with code ${exitCode}.`
				});
			}
			return stdout;
		})().pipe(Effect.scoped, Effect.timeoutOption(CLAUDE_TIMEOUT_MS), Effect.flatMap(Option.match({
			onNone: () => Effect.fail(new TextGenerationError({
				operation,
				detail: "Claude CLI request timed out."
			})),
			onSome: (value) => Effect.succeed(value)
		})));
		const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(ClaudeOutputEnvelope))(rawStdout).pipe(Effect.catchTag("SchemaError", (cause) => Effect.fail(new TextGenerationError({
			operation,
			detail: "Claude CLI returned unexpected output format.",
			cause
		}))));
		return yield* Schema.decodeEffect(outputSchemaJson)(envelope.structured_output).pipe(Effect.catchTag("SchemaError", (cause) => Effect.fail(new TextGenerationError({
			operation,
			detail: "Claude returned invalid structured output.",
			cause
		}))));
	});
	return {
		generateCommitMessage: Effect.fn("ClaudeTextGeneration.generateCommitMessage")(function* (input) {
			const { prompt, outputSchema } = buildCommitMessagePrompt({
				branch: input.branch,
				stagedSummary: input.stagedSummary,
				stagedPatch: input.stagedPatch,
				includeBranch: input.includeBranch === true
			});
			if (input.modelSelection.provider !== "claudeAgent") return yield* new TextGenerationError({
				operation: "generateCommitMessage",
				detail: "Invalid model selection."
			});
			const generated = yield* runClaudeJson({
				operation: "generateCommitMessage",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			});
			return {
				subject: sanitizeCommitSubject(generated.subject),
				body: generated.body.trim(),
				..."branch" in generated && typeof generated.branch === "string" ? { branch: sanitizeFeatureBranchName(generated.branch) } : {}
			};
		}),
		generatePrContent: Effect.fn("ClaudeTextGeneration.generatePrContent")(function* (input) {
			const { prompt, outputSchema } = buildPrContentPrompt({
				baseBranch: input.baseBranch,
				headBranch: input.headBranch,
				commitSummary: input.commitSummary,
				diffSummary: input.diffSummary,
				diffPatch: input.diffPatch
			});
			if (input.modelSelection.provider !== "claudeAgent") return yield* new TextGenerationError({
				operation: "generatePrContent",
				detail: "Invalid model selection."
			});
			const generated = yield* runClaudeJson({
				operation: "generatePrContent",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			});
			return {
				title: sanitizePrTitle(generated.title),
				body: generated.body.trim()
			};
		}),
		generateBranchName: Effect.fn("ClaudeTextGeneration.generateBranchName")(function* (input) {
			const { prompt, outputSchema } = buildBranchNamePrompt({
				message: input.message,
				attachments: input.attachments
			});
			if (input.modelSelection.provider !== "claudeAgent") return yield* new TextGenerationError({
				operation: "generateBranchName",
				detail: "Invalid model selection."
			});
			return { branch: sanitizeBranchFragment((yield* runClaudeJson({
				operation: "generateBranchName",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			})).branch) };
		}),
		generateThreadTitle: Effect.fn("ClaudeTextGeneration.generateThreadTitle")(function* (input) {
			const { prompt, outputSchema } = buildThreadTitlePrompt({
				message: input.message,
				attachments: input.attachments
			});
			if (input.modelSelection.provider !== "claudeAgent") return yield* new TextGenerationError({
				operation: "generateThreadTitle",
				detail: "Invalid model selection."
			});
			return { title: sanitizeThreadTitle((yield* runClaudeJson({
				operation: "generateThreadTitle",
				cwd: input.cwd,
				prompt,
				outputSchemaJson: outputSchema,
				modelSelection: input.modelSelection
			})).title) };
		})
	};
});
const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration);

//#endregion
//#region src/git/Layers/RoutingTextGeneration.ts
/**
* RoutingTextGeneration – Dispatches text generation requests to either the
* Codex CLI or Claude CLI implementation based on the provider in each
* request input.
*
* When `modelSelection.provider` is `"claudeAgent"` the request is forwarded to
* the Claude layer; for any other value (including the default `undefined`) it
* falls through to the Codex layer.
*
* @module RoutingTextGeneration
*/
var CodexTextGen = class extends ServiceMap.Service()("t3/git/Layers/RoutingTextGeneration/CodexTextGen") {};
var ClaudeTextGen = class extends ServiceMap.Service()("t3/git/Layers/RoutingTextGeneration/ClaudeTextGen") {};
const makeRoutingTextGeneration = Effect.gen(function* () {
	const codex = yield* CodexTextGen;
	const claude = yield* ClaudeTextGen;
	const route = (provider) => provider === "claudeAgent" ? claude : codex;
	return {
		generateCommitMessage: (input) => route(input.modelSelection.provider).generateCommitMessage(input),
		generatePrContent: (input) => route(input.modelSelection.provider).generatePrContent(input),
		generateBranchName: (input) => route(input.modelSelection.provider).generateBranchName(input),
		generateThreadTitle: (input) => route(input.modelSelection.provider).generateThreadTitle(input)
	};
});
const InternalCodexLayer = Layer.effect(CodexTextGen, Effect.gen(function* () {
	return yield* TextGeneration;
})).pipe(Layer.provide(CodexTextGenerationLive));
const InternalClaudeLayer = Layer.effect(ClaudeTextGen, Effect.gen(function* () {
	return yield* TextGeneration;
})).pipe(Layer.provide(ClaudeTextGenerationLive));
const RoutingTextGenerationLive = Layer.effect(TextGeneration, makeRoutingTextGeneration).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));

//#endregion
//#region ../../packages/shared/src/KeyedCoalescingWorker.ts
const makeKeyedCoalescingWorker = (options) => Effect.gen(function* () {
	const queue = yield* Effect.acquireRelease(TxQueue.unbounded(), TxQueue.shutdown);
	const stateRef = yield* TxRef.make({
		latestByKey: /* @__PURE__ */ new Map(),
		queuedKeys: /* @__PURE__ */ new Set(),
		activeKeys: /* @__PURE__ */ new Set()
	});
	const processKey = (key, value) => options.process(key, value).pipe(Effect.flatMap(() => TxRef.modify(stateRef, (state) => {
		const nextValue = state.latestByKey.get(key);
		if (nextValue === void 0) {
			const activeKeys = new Set(state.activeKeys);
			activeKeys.delete(key);
			return [null, {
				...state,
				activeKeys
			}];
		}
		const latestByKey = new Map(state.latestByKey);
		latestByKey.delete(key);
		return [nextValue, {
			...state,
			latestByKey
		}];
	}).pipe(Effect.tx)), Effect.flatMap((nextValue) => nextValue === null ? Effect.void : processKey(key, nextValue)));
	const cleanupFailedKey = (key) => TxRef.modify(stateRef, (state) => {
		const activeKeys = new Set(state.activeKeys);
		activeKeys.delete(key);
		if (state.latestByKey.has(key) && !state.queuedKeys.has(key)) {
			const queuedKeys = new Set(state.queuedKeys);
			queuedKeys.add(key);
			return [true, {
				...state,
				activeKeys,
				queuedKeys
			}];
		}
		return [false, {
			...state,
			activeKeys
		}];
	}).pipe(Effect.tx, Effect.flatMap((shouldRequeue) => shouldRequeue ? TxQueue.offer(queue, key) : Effect.void));
	yield* TxQueue.take(queue).pipe(Effect.flatMap((key) => TxRef.modify(stateRef, (state) => {
		const queuedKeys = new Set(state.queuedKeys);
		queuedKeys.delete(key);
		const value = state.latestByKey.get(key);
		if (value === void 0) return [null, {
			...state,
			queuedKeys
		}];
		const latestByKey = new Map(state.latestByKey);
		latestByKey.delete(key);
		const activeKeys = new Set(state.activeKeys);
		activeKeys.add(key);
		return [{
			key,
			value
		}, {
			...state,
			latestByKey,
			queuedKeys,
			activeKeys
		}];
	}).pipe(Effect.tx)), Effect.flatMap((item) => item === null ? Effect.void : processKey(item.key, item.value).pipe(Effect.catchCause(() => cleanupFailedKey(item.key)))), Effect.forever, Effect.forkScoped);
	const enqueue = (key, value) => TxRef.modify(stateRef, (state) => {
		const latestByKey = new Map(state.latestByKey);
		const existing = latestByKey.get(key);
		latestByKey.set(key, existing === void 0 ? value : options.merge(existing, value));
		if (state.queuedKeys.has(key) || state.activeKeys.has(key)) return [false, {
			...state,
			latestByKey
		}];
		const queuedKeys = new Set(state.queuedKeys);
		queuedKeys.add(key);
		return [true, {
			...state,
			latestByKey,
			queuedKeys
		}];
	}).pipe(Effect.flatMap((shouldOffer) => shouldOffer ? TxQueue.offer(queue, key) : Effect.void), Effect.tx, Effect.asVoid);
	const drainKey = (key) => TxRef.get(stateRef).pipe(Effect.tap((state) => state.latestByKey.has(key) || state.queuedKeys.has(key) || state.activeKeys.has(key) ? Effect.txRetry : Effect.void), Effect.asVoid, Effect.tx);
	return {
		enqueue,
		drainKey
	};
});

//#endregion
//#region src/terminal/Services/PTY.ts
/**
* PtyAdapter - Terminal PTY adapter service contract.
*
* Defines the process primitives required by terminal session management
* without binding to a specific PTY implementation.
*
* @module PtyAdapter
*/
/**
* PtyError - Error type for PTY adapter operations.
*/
var PtySpawnError = class extends Schema.TaggedErrorClass()("PtySpawnError", {
	adapter: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.Defect)
}) {};
/**
* PtyAdapter - Service tag for PTY process integration.
*/
var PtyAdapter = class extends ServiceMap.Service()("t3/terminal/Services/PTY/PtyAdapter") {};

//#endregion
//#region src/terminal/Layers/Manager.ts
const DEFAULT_HISTORY_LINE_LIMIT = 5e3;
const DEFAULT_PERSIST_DEBOUNCE_MS = 40;
const DEFAULT_SUBPROCESS_POLL_INTERVAL_MS = 1e3;
const DEFAULT_PROCESS_KILL_GRACE_MS = 1e3;
const DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS = 128;
const DEFAULT_OPEN_COLS = 120;
const DEFAULT_OPEN_ROWS = 30;
const TERMINAL_ENV_BLOCKLIST = new Set([
	"PORT",
	"ELECTRON_RENDERER_PORT",
	"ELECTRON_RUN_AS_NODE"
]);
var TerminalSubprocessCheckError = class extends Data.TaggedError("TerminalSubprocessCheckError") {};
var TerminalProcessSignalError = class extends Data.TaggedError("TerminalProcessSignalError") {};
function snapshot(session) {
	return {
		threadId: session.threadId,
		terminalId: session.terminalId,
		cwd: session.cwd,
		worktreePath: session.worktreePath,
		status: session.status,
		pid: session.pid,
		history: session.history,
		exitCode: session.exitCode,
		exitSignal: session.exitSignal,
		updatedAt: session.updatedAt
	};
}
function cleanupProcessHandles(session) {
	session.unsubscribeData?.();
	session.unsubscribeData = null;
	session.unsubscribeExit?.();
	session.unsubscribeExit = null;
}
function enqueueProcessEvent(session, expectedPid, event) {
	if (!session.process || session.status !== "running" || session.pid !== expectedPid) return false;
	session.pendingProcessEvents.push(event);
	if (session.processEventDrainRunning) return false;
	session.processEventDrainRunning = true;
	return true;
}
function defaultShellResolver() {
	if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
	return process.env.SHELL ?? "bash";
}
function normalizeShellCommand(value) {
	if (!value) return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (process.platform === "win32") return trimmed;
	const firstToken = trimmed.split(/\s+/g)[0]?.trim();
	if (!firstToken) return null;
	return firstToken.replace(/^['"]|['"]$/g, "");
}
function shellCandidateFromCommand(command) {
	if (!command || command.length === 0) return null;
	const shellName = path.basename(command).toLowerCase();
	if (process.platform !== "win32" && shellName === "zsh") return {
		shell: command,
		args: ["-o", "nopromptsp"]
	};
	return { shell: command };
}
function formatShellCandidate(candidate) {
	if (!candidate.args || candidate.args.length === 0) return candidate.shell;
	return `${candidate.shell} ${candidate.args.join(" ")}`;
}
function uniqueShellCandidates(candidates) {
	const seen = /* @__PURE__ */ new Set();
	const ordered = [];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const key = formatShellCandidate(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		ordered.push(candidate);
	}
	return ordered;
}
function resolveShellCandidates(shellResolver) {
	const requested = shellCandidateFromCommand(normalizeShellCommand(shellResolver()));
	if (process.platform === "win32") return uniqueShellCandidates([
		requested,
		shellCandidateFromCommand(process.env.ComSpec ?? null),
		shellCandidateFromCommand("powershell.exe"),
		shellCandidateFromCommand("cmd.exe")
	]);
	return uniqueShellCandidates([
		requested,
		shellCandidateFromCommand(normalizeShellCommand(process.env.SHELL)),
		shellCandidateFromCommand("/bin/zsh"),
		shellCandidateFromCommand("/bin/bash"),
		shellCandidateFromCommand("/bin/sh"),
		shellCandidateFromCommand("zsh"),
		shellCandidateFromCommand("bash"),
		shellCandidateFromCommand("sh")
	]);
}
function isRetryableShellSpawnError(error) {
	const queue = [error];
	const seen = /* @__PURE__ */ new Set();
	const messages = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || seen.has(current)) continue;
		seen.add(current);
		if (typeof current === "string") {
			messages.push(current);
			continue;
		}
		if (current instanceof Error) {
			messages.push(current.message);
			const cause = current.cause;
			if (cause) queue.push(cause);
			continue;
		}
		if (typeof current === "object") {
			const value = current;
			if (typeof value.message === "string") messages.push(value.message);
			if (value.cause) queue.push(value.cause);
		}
	}
	const message = messages.join(" ").toLowerCase();
	return message.includes("posix_spawnp failed") || message.includes("enoent") || message.includes("not found") || message.includes("file not found") || message.includes("no such file");
}
function checkWindowsSubprocessActivity(terminalPid) {
	const command = [
		`$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${terminalPid}" -ErrorAction SilentlyContinue`,
		"if ($children) { exit 0 }",
		"exit 1"
	].join("; ");
	return Effect.tryPromise({
		try: () => runProcess("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			command
		], {
			timeoutMs: 1500,
			allowNonZeroExit: true,
			maxBufferBytes: 32768,
			outputMode: "truncate"
		}),
		catch: (cause) => new TerminalSubprocessCheckError({
			message: "Failed to check Windows terminal subprocess activity.",
			cause,
			terminalPid,
			command: "powershell"
		})
	}).pipe(Effect.map((result) => result.code === 0));
}
const checkPosixSubprocessActivity = Effect.fn("terminal.checkPosixSubprocessActivity")(function* (terminalPid) {
	const runPgrep = Effect.tryPromise({
		try: () => runProcess("pgrep", ["-P", String(terminalPid)], {
			timeoutMs: 1e3,
			allowNonZeroExit: true,
			maxBufferBytes: 32768,
			outputMode: "truncate"
		}),
		catch: (cause) => new TerminalSubprocessCheckError({
			message: "Failed to inspect terminal subprocesses with pgrep.",
			cause,
			terminalPid,
			command: "pgrep"
		})
	});
	const runPs = Effect.tryPromise({
		try: () => runProcess("ps", ["-eo", "pid=,ppid="], {
			timeoutMs: 1e3,
			allowNonZeroExit: true,
			maxBufferBytes: 262144,
			outputMode: "truncate"
		}),
		catch: (cause) => new TerminalSubprocessCheckError({
			message: "Failed to inspect terminal subprocesses with ps.",
			cause,
			terminalPid,
			command: "ps"
		})
	});
	const pgrepResult = yield* Effect.exit(runPgrep);
	if (pgrepResult._tag === "Success") {
		if (pgrepResult.value.code === 0) return pgrepResult.value.stdout.trim().length > 0;
		if (pgrepResult.value.code === 1) return false;
	}
	const psResult = yield* Effect.exit(runPs);
	if (psResult._tag === "Failure" || psResult.value.code !== 0) return false;
	for (const line of psResult.value.stdout.split(/\r?\n/g)) {
		const [pidRaw, ppidRaw] = line.trim().split(/\s+/g);
		const pid = Number(pidRaw);
		const ppid = Number(ppidRaw);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
		if (ppid === terminalPid) return true;
	}
	return false;
});
const defaultSubprocessChecker = Effect.fn("terminal.defaultSubprocessChecker")(function* (terminalPid) {
	if (!Number.isInteger(terminalPid) || terminalPid <= 0) return false;
	if (process.platform === "win32") return yield* checkWindowsSubprocessActivity(terminalPid);
	return yield* checkPosixSubprocessActivity(terminalPid);
});
function capHistory(history, maxLines) {
	if (history.length === 0) return history;
	const hasTrailingNewline = history.endsWith("\n");
	const lines = history.split("\n");
	if (hasTrailingNewline) lines.pop();
	if (lines.length <= maxLines) return history;
	const capped = lines.slice(lines.length - maxLines).join("\n");
	return hasTrailingNewline ? `${capped}\n` : capped;
}
function isCsiFinalByte(codePoint) {
	return codePoint >= 64 && codePoint <= 126;
}
function shouldStripCsiSequence(body, finalByte) {
	if (finalByte === "n") return true;
	if (finalByte === "R" && /^[0-9;?]*$/.test(body)) return true;
	if (finalByte === "c" && /^[>0-9;?]*$/.test(body)) return true;
	return false;
}
function shouldStripOscSequence(content) {
	return /^(10|11|12);(?:\?|rgb:)/.test(content);
}
function stripStringTerminator(value) {
	if (value.endsWith("\x1B\\")) return value.slice(0, -2);
	const lastCharacter = value.at(-1);
	if (lastCharacter === "\x07" || lastCharacter === "") return value.slice(0, -1);
	return value;
}
function findStringTerminatorIndex(input, start) {
	for (let index = start; index < input.length; index += 1) {
		const codePoint = input.charCodeAt(index);
		if (codePoint === 7 || codePoint === 156) return index + 1;
		if (codePoint === 27 && input.charCodeAt(index + 1) === 92) return index + 2;
	}
	return null;
}
function isEscapeIntermediateByte(codePoint) {
	return codePoint >= 32 && codePoint <= 47;
}
function isEscapeFinalByte(codePoint) {
	return codePoint >= 48 && codePoint <= 126;
}
function findEscapeSequenceEndIndex(input, start) {
	let cursor = start;
	while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) cursor += 1;
	if (cursor >= input.length) return null;
	return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1;
}
function sanitizeTerminalHistoryChunk(pendingControlSequence, data) {
	const input = `${pendingControlSequence}${data}`;
	let visibleText = "";
	let index = 0;
	const append = (value) => {
		visibleText += value;
	};
	while (index < input.length) {
		const codePoint = input.charCodeAt(index);
		if (codePoint === 27) {
			const nextCodePoint = input.charCodeAt(index + 1);
			if (Number.isNaN(nextCodePoint)) return {
				visibleText,
				pendingControlSequence: input.slice(index)
			};
			if (nextCodePoint === 91) {
				let cursor = index + 2;
				while (cursor < input.length) {
					if (isCsiFinalByte(input.charCodeAt(cursor))) {
						const sequence = input.slice(index, cursor + 1);
						if (!shouldStripCsiSequence(input.slice(index + 2, cursor), input[cursor] ?? "")) append(sequence);
						index = cursor + 1;
						break;
					}
					cursor += 1;
				}
				if (cursor >= input.length) return {
					visibleText,
					pendingControlSequence: input.slice(index)
				};
				continue;
			}
			if (nextCodePoint === 93 || nextCodePoint === 80 || nextCodePoint === 94 || nextCodePoint === 95) {
				const terminatorIndex = findStringTerminatorIndex(input, index + 2);
				if (terminatorIndex === null) return {
					visibleText,
					pendingControlSequence: input.slice(index)
				};
				const sequence = input.slice(index, terminatorIndex);
				const content = stripStringTerminator(input.slice(index + 2, terminatorIndex));
				if (nextCodePoint !== 93 || !shouldStripOscSequence(content)) append(sequence);
				index = terminatorIndex;
				continue;
			}
			const escapeSequenceEndIndex = findEscapeSequenceEndIndex(input, index + 1);
			if (escapeSequenceEndIndex === null) return {
				visibleText,
				pendingControlSequence: input.slice(index)
			};
			append(input.slice(index, escapeSequenceEndIndex));
			index = escapeSequenceEndIndex;
			continue;
		}
		if (codePoint === 155) {
			let cursor = index + 1;
			while (cursor < input.length) {
				if (isCsiFinalByte(input.charCodeAt(cursor))) {
					const sequence = input.slice(index, cursor + 1);
					if (!shouldStripCsiSequence(input.slice(index + 1, cursor), input[cursor] ?? "")) append(sequence);
					index = cursor + 1;
					break;
				}
				cursor += 1;
			}
			if (cursor >= input.length) return {
				visibleText,
				pendingControlSequence: input.slice(index)
			};
			continue;
		}
		if (codePoint === 157 || codePoint === 144 || codePoint === 158 || codePoint === 159) {
			const terminatorIndex = findStringTerminatorIndex(input, index + 1);
			if (terminatorIndex === null) return {
				visibleText,
				pendingControlSequence: input.slice(index)
			};
			const sequence = input.slice(index, terminatorIndex);
			const content = stripStringTerminator(input.slice(index + 1, terminatorIndex));
			if (codePoint !== 157 || !shouldStripOscSequence(content)) append(sequence);
			index = terminatorIndex;
			continue;
		}
		append(input[index] ?? "");
		index += 1;
	}
	return {
		visibleText,
		pendingControlSequence: ""
	};
}
function legacySafeThreadId(threadId) {
	return threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function toSafeThreadId(threadId) {
	return `terminal_${Encoding.encodeBase64Url(threadId)}`;
}
function toSafeTerminalId(terminalId) {
	return Encoding.encodeBase64Url(terminalId);
}
function toSessionKey(threadId, terminalId) {
	return `${threadId}\u0000${terminalId}`;
}
function shouldExcludeTerminalEnvKey(key) {
	const normalizedKey = key.toUpperCase();
	if (normalizedKey.startsWith("T3CODE_")) return true;
	if (normalizedKey.startsWith("VITE_")) return true;
	return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}
function createTerminalSpawnEnv(baseEnv, runtimeEnv) {
	const spawnEnv = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (value === void 0) continue;
		if (shouldExcludeTerminalEnvKey(key)) continue;
		spawnEnv[key] = value;
	}
	if (runtimeEnv) for (const [key, value] of Object.entries(runtimeEnv)) spawnEnv[key] = value;
	return spawnEnv;
}
function normalizedRuntimeEnv(env) {
	if (!env) return null;
	const entries = Object.entries(env);
	if (entries.length === 0) return null;
	return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)));
}
const makeTerminalManager = Effect.fn("makeTerminalManager")(function* () {
	const { terminalLogsDir } = yield* ServerConfig;
	return yield* makeTerminalManagerWithOptions({
		logsDir: terminalLogsDir,
		ptyAdapter: yield* PtyAdapter
	});
});
const makeTerminalManagerWithOptions = Effect.fn("makeTerminalManagerWithOptions")(function* (options) {
	const fileSystem = yield* FileSystem.FileSystem;
	const services = yield* Effect.services();
	const runFork = Effect.runForkWith(services);
	const logsDir = options.logsDir;
	const historyLineLimit = options.historyLineLimit ?? DEFAULT_HISTORY_LINE_LIMIT;
	const shellResolver = options.shellResolver ?? defaultShellResolver;
	const subprocessChecker = options.subprocessChecker ?? defaultSubprocessChecker;
	const subprocessPollIntervalMs = options.subprocessPollIntervalMs ?? DEFAULT_SUBPROCESS_POLL_INTERVAL_MS;
	const processKillGraceMs = options.processKillGraceMs ?? DEFAULT_PROCESS_KILL_GRACE_MS;
	const maxRetainedInactiveSessions = options.maxRetainedInactiveSessions ?? DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS;
	yield* fileSystem.makeDirectory(logsDir, { recursive: true }).pipe(Effect.orDie);
	const managerStateRef = yield* SynchronizedRef.make({
		sessions: /* @__PURE__ */ new Map(),
		killFibers: /* @__PURE__ */ new Map()
	});
	const threadLocksRef = yield* SynchronizedRef.make(/* @__PURE__ */ new Map());
	const terminalEventListeners = /* @__PURE__ */ new Set();
	const workerScope = yield* Scope.make("sequential");
	yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));
	const publishEvent = (event) => Effect.gen(function* () {
		for (const listener of terminalEventListeners) yield* listener(event).pipe(Effect.ignoreCause({ log: true }));
	});
	const historyPath = (threadId, terminalId) => {
		const threadPart = toSafeThreadId(threadId);
		if (terminalId === DEFAULT_TERMINAL_ID) return path.join(logsDir, `${threadPart}.log`);
		return path.join(logsDir, `${threadPart}_${toSafeTerminalId(terminalId)}.log`);
	};
	const legacyHistoryPath = (threadId) => path.join(logsDir, `${legacySafeThreadId(threadId)}.log`);
	const toTerminalHistoryError = (operation, threadId, terminalId) => (cause) => new TerminalHistoryError({
		operation,
		threadId,
		terminalId,
		cause
	});
	const readManagerState = SynchronizedRef.get(managerStateRef);
	const modifyManagerState = (f) => SynchronizedRef.modify(managerStateRef, f);
	const getThreadSemaphore = (threadId) => SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
		const existing = Option.fromNullishOr(current.get(threadId));
		return Option.match(existing, {
			onNone: () => Semaphore.make(1).pipe(Effect.map((semaphore) => {
				const next = new Map(current);
				next.set(threadId, semaphore);
				return [semaphore, next];
			})),
			onSome: (semaphore) => Effect.succeed([semaphore, current])
		});
	});
	const withThreadLock = (threadId, effect) => Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));
	const clearKillFiber = Effect.fn("terminal.clearKillFiber")(function* (process) {
		if (!process) return;
		const fiber = yield* modifyManagerState((state) => {
			const existing = Option.fromNullishOr(state.killFibers.get(process));
			if (Option.isNone(existing)) return [Option.none(), state];
			const killFibers = new Map(state.killFibers);
			killFibers.delete(process);
			return [existing, {
				...state,
				killFibers
			}];
		});
		if (Option.isSome(fiber)) yield* Fiber.interrupt(fiber.value).pipe(Effect.ignore);
	});
	const registerKillFiber = Effect.fn("terminal.registerKillFiber")(function* (process, fiber) {
		yield* modifyManagerState((state) => {
			const killFibers = new Map(state.killFibers);
			killFibers.set(process, fiber);
			return [void 0, {
				...state,
				killFibers
			}];
		});
	});
	const runKillEscalation = Effect.fn("terminal.runKillEscalation")(function* (process, threadId, terminalId) {
		if (!(yield* Effect.try({
			try: () => process.kill("SIGTERM"),
			catch: (cause) => new TerminalProcessSignalError({
				message: "Failed to send SIGTERM to terminal process.",
				cause,
				signal: "SIGTERM"
			})
		}).pipe(Effect.as(true), Effect.catch((error) => Effect.logWarning("failed to kill terminal process", {
			threadId,
			terminalId,
			signal: "SIGTERM",
			error: error.message
		}).pipe(Effect.as(false)))))) return;
		yield* Effect.sleep(processKillGraceMs);
		yield* Effect.try({
			try: () => process.kill("SIGKILL"),
			catch: (cause) => new TerminalProcessSignalError({
				message: "Failed to send SIGKILL to terminal process.",
				cause,
				signal: "SIGKILL"
			})
		}).pipe(Effect.catch((error) => Effect.logWarning("failed to force-kill terminal process", {
			threadId,
			terminalId,
			signal: "SIGKILL",
			error: error.message
		})));
	});
	const startKillEscalation = Effect.fn("terminal.startKillEscalation")(function* (process, threadId, terminalId) {
		yield* registerKillFiber(process, yield* runKillEscalation(process, threadId, terminalId).pipe(Effect.ensuring(modifyManagerState((state) => {
			if (!state.killFibers.has(process)) return [void 0, state];
			const killFibers = new Map(state.killFibers);
			killFibers.delete(process);
			return [void 0, {
				...state,
				killFibers
			}];
		})), Effect.forkIn(workerScope)));
	});
	const persistWorker = yield* makeKeyedCoalescingWorker({
		merge: (current, next) => ({
			history: next.history,
			immediate: current.immediate || next.immediate
		}),
		process: Effect.fn("terminal.persistHistoryWorker")(function* (sessionKey, request) {
			if (!request.immediate) yield* Effect.sleep(DEFAULT_PERSIST_DEBOUNCE_MS);
			const [threadId, terminalId] = sessionKey.split("\0");
			if (!threadId || !terminalId) return;
			yield* fileSystem.writeFileString(historyPath(threadId, terminalId), request.history).pipe(Effect.catch((error) => Effect.logWarning("failed to persist terminal history", {
				threadId,
				terminalId,
				error: error instanceof Error ? error.message : String(error)
			})));
		})
	});
	const queuePersist = Effect.fn("terminal.queuePersist")(function* (threadId, terminalId, history) {
		yield* persistWorker.enqueue(toSessionKey(threadId, terminalId), {
			history,
			immediate: false
		});
	});
	const flushPersist = Effect.fn("terminal.flushPersist")(function* (threadId, terminalId) {
		yield* persistWorker.drainKey(toSessionKey(threadId, terminalId));
	});
	const persistHistory = Effect.fn("terminal.persistHistory")(function* (threadId, terminalId, history) {
		yield* persistWorker.enqueue(toSessionKey(threadId, terminalId), {
			history,
			immediate: true
		});
		yield* flushPersist(threadId, terminalId);
	});
	const readHistory = Effect.fn("terminal.readHistory")(function* (threadId, terminalId) {
		const nextPath = historyPath(threadId, terminalId);
		if (yield* fileSystem.exists(nextPath).pipe(Effect.mapError(toTerminalHistoryError("read", threadId, terminalId)))) {
			const raw = yield* fileSystem.readFileString(nextPath).pipe(Effect.mapError(toTerminalHistoryError("read", threadId, terminalId)));
			const capped = capHistory(raw, historyLineLimit);
			if (capped !== raw) yield* fileSystem.writeFileString(nextPath, capped).pipe(Effect.mapError(toTerminalHistoryError("truncate", threadId, terminalId)));
			return capped;
		}
		if (terminalId !== DEFAULT_TERMINAL_ID) return "";
		const legacyPath = legacyHistoryPath(threadId);
		if (!(yield* fileSystem.exists(legacyPath).pipe(Effect.mapError(toTerminalHistoryError("migrate", threadId, terminalId))))) return "";
		const capped = capHistory(yield* fileSystem.readFileString(legacyPath).pipe(Effect.mapError(toTerminalHistoryError("migrate", threadId, terminalId))), historyLineLimit);
		yield* fileSystem.writeFileString(nextPath, capped).pipe(Effect.mapError(toTerminalHistoryError("migrate", threadId, terminalId)));
		yield* fileSystem.remove(legacyPath, { force: true }).pipe(Effect.catch((cleanupError) => Effect.logWarning("failed to remove legacy terminal history", {
			threadId,
			error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
		})));
		return capped;
	});
	const deleteHistory = Effect.fn("terminal.deleteHistory")(function* (threadId, terminalId) {
		yield* fileSystem.remove(historyPath(threadId, terminalId), { force: true }).pipe(Effect.catch((error) => Effect.logWarning("failed to delete terminal history", {
			threadId,
			terminalId,
			error: error instanceof Error ? error.message : String(error)
		})));
		if (terminalId === DEFAULT_TERMINAL_ID) yield* fileSystem.remove(legacyHistoryPath(threadId), { force: true }).pipe(Effect.catch((error) => Effect.logWarning("failed to delete terminal history", {
			threadId,
			terminalId,
			error: error instanceof Error ? error.message : String(error)
		})));
	});
	const deleteAllHistoryForThread = Effect.fn("terminal.deleteAllHistoryForThread")(function* (threadId) {
		const threadPrefix = `${toSafeThreadId(threadId)}_`;
		const entries = yield* fileSystem.readDirectory(logsDir, { recursive: false }).pipe(Effect.catch(() => Effect.succeed([])));
		yield* Effect.forEach(entries.filter((name) => name === `${toSafeThreadId(threadId)}.log` || name === `${legacySafeThreadId(threadId)}.log` || name.startsWith(threadPrefix)), (name) => fileSystem.remove(path.join(logsDir, name), { force: true }).pipe(Effect.catch((error) => Effect.logWarning("failed to delete terminal histories for thread", {
			threadId,
			error: error instanceof Error ? error.message : String(error)
		}))), { discard: true });
	});
	const assertValidCwd = Effect.fn("terminal.assertValidCwd")(function* (cwd) {
		if ((yield* fileSystem.stat(cwd).pipe(Effect.mapError((cause) => new TerminalCwdError({
			cwd,
			reason: cause.reason._tag === "NotFound" ? "notFound" : "statFailed",
			cause
		})))).type !== "Directory") return yield* new TerminalCwdError({
			cwd,
			reason: "notDirectory"
		});
	});
	const getSession = Effect.fn("terminal.getSession")(function* (threadId, terminalId) {
		return yield* Effect.map(readManagerState, (state) => Option.fromNullishOr(state.sessions.get(toSessionKey(threadId, terminalId))));
	});
	const requireSession = Effect.fn("terminal.requireSession")(function* (threadId, terminalId) {
		return yield* Effect.flatMap(getSession(threadId, terminalId), (session) => Option.match(session, {
			onNone: () => Effect.fail(new TerminalSessionLookupError({
				threadId,
				terminalId
			})),
			onSome: Effect.succeed
		}));
	});
	const sessionsForThread = Effect.fn("terminal.sessionsForThread")(function* (threadId) {
		return yield* readManagerState.pipe(Effect.map((state) => [...state.sessions.values()].filter((session) => session.threadId === threadId)));
	});
	const evictInactiveSessionsIfNeeded = Effect.fn("terminal.evictInactiveSessionsIfNeeded")(function* () {
		yield* modifyManagerState((state) => {
			const inactiveSessions = [...state.sessions.values()].filter((session) => session.status !== "running");
			if (inactiveSessions.length <= maxRetainedInactiveSessions) return [void 0, state];
			inactiveSessions.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.threadId.localeCompare(right.threadId) || left.terminalId.localeCompare(right.terminalId));
			const sessions = new Map(state.sessions);
			const toEvict = inactiveSessions.length - maxRetainedInactiveSessions;
			for (const session of inactiveSessions.slice(0, toEvict)) {
				const key = toSessionKey(session.threadId, session.terminalId);
				sessions.delete(key);
			}
			return [void 0, {
				...state,
				sessions
			}];
		});
	});
	const drainProcessEvents = Effect.fn("terminal.drainProcessEvents")(function* (session, expectedPid) {
		while (true) {
			const action = yield* Effect.sync(() => {
				if (session.pid !== expectedPid || !session.process || session.status !== "running") {
					session.pendingProcessEvents = [];
					session.pendingProcessEventIndex = 0;
					session.processEventDrainRunning = false;
					return { type: "idle" };
				}
				const nextEvent = session.pendingProcessEvents[session.pendingProcessEventIndex];
				if (!nextEvent) {
					session.pendingProcessEvents = [];
					session.pendingProcessEventIndex = 0;
					session.processEventDrainRunning = false;
					return { type: "idle" };
				}
				session.pendingProcessEventIndex += 1;
				if (session.pendingProcessEventIndex >= session.pendingProcessEvents.length) {
					session.pendingProcessEvents = [];
					session.pendingProcessEventIndex = 0;
				}
				if (nextEvent.type === "output") {
					const sanitized = sanitizeTerminalHistoryChunk(session.pendingHistoryControlSequence, nextEvent.data);
					session.pendingHistoryControlSequence = sanitized.pendingControlSequence;
					if (sanitized.visibleText.length > 0) session.history = capHistory(`${session.history}${sanitized.visibleText}`, historyLineLimit);
					session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
					return {
						type: "output",
						threadId: session.threadId,
						terminalId: session.terminalId,
						history: sanitized.visibleText.length > 0 ? session.history : null,
						data: nextEvent.data
					};
				}
				const process = session.process;
				cleanupProcessHandles(session);
				session.process = null;
				session.pid = null;
				session.hasRunningSubprocess = false;
				session.status = "exited";
				session.pendingHistoryControlSequence = "";
				session.pendingProcessEvents = [];
				session.pendingProcessEventIndex = 0;
				session.processEventDrainRunning = false;
				session.exitCode = Number.isInteger(nextEvent.event.exitCode) ? nextEvent.event.exitCode : null;
				session.exitSignal = Number.isInteger(nextEvent.event.signal) ? nextEvent.event.signal : null;
				session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
				return {
					type: "exit",
					process,
					threadId: session.threadId,
					terminalId: session.terminalId,
					exitCode: session.exitCode,
					exitSignal: session.exitSignal
				};
			});
			if (action.type === "idle") return;
			if (action.type === "output") {
				if (action.history !== null) yield* queuePersist(action.threadId, action.terminalId, action.history);
				yield* publishEvent({
					type: "output",
					threadId: action.threadId,
					terminalId: action.terminalId,
					createdAt: (/* @__PURE__ */ new Date()).toISOString(),
					data: action.data
				});
				continue;
			}
			yield* clearKillFiber(action.process);
			yield* publishEvent({
				type: "exited",
				threadId: action.threadId,
				terminalId: action.terminalId,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				exitCode: action.exitCode,
				exitSignal: action.exitSignal
			});
			yield* evictInactiveSessionsIfNeeded();
			return;
		}
	});
	const stopProcess = Effect.fn("terminal.stopProcess")(function* (session) {
		const process = session.process;
		if (!process) return;
		yield* modifyManagerState((state) => {
			cleanupProcessHandles(session);
			session.process = null;
			session.pid = null;
			session.hasRunningSubprocess = false;
			session.status = "exited";
			session.pendingHistoryControlSequence = "";
			session.pendingProcessEvents = [];
			session.pendingProcessEventIndex = 0;
			session.processEventDrainRunning = false;
			session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
			return [void 0, state];
		});
		yield* clearKillFiber(process);
		yield* startKillEscalation(process, session.threadId, session.terminalId);
		yield* evictInactiveSessionsIfNeeded();
	});
	const trySpawn = Effect.fn("terminal.trySpawn")(function* (shellCandidates, spawnEnv, session, index = 0, lastError = null) {
		if (index >= shellCandidates.length) return yield* new PtySpawnError({
			adapter: "terminal-manager",
			message: `${lastError?.message ?? "Failed to spawn PTY process"}.${shellCandidates.length > 0 ? ` Tried shells: ${shellCandidates.map((candidate) => formatShellCandidate(candidate)).join(", ")}.` : ""}`.trim(),
			...lastError ? { cause: lastError } : {}
		});
		const candidate = shellCandidates[index];
		if (!candidate) return yield* lastError ?? new PtySpawnError({
			adapter: "terminal-manager",
			message: "No shell candidate available for PTY spawn."
		});
		const attempt = yield* Effect.result(options.ptyAdapter.spawn({
			shell: candidate.shell,
			...candidate.args ? { args: candidate.args } : {},
			cwd: session.cwd,
			cols: session.cols,
			rows: session.rows,
			env: spawnEnv
		}));
		if (attempt._tag === "Success") return {
			process: attempt.success,
			shellLabel: formatShellCandidate(candidate)
		};
		const spawnError = attempt.failure;
		if (!isRetryableShellSpawnError(spawnError)) return yield* spawnError;
		return yield* trySpawn(shellCandidates, spawnEnv, session, index + 1, spawnError);
	});
	const startSession = Effect.fn("terminal.startSession")(function* (session, input, eventType) {
		yield* stopProcess(session);
		yield* Effect.annotateCurrentSpan({
			"terminal.thread_id": session.threadId,
			"terminal.id": session.terminalId,
			"terminal.event_type": eventType,
			"terminal.cwd": input.cwd
		});
		yield* modifyManagerState((state) => {
			session.status = "starting";
			session.cwd = input.cwd;
			session.worktreePath = input.worktreePath ?? null;
			session.cols = input.cols;
			session.rows = input.rows;
			session.exitCode = null;
			session.exitSignal = null;
			session.hasRunningSubprocess = false;
			session.pendingProcessEvents = [];
			session.pendingProcessEventIndex = 0;
			session.processEventDrainRunning = false;
			session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
			return [void 0, state];
		});
		let ptyProcess = null;
		let startedShell = null;
		const startResult = yield* Effect.result(increment(terminalSessionsTotal, { lifecycle: eventType }).pipe(Effect.andThen(Effect.gen(function* () {
			const spawnResult = yield* trySpawn(resolveShellCandidates(shellResolver), createTerminalSpawnEnv(process.env, session.runtimeEnv), session);
			ptyProcess = spawnResult.process;
			startedShell = spawnResult.shellLabel;
			const processPid = ptyProcess.pid;
			const unsubscribeData = ptyProcess.onData((data) => {
				if (!enqueueProcessEvent(session, processPid, {
					type: "output",
					data
				})) return;
				runFork(drainProcessEvents(session, processPid));
			});
			const unsubscribeExit = ptyProcess.onExit((event) => {
				if (!enqueueProcessEvent(session, processPid, {
					type: "exit",
					event
				})) return;
				runFork(drainProcessEvents(session, processPid));
			});
			yield* modifyManagerState((state) => {
				session.process = ptyProcess;
				session.pid = processPid;
				session.status = "running";
				session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
				session.unsubscribeData = unsubscribeData;
				session.unsubscribeExit = unsubscribeExit;
				return [void 0, state];
			});
			yield* publishEvent({
				type: eventType,
				threadId: session.threadId,
				terminalId: session.terminalId,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				snapshot: snapshot(session)
			});
		}))));
		if (startResult._tag === "Success") return;
		{
			const error = startResult.failure;
			if (ptyProcess) yield* startKillEscalation(ptyProcess, session.threadId, session.terminalId);
			yield* modifyManagerState((state) => {
				session.status = "error";
				session.pid = null;
				session.process = null;
				session.unsubscribeData = null;
				session.unsubscribeExit = null;
				session.hasRunningSubprocess = false;
				session.pendingProcessEvents = [];
				session.pendingProcessEventIndex = 0;
				session.processEventDrainRunning = false;
				session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
				return [void 0, state];
			});
			yield* evictInactiveSessionsIfNeeded();
			const message = error.message;
			yield* publishEvent({
				type: "error",
				threadId: session.threadId,
				terminalId: session.terminalId,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				message
			});
			yield* Effect.logError("failed to start terminal", {
				threadId: session.threadId,
				terminalId: session.terminalId,
				error: message,
				...startedShell ? { shell: startedShell } : {}
			});
		}
	});
	const closeSession = Effect.fn("terminal.closeSession")(function* (threadId, terminalId, deleteHistoryOnClose) {
		const key = toSessionKey(threadId, terminalId);
		const session = yield* getSession(threadId, terminalId);
		if (Option.isSome(session)) {
			yield* stopProcess(session.value);
			yield* persistHistory(threadId, terminalId, session.value.history);
		}
		yield* flushPersist(threadId, terminalId);
		yield* modifyManagerState((state) => {
			if (!state.sessions.has(key)) return [void 0, state];
			const sessions = new Map(state.sessions);
			sessions.delete(key);
			return [void 0, {
				...state,
				sessions
			}];
		});
		if (deleteHistoryOnClose) yield* deleteHistory(threadId, terminalId);
	});
	const pollSubprocessActivity = Effect.fn("terminal.pollSubprocessActivity")(function* () {
		const runningSessions = [...(yield* readManagerState).sessions.values()].filter((session) => session.status === "running" && Number.isInteger(session.pid));
		if (runningSessions.length === 0) return;
		const checkSubprocessActivity = Effect.fn("terminal.checkSubprocessActivity")(function* (session) {
			const terminalPid = session.pid;
			const hasRunningSubprocess = yield* subprocessChecker(terminalPid).pipe(Effect.map(Option.some), Effect.catch((error) => Effect.logWarning("failed to check terminal subprocess activity", {
				threadId: session.threadId,
				terminalId: session.terminalId,
				terminalPid,
				error: error instanceof Error ? error.message : String(error)
			}).pipe(Effect.as(Option.none()))));
			if (Option.isNone(hasRunningSubprocess)) return;
			const event = yield* modifyManagerState((state) => {
				const liveSession = Option.fromNullishOr(state.sessions.get(toSessionKey(session.threadId, session.terminalId)));
				if (Option.isNone(liveSession) || liveSession.value.status !== "running" || liveSession.value.pid !== terminalPid || liveSession.value.hasRunningSubprocess === hasRunningSubprocess.value) return [Option.none(), state];
				liveSession.value.hasRunningSubprocess = hasRunningSubprocess.value;
				liveSession.value.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
				return [Option.some({
					type: "activity",
					threadId: liveSession.value.threadId,
					terminalId: liveSession.value.terminalId,
					createdAt: (/* @__PURE__ */ new Date()).toISOString(),
					hasRunningSubprocess: hasRunningSubprocess.value
				}), state];
			});
			if (Option.isSome(event)) yield* publishEvent(event.value);
		});
		yield* Effect.forEach(runningSessions, checkSubprocessActivity, {
			concurrency: "unbounded",
			discard: true
		});
	});
	const hasRunningSessions = readManagerState.pipe(Effect.map((state) => [...state.sessions.values()].some((session) => session.status === "running")));
	yield* Effect.forever(hasRunningSessions.pipe(Effect.flatMap((active) => active ? pollSubprocessActivity().pipe(Effect.flatMap(() => Effect.sleep(subprocessPollIntervalMs))) : Effect.sleep(subprocessPollIntervalMs)))).pipe(Effect.forkIn(workerScope));
	yield* Effect.addFinalizer(() => Effect.gen(function* () {
		const sessions = yield* modifyManagerState((state) => [[...state.sessions.values()], {
			...state,
			sessions: /* @__PURE__ */ new Map()
		}]);
		const cleanupSession = Effect.fn("terminal.cleanupSession")(function* (session) {
			cleanupProcessHandles(session);
			if (!session.process) return;
			yield* clearKillFiber(session.process);
			yield* runKillEscalation(session.process, session.threadId, session.terminalId);
		});
		yield* Effect.forEach(sessions, cleanupSession, {
			concurrency: "unbounded",
			discard: true
		});
	}).pipe(Effect.ignoreCause({ log: true })));
	const open = (input) => withThreadLock(input.threadId, Effect.gen(function* () {
		const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
		yield* assertValidCwd(input.cwd);
		const sessionKey = toSessionKey(input.threadId, terminalId);
		const existing = yield* getSession(input.threadId, terminalId);
		if (Option.isNone(existing)) {
			yield* flushPersist(input.threadId, terminalId);
			const history = yield* readHistory(input.threadId, terminalId);
			const cols = input.cols ?? DEFAULT_OPEN_COLS;
			const rows = input.rows ?? DEFAULT_OPEN_ROWS;
			const session = {
				threadId: input.threadId,
				terminalId,
				cwd: input.cwd,
				worktreePath: input.worktreePath ?? null,
				status: "starting",
				pid: null,
				history,
				pendingHistoryControlSequence: "",
				pendingProcessEvents: [],
				pendingProcessEventIndex: 0,
				processEventDrainRunning: false,
				exitCode: null,
				exitSignal: null,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				cols,
				rows,
				process: null,
				unsubscribeData: null,
				unsubscribeExit: null,
				hasRunningSubprocess: false,
				runtimeEnv: normalizedRuntimeEnv(input.env)
			};
			const createdSession = session;
			yield* modifyManagerState((state) => {
				const sessions = new Map(state.sessions);
				sessions.set(sessionKey, createdSession);
				return [void 0, {
					...state,
					sessions
				}];
			});
			yield* evictInactiveSessionsIfNeeded();
			yield* startSession(session, {
				threadId: input.threadId,
				terminalId,
				cwd: input.cwd,
				...input.worktreePath !== void 0 ? { worktreePath: input.worktreePath } : {},
				cols,
				rows,
				...input.env ? { env: input.env } : {}
			}, "started");
			return snapshot(session);
		}
		const liveSession = existing.value;
		const nextRuntimeEnv = normalizedRuntimeEnv(input.env);
		const currentRuntimeEnv = liveSession.runtimeEnv;
		const targetCols = input.cols ?? liveSession.cols;
		const targetRows = input.rows ?? liveSession.rows;
		const runtimeEnvChanged = !Equal.equals(currentRuntimeEnv, nextRuntimeEnv);
		if (liveSession.cwd !== input.cwd || runtimeEnvChanged) {
			yield* stopProcess(liveSession);
			liveSession.cwd = input.cwd;
			liveSession.worktreePath = input.worktreePath ?? null;
			liveSession.runtimeEnv = nextRuntimeEnv;
			liveSession.history = "";
			liveSession.pendingHistoryControlSequence = "";
			liveSession.pendingProcessEvents = [];
			liveSession.pendingProcessEventIndex = 0;
			liveSession.processEventDrainRunning = false;
			yield* persistHistory(liveSession.threadId, liveSession.terminalId, liveSession.history);
		} else if (liveSession.status === "exited" || liveSession.status === "error") {
			liveSession.runtimeEnv = nextRuntimeEnv;
			liveSession.worktreePath = input.worktreePath ?? null;
			liveSession.history = "";
			liveSession.pendingHistoryControlSequence = "";
			liveSession.pendingProcessEvents = [];
			liveSession.pendingProcessEventIndex = 0;
			liveSession.processEventDrainRunning = false;
			yield* persistHistory(liveSession.threadId, liveSession.terminalId, liveSession.history);
		}
		if (!liveSession.process) {
			yield* startSession(liveSession, {
				threadId: input.threadId,
				terminalId,
				cwd: input.cwd,
				worktreePath: liveSession.worktreePath,
				cols: targetCols,
				rows: targetRows,
				...input.env ? { env: input.env } : {}
			}, "started");
			return snapshot(liveSession);
		}
		if (liveSession.cols !== targetCols || liveSession.rows !== targetRows) {
			liveSession.cols = targetCols;
			liveSession.rows = targetRows;
			liveSession.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
			liveSession.process.resize(targetCols, targetRows);
		}
		return snapshot(liveSession);
	}));
	const write = Effect.fn("terminal.write")(function* (input) {
		const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
		const session = yield* requireSession(input.threadId, terminalId);
		const process = session.process;
		if (!process || session.status !== "running") {
			if (session.status === "exited") return;
			return yield* new TerminalNotRunningError({
				threadId: input.threadId,
				terminalId
			});
		}
		yield* Effect.sync(() => process.write(input.data));
	});
	const resize = Effect.fn("terminal.resize")(function* (input) {
		const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
		const session = yield* requireSession(input.threadId, terminalId);
		const process = session.process;
		if (!process || session.status !== "running") return yield* new TerminalNotRunningError({
			threadId: input.threadId,
			terminalId
		});
		session.cols = input.cols;
		session.rows = input.rows;
		session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		yield* Effect.sync(() => process.resize(input.cols, input.rows));
	});
	const clear = (input) => withThreadLock(input.threadId, Effect.gen(function* () {
		const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
		const session = yield* requireSession(input.threadId, terminalId);
		session.history = "";
		session.pendingHistoryControlSequence = "";
		session.pendingProcessEvents = [];
		session.pendingProcessEventIndex = 0;
		session.processEventDrainRunning = false;
		session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		yield* persistHistory(input.threadId, terminalId, session.history);
		yield* publishEvent({
			type: "cleared",
			threadId: input.threadId,
			terminalId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}));
	const restart = (input) => withThreadLock(input.threadId, Effect.gen(function* () {
		yield* increment(terminalRestartsTotal, { scope: "thread" });
		const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
		yield* assertValidCwd(input.cwd);
		const sessionKey = toSessionKey(input.threadId, terminalId);
		const existingSession = yield* getSession(input.threadId, terminalId);
		let session;
		if (Option.isNone(existingSession)) {
			const cols = input.cols ?? DEFAULT_OPEN_COLS;
			const rows = input.rows ?? DEFAULT_OPEN_ROWS;
			session = {
				threadId: input.threadId,
				terminalId,
				cwd: input.cwd,
				worktreePath: input.worktreePath ?? null,
				status: "starting",
				pid: null,
				history: "",
				pendingHistoryControlSequence: "",
				pendingProcessEvents: [],
				pendingProcessEventIndex: 0,
				processEventDrainRunning: false,
				exitCode: null,
				exitSignal: null,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				cols,
				rows,
				process: null,
				unsubscribeData: null,
				unsubscribeExit: null,
				hasRunningSubprocess: false,
				runtimeEnv: normalizedRuntimeEnv(input.env)
			};
			const createdSession = session;
			yield* modifyManagerState((state) => {
				const sessions = new Map(state.sessions);
				sessions.set(sessionKey, createdSession);
				return [void 0, {
					...state,
					sessions
				}];
			});
			yield* evictInactiveSessionsIfNeeded();
		} else {
			session = existingSession.value;
			yield* stopProcess(session);
			session.cwd = input.cwd;
			session.worktreePath = input.worktreePath ?? null;
			session.runtimeEnv = normalizedRuntimeEnv(input.env);
		}
		const cols = input.cols ?? session.cols;
		const rows = input.rows ?? session.rows;
		session.history = "";
		session.pendingHistoryControlSequence = "";
		session.pendingProcessEvents = [];
		session.pendingProcessEventIndex = 0;
		session.processEventDrainRunning = false;
		yield* persistHistory(input.threadId, terminalId, session.history);
		yield* startSession(session, {
			threadId: input.threadId,
			terminalId,
			cwd: input.cwd,
			...input.worktreePath !== void 0 ? { worktreePath: input.worktreePath } : {},
			cols,
			rows,
			...input.env ? { env: input.env } : {}
		}, "restarted");
		return snapshot(session);
	}));
	const close = (input) => withThreadLock(input.threadId, Effect.gen(function* () {
		if (input.terminalId) {
			yield* closeSession(input.threadId, input.terminalId, input.deleteHistory === true);
			return;
		}
		const threadSessions = yield* sessionsForThread(input.threadId);
		yield* Effect.forEach(threadSessions, (session) => closeSession(input.threadId, session.terminalId, false), { discard: true });
		if (input.deleteHistory) yield* deleteAllHistoryForThread(input.threadId);
	}));
	return {
		open,
		write,
		resize,
		clear,
		restart,
		close,
		subscribe: (listener) => Effect.sync(() => {
			terminalEventListeners.add(listener);
			return () => {
				terminalEventListeners.delete(listener);
			};
		})
	};
});
const TerminalManagerLive = Layer.effect(TerminalManager, makeTerminalManager());

//#endregion
//#region src/git/Layers/GitManager.ts
const COMMIT_TIMEOUT_MS = 10 * 6e4;
const MAX_PROGRESS_TEXT_LENGTH = 500;
const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;
const STATUS_RESULT_CACHE_TTL = Duration.seconds(1);
const STATUS_RESULT_CACHE_CAPACITY = 2048;
function isNotGitRepositoryError(error) {
	return error.message.toLowerCase().includes("not a git repository");
}
function parseRepositoryNameFromPullRequestUrl(url) {
	const trimmed = url.trim();
	const repositoryName = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed)?.[1]?.trim() ?? "";
	return repositoryName.length > 0 ? repositoryName : null;
}
function resolveHeadRepositoryNameWithOwner(pullRequest) {
	const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
	if (explicitRepository.length > 0) return explicitRepository;
	if (!pullRequest.isCrossRepository) return null;
	const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
	const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
	if (ownerLogin.length === 0 || !repositoryName) return null;
	return `${ownerLogin}/${repositoryName}`;
}
function resolvePullRequestWorktreeLocalBranchName(pullRequest) {
	if (!pullRequest.isCrossRepository) return pullRequest.headBranch;
	const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
	const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
	return `t3code/pr-${pullRequest.number}/${suffix}`;
}
function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url) {
	const trimmed = url?.trim() ?? "";
	if (trimmed.length === 0) return null;
	const repositoryNameWithOwner = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed)?.[1]?.trim() ?? "";
	return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}
function parseRepositoryOwnerLogin(nameWithOwner) {
	const trimmed = nameWithOwner?.trim() ?? "";
	if (trimmed.length === 0) return null;
	const [ownerLogin] = trimmed.split("/");
	const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
	return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}
function normalizeOptionalString(value) {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}
function normalizeOptionalRepositoryNameWithOwner(value) {
	const normalized = normalizeOptionalString(value);
	return normalized ? normalized.toLowerCase() : null;
}
function normalizeOptionalOwnerLogin(value) {
	const normalized = normalizeOptionalString(value);
	return normalized ? normalized.toLowerCase() : null;
}
function resolvePullRequestHeadRepositoryNameWithOwner(pr) {
	const explicitRepository = normalizeOptionalString(pr.headRepositoryNameWithOwner);
	if (explicitRepository) return explicitRepository;
	if (!pr.isCrossRepository) return null;
	const ownerLogin = normalizeOptionalString(pr.headRepositoryOwnerLogin);
	const repositoryName = parseRepositoryNameFromPullRequestUrl(pr.url);
	if (!ownerLogin || !repositoryName) return null;
	return `${ownerLogin}/${repositoryName}`;
}
function matchesBranchHeadContext(pr, headContext) {
	if (pr.headRefName !== headContext.headBranch) return false;
	const expectedHeadRepository = normalizeOptionalRepositoryNameWithOwner(headContext.headRepositoryNameWithOwner);
	const expectedHeadOwner = normalizeOptionalOwnerLogin(headContext.headRepositoryOwnerLogin) ?? parseRepositoryOwnerLogin(expectedHeadRepository);
	const prHeadRepository = normalizeOptionalRepositoryNameWithOwner(resolvePullRequestHeadRepositoryNameWithOwner(pr));
	const prHeadOwner = normalizeOptionalOwnerLogin(pr.headRepositoryOwnerLogin) ?? parseRepositoryOwnerLogin(prHeadRepository);
	if (headContext.isCrossRepository) {
		if (pr.isCrossRepository === false) return false;
		if ((expectedHeadRepository || expectedHeadOwner) && !prHeadRepository && !prHeadOwner) return false;
		if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) return false;
		if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) return false;
		return true;
	}
	if (pr.isCrossRepository === true) return false;
	if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) return false;
	if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) return false;
	return true;
}
function parsePullRequestList(raw) {
	if (!Array.isArray(raw)) return [];
	const parsed = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry;
		const number = record.number;
		const title = record.title;
		const url = record.url;
		const baseRefName = record.baseRefName;
		const headRefName = record.headRefName;
		const state = record.state;
		const mergedAt = record.mergedAt;
		const updatedAt = record.updatedAt;
		const isCrossRepository = record.isCrossRepository;
		const headRepositoryRecord = typeof record.headRepository === "object" && record.headRepository !== null ? record.headRepository : null;
		const headRepositoryOwnerRecord = typeof record.headRepositoryOwner === "object" && record.headRepositoryOwner !== null ? record.headRepositoryOwner : null;
		const headRepositoryNameWithOwner = typeof record.headRepositoryNameWithOwner === "string" ? record.headRepositoryNameWithOwner : typeof headRepositoryRecord?.nameWithOwner === "string" ? headRepositoryRecord.nameWithOwner : null;
		const headRepositoryOwnerLogin = typeof record.headRepositoryOwnerLogin === "string" ? record.headRepositoryOwnerLogin : typeof headRepositoryOwnerRecord?.login === "string" ? headRepositoryOwnerRecord.login : null;
		if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) continue;
		if (typeof title !== "string" || typeof url !== "string" || typeof baseRefName !== "string" || typeof headRefName !== "string") continue;
		let normalizedState;
		if (typeof mergedAt === "string" && mergedAt.trim().length > 0 || state === "MERGED" || state === "merged") normalizedState = "merged";
		else if (state === "OPEN" || state === "open" || state === void 0 || state === null) normalizedState = "open";
		else if (state === "CLOSED" || state === "closed") normalizedState = "closed";
		else continue;
		parsed.push({
			number,
			title,
			url,
			baseRefName,
			headRefName,
			state: normalizedState,
			updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
			...typeof isCrossRepository === "boolean" ? { isCrossRepository } : {},
			...headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {},
			...headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}
		});
	}
	return parsed;
}
function toPullRequestInfo(summary) {
	return {
		number: summary.number,
		title: summary.title,
		url: summary.url,
		baseRefName: summary.baseRefName,
		headRefName: summary.headRefName,
		state: summary.state ?? "open",
		updatedAt: null,
		...summary.isCrossRepository !== void 0 ? { isCrossRepository: summary.isCrossRepository } : {},
		...summary.headRepositoryNameWithOwner !== void 0 ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner } : {},
		...summary.headRepositoryOwnerLogin !== void 0 ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin } : {}
	};
}
function gitManagerError(operation, detail, cause) {
	return new GitManagerError({
		operation,
		detail,
		...cause !== void 0 ? { cause } : {}
	});
}
function limitContext(value, maxChars) {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n\n[truncated]`;
}
function shortenSha(sha) {
	if (!sha) return null;
	return sha.slice(0, SHORT_SHA_LENGTH);
}
function truncateText(value, maxLength = TOAST_DESCRIPTION_MAX) {
	if (!value) return void 0;
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return "...".slice(0, maxLength);
	return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
function withDescription(title, description) {
	return description ? {
		title,
		description
	} : { title };
}
function summarizeGitActionResult(result) {
	if (result.pr.status === "created" || result.pr.status === "opened_existing") {
		const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
		return withDescription(`${result.pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`, truncateText(result.pr.title));
	}
	if (result.push.status === "pushed") {
		const shortSha = shortenSha(result.commit.commitSha);
		const branch = result.push.upstreamBranch ?? result.push.branch;
		return withDescription(`Pushed${shortSha ? ` ${shortSha}` : ""}${branch ? ` to ${branch}` : ""}`, truncateText(result.commit.subject));
	}
	if (result.commit.status === "created") {
		const shortSha = shortenSha(result.commit.commitSha);
		return withDescription(shortSha ? `Committed ${shortSha}` : "Committed changes", truncateText(result.commit.subject));
	}
	return { title: "Done" };
}
function sanitizeCommitMessage(generated) {
	const subject = (generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "").replace(/[.]+$/g, "").trim();
	return {
		subject: subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files",
		body: generated.body.trim(),
		...generated.branch !== void 0 ? { branch: generated.branch } : {}
	};
}
function sanitizeProgressText(value) {
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) return trimmed;
	return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}
function isCommitAction(action) {
	return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}
function formatCommitMessage(subject, body) {
	const trimmedBody = body.trim();
	if (trimmedBody.length === 0) return subject;
	return `${subject}\n\n${trimmedBody}`;
}
function parseCustomCommitMessage(raw) {
	const normalized = raw.replace(/\r\n/g, "\n").trim();
	if (normalized.length === 0) return null;
	const [firstLine, ...rest] = normalized.split("\n");
	const subject = firstLine?.trim() ?? "";
	if (subject.length === 0) return null;
	return {
		subject,
		body: rest.join("\n").trim()
	};
}
function appendUnique(values, next) {
	const trimmed = next?.trim() ?? "";
	if (trimmed.length === 0 || values.includes(trimmed)) return;
	values.push(trimmed);
}
function toStatusPr(pr) {
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		baseBranch: pr.baseRefName,
		headBranch: pr.headRefName,
		state: pr.state
	};
}
function normalizePullRequestReference(reference) {
	const trimmed = reference.trim();
	return /^#(\d+)$/.exec(trimmed)?.[1] ?? trimmed;
}
function canonicalizeExistingPath(value) {
	try {
		return realpathSync.native(value);
	} catch {
		return value;
	}
}
function toResolvedPullRequest(pr) {
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		baseBranch: pr.baseRefName,
		headBranch: pr.headRefName,
		state: pr.state ?? "open"
	};
}
function shouldPreferSshRemote(url) {
	if (!url) return false;
	const trimmed = url.trim();
	return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}
function toPullRequestHeadRemoteInfo(pr) {
	return {
		...pr.isCrossRepository !== void 0 ? { isCrossRepository: pr.isCrossRepository } : {},
		...pr.headRepositoryNameWithOwner !== void 0 ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner } : {},
		...pr.headRepositoryOwnerLogin !== void 0 ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin } : {}
	};
}
const makeGitManager = Effect.fn("makeGitManager")(function* () {
	const gitCore = yield* GitCore;
	const gitHubCli = yield* GitHubCli;
	const textGeneration = yield* TextGeneration;
	const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
	const serverSettingsService = yield* ServerSettingsService;
	const createProgressEmitter = (input, options) => {
		const actionId = options?.actionId ?? randomUUID();
		const reporter = options?.progressReporter;
		const emit = (event) => reporter ? reporter.publish({
			actionId,
			cwd: input.cwd,
			action: input.action,
			...event
		}) : Effect.void;
		return {
			actionId,
			emit
		};
	};
	const configurePullRequestHeadUpstreamBase = Effect.fn("configurePullRequestHeadUpstream")(function* (cwd, pullRequest, localBranch = pullRequest.headBranch) {
		const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
		if (repositoryNameWithOwner.length === 0) return;
		const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
			cwd,
			repository: repositoryNameWithOwner
		});
		const remoteUrl = shouldPreferSshRemote(yield* gitCore.readConfigValue(cwd, "remote.origin.url")) ? cloneUrls.sshUrl : cloneUrls.url;
		const preferredRemoteName = pullRequest.headRepositoryOwnerLogin?.trim() || repositoryNameWithOwner.split("/")[0]?.trim() || "fork";
		const remoteName = yield* gitCore.ensureRemote({
			cwd,
			preferredName: preferredRemoteName,
			url: remoteUrl
		});
		yield* gitCore.setBranchUpstream({
			cwd,
			branch: localBranch,
			remoteName,
			remoteBranch: pullRequest.headBranch
		});
	});
	const configurePullRequestHeadUpstream = (cwd, pullRequest, localBranch = pullRequest.headBranch) => configurePullRequestHeadUpstreamBase(cwd, pullRequest, localBranch).pipe(Effect.catch((error) => Effect.logWarning(`GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${localBranch} -> ${pullRequest.headBranch} in ${cwd}: ${error.message}`).pipe(Effect.asVoid)));
	const materializePullRequestHeadBranchBase = Effect.fn("materializePullRequestHeadBranch")(function* (cwd, pullRequest, localBranch = pullRequest.headBranch) {
		const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
		if (repositoryNameWithOwner.length === 0) {
			yield* gitCore.fetchPullRequestBranch({
				cwd,
				prNumber: pullRequest.number,
				branch: localBranch
			});
			return;
		}
		const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
			cwd,
			repository: repositoryNameWithOwner
		});
		const remoteUrl = shouldPreferSshRemote(yield* gitCore.readConfigValue(cwd, "remote.origin.url")) ? cloneUrls.sshUrl : cloneUrls.url;
		const preferredRemoteName = pullRequest.headRepositoryOwnerLogin?.trim() || repositoryNameWithOwner.split("/")[0]?.trim() || "fork";
		const remoteName = yield* gitCore.ensureRemote({
			cwd,
			preferredName: preferredRemoteName,
			url: remoteUrl
		});
		yield* gitCore.fetchRemoteBranch({
			cwd,
			remoteName,
			remoteBranch: pullRequest.headBranch,
			localBranch
		});
		yield* gitCore.setBranchUpstream({
			cwd,
			branch: localBranch,
			remoteName,
			remoteBranch: pullRequest.headBranch
		});
	});
	const materializePullRequestHeadBranch = (cwd, pullRequest, localBranch = pullRequest.headBranch) => materializePullRequestHeadBranchBase(cwd, pullRequest, localBranch).pipe(Effect.catch(() => gitCore.fetchPullRequestBranch({
		cwd,
		prNumber: pullRequest.number,
		branch: localBranch
	})));
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";
	const normalizeStatusCacheKey = (cwd) => canonicalizeExistingPath(cwd);
	const readStatus = Effect.fn("readStatus")(function* (cwd) {
		const details = yield* gitCore.statusDetails(cwd).pipe(Effect.catchIf(isNotGitRepositoryError, () => Effect.succeed({
			isRepo: false,
			hasOriginRemote: false,
			isDefaultBranch: false,
			branch: null,
			upstreamRef: null,
			hasWorkingTreeChanges: false,
			workingTree: {
				files: [],
				insertions: 0,
				deletions: 0
			},
			hasUpstream: false,
			aheadCount: 0,
			behindCount: 0
		})));
		const pr = details.isRepo && details.branch !== null ? yield* findLatestPr(cwd, {
			branch: details.branch,
			upstreamRef: details.upstreamRef
		}).pipe(Effect.map((latest) => latest ? toStatusPr(latest) : null), Effect.catch(() => Effect.succeed(null))) : null;
		return {
			isRepo: details.isRepo,
			hasOriginRemote: details.hasOriginRemote,
			isDefaultBranch: details.isDefaultBranch,
			branch: details.branch,
			hasWorkingTreeChanges: details.hasWorkingTreeChanges,
			workingTree: details.workingTree,
			hasUpstream: details.hasUpstream,
			aheadCount: details.aheadCount,
			behindCount: details.behindCount,
			pr
		};
	});
	const statusResultCache = yield* Cache.makeWith({
		capacity: STATUS_RESULT_CACHE_CAPACITY,
		lookup: readStatus,
		timeToLive: (exit) => Exit.isSuccess(exit) ? STATUS_RESULT_CACHE_TTL : Duration.zero
	});
	const invalidateStatusResultCache = (cwd) => Cache.invalidate(statusResultCache, normalizeStatusCacheKey(cwd));
	const readConfigValueNullable = (cwd, key) => gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));
	const resolveRemoteRepositoryContext = Effect.fn("resolveRemoteRepositoryContext")(function* (cwd, remoteName) {
		if (!remoteName) return {
			repositoryNameWithOwner: null,
			ownerLogin: null
		};
		const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(yield* readConfigValueNullable(cwd, `remote.${remoteName}.url`));
		return {
			repositoryNameWithOwner,
			ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner)
		};
	});
	const resolveBranchHeadContext = Effect.fn("resolveBranchHeadContext")(function* (cwd, details) {
		const remoteName = yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
		const headBranchFromUpstream = details.upstreamRef ? extractBranchNameFromRemoteRef(details.upstreamRef, { remoteName }) : "";
		const headBranch = headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;
		const shouldProbeLocalBranchSelector = headBranchFromUpstream.length === 0 || headBranch === details.branch;
		const [remoteRepository, originRepository] = yield* Effect.all([resolveRemoteRepositoryContext(cwd, remoteName), resolveRemoteRepositoryContext(cwd, "origin")], { concurrency: "unbounded" });
		const isCrossRepository = remoteRepository.repositoryNameWithOwner !== null && originRepository.repositoryNameWithOwner !== null ? remoteRepository.repositoryNameWithOwner.toLowerCase() !== originRepository.repositoryNameWithOwner.toLowerCase() : remoteName !== null && remoteName !== "origin" && remoteRepository.repositoryNameWithOwner !== null;
		const ownerHeadSelector = remoteRepository.ownerLogin && headBranch.length > 0 ? `${remoteRepository.ownerLogin}:${headBranch}` : null;
		const remoteAliasHeadSelector = remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
		const shouldProbeRemoteOwnedSelectors = isCrossRepository || remoteName !== null && remoteName !== "origin";
		const headSelectors = [];
		if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
			appendUnique(headSelectors, ownerHeadSelector);
			appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
		}
		if (shouldProbeLocalBranchSelector) appendUnique(headSelectors, details.branch);
		appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
		if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
			appendUnique(headSelectors, ownerHeadSelector);
			appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
		}
		return {
			localBranch: details.branch,
			headBranch,
			headSelectors,
			preferredHeadSelector: ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
			remoteName,
			headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
			headRepositoryOwnerLogin: remoteRepository.ownerLogin,
			isCrossRepository
		};
	});
	const findOpenPr = Effect.fn("findOpenPr")(function* (cwd, headContext) {
		for (const headSelector of headContext.headSelectors) {
			const firstPullRequest = (yield* gitHubCli.listOpenPullRequests({
				cwd,
				headSelector,
				limit: 1
			})).map(toPullRequestInfo).find((pullRequest) => matchesBranchHeadContext(pullRequest, headContext));
			if (firstPullRequest) return {
				number: firstPullRequest.number,
				title: firstPullRequest.title,
				url: firstPullRequest.url,
				baseRefName: firstPullRequest.baseRefName,
				headRefName: firstPullRequest.headRefName,
				state: "open",
				updatedAt: null
			};
		}
		return null;
	});
	const findLatestPr = Effect.fn("findLatestPr")(function* (cwd, details) {
		const headContext = yield* resolveBranchHeadContext(cwd, details);
		const parsedByNumber = /* @__PURE__ */ new Map();
		for (const headSelector of headContext.headSelectors) {
			const raw = (yield* gitHubCli.execute({
				cwd,
				args: [
					"pr",
					"list",
					"--head",
					headSelector,
					"--state",
					"all",
					"--limit",
					"20",
					"--json",
					"number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner"
				]
			}).pipe(Effect.map((result) => result.stdout))).trim();
			if (raw.length === 0) continue;
			const parsedJson = yield* Effect.try({
				try: () => JSON.parse(raw),
				catch: (cause) => gitManagerError("findLatestPr", "GitHub CLI returned invalid PR list JSON.", cause)
			});
			for (const pr of parsePullRequestList(parsedJson)) {
				if (!matchesBranchHeadContext(pr, headContext)) continue;
				parsedByNumber.set(pr.number, pr);
			}
		}
		const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
			const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
			return (b.updatedAt ? Date.parse(b.updatedAt) : 0) - left;
		});
		const latestOpenPr = parsed.find((pr) => pr.state === "open");
		if (latestOpenPr) return latestOpenPr;
		return parsed[0] ?? null;
	});
	const buildCompletionToast = Effect.fn("buildCompletionToast")(function* (cwd, result) {
		const summary = summarizeGitActionResult(result);
		let latestOpenPr = null;
		let currentBranchIsDefault = false;
		let finalBranchContext = null;
		if (result.action !== "commit") {
			const finalStatus = yield* gitCore.statusDetails(cwd);
			if (finalStatus.branch) {
				finalBranchContext = {
					branch: finalStatus.branch,
					upstreamRef: finalStatus.upstreamRef,
					hasUpstream: finalStatus.hasUpstream
				};
				currentBranchIsDefault = finalStatus.isDefaultBranch;
			}
		}
		const explicitResultPr = (result.pr.status === "created" || result.pr.status === "opened_existing") && result.pr.url ? {
			url: result.pr.url,
			state: "open"
		} : null;
		if ((result.action === "commit_push" || result.action === "push") && result.push.status === "pushed" && result.branch.status !== "created" && !currentBranchIsDefault && explicitResultPr === null && finalBranchContext?.hasUpstream === true && finalBranchContext) latestOpenPr = yield* resolveBranchHeadContext(cwd, {
			branch: finalBranchContext.branch,
			upstreamRef: finalBranchContext.upstreamRef
		}).pipe(Effect.flatMap((headContext) => findOpenPr(cwd, headContext)), Effect.catch(() => Effect.succeed(null)));
		const openPr = latestOpenPr ?? explicitResultPr;
		const cta = result.action === "commit" && result.commit.status === "created" ? {
			kind: "run_action",
			label: "Push",
			action: { kind: "push" }
		} : (result.action === "push" || result.action === "create_pr" || result.action === "commit_push" || result.action === "commit_push_pr") && openPr?.url && (!currentBranchIsDefault || result.pr.status === "created" || result.pr.status === "opened_existing") ? {
			kind: "open_pr",
			label: "View PR",
			url: openPr.url
		} : (result.action === "push" || result.action === "commit_push") && result.push.status === "pushed" && !currentBranchIsDefault ? {
			kind: "run_action",
			label: "Create PR",
			action: { kind: "create_pr" }
		} : { kind: "none" };
		return {
			...summary,
			cta
		};
	});
	const resolveBaseBranch = Effect.fn("resolveBaseBranch")(function* (cwd, branch, upstreamRef, headContext) {
		const configured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
		if (configured) return configured;
		if (upstreamRef && !headContext.isCrossRepository) {
			const upstreamBranch = extractBranchNameFromRemoteRef(upstreamRef, { remoteName: headContext.remoteName });
			if (upstreamBranch.length > 0 && upstreamBranch !== branch) return upstreamBranch;
		}
		const defaultFromGh = yield* gitHubCli.getDefaultBranch({ cwd }).pipe(Effect.catch(() => Effect.succeed(null)));
		if (defaultFromGh) return defaultFromGh;
		return "main";
	});
	const resolveCommitAndBranchSuggestion = Effect.fn("resolveCommitAndBranchSuggestion")(function* (input) {
		const context = yield* gitCore.prepareCommitContext(input.cwd, input.filePaths);
		if (!context) return null;
		const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
		if (customCommit) return {
			subject: customCommit.subject,
			body: customCommit.body,
			...input.includeBranch ? { branch: sanitizeFeatureBranchName(customCommit.subject) } : {},
			commitMessage: formatCommitMessage(customCommit.subject, customCommit.body)
		};
		const generated = yield* textGeneration.generateCommitMessage({
			cwd: input.cwd,
			branch: input.branch,
			stagedSummary: limitContext(context.stagedSummary, 8e3),
			stagedPatch: limitContext(context.stagedPatch, 5e4),
			...input.includeBranch ? { includeBranch: true } : {},
			modelSelection: input.modelSelection
		}).pipe(Effect.map((result) => sanitizeCommitMessage(result)));
		return {
			subject: generated.subject,
			body: generated.body,
			...generated.branch !== void 0 ? { branch: generated.branch } : {},
			commitMessage: formatCommitMessage(generated.subject, generated.body)
		};
	});
	const runCommitStep = Effect.fn("runCommitStep")(function* (modelSelection, cwd, action, branch, commitMessage, preResolvedSuggestion, filePaths, progressReporter, actionId) {
		const emit = (event) => progressReporter && actionId ? progressReporter.publish({
			actionId,
			cwd,
			action,
			...event
		}) : Effect.void;
		let suggestion = preResolvedSuggestion;
		if (!suggestion) {
			if (!commitMessage?.trim()) yield* emit({
				kind: "phase_started",
				phase: "commit",
				label: "Generating commit message..."
			});
			suggestion = yield* resolveCommitAndBranchSuggestion({
				cwd,
				branch,
				...commitMessage ? { commitMessage } : {},
				...filePaths ? { filePaths } : {},
				modelSelection
			});
		}
		if (!suggestion) return { status: "skipped_no_changes" };
		yield* emit({
			kind: "phase_started",
			phase: "commit",
			label: "Committing..."
		});
		let currentHookName = null;
		const commitProgress = progressReporter && actionId ? {
			onOutputLine: ({ stream, text }) => {
				const sanitized = sanitizeProgressText(text);
				if (!sanitized) return Effect.void;
				return emit({
					kind: "hook_output",
					hookName: currentHookName,
					stream,
					text: sanitized
				});
			},
			onHookStarted: (hookName) => {
				currentHookName = hookName;
				return emit({
					kind: "hook_started",
					hookName
				});
			},
			onHookFinished: ({ hookName, exitCode, durationMs }) => {
				if (currentHookName === hookName) currentHookName = null;
				return emit({
					kind: "hook_finished",
					hookName,
					exitCode,
					durationMs
				});
			}
		} : null;
		const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
			timeoutMs: COMMIT_TIMEOUT_MS,
			...commitProgress ? { progress: commitProgress } : {}
		});
		if (currentHookName !== null) {
			yield* emit({
				kind: "hook_finished",
				hookName: currentHookName,
				exitCode: 0,
				durationMs: null
			});
			currentHookName = null;
		}
		return {
			status: "created",
			commitSha,
			subject: suggestion.subject
		};
	});
	const runPrStep = Effect.fn("runPrStep")(function* (modelSelection, cwd, fallbackBranch, emit) {
		const details = yield* gitCore.statusDetails(cwd);
		const branch = details.branch ?? fallbackBranch;
		if (!branch) return yield* gitManagerError("runPrStep", "Cannot create a pull request from detached HEAD.");
		if (!details.hasUpstream) return yield* gitManagerError("runPrStep", "Current branch has not been pushed. Push before creating a PR.");
		const headContext = yield* resolveBranchHeadContext(cwd, {
			branch,
			upstreamRef: details.upstreamRef
		});
		const existing = yield* findOpenPr(cwd, headContext);
		if (existing) return {
			status: "opened_existing",
			url: existing.url,
			number: existing.number,
			baseBranch: existing.baseRefName,
			headBranch: existing.headRefName,
			title: existing.title
		};
		const baseBranch = yield* resolveBaseBranch(cwd, branch, details.upstreamRef, headContext);
		yield* emit({
			kind: "phase_started",
			phase: "pr",
			label: "Generating PR content..."
		});
		const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);
		const generated = yield* textGeneration.generatePrContent({
			cwd,
			baseBranch,
			headBranch: headContext.headBranch,
			commitSummary: limitContext(rangeContext.commitSummary, 2e4),
			diffSummary: limitContext(rangeContext.diffSummary, 2e4),
			diffPatch: limitContext(rangeContext.diffPatch, 6e4),
			modelSelection
		});
		const bodyFile = path.join(tempDir, `t3code-pr-body-${process.pid}-${randomUUID()}.md`);
		yield* fileSystem.writeFileString(bodyFile, generated.body).pipe(Effect.mapError((cause) => gitManagerError("runPrStep", "Failed to write pull request body temp file.", cause)));
		yield* emit({
			kind: "phase_started",
			phase: "pr",
			label: "Creating GitHub pull request..."
		});
		yield* gitHubCli.createPullRequest({
			cwd,
			baseBranch,
			headSelector: headContext.preferredHeadSelector,
			title: generated.title,
			bodyFile
		}).pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));
		const created = yield* findOpenPr(cwd, headContext);
		if (!created) return {
			status: "created",
			baseBranch,
			headBranch: headContext.headBranch,
			title: generated.title
		};
		return {
			status: "created",
			url: created.url,
			number: created.number,
			baseBranch: created.baseRefName,
			headBranch: created.headRefName,
			title: created.title
		};
	});
	const status = Effect.fn("status")(function* (input) {
		return yield* Cache.get(statusResultCache, normalizeStatusCacheKey(input.cwd));
	});
	const resolvePullRequest = Effect.fn("resolvePullRequest")(function* (input) {
		return { pullRequest: yield* gitHubCli.getPullRequest({
			cwd: input.cwd,
			reference: normalizePullRequestReference(input.reference)
		}).pipe(Effect.map((resolved) => toResolvedPullRequest(resolved))) };
	});
	const preparePullRequestThread = Effect.fn("preparePullRequestThread")(function* (input) {
		const maybeRunSetupScript = (worktreePath) => {
			if (!input.threadId) return Effect.void;
			return projectSetupScriptRunner.runForThread({
				threadId: input.threadId,
				projectCwd: input.cwd,
				worktreePath
			}).pipe(Effect.catch((error) => Effect.logWarning(`GitManager.preparePullRequestThread: failed to launch worktree setup script for thread ${input.threadId} in ${worktreePath}: ${error.message}`).pipe(Effect.asVoid)));
		};
		return yield* Effect.gen(function* () {
			const normalizedReference = normalizePullRequestReference(input.reference);
			const rootWorktreePath = canonicalizeExistingPath(input.cwd);
			const pullRequestSummary = yield* gitHubCli.getPullRequest({
				cwd: input.cwd,
				reference: normalizedReference
			});
			const pullRequest = toResolvedPullRequest(pullRequestSummary);
			if (input.mode === "local") {
				yield* gitHubCli.checkoutPullRequest({
					cwd: input.cwd,
					reference: normalizedReference,
					force: true
				});
				const details = yield* gitCore.statusDetails(input.cwd);
				yield* configurePullRequestHeadUpstream(input.cwd, {
					...pullRequest,
					...toPullRequestHeadRemoteInfo(pullRequestSummary)
				}, details.branch ?? pullRequest.headBranch);
				return {
					pullRequest,
					branch: details.branch ?? pullRequest.headBranch,
					worktreePath: null
				};
			}
			const ensureExistingWorktreeUpstream = Effect.fn("ensureExistingWorktreeUpstream")(function* (worktreePath) {
				const details = yield* gitCore.statusDetails(worktreePath);
				yield* configurePullRequestHeadUpstream(worktreePath, {
					...pullRequest,
					...toPullRequestHeadRemoteInfo(pullRequestSummary)
				}, details.branch ?? pullRequest.headBranch);
			});
			const pullRequestWithRemoteInfo = {
				...pullRequest,
				...toPullRequestHeadRemoteInfo(pullRequestSummary)
			};
			const localPullRequestBranch = resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);
			const findLocalHeadBranch = (cwd) => gitCore.listBranches({ cwd }).pipe(Effect.map((result) => {
				const localBranch = result.branches.find((branch) => !branch.isRemote && branch.name === localPullRequestBranch);
				if (localBranch) return localBranch;
				if (localPullRequestBranch === pullRequest.headBranch) return null;
				return result.branches.find((branch) => !branch.isRemote && branch.name === pullRequest.headBranch && branch.worktreePath !== null && canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath) ?? null;
			}));
			const existingBranchBeforeFetch = yield* findLocalHeadBranch(input.cwd);
			const existingBranchBeforeFetchPath = existingBranchBeforeFetch?.worktreePath ? canonicalizeExistingPath(existingBranchBeforeFetch.worktreePath) : null;
			if (existingBranchBeforeFetch?.worktreePath && existingBranchBeforeFetchPath !== rootWorktreePath) {
				yield* ensureExistingWorktreeUpstream(existingBranchBeforeFetch.worktreePath);
				return {
					pullRequest,
					branch: localPullRequestBranch,
					worktreePath: existingBranchBeforeFetch.worktreePath
				};
			}
			if (existingBranchBeforeFetchPath === rootWorktreePath) return yield* gitManagerError("preparePullRequestThread", "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.");
			yield* materializePullRequestHeadBranch(input.cwd, pullRequestWithRemoteInfo, localPullRequestBranch);
			const existingBranchAfterFetch = yield* findLocalHeadBranch(input.cwd);
			const existingBranchAfterFetchPath = existingBranchAfterFetch?.worktreePath ? canonicalizeExistingPath(existingBranchAfterFetch.worktreePath) : null;
			if (existingBranchAfterFetch?.worktreePath && existingBranchAfterFetchPath !== rootWorktreePath) {
				yield* ensureExistingWorktreeUpstream(existingBranchAfterFetch.worktreePath);
				return {
					pullRequest,
					branch: localPullRequestBranch,
					worktreePath: existingBranchAfterFetch.worktreePath
				};
			}
			if (existingBranchAfterFetchPath === rootWorktreePath) return yield* gitManagerError("preparePullRequestThread", "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.");
			const worktree = yield* gitCore.createWorktree({
				cwd: input.cwd,
				branch: localPullRequestBranch,
				path: null
			});
			yield* ensureExistingWorktreeUpstream(worktree.worktree.path);
			yield* maybeRunSetupScript(worktree.worktree.path);
			return {
				pullRequest,
				branch: worktree.worktree.branch,
				worktreePath: worktree.worktree.path
			};
		}).pipe(Effect.ensuring(invalidateStatusResultCache(input.cwd)));
	});
	const runFeatureBranchStep = Effect.fn("runFeatureBranchStep")(function* (modelSelection, cwd, branch, commitMessage, filePaths) {
		const suggestion = yield* resolveCommitAndBranchSuggestion({
			cwd,
			branch,
			...commitMessage ? { commitMessage } : {},
			...filePaths ? { filePaths } : {},
			includeBranch: true,
			modelSelection
		});
		if (!suggestion) return yield* gitManagerError("runFeatureBranchStep", "Cannot create a feature branch because there are no changes to commit.");
		const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
		const resolvedBranch = resolveAutoFeatureBranchName(yield* gitCore.listLocalBranchNames(cwd), preferredBranch);
		yield* gitCore.createBranch({
			cwd,
			branch: resolvedBranch
		});
		yield* Effect.scoped(gitCore.checkoutBranch({
			cwd,
			branch: resolvedBranch
		}));
		return {
			branchStep: {
				status: "created",
				name: resolvedBranch
			},
			resolvedCommitMessage: suggestion.commitMessage,
			resolvedCommitSuggestion: suggestion
		};
	});
	return {
		status,
		resolvePullRequest,
		preparePullRequestThread,
		runStackedAction: Effect.fn("runStackedAction")(function* (input, options) {
			const progress = createProgressEmitter(input, options);
			const currentPhase = yield* Ref.make(Option.none());
			return yield* Effect.fn("runStackedAction.runAction")(function* () {
				const initialStatus = yield* gitCore.statusDetails(input.cwd);
				const wantsCommit = isCommitAction(input.action);
				const wantsPush = input.action === "push" || input.action === "commit_push" || input.action === "commit_push_pr" || input.action === "create_pr" && (!initialStatus.hasUpstream || initialStatus.aheadCount > 0);
				const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";
				if (input.featureBranch && !wantsCommit) return yield* gitManagerError("runStackedAction", "Feature-branch checkout is only supported for commit actions.");
				if (input.action === "push" && initialStatus.hasWorkingTreeChanges) return yield* gitManagerError("runStackedAction", "Commit or stash local changes before pushing.");
				if (input.action === "create_pr" && initialStatus.hasWorkingTreeChanges) return yield* gitManagerError("runStackedAction", "Commit local changes before creating a PR.");
				const phases = [
					...input.featureBranch ? ["branch"] : [],
					...wantsCommit ? ["commit"] : [],
					...wantsPush ? ["push"] : [],
					...wantsPr ? ["pr"] : []
				];
				yield* progress.emit({
					kind: "action_started",
					phases
				});
				if (!input.featureBranch && wantsPush && !initialStatus.branch) return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
				if (!input.featureBranch && wantsPr && !initialStatus.branch) return yield* gitManagerError("runStackedAction", "Cannot create a pull request from detached HEAD.");
				let branchStep;
				let commitMessageForStep = input.commitMessage;
				let preResolvedCommitSuggestion = void 0;
				const modelSelection = yield* serverSettingsService.getSettings.pipe(Effect.map((settings) => settings.textGenerationModelSelection), Effect.mapError((cause) => gitManagerError("runStackedAction", "Failed to get server settings.", cause)));
				if (input.featureBranch) {
					yield* Ref.set(currentPhase, Option.some("branch"));
					yield* progress.emit({
						kind: "phase_started",
						phase: "branch",
						label: "Preparing feature branch..."
					});
					const result = yield* runFeatureBranchStep(modelSelection, input.cwd, initialStatus.branch, input.commitMessage, input.filePaths);
					branchStep = result.branchStep;
					commitMessageForStep = result.resolvedCommitMessage;
					preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
				} else branchStep = { status: "skipped_not_requested" };
				const currentBranch = branchStep.name ?? initialStatus.branch;
				const commitAction = isCommitAction(input.action) ? input.action : null;
				const commit = commitAction ? yield* Ref.set(currentPhase, Option.some("commit")).pipe(Effect.flatMap(() => runCommitStep(modelSelection, input.cwd, commitAction, currentBranch, commitMessageForStep, preResolvedCommitSuggestion, input.filePaths, options?.progressReporter, progress.actionId))) : { status: "skipped_not_requested" };
				const push = wantsPush ? yield* progress.emit({
					kind: "phase_started",
					phase: "push",
					label: "Pushing..."
				}).pipe(Effect.tap(() => Ref.set(currentPhase, Option.some("push"))), Effect.flatMap(() => gitCore.pushCurrentBranch(input.cwd, currentBranch))) : { status: "skipped_not_requested" };
				const pr = wantsPr ? yield* progress.emit({
					kind: "phase_started",
					phase: "pr",
					label: "Preparing PR..."
				}).pipe(Effect.tap(() => Ref.set(currentPhase, Option.some("pr"))), Effect.flatMap(() => runPrStep(modelSelection, input.cwd, currentBranch, progress.emit))) : { status: "skipped_not_requested" };
				const toast = yield* buildCompletionToast(input.cwd, {
					action: input.action,
					branch: branchStep,
					commit,
					push,
					pr
				});
				const result = {
					action: input.action,
					branch: branchStep,
					commit,
					push,
					pr,
					toast
				};
				yield* progress.emit({
					kind: "action_finished",
					result
				});
				return result;
			})().pipe(Effect.ensuring(invalidateStatusResultCache(input.cwd)), Effect.tapError((error) => Effect.flatMap(Ref.get(currentPhase), (phase) => progress.emit({
				kind: "action_failed",
				phase: Option.getOrNull(phase),
				message: error.message
			}))));
		})
	};
});
const GitManagerLive = Layer.effect(GitManager, makeGitManager());

//#endregion
//#region src/orchestration/Services/CheckpointReactor.ts
/**
* CheckpointReactor - Checkpoint reaction service interface.
*
* Owns background workers that react to orchestration checkpoint lifecycle
* events and apply checkpoint side effects.
*
* @module CheckpointReactor
*/
/**
* CheckpointReactor - Service tag for checkpoint reactor workers.
*/
var CheckpointReactor = class extends ServiceMap.Service()("t3/orchestration/Services/CheckpointReactor") {};

//#endregion
//#region src/orchestration/Services/ProviderCommandReactor.ts
/**
* ProviderCommandReactor - Provider command reaction service interface.
*
* Owns background workers that react to orchestration intent events and
* dispatch provider-side command execution.
*
* @module ProviderCommandReactor
*/
/**
* ProviderCommandReactor - Service tag for provider command reaction workers.
*/
var ProviderCommandReactor = class extends ServiceMap.Service()("t3/orchestration/Services/ProviderCommandReactor") {};

//#endregion
//#region src/orchestration/Services/ProviderRuntimeIngestion.ts
/**
* ProviderRuntimeIngestionService - Provider runtime ingestion service interface.
*
* Owns background workers that consume provider runtime streams and emit
* orchestration commands/events.
*
* @module ProviderRuntimeIngestionService
*/
/**
* ProviderRuntimeIngestionService - Service tag for runtime ingestion workers.
*/
var ProviderRuntimeIngestionService = class extends ServiceMap.Service()("t3/orchestration/Services/ProviderRuntimeIngestion/ProviderRuntimeIngestionService") {};

//#endregion
//#region src/orchestration/Layers/OrchestrationReactor.ts
const makeOrchestrationReactor = Effect.gen(function* () {
	const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
	const providerCommandReactor = yield* ProviderCommandReactor;
	const checkpointReactor = yield* CheckpointReactor;
	return { start: Effect.fn("start")(function* () {
		yield* providerRuntimeIngestion.start();
		yield* providerCommandReactor.start();
		yield* checkpointReactor.start();
	}) };
});
const OrchestrationReactorLive = Layer.effect(OrchestrationReactor, makeOrchestrationReactor);

//#endregion
//#region src/orchestration/Services/RuntimeReceiptBus.ts
/**
* RuntimeReceiptBus - Internal checkpoint-reactor synchronization receipts.
*
* This service exists to expose short-lived orchestration milestones that are
* useful in tests and harnesses but are not part of the production runtime
* event model. `CheckpointReactor` publishes receipts such as baseline capture,
* diff finalization, and turn-processing quiescence so integration tests can
* wait for those exact points without inferring them indirectly from persisted
* state.
*
* Production code should only call `publish`. Test code may subscribe via
* `streamEventsForTest`, which is intentionally named to make the intended
* usage explicit.
*
* @module RuntimeReceiptBus
*/
const CheckpointBaselineCapturedReceipt = Schema.Struct({
	type: Schema.Literal("checkpoint.baseline.captured"),
	threadId: ThreadId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	createdAt: IsoDateTime
});
const CheckpointDiffFinalizedReceipt = Schema.Struct({
	type: Schema.Literal("checkpoint.diff.finalized"),
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	checkpointRef: CheckpointRef,
	status: Schema.Literals([
		"ready",
		"missing",
		"error"
	]),
	createdAt: IsoDateTime
});
const TurnProcessingQuiescedReceipt = Schema.Struct({
	type: Schema.Literal("turn.processing.quiesced"),
	threadId: ThreadId,
	turnId: TurnId,
	checkpointTurnCount: NonNegativeInt,
	createdAt: IsoDateTime
});
const OrchestrationRuntimeReceipt = Schema.Union([
	CheckpointBaselineCapturedReceipt,
	CheckpointDiffFinalizedReceipt,
	TurnProcessingQuiescedReceipt
]);
var RuntimeReceiptBus = class extends ServiceMap.Service()("t3/orchestration/Services/RuntimeReceiptBus") {};

//#endregion
//#region src/orchestration/Layers/RuntimeReceiptBus.ts
/**
* RuntimeReceiptBus layers.
*
* `RuntimeReceiptBusLive` is the production default and intentionally does not
* retain or broadcast receipts. `RuntimeReceiptBusTest` installs the in-memory
* PubSub-backed implementation used by integration tests that need to await
* checkpoint-reactor milestones precisely.
*
* @module RuntimeReceiptBus
*/
const makeRuntimeReceiptBus = Effect.succeed({
	publish: () => Effect.void,
	streamEventsForTest: Stream.empty
});
const makeRuntimeReceiptBusTest = Effect.gen(function* () {
	const pubSub = yield* PubSub.unbounded();
	return {
		publish: (receipt) => PubSub.publish(pubSub, receipt).pipe(Effect.asVoid),
		get streamEventsForTest() {
			return Stream.fromPubSub(pubSub);
		}
	};
});
const RuntimeReceiptBusLive = Layer.effect(RuntimeReceiptBus, makeRuntimeReceiptBus);
const RuntimeReceiptBusTest = Layer.effect(RuntimeReceiptBus, makeRuntimeReceiptBusTest);

//#endregion
//#region ../../packages/shared/src/DrainableWorker.ts
/**
* Create a drainable worker that processes items from an unbounded queue.
*
* The worker is forked into the current scope and will be interrupted when
* the scope closes. A finalizer shuts down the queue.
*
* @param process - The effect to run for each queued item.
* @returns A `DrainableWorker` with `queue` and `drain`.
*/
const makeDrainableWorker = (process) => Effect.gen(function* () {
	const queue = yield* Effect.acquireRelease(TxQueue.unbounded(), TxQueue.shutdown);
	const outstanding = yield* TxRef.make(0);
	yield* TxQueue.take(queue).pipe(Effect.tap((a) => Effect.ensuring(process(a), TxRef.update(outstanding, (n) => n - 1))), Effect.forever, Effect.forkScoped);
	const drain = TxRef.get(outstanding).pipe(Effect.tap((n) => n > 0 ? Effect.txRetry : Effect.void), Effect.tx);
	const enqueue = (element) => TxQueue.offer(queue, element).pipe(Effect.tap(() => TxRef.update(outstanding, (n) => n + 1)), Effect.tx);
	return {
		enqueue,
		drain
	};
});

//#endregion
//#region src/orchestration/Layers/ProviderRuntimeIngestion.ts
const providerTurnKey = (threadId, turnId) => `${threadId}:${turnId}`;
const providerCommandId = (event, tag) => CommandId.makeUnsafe(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`);
const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 1e4;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 2e4;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 1e4;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24e3;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.T3CODE_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";
function toTurnId$1(value) {
	return value === void 0 ? void 0 : TurnId.makeUnsafe(String(value));
}
function toApprovalRequestId(value) {
	return value === void 0 ? void 0 : ApprovalRequestId.makeUnsafe(value);
}
function sameId$1(left, right) {
	if (left === null || left === void 0 || right === null || right === void 0) return false;
	return left === right;
}
function truncateDetail(value, limit = 180) {
	return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
function normalizeProposedPlanMarkdown(planMarkdown) {
	const trimmed = planMarkdown?.trim();
	if (!trimmed) return;
	return trimmed;
}
function proposedPlanIdForTurn(threadId, turnId) {
	return `plan:${threadId}:turn:${turnId}`;
}
function proposedPlanIdFromEvent(event, threadId) {
	const turnId = toTurnId$1(event.turnId);
	if (turnId) return proposedPlanIdForTurn(threadId, turnId);
	if (event.itemId) return `plan:${threadId}:item:${event.itemId}`;
	return `plan:${threadId}:event:${event.eventId}`;
}
function buildContextWindowActivityPayload(event) {
	if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) return;
	return event.payload.usage;
}
function normalizeRuntimeTurnState(value) {
	switch (value) {
		case "failed":
		case "interrupted":
		case "cancelled":
		case "completed": return value;
		default: return "completed";
	}
}
function orchestrationSessionStatusFromRuntimeState(state) {
	switch (state) {
		case "starting": return "starting";
		case "running":
		case "waiting": return "running";
		case "ready": return "ready";
		case "interrupted": return "interrupted";
		case "stopped": return "stopped";
		case "error": return "error";
	}
}
function requestKindFromCanonicalRequestType(requestType) {
	switch (requestType) {
		case "command_execution_approval":
		case "exec_command_approval": return "command";
		case "file_read_approval": return "file-read";
		case "file_change_approval":
		case "apply_patch_approval": return "file-change";
		default: return;
	}
}
function runtimeEventToActivities(event) {
	const maybeSequence = (() => {
		const eventWithSequence = event;
		return eventWithSequence.sessionSequence !== void 0 ? { sequence: eventWithSequence.sessionSequence } : {};
	})();
	switch (event.type) {
		case "request.opened": {
			if (event.payload.requestType === "tool_user_input") return [];
			const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "approval",
				kind: "approval.requested",
				summary: requestKind === "command" ? "Command approval requested" : requestKind === "file-read" ? "File-read approval requested" : requestKind === "file-change" ? "File-change approval requested" : "Approval requested",
				payload: {
					requestId: toApprovalRequestId(event.requestId),
					...requestKind ? { requestKind } : {},
					requestType: event.payload.requestType,
					...event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		}
		case "request.resolved": {
			if (event.payload.requestType === "tool_user_input") return [];
			const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "approval",
				kind: "approval.resolved",
				summary: "Approval resolved",
				payload: {
					requestId: toApprovalRequestId(event.requestId),
					...requestKind ? { requestKind } : {},
					requestType: event.payload.requestType,
					...event.payload.decision ? { decision: event.payload.decision } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		}
		case "runtime.error": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "error",
			kind: "runtime.error",
			summary: "Runtime error",
			payload: { message: truncateDetail(event.payload.message) },
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "runtime.warning": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "runtime.warning",
			summary: "Runtime warning",
			payload: {
				message: truncateDetail(event.payload.message),
				...event.payload.detail !== void 0 ? { detail: event.payload.detail } : {}
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "turn.plan.updated": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "turn.plan.updated",
			summary: "Plan updated",
			payload: {
				plan: event.payload.plan,
				...event.payload.explanation !== void 0 ? { explanation: event.payload.explanation } : {}
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "user-input.requested": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "user-input.requested",
			summary: "User input requested",
			payload: {
				...event.requestId ? { requestId: event.requestId } : {},
				questions: event.payload.questions
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "user-input.resolved": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "user-input.resolved",
			summary: "User input submitted",
			payload: {
				...event.requestId ? { requestId: event.requestId } : {},
				answers: event.payload.answers
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "task.started": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "task.started",
			summary: event.payload.taskType === "plan" ? "Plan task started" : event.payload.taskType ? `${event.payload.taskType} task started` : "Task started",
			payload: {
				taskId: event.payload.taskId,
				...event.payload.taskType ? { taskType: event.payload.taskType } : {},
				...event.payload.description ? { detail: truncateDetail(event.payload.description) } : {}
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "task.progress": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: "info",
			kind: "task.progress",
			summary: "Reasoning update",
			payload: {
				taskId: event.payload.taskId,
				detail: truncateDetail(event.payload.summary ?? event.payload.description),
				...event.payload.summary ? { summary: truncateDetail(event.payload.summary) } : {},
				...event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {},
				...event.payload.usage !== void 0 ? { usage: event.payload.usage } : {}
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "task.completed": return [{
			id: event.eventId,
			createdAt: event.createdAt,
			tone: event.payload.status === "failed" ? "error" : "info",
			kind: "task.completed",
			summary: event.payload.status === "failed" ? "Task failed" : event.payload.status === "stopped" ? "Task stopped" : "Task completed",
			payload: {
				taskId: event.payload.taskId,
				status: event.payload.status,
				...event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {},
				...event.payload.usage !== void 0 ? { usage: event.payload.usage } : {}
			},
			turnId: toTurnId$1(event.turnId) ?? null,
			...maybeSequence
		}];
		case "thread.state.changed":
			if (event.payload.state !== "compacted") return [];
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "info",
				kind: "context-compaction",
				summary: "Context compacted",
				payload: {
					state: event.payload.state,
					...event.payload.detail !== void 0 ? { detail: event.payload.detail } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		case "thread.token-usage.updated": {
			const payload = buildContextWindowActivityPayload(event);
			if (!payload) return [];
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "info",
				kind: "context-window.updated",
				summary: "Context window updated",
				payload,
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		}
		case "item.updated":
			if (!isToolLifecycleItemType(event.payload.itemType)) return [];
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "tool",
				kind: "tool.updated",
				summary: event.payload.title ?? "Tool updated",
				payload: {
					itemType: event.payload.itemType,
					...event.payload.status ? { status: event.payload.status } : {},
					...event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {},
					...event.payload.data !== void 0 ? { data: event.payload.data } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		case "item.completed":
			if (!isToolLifecycleItemType(event.payload.itemType)) return [];
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "tool",
				kind: "tool.completed",
				summary: event.payload.title ?? "Tool",
				payload: {
					itemType: event.payload.itemType,
					...event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		case "item.started":
			if (!isToolLifecycleItemType(event.payload.itemType)) return [];
			return [{
				id: event.eventId,
				createdAt: event.createdAt,
				tone: "tool",
				kind: "tool.started",
				summary: `${event.payload.title ?? "Tool"} started`,
				payload: {
					itemType: event.payload.itemType,
					...event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}
				},
				turnId: toTurnId$1(event.turnId) ?? null,
				...maybeSequence
			}];
		default: break;
	}
	return [];
}
const make$2 = Effect.fn("make")(function* () {
	const orchestrationEngine = yield* OrchestrationEngineService;
	const providerService = yield* ProviderService;
	const projectionTurnRepository = yield* ProjectionTurnRepository;
	const serverSettingsService = yield* ServerSettingsService;
	const turnMessageIdsByTurnKey = yield* Cache.make({
		capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
		timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
		lookup: () => Effect.succeed(/* @__PURE__ */ new Set())
	});
	const bufferedAssistantTextByMessageId = yield* Cache.make({
		capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
		timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
		lookup: () => Effect.succeed("")
	});
	const bufferedProposedPlanById = yield* Cache.make({
		capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
		timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
		lookup: () => Effect.succeed({
			text: "",
			createdAt: ""
		})
	});
	const isGitRepoForThread = Effect.fn("isGitRepoForThread")(function* (threadId) {
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === threadId);
		if (!thread) return false;
		const workspaceCwd = resolveThreadWorkspaceCwd({
			thread,
			projects: readModel.projects
		});
		if (!workspaceCwd) return false;
		return isGitRepository(workspaceCwd);
	});
	const rememberAssistantMessageId = (threadId, turnId, messageId) => Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(Effect.flatMap((existingIds) => Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), Option.match(existingIds, {
		onNone: () => new Set([messageId]),
		onSome: (ids) => {
			const nextIds = new Set(ids);
			nextIds.add(messageId);
			return nextIds;
		}
	}))));
	const forgetAssistantMessageId = (threadId, turnId, messageId) => Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(Effect.flatMap((existingIds) => Option.match(existingIds, {
		onNone: () => Effect.void,
		onSome: (ids) => {
			const nextIds = new Set(ids);
			nextIds.delete(messageId);
			if (nextIds.size === 0) return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
			return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
		}
	})));
	const getAssistantMessageIdsForTurn = (threadId, turnId) => Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(Effect.map((existingIds) => Option.getOrElse(existingIds, () => /* @__PURE__ */ new Set())));
	const clearAssistantMessageIdsForTurn = (threadId, turnId) => Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
	const appendBufferedAssistantText = (messageId, delta) => Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(Effect.flatMap(Effect.fn("appendBufferedAssistantText")(function* (existingText) {
		const nextText = Option.match(existingText, {
			onNone: () => delta,
			onSome: (text) => `${text}${delta}`
		});
		if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
			yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
			return "";
		}
		yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
		return nextText;
	})));
	const takeBufferedAssistantText = (messageId) => Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(Effect.flatMap((existingText) => Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(Effect.as(Option.getOrElse(existingText, () => "")))));
	const clearBufferedAssistantText = (messageId) => Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
	const appendBufferedProposedPlan = (planId, delta, createdAt) => Cache.getOption(bufferedProposedPlanById, planId).pipe(Effect.flatMap((existingEntry) => {
		const existing = Option.getOrUndefined(existingEntry);
		return Cache.set(bufferedProposedPlanById, planId, {
			text: `${existing?.text ?? ""}${delta}`,
			createdAt: existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt
		});
	}));
	const takeBufferedProposedPlan = (planId) => Cache.getOption(bufferedProposedPlanById, planId).pipe(Effect.flatMap((existingEntry) => Cache.invalidate(bufferedProposedPlanById, planId).pipe(Effect.as(Option.getOrUndefined(existingEntry)))));
	const clearBufferedProposedPlan = (planId) => Cache.invalidate(bufferedProposedPlanById, planId);
	const clearAssistantMessageState = (messageId) => clearBufferedAssistantText(messageId);
	const finalizeAssistantMessage = Effect.fn("finalizeAssistantMessage")(function* (input) {
		const bufferedText = yield* takeBufferedAssistantText(input.messageId);
		const text = bufferedText.length > 0 ? bufferedText : (input.fallbackText?.trim().length ?? 0) > 0 ? input.fallbackText : "";
		if (text.length > 0) yield* orchestrationEngine.dispatch({
			type: "thread.message.assistant.delta",
			commandId: providerCommandId(input.event, input.finalDeltaCommandTag),
			threadId: input.threadId,
			messageId: input.messageId,
			delta: text,
			...input.turnId ? { turnId: input.turnId } : {},
			createdAt: input.createdAt
		});
		yield* orchestrationEngine.dispatch({
			type: "thread.message.assistant.complete",
			commandId: providerCommandId(input.event, input.commandTag),
			threadId: input.threadId,
			messageId: input.messageId,
			...input.turnId ? { turnId: input.turnId } : {},
			createdAt: input.createdAt
		});
		yield* clearAssistantMessageState(input.messageId);
	});
	const upsertProposedPlan = Effect.fn("upsertProposedPlan")(function* (input) {
		const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
		if (!planMarkdown) return;
		const existingPlan = input.threadProposedPlans.find((entry) => entry.id === input.planId);
		yield* orchestrationEngine.dispatch({
			type: "thread.proposed-plan.upsert",
			commandId: providerCommandId(input.event, "proposed-plan-upsert"),
			threadId: input.threadId,
			proposedPlan: {
				id: input.planId,
				turnId: input.turnId ?? null,
				planMarkdown,
				implementedAt: existingPlan?.implementedAt ?? null,
				implementationThreadId: existingPlan?.implementationThreadId ?? null,
				createdAt: existingPlan?.createdAt ?? input.createdAt,
				updatedAt: input.updatedAt
			},
			createdAt: input.updatedAt
		});
	});
	const finalizeBufferedProposedPlan = Effect.fn("finalizeBufferedProposedPlan")(function* (input) {
		const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
		const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
		const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
		const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
		if (!planMarkdown) return;
		yield* upsertProposedPlan({
			event: input.event,
			threadId: input.threadId,
			threadProposedPlans: input.threadProposedPlans,
			planId: input.planId,
			...input.turnId ? { turnId: input.turnId } : {},
			planMarkdown,
			createdAt: bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0 ? bufferedPlan.createdAt : input.updatedAt,
			updatedAt: input.updatedAt
		});
		yield* clearBufferedProposedPlan(input.planId);
	});
	const clearTurnStateForSession = Effect.fn("clearTurnStateForSession")(function* (threadId) {
		const prefix = `${threadId}:`;
		const proposedPlanPrefix = `plan:${threadId}:`;
		const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
		const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
		yield* Effect.forEach(turnKeys, Effect.fn(function* (key) {
			if (!key.startsWith(prefix)) return;
			const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
			if (Option.isSome(messageIds)) yield* Effect.forEach(messageIds.value, clearAssistantMessageState, { concurrency: 1 }).pipe(Effect.asVoid);
			yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
		}), { concurrency: 1 }).pipe(Effect.asVoid);
		yield* Effect.forEach(proposedPlanKeys, (key) => key.startsWith(proposedPlanPrefix) ? Cache.invalidate(bufferedProposedPlanById, key) : Effect.void, { concurrency: 1 }).pipe(Effect.asVoid);
	});
	const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fn("getSourceProposedPlanReferenceForPendingTurnStart")(function* (threadId) {
		const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({ threadId });
		if (Option.isNone(pendingTurnStart)) return null;
		const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
		const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
		if (sourceThreadId === null || sourcePlanId === null) return null;
		return {
			sourceThreadId,
			sourcePlanId
		};
	});
	const getExpectedProviderTurnIdForThread = Effect.fn("getExpectedProviderTurnIdForThread")(function* (threadId) {
		return (yield* providerService.listSessions()).find((entry) => entry.threadId === threadId)?.activeTurnId;
	});
	const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fn("getSourceProposedPlanReferenceForAcceptedTurnStart")(function* (threadId, eventTurnId) {
		if (eventTurnId === void 0) return null;
		if (!sameId$1(yield* getExpectedProviderTurnIdForThread(threadId), eventTurnId)) return null;
		return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
	});
	const markSourceProposedPlanImplemented = Effect.fn("markSourceProposedPlanImplemented")(function* (sourceThreadId, sourcePlanId, implementationThreadId, implementedAt) {
		const sourceThread = (yield* orchestrationEngine.getReadModel()).threads.find((entry) => entry.id === sourceThreadId);
		const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
		if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) return;
		yield* orchestrationEngine.dispatch({
			type: "thread.proposed-plan.upsert",
			commandId: CommandId.makeUnsafe(`provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}`),
			threadId: sourceThread.id,
			proposedPlan: {
				...sourcePlan,
				implementedAt,
				implementationThreadId,
				updatedAt: implementedAt
			},
			createdAt: implementedAt
		});
	});
	const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (event) {
		const thread = (yield* orchestrationEngine.getReadModel()).threads.find((entry) => entry.id === event.threadId);
		if (!thread) return;
		const now = event.createdAt;
		const eventTurnId = toTurnId$1(event.turnId);
		const activeTurnId = thread.session?.activeTurnId ?? null;
		const conflictsWithActiveTurn = activeTurnId !== null && eventTurnId !== void 0 && !sameId$1(activeTurnId, eventTurnId);
		const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === void 0;
		const shouldApplyThreadLifecycle = (() => {
			if (!STRICT_PROVIDER_LIFECYCLE_GUARD) return true;
			switch (event.type) {
				case "session.exited": return true;
				case "session.started":
				case "thread.started": return true;
				case "turn.started": return !conflictsWithActiveTurn;
				case "turn.completed":
					if (conflictsWithActiveTurn || missingTurnForActiveTurn) return false;
					if (activeTurnId !== null && eventTurnId !== void 0) return sameId$1(activeTurnId, eventTurnId);
					return true;
				default: return true;
			}
		})();
		const acceptedTurnStartedSourcePlan = event.type === "turn.started" && shouldApplyThreadLifecycle ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId) : null;
		if (event.type === "session.started" || event.type === "session.state.changed" || event.type === "session.exited" || event.type === "thread.started" || event.type === "turn.started" || event.type === "turn.completed") {
			const nextActiveTurnId = event.type === "turn.started" ? eventTurnId ?? null : event.type === "turn.completed" || event.type === "session.exited" ? null : activeTurnId;
			const status = (() => {
				switch (event.type) {
					case "session.state.changed": return orchestrationSessionStatusFromRuntimeState(event.payload.state);
					case "turn.started": return "running";
					case "session.exited": return "stopped";
					case "turn.completed": return normalizeRuntimeTurnState(event.payload.state) === "failed" ? "error" : "ready";
					case "session.started":
					case "thread.started": return activeTurnId !== null ? "running" : "ready";
				}
			})();
			const lastError = event.type === "session.state.changed" && event.payload.state === "error" ? event.payload.reason ?? thread.session?.lastError ?? "Provider session error" : event.type === "turn.completed" && normalizeRuntimeTurnState(event.payload.state) === "failed" ? event.payload.errorMessage ?? thread.session?.lastError ?? "Turn failed" : status === "ready" ? null : thread.session?.lastError ?? null;
			if (shouldApplyThreadLifecycle) {
				if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) yield* markSourceProposedPlanImplemented(acceptedTurnStartedSourcePlan.sourceThreadId, acceptedTurnStartedSourcePlan.sourcePlanId, thread.id, now).pipe(Effect.catchCause((cause) => Effect.logWarning("provider runtime ingestion failed to mark source proposed plan", {
					eventId: event.eventId,
					eventType: event.type,
					cause: Cause.pretty(cause)
				})));
				yield* orchestrationEngine.dispatch({
					type: "thread.session.set",
					commandId: providerCommandId(event, "thread-session-set"),
					threadId: thread.id,
					session: {
						threadId: thread.id,
						status,
						providerName: event.provider,
						runtimeMode: thread.session?.runtimeMode ?? "full-access",
						activeTurnId: nextActiveTurnId,
						lastError,
						updatedAt: now
					},
					createdAt: now
				});
			}
		}
		const assistantDelta = event.type === "content.delta" && event.payload.streamKind === "assistant_text" ? event.payload.delta : void 0;
		const proposedPlanDelta = event.type === "turn.proposed.delta" ? event.payload.delta : void 0;
		if (assistantDelta && assistantDelta.length > 0) {
			const assistantMessageId = MessageId.makeUnsafe(`assistant:${event.itemId ?? event.turnId ?? event.eventId}`);
			const turnId = toTurnId$1(event.turnId);
			if (turnId) yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
			if ((yield* Effect.map(serverSettingsService.getSettings, (settings) => settings.enableAssistantStreaming ? "streaming" : "buffered")) === "buffered") {
				const spillChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
				if (spillChunk.length > 0) yield* orchestrationEngine.dispatch({
					type: "thread.message.assistant.delta",
					commandId: providerCommandId(event, "assistant-delta-buffer-spill"),
					threadId: thread.id,
					messageId: assistantMessageId,
					delta: spillChunk,
					...turnId ? { turnId } : {},
					createdAt: now
				});
			} else yield* orchestrationEngine.dispatch({
				type: "thread.message.assistant.delta",
				commandId: providerCommandId(event, "assistant-delta"),
				threadId: thread.id,
				messageId: assistantMessageId,
				delta: assistantDelta,
				...turnId ? { turnId } : {},
				createdAt: now
			});
		}
		if (proposedPlanDelta && proposedPlanDelta.length > 0) yield* appendBufferedProposedPlan(proposedPlanIdFromEvent(event, thread.id), proposedPlanDelta, now);
		const assistantCompletion = event.type === "item.completed" && event.payload.itemType === "assistant_message" ? {
			messageId: MessageId.makeUnsafe(`assistant:${event.itemId ?? event.turnId ?? event.eventId}`),
			fallbackText: event.payload.detail
		} : void 0;
		const proposedPlanCompletion = event.type === "turn.proposed.completed" ? {
			planId: proposedPlanIdFromEvent(event, thread.id),
			turnId: toTurnId$1(event.turnId),
			planMarkdown: event.payload.planMarkdown
		} : void 0;
		if (assistantCompletion) {
			const assistantMessageId = assistantCompletion.messageId;
			const turnId = toTurnId$1(event.turnId);
			const existingAssistantMessage = thread.messages.find((entry) => entry.id === assistantMessageId);
			const shouldApplyFallbackCompletionText = !existingAssistantMessage || existingAssistantMessage.text.length === 0;
			if (turnId) yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
			yield* finalizeAssistantMessage({
				event,
				threadId: thread.id,
				messageId: assistantMessageId,
				...turnId ? { turnId } : {},
				createdAt: now,
				commandTag: "assistant-complete",
				finalDeltaCommandTag: "assistant-delta-finalize",
				...assistantCompletion.fallbackText !== void 0 && shouldApplyFallbackCompletionText ? { fallbackText: assistantCompletion.fallbackText } : {}
			});
			if (turnId) yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId);
		}
		if (proposedPlanCompletion) yield* finalizeBufferedProposedPlan({
			event,
			threadId: thread.id,
			threadProposedPlans: thread.proposedPlans,
			planId: proposedPlanCompletion.planId,
			...proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {},
			fallbackMarkdown: proposedPlanCompletion.planMarkdown,
			updatedAt: now
		});
		if (event.type === "turn.completed") {
			const turnId = toTurnId$1(event.turnId);
			if (turnId) {
				const assistantMessageIds = yield* getAssistantMessageIdsForTurn(thread.id, turnId);
				yield* Effect.forEach(assistantMessageIds, (assistantMessageId) => finalizeAssistantMessage({
					event,
					threadId: thread.id,
					messageId: assistantMessageId,
					turnId,
					createdAt: now,
					commandTag: "assistant-complete-finalize",
					finalDeltaCommandTag: "assistant-delta-finalize-fallback"
				}), { concurrency: 1 }).pipe(Effect.asVoid);
				yield* clearAssistantMessageIdsForTurn(thread.id, turnId);
				yield* finalizeBufferedProposedPlan({
					event,
					threadId: thread.id,
					threadProposedPlans: thread.proposedPlans,
					planId: proposedPlanIdForTurn(thread.id, turnId),
					turnId,
					updatedAt: now
				});
			}
		}
		if (event.type === "session.exited") yield* clearTurnStateForSession(thread.id);
		if (event.type === "runtime.error") {
			const runtimeErrorMessage = event.payload.message;
			if (!STRICT_PROVIDER_LIFECYCLE_GUARD ? true : activeTurnId === null || eventTurnId === void 0 || sameId$1(activeTurnId, eventTurnId)) yield* orchestrationEngine.dispatch({
				type: "thread.session.set",
				commandId: providerCommandId(event, "runtime-error-session-set"),
				threadId: thread.id,
				session: {
					threadId: thread.id,
					status: "error",
					providerName: event.provider,
					runtimeMode: thread.session?.runtimeMode ?? "full-access",
					activeTurnId: eventTurnId ?? null,
					lastError: runtimeErrorMessage,
					updatedAt: now
				},
				createdAt: now
			});
		}
		if (event.type === "thread.metadata.updated" && event.payload.name) yield* orchestrationEngine.dispatch({
			type: "thread.meta.update",
			commandId: providerCommandId(event, "thread-meta-update"),
			threadId: thread.id,
			title: event.payload.name
		});
		if (event.type === "turn.diff.updated") {
			const turnId = toTurnId$1(event.turnId);
			if (turnId && (yield* isGitRepoForThread(thread.id))) if (thread.checkpoints.some((c) => c.turnId === turnId)) {} else {
				const assistantMessageId = MessageId.makeUnsafe(`assistant:${event.itemId ?? event.turnId ?? event.eventId}`);
				const maxTurnCount = thread.checkpoints.reduce((max, c) => Math.max(max, c.checkpointTurnCount), 0);
				yield* orchestrationEngine.dispatch({
					type: "thread.turn.diff.complete",
					commandId: providerCommandId(event, "thread-turn-diff-complete"),
					threadId: thread.id,
					turnId,
					completedAt: now,
					checkpointRef: CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`),
					status: "missing",
					files: [],
					assistantMessageId,
					checkpointTurnCount: maxTurnCount + 1,
					createdAt: now
				});
			}
		}
		const activities = runtimeEventToActivities(event);
		yield* Effect.forEach(activities, (activity) => orchestrationEngine.dispatch({
			type: "thread.activity.append",
			commandId: providerCommandId(event, "thread-activity-append"),
			threadId: thread.id,
			activity,
			createdAt: activity.createdAt
		})).pipe(Effect.asVoid);
	});
	const processDomainEvent = (_event) => Effect.void;
	const processInput = (input) => input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);
	const processInputSafely = (input) => processInput(input).pipe(Effect.catchCause((cause) => {
		if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
		return Effect.logWarning("provider runtime ingestion failed to process event", {
			source: input.source,
			eventId: input.event.eventId,
			eventType: input.event.type,
			cause: Cause.pretty(cause)
		});
	}));
	const worker = yield* makeDrainableWorker(processInputSafely);
	return {
		start: Effect.fn("start")(function* () {
			yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, (event) => worker.enqueue({
				source: "runtime",
				event
			})));
			yield* Effect.forkScoped(Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
				if (event.type !== "thread.turn-start-requested") return Effect.void;
				return worker.enqueue({
					source: "domain",
					event
				});
			}));
		}),
		drain: worker.drain
	};
});
const ProviderRuntimeIngestionLive = Layer.effect(ProviderRuntimeIngestionService, make$2()).pipe(Layer.provide(ProjectionTurnRepositoryLive));

//#endregion
//#region src/orchestration/Layers/ProviderCommandReactor.ts
function toNonEmptyProviderInput(value) {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : void 0;
}
function mapProviderSessionStatusToOrchestrationStatus(status) {
	switch (status) {
		case "connecting": return "starting";
		case "running": return "running";
		case "error": return "error";
		case "closed": return "stopped";
		default: return "ready";
	}
}
const turnStartKeyForEvent = (event) => event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;
const serverCommandId$1 = (tag) => CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
const HANDLED_TURN_START_KEY_MAX = 1e4;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const DEFAULT_RUNTIME_MODE = "full-access";
const WORKTREE_BRANCH_PREFIX = "t3code";
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(`^${WORKTREE_BRANCH_PREFIX}\\/[0-9a-f]{8}$`);
const DEFAULT_THREAD_TITLE = "New thread";
function canReplaceThreadTitle(currentTitle, titleSeed) {
	const trimmedCurrentTitle = currentTitle.trim();
	if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) return true;
	const trimmedTitleSeed = titleSeed?.trim();
	return trimmedTitleSeed !== void 0 && trimmedTitleSeed.length > 0 ? trimmedCurrentTitle === trimmedTitleSeed : false;
}
function isUnknownPendingApprovalRequestError(cause) {
	const error = Cause.squash(cause);
	if (Schema.is(ProviderAdapterRequestError)(error)) {
		const detail = error.detail.toLowerCase();
		return detail.includes("unknown pending approval request") || detail.includes("unknown pending permission request");
	}
	const message = Cause.pretty(cause);
	return message.includes("unknown pending approval request") || message.includes("unknown pending permission request");
}
function isUnknownPendingUserInputRequestError(cause) {
	const error = Cause.squash(cause);
	if (Schema.is(ProviderAdapterRequestError)(error)) return error.detail.toLowerCase().includes("unknown pending user-input request");
	return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}
function stalePendingRequestDetail(requestKind, requestId) {
	return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}
function isTemporaryWorktreeBranch(branch) {
	return TEMP_WORKTREE_BRANCH_PATTERN.test(branch.trim().toLowerCase());
}
function buildGeneratedWorktreeBranchName(raw) {
	const normalized = raw.trim().toLowerCase().replace(/^refs\/heads\//, "").replace(/['"`]/g, "");
	const branchFragment = (normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`) ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length) : normalized).replace(/[^a-z0-9/_-]+/g, "-").replace(/\/+/g, "/").replace(/-+/g, "-").replace(/^[./_-]+|[./_-]+$/g, "").slice(0, 64).replace(/[./_-]+$/g, "");
	return `${WORKTREE_BRANCH_PREFIX}/${branchFragment.length > 0 ? branchFragment : "update"}`;
}
const make$1 = Effect.gen(function* () {
	const orchestrationEngine = yield* OrchestrationEngineService;
	const providerService = yield* ProviderService;
	const git = yield* GitCore;
	const textGeneration = yield* TextGeneration;
	const serverSettingsService = yield* ServerSettingsService;
	const handledTurnStartKeys = yield* Cache.make({
		capacity: HANDLED_TURN_START_KEY_MAX,
		timeToLive: HANDLED_TURN_START_KEY_TTL,
		lookup: () => Effect.succeed(true)
	});
	const hasHandledTurnStartRecently = (key) => Cache.getOption(handledTurnStartKeys, key).pipe(Effect.flatMap((cached) => Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached)))));
	const threadModelSelections = /* @__PURE__ */ new Map();
	const appendProviderFailureActivity = (input) => orchestrationEngine.dispatch({
		type: "thread.activity.append",
		commandId: serverCommandId$1("provider-failure-activity"),
		threadId: input.threadId,
		activity: {
			id: EventId.makeUnsafe(crypto.randomUUID()),
			tone: "error",
			kind: input.kind,
			summary: input.summary,
			payload: {
				detail: input.detail,
				...input.requestId ? { requestId: input.requestId } : {}
			},
			turnId: input.turnId,
			createdAt: input.createdAt
		},
		createdAt: input.createdAt
	});
	const setThreadSession = (input) => orchestrationEngine.dispatch({
		type: "thread.session.set",
		commandId: serverCommandId$1("provider-session-set"),
		threadId: input.threadId,
		session: input.session,
		createdAt: input.createdAt
	});
	const resolveThread = Effect.fn("resolveThread")(function* (threadId) {
		return (yield* orchestrationEngine.getReadModel()).threads.find((entry) => entry.id === threadId);
	});
	const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (threadId, createdAt, options) {
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === threadId);
		if (!thread) return yield* Effect.die(/* @__PURE__ */ new Error(`Thread '${threadId}' was not found in read model.`));
		const desiredRuntimeMode = thread.runtimeMode;
		const currentProvider = Schema.is(ProviderKind)(thread.session?.providerName) ? thread.session.providerName : void 0;
		const requestedModelSelection = options?.modelSelection;
		const threadProvider = currentProvider ?? thread.modelSelection.provider;
		if (requestedModelSelection !== void 0 && requestedModelSelection.provider !== threadProvider) return yield* new ProviderAdapterRequestError({
			provider: threadProvider,
			method: "thread.turn.start",
			detail: `Thread '${threadId}' is bound to provider '${threadProvider}' and cannot switch to '${requestedModelSelection.provider}'.`
		});
		const preferredProvider = currentProvider ?? threadProvider;
		const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
		const effectiveCwd = resolveThreadWorkspaceCwd({
			thread,
			projects: readModel.projects
		});
		const resolveActiveSession = (threadId) => providerService.listSessions().pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));
		const startProviderSession = (input) => providerService.startSession(threadId, {
			threadId,
			...preferredProvider ? { provider: preferredProvider } : {},
			...effectiveCwd ? { cwd: effectiveCwd } : {},
			modelSelection: desiredModelSelection,
			...input?.resumeCursor !== void 0 ? { resumeCursor: input.resumeCursor } : {},
			runtimeMode: desiredRuntimeMode
		});
		const bindSessionToThread = (session) => setThreadSession({
			threadId,
			session: {
				threadId,
				status: mapProviderSessionStatusToOrchestrationStatus(session.status),
				providerName: session.provider,
				runtimeMode: desiredRuntimeMode,
				activeTurnId: null,
				lastError: session.lastError ?? null,
				updatedAt: session.updatedAt
			},
			createdAt
		});
		const existingSessionThreadId = thread.session && thread.session.status !== "stopped" ? thread.id : null;
		if (existingSessionThreadId) {
			const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
			const providerChanged = requestedModelSelection !== void 0 && requestedModelSelection.provider !== currentProvider;
			const activeSession = yield* resolveActiveSession(existingSessionThreadId);
			const sessionModelSwitch = currentProvider === void 0 ? "in-session" : (yield* providerService.getCapabilities(currentProvider)).sessionModelSwitch;
			const modelChanged = requestedModelSelection !== void 0 && requestedModelSelection.model !== activeSession?.model;
			const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "restart-session";
			const previousModelSelection = threadModelSelections.get(threadId);
			const shouldRestartForModelSelectionChange = currentProvider === "claudeAgent" && requestedModelSelection !== void 0 && !Equal.equals(previousModelSelection, requestedModelSelection);
			if (!runtimeModeChanged && !providerChanged && !shouldRestartForModelChange && !shouldRestartForModelSelectionChange) return existingSessionThreadId;
			const resumeCursor = providerChanged || shouldRestartForModelChange ? void 0 : activeSession?.resumeCursor ?? void 0;
			yield* Effect.logInfo("provider command reactor restarting provider session", {
				threadId,
				existingSessionThreadId,
				currentProvider,
				desiredProvider: desiredModelSelection.provider,
				currentRuntimeMode: thread.session?.runtimeMode,
				desiredRuntimeMode: thread.runtimeMode,
				runtimeModeChanged,
				providerChanged,
				modelChanged,
				shouldRestartForModelChange,
				shouldRestartForModelSelectionChange,
				hasResumeCursor: resumeCursor !== void 0
			});
			const restartedSession = yield* startProviderSession(resumeCursor !== void 0 ? { resumeCursor } : void 0);
			yield* Effect.logInfo("provider command reactor restarted provider session", {
				threadId,
				previousSessionId: existingSessionThreadId,
				restartedSessionThreadId: restartedSession.threadId,
				provider: restartedSession.provider,
				runtimeMode: restartedSession.runtimeMode
			});
			yield* bindSessionToThread(restartedSession);
			return restartedSession.threadId;
		}
		const startedSession = yield* startProviderSession(void 0);
		yield* bindSessionToThread(startedSession);
		return startedSession.threadId;
	});
	const sendTurnForThread = Effect.fn("sendTurnForThread")(function* (input) {
		const thread = yield* resolveThread(input.threadId);
		if (!thread) return;
		yield* ensureSessionForThread(input.threadId, input.createdAt, input.modelSelection !== void 0 ? { modelSelection: input.modelSelection } : {});
		if (input.modelSelection !== void 0) threadModelSelections.set(input.threadId, input.modelSelection);
		const normalizedInput = toNonEmptyProviderInput(input.messageText);
		const normalizedAttachments = input.attachments ?? [];
		const activeSession = yield* providerService.listSessions().pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)));
		const sessionModelSwitch = activeSession === void 0 ? "in-session" : (yield* providerService.getCapabilities(activeSession.provider)).sessionModelSwitch;
		const requestedModelSelection = input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
		const modelForTurn = sessionModelSwitch === "unsupported" ? activeSession?.model !== void 0 ? {
			...requestedModelSelection,
			model: activeSession.model
		} : requestedModelSelection : input.modelSelection;
		yield* providerService.sendTurn({
			threadId: input.threadId,
			...normalizedInput ? { input: normalizedInput } : {},
			...normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {},
			...modelForTurn !== void 0 ? { modelSelection: modelForTurn } : {},
			...input.interactionMode !== void 0 ? { interactionMode: input.interactionMode } : {}
		});
	});
	const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn("maybeGenerateAndRenameWorktreeBranchForFirstTurn")(function* (input) {
		if (!input.branch || !input.worktreePath) return;
		if (!isTemporaryWorktreeBranch(input.branch)) return;
		const oldBranch = input.branch;
		const cwd = input.worktreePath;
		const attachments = input.attachments ?? [];
		yield* Effect.gen(function* () {
			const { textGenerationModelSelection: modelSelection } = yield* serverSettingsService.getSettings;
			const generated = yield* textGeneration.generateBranchName({
				cwd,
				message: input.messageText,
				...attachments.length > 0 ? { attachments } : {},
				modelSelection
			});
			if (!generated) return;
			const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
			if (targetBranch === oldBranch) return;
			const renamed = yield* git.renameBranch({
				cwd,
				oldBranch,
				newBranch: targetBranch
			});
			yield* orchestrationEngine.dispatch({
				type: "thread.meta.update",
				commandId: serverCommandId$1("worktree-branch-rename"),
				threadId: input.threadId,
				branch: renamed.branch,
				worktreePath: cwd
			});
		}).pipe(Effect.catchCause((cause) => Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
			threadId: input.threadId,
			cwd,
			oldBranch,
			cause: Cause.pretty(cause)
		})));
	});
	const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(function* (input) {
		const attachments = input.attachments ?? [];
		yield* Effect.gen(function* () {
			const { textGenerationModelSelection: modelSelection } = yield* serverSettingsService.getSettings;
			const generated = yield* textGeneration.generateThreadTitle({
				cwd: input.cwd,
				message: input.messageText,
				...attachments.length > 0 ? { attachments } : {},
				modelSelection
			});
			if (!generated) return;
			const thread = yield* resolveThread(input.threadId);
			if (!thread) return;
			if (!canReplaceThreadTitle(thread.title, input.titleSeed)) return;
			yield* orchestrationEngine.dispatch({
				type: "thread.meta.update",
				commandId: serverCommandId$1("thread-title-rename"),
				threadId: input.threadId,
				title: generated.title
			});
		}).pipe(Effect.catchCause((cause) => Effect.logWarning("provider command reactor failed to generate or rename thread title", {
			threadId: input.threadId,
			cwd: input.cwd,
			cause: Cause.pretty(cause)
		})));
	});
	const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (event) {
		if (yield* hasHandledTurnStartRecently(turnStartKeyForEvent(event))) return;
		const thread = yield* resolveThread(event.payload.threadId);
		if (!thread) return;
		const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
		if (!message || message.role !== "user") {
			yield* appendProviderFailureActivity({
				threadId: event.payload.threadId,
				kind: "provider.turn.start.failed",
				summary: "Provider turn start failed",
				detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
				turnId: null,
				createdAt: event.payload.createdAt
			});
			return;
		}
		if (thread.messages.filter((entry) => entry.role === "user").length === 1) {
			const generationCwd = resolveThreadWorkspaceCwd({
				thread,
				projects: (yield* orchestrationEngine.getReadModel()).projects
			}) ?? process.cwd();
			const generationInput = {
				messageText: message.text,
				...message.attachments !== void 0 ? { attachments: message.attachments } : {},
				...event.payload.titleSeed !== void 0 ? { titleSeed: event.payload.titleSeed } : {}
			};
			yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
				threadId: event.payload.threadId,
				branch: thread.branch,
				worktreePath: thread.worktreePath,
				...generationInput
			}).pipe(Effect.forkScoped);
			if (canReplaceThreadTitle(thread.title, event.payload.titleSeed)) yield* maybeGenerateThreadTitleForFirstTurn({
				threadId: event.payload.threadId,
				cwd: generationCwd,
				...generationInput
			}).pipe(Effect.forkScoped);
		}
		yield* sendTurnForThread({
			threadId: event.payload.threadId,
			messageText: message.text,
			...message.attachments !== void 0 ? { attachments: message.attachments } : {},
			...event.payload.modelSelection !== void 0 ? { modelSelection: event.payload.modelSelection } : {},
			interactionMode: event.payload.interactionMode,
			createdAt: event.payload.createdAt
		}).pipe(Effect.catchCause((cause) => appendProviderFailureActivity({
			threadId: event.payload.threadId,
			kind: "provider.turn.start.failed",
			summary: "Provider turn start failed",
			detail: Cause.pretty(cause),
			turnId: null,
			createdAt: event.payload.createdAt
		})));
	});
	const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (event) {
		const thread = yield* resolveThread(event.payload.threadId);
		if (!thread) return;
		if (!(thread.session && thread.session.status !== "stopped")) return yield* appendProviderFailureActivity({
			threadId: event.payload.threadId,
			kind: "provider.turn.interrupt.failed",
			summary: "Provider turn interrupt failed",
			detail: "No active provider session is bound to this thread.",
			turnId: event.payload.turnId ?? null,
			createdAt: event.payload.createdAt
		});
		yield* providerService.interruptTurn({ threadId: event.payload.threadId });
	});
	const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (event) {
		const thread = yield* resolveThread(event.payload.threadId);
		if (!thread) return;
		if (!(thread.session && thread.session.status !== "stopped")) return yield* appendProviderFailureActivity({
			threadId: event.payload.threadId,
			kind: "provider.approval.respond.failed",
			summary: "Provider approval response failed",
			detail: "No active provider session is bound to this thread.",
			turnId: null,
			createdAt: event.payload.createdAt,
			requestId: event.payload.requestId
		});
		yield* providerService.respondToRequest({
			threadId: event.payload.threadId,
			requestId: event.payload.requestId,
			decision: event.payload.decision
		}).pipe(Effect.catchCause((cause) => Effect.gen(function* () {
			yield* appendProviderFailureActivity({
				threadId: event.payload.threadId,
				kind: "provider.approval.respond.failed",
				summary: "Provider approval response failed",
				detail: isUnknownPendingApprovalRequestError(cause) ? stalePendingRequestDetail("approval", event.payload.requestId) : Cause.pretty(cause),
				turnId: null,
				createdAt: event.payload.createdAt,
				requestId: event.payload.requestId
			});
			if (!isUnknownPendingApprovalRequestError(cause)) return;
		})));
	});
	const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(function* (event) {
		const thread = yield* resolveThread(event.payload.threadId);
		if (!thread) return;
		if (!(thread.session && thread.session.status !== "stopped")) return yield* appendProviderFailureActivity({
			threadId: event.payload.threadId,
			kind: "provider.user-input.respond.failed",
			summary: "Provider user input response failed",
			detail: "No active provider session is bound to this thread.",
			turnId: null,
			createdAt: event.payload.createdAt,
			requestId: event.payload.requestId
		});
		yield* providerService.respondToUserInput({
			threadId: event.payload.threadId,
			requestId: event.payload.requestId,
			answers: event.payload.answers
		}).pipe(Effect.catchCause((cause) => appendProviderFailureActivity({
			threadId: event.payload.threadId,
			kind: "provider.user-input.respond.failed",
			summary: "Provider user input response failed",
			detail: isUnknownPendingUserInputRequestError(cause) ? stalePendingRequestDetail("user-input", event.payload.requestId) : Cause.pretty(cause),
			turnId: null,
			createdAt: event.payload.createdAt,
			requestId: event.payload.requestId
		})));
	});
	const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (event) {
		const thread = yield* resolveThread(event.payload.threadId);
		if (!thread) return;
		const now = event.payload.createdAt;
		if (thread.session && thread.session.status !== "stopped") yield* providerService.stopSession({ threadId: thread.id });
		yield* setThreadSession({
			threadId: thread.id,
			session: {
				threadId: thread.id,
				status: "stopped",
				providerName: thread.session?.providerName ?? null,
				runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
				activeTurnId: null,
				lastError: thread.session?.lastError ?? null,
				updatedAt: now
			},
			createdAt: now
		});
	});
	const processDomainEvent = Effect.fn("processDomainEvent")(function* (event) {
		yield* Effect.annotateCurrentSpan({
			"orchestration.event_type": event.type,
			"orchestration.thread_id": event.payload.threadId,
			...event.commandId ? { "orchestration.command_id": event.commandId } : {}
		});
		yield* increment(orchestrationEventsProcessedTotal, { eventType: event.type });
		switch (event.type) {
			case "thread.runtime-mode-set": {
				const thread = yield* resolveThread(event.payload.threadId);
				if (!thread?.session || thread.session.status === "stopped") return;
				const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
				yield* ensureSessionForThread(event.payload.threadId, event.occurredAt, cachedModelSelection !== void 0 ? { modelSelection: cachedModelSelection } : {});
				return;
			}
			case "thread.turn-start-requested":
				yield* processTurnStartRequested(event);
				return;
			case "thread.turn-interrupt-requested":
				yield* processTurnInterruptRequested(event);
				return;
			case "thread.approval-response-requested":
				yield* processApprovalResponseRequested(event);
				return;
			case "thread.user-input-response-requested":
				yield* processUserInputResponseRequested(event);
				return;
			case "thread.session-stop-requested":
				yield* processSessionStopRequested(event);
				return;
		}
	});
	const processDomainEventSafely = (event) => processDomainEvent(event).pipe(Effect.catchCause((cause) => {
		if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
		return Effect.logWarning("provider command reactor failed to process event", {
			eventType: event.type,
			cause: Cause.pretty(cause)
		});
	}));
	const worker = yield* makeDrainableWorker(processDomainEventSafely);
	return {
		start: Effect.fn("start")(function* () {
			const processEvent = Effect.fn("processEvent")(function* (event) {
				if (event.type === "thread.runtime-mode-set" || event.type === "thread.turn-start-requested" || event.type === "thread.turn-interrupt-requested" || event.type === "thread.approval-response-requested" || event.type === "thread.user-input-response-requested" || event.type === "thread.session-stop-requested") return yield* worker.enqueue(event);
			});
			yield* Effect.forkScoped(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));
		}),
		drain: worker.drain
	};
});
const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make$1);

//#endregion
//#region src/checkpointing/Diffs.ts
function parseTurnDiffFilesFromUnifiedDiff(diff) {
	const normalized = diff.replace(/\r\n/g, "\n").trim();
	if (normalized.length === 0) return [];
	return parsePatchFiles(normalized).flatMap((patch) => patch.files.map((file) => ({
		path: file.name,
		additions: file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
		deletions: file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0)
	}))).toSorted((left, right) => left.path.localeCompare(right.path));
}

//#endregion
//#region src/orchestration/Layers/CheckpointReactor.ts
function toTurnId(value) {
	return value === void 0 ? null : TurnId.makeUnsafe(String(value));
}
function sameId(left, right) {
	if (left === null || left === void 0 || right === null || right === void 0) return false;
	return left === right;
}
function checkpointStatusFromRuntime(status) {
	switch (status) {
		case "failed": return "error";
		case "cancelled":
		case "interrupted": return "missing";
		default: return "ready";
	}
}
const serverCommandId = (tag) => CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
const make = Effect.gen(function* () {
	const orchestrationEngine = yield* OrchestrationEngineService;
	const providerService = yield* ProviderService;
	const checkpointStore = yield* CheckpointStore;
	const receiptBus = yield* RuntimeReceiptBus;
	const workspaceEntries = yield* WorkspaceEntries;
	const appendRevertFailureActivity = (input) => orchestrationEngine.dispatch({
		type: "thread.activity.append",
		commandId: serverCommandId("checkpoint-revert-failure"),
		threadId: input.threadId,
		activity: {
			id: EventId.makeUnsafe(crypto.randomUUID()),
			tone: "error",
			kind: "checkpoint.revert.failed",
			summary: "Checkpoint revert failed",
			payload: {
				turnCount: input.turnCount,
				detail: input.detail
			},
			turnId: null,
			createdAt: input.createdAt
		},
		createdAt: input.createdAt
	});
	const appendCaptureFailureActivity = (input) => orchestrationEngine.dispatch({
		type: "thread.activity.append",
		commandId: serverCommandId("checkpoint-capture-failure"),
		threadId: input.threadId,
		activity: {
			id: EventId.makeUnsafe(crypto.randomUUID()),
			tone: "error",
			kind: "checkpoint.capture.failed",
			summary: "Checkpoint capture failed",
			payload: { detail: input.detail },
			turnId: input.turnId,
			createdAt: input.createdAt
		},
		createdAt: input.createdAt
	});
	const resolveSessionRuntimeForThread = Effect.fn("resolveSessionRuntimeForThread")(function* (threadId) {
		const thread = (yield* orchestrationEngine.getReadModel()).threads.find((entry) => entry.id === threadId);
		const sessions = yield* providerService.listSessions();
		const findSessionWithCwd = (session) => {
			if (!session?.cwd) return Option.none();
			return Option.some({
				threadId: session.threadId,
				cwd: session.cwd
			});
		};
		if (thread) {
			const fromProjected = findSessionWithCwd(sessions.find((session) => session.threadId === thread.id));
			if (Option.isSome(fromProjected)) return fromProjected;
		}
		return Option.none();
	});
	const isGitWorkspace = (cwd) => isGitRepository(cwd);
	const resolveCheckpointCwd = Effect.fn("resolveCheckpointCwd")(function* (input) {
		const fromSession = yield* resolveSessionRuntimeForThread(input.threadId);
		const fromThread = resolveThreadWorkspaceCwd({
			thread: input.thread,
			projects: input.projects
		});
		const cwd = input.preferSessionRuntime ? Option.match(fromSession, {
			onNone: () => void 0,
			onSome: (runtime) => runtime.cwd
		}) ?? fromThread : fromThread ?? Option.match(fromSession, {
			onNone: () => void 0,
			onSome: (runtime) => runtime.cwd
		});
		if (!cwd) return;
		if (!isGitWorkspace(cwd)) return;
		return cwd;
	});
	const captureAndDispatchCheckpoint = Effect.fn("captureAndDispatchCheckpoint")(function* (input) {
		const fromTurnCount = Math.max(0, input.turnCount - 1);
		const fromCheckpointRef = checkpointRefForThreadTurn(input.threadId, fromTurnCount);
		const targetCheckpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);
		if (!(yield* checkpointStore.hasCheckpointRef({
			cwd: input.cwd,
			checkpointRef: fromCheckpointRef
		}))) yield* Effect.logWarning("checkpoint capture missing pre-turn baseline", {
			threadId: input.threadId,
			turnId: input.turnId,
			fromTurnCount
		});
		yield* checkpointStore.captureCheckpoint({
			cwd: input.cwd,
			checkpointRef: targetCheckpointRef
		});
		yield* workspaceEntries.invalidate(input.cwd);
		const files = yield* checkpointStore.diffCheckpoints({
			cwd: input.cwd,
			fromCheckpointRef,
			toCheckpointRef: targetCheckpointRef,
			fallbackFromToHead: false
		}).pipe(Effect.map((diff) => parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
			path: file.path,
			kind: "modified",
			additions: file.additions,
			deletions: file.deletions
		}))), Effect.tapError((error) => appendCaptureFailureActivity({
			threadId: input.threadId,
			turnId: input.turnId,
			detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
			createdAt: input.createdAt
		})), Effect.catch((error) => Effect.logWarning("failed to derive checkpoint file summary", {
			threadId: input.threadId,
			turnId: input.turnId,
			turnCount: input.turnCount,
			detail: error.message
		}).pipe(Effect.as([]))));
		const assistantMessageId = input.assistantMessageId ?? input.thread.messages.toReversed().find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id ?? MessageId.makeUnsafe(`assistant:${input.turnId}`);
		yield* orchestrationEngine.dispatch({
			type: "thread.turn.diff.complete",
			commandId: serverCommandId("checkpoint-turn-diff-complete"),
			threadId: input.threadId,
			turnId: input.turnId,
			completedAt: input.createdAt,
			checkpointRef: targetCheckpointRef,
			status: input.status,
			files,
			assistantMessageId,
			checkpointTurnCount: input.turnCount,
			createdAt: input.createdAt
		});
		yield* receiptBus.publish({
			type: "checkpoint.diff.finalized",
			threadId: input.threadId,
			turnId: input.turnId,
			checkpointTurnCount: input.turnCount,
			checkpointRef: targetCheckpointRef,
			status: input.status,
			createdAt: input.createdAt
		});
		yield* receiptBus.publish({
			type: "turn.processing.quiesced",
			threadId: input.threadId,
			turnId: input.turnId,
			checkpointTurnCount: input.turnCount,
			createdAt: input.createdAt
		});
		yield* orchestrationEngine.dispatch({
			type: "thread.activity.append",
			commandId: serverCommandId("checkpoint-captured-activity"),
			threadId: input.threadId,
			activity: {
				id: EventId.makeUnsafe(crypto.randomUUID()),
				tone: "info",
				kind: "checkpoint.captured",
				summary: "Checkpoint captured",
				payload: {
					turnCount: input.turnCount,
					status: input.status
				},
				turnId: input.turnId,
				createdAt: input.createdAt
			},
			createdAt: input.createdAt
		});
	});
	const captureCheckpointFromTurnCompletion = Effect.fn("captureCheckpointFromTurnCompletion")(function* (event) {
		const turnId = toTurnId(event.turnId);
		if (!turnId) return;
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === event.threadId);
		if (!thread) return;
		if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) return;
		if (thread.checkpoints.some((checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing")) return;
		const checkpointCwd = yield* resolveCheckpointCwd({
			threadId: thread.id,
			thread,
			projects: readModel.projects,
			preferSessionRuntime: true
		});
		if (!checkpointCwd) return;
		const existingPlaceholder = thread.checkpoints.find((checkpoint) => checkpoint.turnId === turnId && checkpoint.status === "missing");
		const currentTurnCount = thread.checkpoints.reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
		const nextTurnCount = existingPlaceholder ? existingPlaceholder.checkpointTurnCount : currentTurnCount + 1;
		yield* captureAndDispatchCheckpoint({
			threadId: thread.id,
			turnId,
			thread,
			cwd: checkpointCwd,
			turnCount: nextTurnCount,
			status: checkpointStatusFromRuntime(event.payload.state),
			assistantMessageId: void 0,
			createdAt: event.createdAt
		});
	});
	const captureCheckpointFromPlaceholder = Effect.fn("captureCheckpointFromPlaceholder")(function* (event) {
		const { threadId, turnId, checkpointTurnCount, status } = event.payload;
		if (status !== "missing") return;
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === threadId);
		if (!thread) {
			yield* Effect.logWarning("checkpoint capture from placeholder skipped: thread not found", { threadId });
			return;
		}
		if (thread.checkpoints.some((checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing")) {
			yield* Effect.logDebug("checkpoint capture from placeholder skipped: real checkpoint already exists", {
				threadId,
				turnId
			});
			return;
		}
		const checkpointCwd = yield* resolveCheckpointCwd({
			threadId,
			thread,
			projects: readModel.projects,
			preferSessionRuntime: true
		});
		if (!checkpointCwd) return;
		yield* captureAndDispatchCheckpoint({
			threadId,
			turnId,
			thread,
			cwd: checkpointCwd,
			turnCount: checkpointTurnCount,
			status: "ready",
			assistantMessageId: event.payload.assistantMessageId ?? void 0,
			createdAt: event.payload.completedAt
		});
	});
	const ensurePreTurnBaselineFromTurnStart = Effect.fn("ensurePreTurnBaselineFromTurnStart")(function* (event) {
		if (!toTurnId(event.turnId)) return;
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === event.threadId);
		if (!thread) return;
		const checkpointCwd = yield* resolveCheckpointCwd({
			threadId: thread.id,
			thread,
			projects: readModel.projects,
			preferSessionRuntime: false
		});
		if (!checkpointCwd) return;
		const currentTurnCount = thread.checkpoints.reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
		const baselineCheckpointRef = checkpointRefForThreadTurn(thread.id, currentTurnCount);
		if (yield* checkpointStore.hasCheckpointRef({
			cwd: checkpointCwd,
			checkpointRef: baselineCheckpointRef
		})) return;
		yield* checkpointStore.captureCheckpoint({
			cwd: checkpointCwd,
			checkpointRef: baselineCheckpointRef
		});
		yield* receiptBus.publish({
			type: "checkpoint.baseline.captured",
			threadId: thread.id,
			checkpointTurnCount: currentTurnCount,
			checkpointRef: baselineCheckpointRef,
			createdAt: event.createdAt
		});
	});
	const ensurePreTurnBaselineFromDomainTurnStart = Effect.fn("ensurePreTurnBaselineFromDomainTurnStart")(function* (event) {
		if (event.type === "thread.message-sent") {
			if (event.payload.role !== "user" || event.payload.streaming || event.payload.turnId !== null) return;
		}
		const threadId = event.payload.threadId;
		const readModel = yield* orchestrationEngine.getReadModel();
		const thread = readModel.threads.find((entry) => entry.id === threadId);
		if (!thread) return;
		const checkpointCwd = yield* resolveCheckpointCwd({
			threadId,
			thread,
			projects: readModel.projects,
			preferSessionRuntime: false
		});
		if (!checkpointCwd) return;
		const currentTurnCount = thread.checkpoints.reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
		const baselineCheckpointRef = checkpointRefForThreadTurn(threadId, currentTurnCount);
		if (yield* checkpointStore.hasCheckpointRef({
			cwd: checkpointCwd,
			checkpointRef: baselineCheckpointRef
		})) return;
		yield* checkpointStore.captureCheckpoint({
			cwd: checkpointCwd,
			checkpointRef: baselineCheckpointRef
		});
		yield* receiptBus.publish({
			type: "checkpoint.baseline.captured",
			threadId,
			checkpointTurnCount: currentTurnCount,
			checkpointRef: baselineCheckpointRef,
			createdAt: event.occurredAt
		});
	});
	const handleRevertRequested = Effect.fn("handleRevertRequested")(function* (event) {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const thread = (yield* orchestrationEngine.getReadModel()).threads.find((entry) => entry.id === event.payload.threadId);
		if (!thread) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: "Thread was not found in read model.",
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		const sessionRuntime = yield* resolveSessionRuntimeForThread(event.payload.threadId);
		if (Option.isNone(sessionRuntime)) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: "No active provider session with workspace cwd is bound to this thread.",
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		if (!isGitWorkspace(sessionRuntime.value.cwd)) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: "Checkpoints are unavailable because this project is not a git repository.",
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		const currentTurnCount = thread.checkpoints.reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
		if (event.payload.turnCount > currentTurnCount) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: `Checkpoint turn count ${event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		const targetCheckpointRef = event.payload.turnCount === 0 ? checkpointRefForThreadTurn(event.payload.threadId, 0) : thread.checkpoints.find((checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount)?.checkpointRef;
		if (!targetCheckpointRef) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: `Checkpoint ref for turn ${event.payload.turnCount} is unavailable in read model.`,
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		if (!(yield* checkpointStore.restoreCheckpoint({
			cwd: sessionRuntime.value.cwd,
			checkpointRef: targetCheckpointRef,
			fallbackToHead: event.payload.turnCount === 0
		}))) {
			yield* appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
				createdAt: now
			}).pipe(Effect.catch(() => Effect.void));
			return;
		}
		yield* workspaceEntries.invalidate(sessionRuntime.value.cwd);
		const rolledBackTurns = Math.max(0, currentTurnCount - event.payload.turnCount);
		if (rolledBackTurns > 0) yield* providerService.rollbackConversation({
			threadId: sessionRuntime.value.threadId,
			numTurns: rolledBackTurns
		});
		const staleCheckpointRefs = thread.checkpoints.filter((checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount).map((checkpoint) => checkpoint.checkpointRef);
		if (staleCheckpointRefs.length > 0) yield* checkpointStore.deleteCheckpointRefs({
			cwd: sessionRuntime.value.cwd,
			checkpointRefs: staleCheckpointRefs
		});
		yield* orchestrationEngine.dispatch({
			type: "thread.revert.complete",
			commandId: serverCommandId("checkpoint-revert-complete"),
			threadId: event.payload.threadId,
			turnCount: event.payload.turnCount,
			createdAt: now
		}).pipe(Effect.catch((error) => appendRevertFailureActivity({
			threadId: event.payload.threadId,
			turnCount: event.payload.turnCount,
			detail: error.message,
			createdAt: now
		})), Effect.asVoid);
	});
	const processDomainEvent = Effect.fn("processDomainEvent")(function* (event) {
		if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
			yield* ensurePreTurnBaselineFromDomainTurnStart(event);
			return;
		}
		if (event.type === "thread.checkpoint-revert-requested") {
			yield* handleRevertRequested(event).pipe(Effect.catch((error) => appendRevertFailureActivity({
				threadId: event.payload.threadId,
				turnCount: event.payload.turnCount,
				detail: error.message,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			})));
			return;
		}
		if (event.type === "thread.turn-diff-completed") yield* captureCheckpointFromPlaceholder(event).pipe(Effect.catch((error) => appendCaptureFailureActivity({
			threadId: event.payload.threadId,
			turnId: event.payload.turnId,
			detail: error.message,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		}).pipe(Effect.catch(() => Effect.void))));
	});
	const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (event) {
		if (event.type === "turn.started") {
			yield* ensurePreTurnBaselineFromTurnStart(event);
			return;
		}
		if (event.type === "turn.completed") {
			const turnId = toTurnId(event.turnId);
			yield* captureCheckpointFromTurnCompletion(event).pipe(Effect.catch((error) => appendCaptureFailureActivity({
				threadId: event.threadId,
				turnId,
				detail: error.message,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			}).pipe(Effect.catch(() => Effect.void))));
			return;
		}
	});
	const processInput = (input) => input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);
	const processInputSafely = (input) => processInput(input).pipe(Effect.catchCause((cause) => {
		if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
		return Effect.logWarning("checkpoint reactor failed to process input", {
			source: input.source,
			eventType: input.event.type,
			cause: Cause.pretty(cause)
		});
	}));
	const worker = yield* makeDrainableWorker(processInputSafely);
	return {
		start: Effect.fn("start")(function* () {
			yield* Effect.forkScoped(Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
				if (event.type !== "thread.turn-start-requested" && event.type !== "thread.message-sent" && event.type !== "thread.checkpoint-revert-requested" && event.type !== "thread.turn-diff-completed") return Effect.void;
				return worker.enqueue({
					source: "domain",
					event
				});
			}));
			yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, (event) => {
				if (event.type !== "turn.started" && event.type !== "turn.completed") return Effect.void;
				return worker.enqueue({
					source: "runtime",
					event
				});
			}));
		}),
		drain: worker.drain
	};
});
const CheckpointReactorLive = Layer.effect(CheckpointReactor, make);

//#endregion
//#region src/provider/Layers/ProviderRegistry.ts
const loadProviders = (codexProvider, claudeProvider) => Effect.all([codexProvider.getSnapshot, claudeProvider.getSnapshot], { concurrency: "unbounded" });
const haveProvidersChanged = (previousProviders, nextProviders) => !Equal.equals(previousProviders, nextProviders);
const ProviderRegistryLive = Layer.effect(ProviderRegistry, Effect.gen(function* () {
	const codexProvider = yield* CodexProvider;
	const claudeProvider = yield* ClaudeProvider;
	const changesPubSub = yield* Effect.acquireRelease(PubSub.unbounded(), PubSub.shutdown);
	const providersRef = yield* Ref.make(yield* loadProviders(codexProvider, claudeProvider));
	const syncProviders = Effect.fn("syncProviders")(function* (options) {
		const previousProviders = yield* Ref.get(providersRef);
		const providers = yield* loadProviders(codexProvider, claudeProvider);
		yield* Ref.set(providersRef, providers);
		if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) yield* PubSub.publish(changesPubSub, providers);
		return providers;
	});
	yield* Stream.runForEach(codexProvider.streamChanges, () => syncProviders()).pipe(Effect.forkScoped);
	yield* Stream.runForEach(claudeProvider.streamChanges, () => syncProviders()).pipe(Effect.forkScoped);
	const refresh = Effect.fn("refresh")(function* (provider) {
		switch (provider) {
			case "codex":
				yield* codexProvider.refresh;
				break;
			case "claudeAgent":
				yield* claudeProvider.refresh;
				break;
			default:
				yield* Effect.all([codexProvider.refresh, claudeProvider.refresh], { concurrency: "unbounded" });
				break;
		}
		return yield* syncProviders();
	});
	return {
		getProviders: syncProviders({ publish: false }).pipe(Effect.tapError(Effect.logError), Effect.orElseSucceed(() => [])),
		refresh: (provider) => refresh(provider).pipe(Effect.tapError(Effect.logError), Effect.orElseSucceed(() => [])),
		get streamChanges() {
			return Stream.fromPubSub(changesPubSub);
		}
	};
})).pipe(Layer.provideMerge(CodexProviderLive), Layer.provideMerge(ClaudeProviderLive));

//#endregion
//#region src/project/Layers/ProjectFaviconResolver.ts
const FAVICON_CANDIDATES = [
	"favicon.svg",
	"favicon.ico",
	"favicon.png",
	"public/favicon.svg",
	"public/favicon.ico",
	"public/favicon.png",
	"app/favicon.ico",
	"app/favicon.png",
	"app/icon.svg",
	"app/icon.png",
	"app/icon.ico",
	"src/favicon.ico",
	"src/favicon.svg",
	"src/app/favicon.ico",
	"src/app/icon.svg",
	"src/app/icon.png",
	"assets/icon.svg",
	"assets/icon.png",
	"assets/logo.svg",
	"assets/logo.png"
];
const ICON_SOURCE_FILES = [
	"index.html",
	"public/index.html",
	"app/routes/__root.tsx",
	"src/routes/__root.tsx",
	"app/root.tsx",
	"src/root.tsx",
	"src/index.html"
];
const LINK_ICON_HTML_RE = /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE = /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;
function extractIconHref(source) {
	const htmlMatch = source.match(LINK_ICON_HTML_RE);
	if (htmlMatch?.[1]) return htmlMatch[1];
	const objMatch = source.match(LINK_ICON_OBJ_RE);
	if (objMatch?.[1]) return objMatch[1];
	return null;
}
const makeProjectFaviconResolver = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const resolveIconHref = (projectCwd, href) => {
		const clean = href.replace(/^\//, "");
		return [path.join(projectCwd, "public", clean), path.join(projectCwd, clean)];
	};
	const isPathWithinProject = (projectCwd, candidatePath) => {
		const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
		return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
	};
	const findExistingFile = Effect.fn("ProjectFaviconResolver.findExistingFile")(function* (projectCwd, candidates) {
		for (const candidate of candidates) {
			if (!isPathWithinProject(projectCwd, candidate)) continue;
			if ((yield* fileSystem.stat(candidate).pipe(Effect.catch(() => Effect.succeed(null))))?.type === "File") return candidate;
		}
		return null;
	});
	return { resolvePath: Effect.fn("ProjectFaviconResolver.resolvePath")(function* (cwd) {
		for (const candidate of FAVICON_CANDIDATES) {
			const existing = yield* findExistingFile(cwd, [path.join(cwd, candidate)]);
			if (existing) return existing;
		}
		for (const sourceFile of ICON_SOURCE_FILES) {
			const sourcePath = path.join(cwd, sourceFile);
			const source = yield* fileSystem.readFileString(sourcePath).pipe(Effect.catch(() => Effect.succeed(null)));
			if (!source) continue;
			const href = extractIconHref(source);
			if (!href) continue;
			const existing = yield* findExistingFile(cwd, resolveIconHref(cwd, href));
			if (existing) return existing;
		}
		return null;
	}) };
});
const ProjectFaviconResolverLive = Layer.effect(ProjectFaviconResolver, makeProjectFaviconResolver);

//#endregion
//#region src/workspace/Layers/WorkspaceEntries.ts
const WORKSPACE_CACHE_TTL_MS = 15e3;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25e3;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const IGNORED_DIRECTORY_NAMES = new Set([
	".git",
	".convex",
	"node_modules",
	".next",
	".turbo",
	"dist",
	"build",
	"out",
	".cache"
]);
function toPosixPath(input) {
	return input.replaceAll("\\", "/");
}
function parentPathOf(input) {
	const separatorIndex = input.lastIndexOf("/");
	if (separatorIndex === -1) return;
	return input.slice(0, separatorIndex);
}
function basenameOf(input) {
	const separatorIndex = input.lastIndexOf("/");
	if (separatorIndex === -1) return input;
	return input.slice(separatorIndex + 1);
}
function toSearchableWorkspaceEntry(entry) {
	const normalizedPath = entry.path.toLowerCase();
	return {
		...entry,
		normalizedPath,
		normalizedName: basenameOf(normalizedPath)
	};
}
function normalizeQuery(input) {
	return input.trim().replace(/^[@./]+/, "").toLowerCase();
}
function scoreSubsequenceMatch(value, query) {
	if (!query) return 0;
	let queryIndex = 0;
	let firstMatchIndex = -1;
	let previousMatchIndex = -1;
	let gapPenalty = 0;
	for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
		if (value[valueIndex] !== query[queryIndex]) continue;
		if (firstMatchIndex === -1) firstMatchIndex = valueIndex;
		if (previousMatchIndex !== -1) gapPenalty += valueIndex - previousMatchIndex - 1;
		previousMatchIndex = valueIndex;
		queryIndex += 1;
		if (queryIndex === query.length) {
			const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length;
			const lengthPenalty = Math.min(64, value.length - query.length);
			return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
		}
	}
	return null;
}
function scoreEntry(entry, query) {
	if (!query) return entry.kind === "directory" ? 0 : 1;
	const { normalizedPath, normalizedName } = entry;
	if (normalizedName === query) return 0;
	if (normalizedPath === query) return 1;
	if (normalizedName.startsWith(query)) return 2;
	if (normalizedPath.startsWith(query)) return 3;
	if (normalizedPath.includes(`/${query}`)) return 4;
	if (normalizedName.includes(query)) return 5;
	if (normalizedPath.includes(query)) return 6;
	const nameFuzzyScore = scoreSubsequenceMatch(normalizedName, query);
	if (nameFuzzyScore !== null) return 100 + nameFuzzyScore;
	const pathFuzzyScore = scoreSubsequenceMatch(normalizedPath, query);
	if (pathFuzzyScore !== null) return 200 + pathFuzzyScore;
	return null;
}
function compareRankedWorkspaceEntries(left, right) {
	const scoreDelta = left.score - right.score;
	if (scoreDelta !== 0) return scoreDelta;
	return left.entry.path.localeCompare(right.entry.path);
}
function findInsertionIndex(rankedEntries, candidate) {
	let low = 0;
	let high = rankedEntries.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const current = rankedEntries[middle];
		if (!current) break;
		if (compareRankedWorkspaceEntries(candidate, current) < 0) high = middle;
		else low = middle + 1;
	}
	return low;
}
function insertRankedEntry(rankedEntries, candidate, limit) {
	if (limit <= 0) return;
	const insertionIndex = findInsertionIndex(rankedEntries, candidate);
	if (rankedEntries.length < limit) {
		rankedEntries.splice(insertionIndex, 0, candidate);
		return;
	}
	if (insertionIndex >= limit) return;
	rankedEntries.splice(insertionIndex, 0, candidate);
	rankedEntries.pop();
}
function isPathInIgnoredDirectory(relativePath) {
	const firstSegment = relativePath.split("/")[0];
	if (!firstSegment) return false;
	return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}
function directoryAncestorsOf(relativePath) {
	const segments = relativePath.split("/").filter((segment) => segment.length > 0);
	if (segments.length <= 1) return [];
	const directories = [];
	for (let index = 1; index < segments.length; index += 1) directories.push(segments.slice(0, index).join("/"));
	return directories;
}
const processErrorDetail = (cause) => cause instanceof Error ? cause.message : String(cause);
const makeWorkspaceEntries = Effect.gen(function* () {
	const path = yield* Path.Path;
	const gitOption = yield* Effect.serviceOption(GitCore);
	const workspacePaths = yield* WorkspacePaths;
	const isInsideGitWorkTree = (cwd) => Option.match(gitOption, {
		onSome: (git) => git.isInsideWorkTree(cwd).pipe(Effect.catch(() => Effect.succeed(false))),
		onNone: () => Effect.succeed(false)
	});
	const filterGitIgnoredPaths = (cwd, relativePaths) => Option.match(gitOption, {
		onSome: (git) => git.filterIgnoredPaths(cwd, relativePaths).pipe(Effect.map((paths) => [...paths]), Effect.catch(() => Effect.succeed(relativePaths))),
		onNone: () => Effect.succeed(relativePaths)
	});
	const buildWorkspaceIndexFromGit = Effect.fn("WorkspaceEntries.buildWorkspaceIndexFromGit")(function* (cwd) {
		if (Option.isNone(gitOption)) return null;
		if (!(yield* isInsideGitWorkTree(cwd))) return null;
		const listedFiles = yield* gitOption.value.listWorkspaceFiles(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
		if (!listedFiles) return null;
		const filePaths = yield* filterGitIgnoredPaths(cwd, [...listedFiles.paths].map((entry) => toPosixPath(entry)).filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry)));
		const directorySet = /* @__PURE__ */ new Set();
		for (const filePath of filePaths) for (const directoryPath of directoryAncestorsOf(filePath)) if (!isPathInIgnoredDirectory(directoryPath)) directorySet.add(directoryPath);
		const directoryEntries = [...directorySet].toSorted((left, right) => left.localeCompare(right)).map((directoryPath) => ({
			path: directoryPath,
			kind: "directory",
			parentPath: parentPathOf(directoryPath)
		})).map(toSearchableWorkspaceEntry);
		const fileEntries = [...new Set(filePaths)].toSorted((left, right) => left.localeCompare(right)).map((filePath) => ({
			path: filePath,
			kind: "file",
			parentPath: parentPathOf(filePath)
		})).map(toSearchableWorkspaceEntry);
		const entries = [...directoryEntries, ...fileEntries];
		return {
			scannedAt: Date.now(),
			entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
			truncated: listedFiles.truncated || entries.length > WORKSPACE_INDEX_MAX_ENTRIES
		};
	});
	const readDirectoryEntries = Effect.fn("WorkspaceEntries.readDirectoryEntries")(function* (cwd, relativeDir) {
		return yield* Effect.tryPromise({
			try: async () => {
				const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
				return {
					relativeDir,
					dirents: await fsPromises.readdir(absoluteDir, { withFileTypes: true })
				};
			},
			catch: (cause) => new WorkspaceEntriesError({
				cwd,
				operation: "workspaceEntries.readDirectoryEntries",
				detail: processErrorDetail(cause),
				cause
			})
		}).pipe(Effect.catchIf(() => relativeDir.length > 0, () => Effect.succeed({
			relativeDir,
			dirents: null
		})));
	});
	const buildWorkspaceIndexFromFilesystem = Effect.fn("WorkspaceEntries.buildWorkspaceIndexFromFilesystem")(function* (cwd) {
		const shouldFilterWithGitIgnore = yield* isInsideGitWorkTree(cwd);
		let pendingDirectories = [""];
		const entries = [];
		let truncated = false;
		while (pendingDirectories.length > 0 && !truncated) {
			const currentDirectories = pendingDirectories;
			pendingDirectories = [];
			const candidateEntriesByDirectory = (yield* Effect.forEach(currentDirectories, (relativeDir) => readDirectoryEntries(cwd, relativeDir), { concurrency: WORKSPACE_SCAN_READDIR_CONCURRENCY })).map((directoryEntry) => {
				const { relativeDir, dirents } = directoryEntry;
				if (!dirents) return [];
				dirents.sort((left, right) => left.name.localeCompare(right.name));
				const candidates = [];
				for (const dirent of dirents) {
					if (!dirent.name || dirent.name === "." || dirent.name === "..") continue;
					if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) continue;
					if (!dirent.isDirectory() && !dirent.isFile()) continue;
					const relativePath = toPosixPath(relativeDir ? path.join(relativeDir, dirent.name) : dirent.name);
					if (isPathInIgnoredDirectory(relativePath)) continue;
					candidates.push({
						dirent,
						relativePath
					});
				}
				return candidates;
			});
			const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) => candidateEntries.map((entry) => entry.relativePath));
			const allowedPathSet = shouldFilterWithGitIgnore ? new Set(yield* filterGitIgnoredPaths(cwd, candidatePaths)) : null;
			for (const candidateEntries of candidateEntriesByDirectory) {
				for (const candidate of candidateEntries) {
					if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) continue;
					const entry = toSearchableWorkspaceEntry({
						path: candidate.relativePath,
						kind: candidate.dirent.isDirectory() ? "directory" : "file",
						parentPath: parentPathOf(candidate.relativePath)
					});
					entries.push(entry);
					if (candidate.dirent.isDirectory()) pendingDirectories.push(candidate.relativePath);
					if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
						truncated = true;
						break;
					}
				}
				if (truncated) break;
			}
		}
		return {
			scannedAt: Date.now(),
			entries,
			truncated
		};
	});
	const buildWorkspaceIndex = Effect.fn("WorkspaceEntries.buildWorkspaceIndex")(function* (cwd) {
		const gitIndexed = yield* buildWorkspaceIndexFromGit(cwd);
		if (gitIndexed) return gitIndexed;
		return yield* buildWorkspaceIndexFromFilesystem(cwd);
	});
	const workspaceIndexCache = yield* Cache.makeWith({
		capacity: WORKSPACE_CACHE_MAX_KEYS,
		lookup: buildWorkspaceIndex,
		timeToLive: (exit) => Exit.isSuccess(exit) ? Duration.millis(WORKSPACE_CACHE_TTL_MS) : Duration.zero
	});
	const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (cwd) {
		return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(Effect.mapError((cause) => new WorkspaceEntriesError({
			cwd,
			operation: "workspaceEntries.normalizeWorkspaceRoot",
			detail: cause.message,
			cause
		})));
	});
	return {
		invalidate: Effect.fn("WorkspaceEntries.invalidate")(function* (cwd) {
			const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(Effect.catch(() => Effect.succeed(cwd)));
			yield* Cache.invalidate(workspaceIndexCache, cwd);
			if (normalizedCwd !== cwd) yield* Cache.invalidate(workspaceIndexCache, normalizedCwd);
		}),
		search: Effect.fn("WorkspaceEntries.search")(function* (input) {
			const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
			return yield* Cache.get(workspaceIndexCache, normalizedCwd).pipe(Effect.map((index) => {
				const normalizedQuery = normalizeQuery(input.query);
				const limit = Math.max(0, Math.floor(input.limit));
				const rankedEntries = [];
				let matchedEntryCount = 0;
				for (const entry of index.entries) {
					const score = scoreEntry(entry, normalizedQuery);
					if (score === null) continue;
					matchedEntryCount += 1;
					insertRankedEntry(rankedEntries, {
						entry,
						score
					}, limit);
				}
				return {
					entries: rankedEntries.map((candidate) => candidate.entry),
					truncated: index.truncated || matchedEntryCount > limit
				};
			}));
		})
	};
});
const WorkspaceEntriesLive = Layer.effect(WorkspaceEntries, makeWorkspaceEntries);

//#endregion
//#region src/workspace/Layers/WorkspaceFileSystem.ts
const makeWorkspaceFileSystem = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const workspacePaths = yield* WorkspacePaths;
	const workspaceEntries = yield* WorkspaceEntries;
	return { writeFile: Effect.fn("WorkspaceFileSystem.writeFile")(function* (input) {
		const target = yield* workspacePaths.resolveRelativePathWithinRoot({
			workspaceRoot: input.cwd,
			relativePath: input.relativePath
		});
		yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(Effect.mapError((cause) => new WorkspaceFileSystemError({
			cwd: input.cwd,
			relativePath: input.relativePath,
			operation: "workspaceFileSystem.makeDirectory",
			detail: cause.message,
			cause
		})));
		yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(Effect.mapError((cause) => new WorkspaceFileSystemError({
			cwd: input.cwd,
			relativePath: input.relativePath,
			operation: "workspaceFileSystem.writeFile",
			detail: cause.message,
			cause
		})));
		yield* workspaceEntries.invalidate(input.cwd);
		return { relativePath: target.relativePath };
	}) };
});
const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);

//#endregion
//#region src/workspace/Layers/WorkspacePaths.ts
function toPosixRelativePath(input) {
	return input.replaceAll("\\", "/");
}
function expandHomePath(input, path) {
	if (input === "~") return OS.homedir();
	if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(OS.homedir(), input.slice(2));
	return input;
}
const makeWorkspacePaths = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	return {
		normalizeWorkspaceRoot: Effect.fn("WorkspacePaths.normalizeWorkspaceRoot")(function* (workspaceRoot) {
			const normalizedWorkspaceRoot = path.resolve(expandHomePath(workspaceRoot.trim(), path));
			const workspaceStat = yield* fileSystem.stat(normalizedWorkspaceRoot).pipe(Effect.catch(() => Effect.succeed(null)));
			if (!workspaceStat) return yield* new WorkspaceRootNotExistsError({
				workspaceRoot,
				normalizedWorkspaceRoot
			});
			if (workspaceStat.type !== "Directory") return yield* new WorkspaceRootNotDirectoryError({
				workspaceRoot,
				normalizedWorkspaceRoot
			});
			return normalizedWorkspaceRoot;
		}),
		resolveRelativePathWithinRoot: Effect.fn("WorkspacePaths.resolveRelativePathWithinRoot")(function* (input) {
			const normalizedInputPath = input.relativePath.trim();
			if (path.isAbsolute(normalizedInputPath)) return yield* new WorkspacePathOutsideRootError({
				workspaceRoot: input.workspaceRoot,
				relativePath: input.relativePath
			});
			const absolutePath = path.resolve(input.workspaceRoot, normalizedInputPath);
			const relativeToRoot = toPosixRelativePath(path.relative(input.workspaceRoot, absolutePath));
			if (relativeToRoot.length === 0 || relativeToRoot === "." || relativeToRoot.startsWith("../") || relativeToRoot === ".." || path.isAbsolute(relativeToRoot)) return yield* new WorkspacePathOutsideRootError({
				workspaceRoot: input.workspaceRoot,
				relativePath: input.relativePath
			});
			return {
				absolutePath,
				relativePath: relativeToRoot
			};
		})
	};
});
const WorkspacePathsLive = Layer.effect(WorkspacePaths, makeWorkspacePaths);

//#endregion
//#region ../../packages/shared/src/projectScripts.ts
function projectScriptRuntimeEnv(input) {
	const env = { T3CODE_PROJECT_ROOT: input.project.cwd };
	if (input.worktreePath) env.T3CODE_WORKTREE_PATH = input.worktreePath;
	if (input.extraEnv) return {
		...env,
		...input.extraEnv
	};
	return env;
}
function setupProjectScript(scripts) {
	return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

//#endregion
//#region src/project/Layers/ProjectSetupScriptRunner.ts
const makeProjectSetupScriptRunner = Effect.gen(function* () {
	const orchestrationEngine = yield* OrchestrationEngineService;
	const terminalManager = yield* TerminalManager;
	const runForThread = (input) => Effect.gen(function* () {
		const readModel = yield* orchestrationEngine.getReadModel();
		const project = (input.projectId ? readModel.projects.find((entry) => entry.id === input.projectId) : null) ?? (input.projectCwd ? readModel.projects.find((entry) => entry.workspaceRoot === input.projectCwd) : null) ?? null;
		if (!project) return yield* Effect.fail(/* @__PURE__ */ new Error("Project was not found for setup script execution."));
		const script = setupProjectScript(project.scripts);
		if (!script) return { status: "no-script" };
		const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
		const cwd = input.worktreePath;
		const env = projectScriptRuntimeEnv({
			project: { cwd: project.workspaceRoot },
			worktreePath: input.worktreePath
		});
		yield* terminalManager.open({
			threadId: input.threadId,
			terminalId,
			cwd,
			worktreePath: input.worktreePath,
			env
		});
		yield* terminalManager.write({
			threadId: input.threadId,
			terminalId,
			data: `${script.command}\r`
		});
		return {
			status: "started",
			scriptId: script.id,
			scriptName: script.name,
			terminalId,
			cwd
		};
	});
	return { runForThread };
});
const ProjectSetupScriptRunnerLive = Layer.effect(ProjectSetupScriptRunner, makeProjectSetupScriptRunner);

//#endregion
//#region src/serverLogger.ts
const ServerLoggerLive = Effect.gen(function* () {
	const config = yield* ServerConfig;
	const minimumLogLevelLayer = Layer.succeed(References.MinimumLogLevel, config.logLevel);
	const loggerLayer = Logger.layer([Logger.consolePretty(), Logger.tracerLogger], { mergeWithExisting: false });
	return Layer.mergeAll(loggerLayer, minimumLogLevelLayer);
}).pipe(Layer.unwrap);

//#endregion
//#region src/observability/TraceSink.ts
const FLUSH_BUFFER_THRESHOLD = 32;
const makeTraceSink = Effect.fn("makeTraceSink")(function* (options) {
	const sink = new RotatingFileSink({
		filePath: options.filePath,
		maxBytes: options.maxBytes,
		maxFiles: options.maxFiles
	});
	let buffer = [];
	const flushUnsafe = () => {
		if (buffer.length === 0) return;
		const chunk = buffer.join("");
		buffer = [];
		try {
			sink.write(chunk);
		} catch {
			buffer.unshift(chunk);
		}
	};
	const flush = Effect.sync(flushUnsafe).pipe(Effect.withTracerEnabled(false));
	yield* Effect.addFinalizer(() => flush.pipe(Effect.ignore));
	yield* Effect.forkScoped(Effect.sleep(`${options.batchWindowMs} millis`).pipe(Effect.andThen(flush), Effect.forever));
	return {
		filePath: options.filePath,
		push(record) {
			try {
				buffer.push(`${JSON.stringify(record)}\n`);
				if (buffer.length >= FLUSH_BUFFER_THRESHOLD) flushUnsafe();
			} catch {
				return;
			}
		},
		flush,
		close: () => flush
	};
});

//#endregion
//#region src/observability/LocalFileTracer.ts
var LocalFileSpan = class {
	_tag = "Span";
	name;
	spanId;
	traceId;
	parent;
	annotations;
	links;
	sampled;
	kind;
	status;
	attributes;
	events;
	constructor(options, delegate, push) {
		this.delegate = delegate;
		this.push = push;
		this.name = delegate.name;
		this.spanId = delegate.spanId;
		this.traceId = delegate.traceId;
		this.parent = options.parent;
		this.annotations = options.annotations;
		this.links = [...options.links];
		this.sampled = delegate.sampled;
		this.kind = delegate.kind;
		this.status = {
			_tag: "Started",
			startTime: options.startTime
		};
		this.attributes = /* @__PURE__ */ new Map();
		this.events = [];
	}
	end(endTime, exit) {
		this.status = {
			_tag: "Ended",
			startTime: this.status.startTime,
			endTime,
			exit
		};
		this.delegate.end(endTime, exit);
		if (this.sampled) this.push(spanToTraceRecord(this));
	}
	attribute(key, value) {
		this.attributes.set(key, value);
		this.delegate.attribute(key, value);
	}
	event(name, startTime, attributes) {
		const nextAttributes = attributes ?? {};
		this.events.push([
			name,
			startTime,
			nextAttributes
		]);
		this.delegate.event(name, startTime, nextAttributes);
	}
	addLinks(links) {
		this.links.push(...links);
		this.delegate.addLinks(links);
	}
};
const makeLocalFileTracer = Effect.fn("makeLocalFileTracer")(function* (options) {
	const sink = options.sink ?? (yield* makeTraceSink({
		filePath: options.filePath,
		maxBytes: options.maxBytes,
		maxFiles: options.maxFiles,
		batchWindowMs: options.batchWindowMs
	}));
	const delegate = options.delegate ?? Tracer.make({ span: (spanOptions) => new Tracer.NativeSpan(spanOptions) });
	return Tracer.make({
		span(spanOptions) {
			return new LocalFileSpan(spanOptions, delegate.span(spanOptions), sink.push);
		},
		...delegate.context ? { context: delegate.context } : {}
	});
});

//#endregion
//#region src/observability/Layers/Observability.ts
const otlpSerializationLayer = OtlpSerialization.layerJson;
const ObservabilityLive = Layer.unwrap(Effect.gen(function* () {
	const config = yield* ServerConfig;
	const traceReferencesLayer = Layer.mergeAll(Layer.succeed(Tracer.MinimumTraceLevel, config.traceMinLevel), Layer.succeed(References.TracerTimingEnabled, config.traceTimingEnabled));
	const tracerLayer = Layer.unwrap(Effect.gen(function* () {
		const sink = yield* makeTraceSink({
			filePath: config.serverTracePath,
			maxBytes: config.traceMaxBytes,
			maxFiles: config.traceMaxFiles,
			batchWindowMs: config.traceBatchWindowMs
		});
		const delegate = config.otlpTracesUrl === void 0 ? void 0 : yield* OtlpTracer.make({
			url: config.otlpTracesUrl,
			exportInterval: `${config.otlpExportIntervalMs} millis`,
			resource: {
				serviceName: config.otlpServiceName,
				attributes: {
					"service.runtime": "t3-server",
					"service.mode": config.mode
				}
			}
		});
		const tracer = yield* makeLocalFileTracer({
			filePath: config.serverTracePath,
			maxBytes: config.traceMaxBytes,
			maxFiles: config.traceMaxFiles,
			batchWindowMs: config.traceBatchWindowMs,
			sink,
			...delegate ? { delegate } : {}
		});
		return Layer.mergeAll(Layer.succeed(Tracer.Tracer, tracer), Layer.succeed(BrowserTraceCollector, { record: (records) => Effect.sync(() => {
			for (const record of records) sink.push(record);
		}) }));
	})).pipe(Layer.provideMerge(otlpSerializationLayer));
	const metricsLayer = config.otlpMetricsUrl === void 0 ? Layer.empty : OtlpMetrics.layer({
		url: config.otlpMetricsUrl,
		exportInterval: `${config.otlpExportIntervalMs} millis`,
		resource: {
			serviceName: config.otlpServiceName,
			attributes: {
				"service.runtime": "t3-server",
				"service.mode": config.mode
			}
		}
	}).pipe(Layer.provideMerge(otlpSerializationLayer));
	return Layer.mergeAll(ServerLoggerLive, traceReferencesLayer, tracerLayer, metricsLayer);
}));

//#endregion
//#region src/server.ts
const PtyAdapterLive = Layer.unwrap(Effect.gen(function* () {
	if (typeof Bun !== "undefined") return (yield* Effect.promise(() => import("./BunPTY-Cxy7XaA3.mjs"))).layer;
	else return (yield* Effect.promise(() => import("./NodePTY-BEVM0UX2.mjs"))).layer;
}));
const HttpServerLive = Layer.unwrap(Effect.gen(function* () {
	const config = yield* ServerConfig;
	if (typeof Bun !== "undefined") return (yield* Effect.promise(() => import("@effect/platform-bun/BunHttpServer"))).layer({
		port: config.port,
		...config.host ? { hostname: config.host } : {}
	});
	else {
		const [NodeHttpServer, NodeHttp] = yield* Effect.all([Effect.promise(() => import("@effect/platform-node/NodeHttpServer")), Effect.promise(() => import("node:http"))]);
		return NodeHttpServer.layer(NodeHttp.createServer, {
			host: config.host,
			port: config.port
		});
	}
}));
const PlatformServicesLive = Layer.unwrap(Effect.gen(function* () {
	if (typeof Bun !== "undefined") {
		const { layer } = yield* Effect.promise(() => import("@effect/platform-bun/BunServices"));
		return layer;
	} else {
		const { layer } = yield* Effect.promise(() => import("@effect/platform-node/NodeServices"));
		return layer;
	}
}));
const ReactorLayerLive = Layer.empty.pipe(Layer.provideMerge(OrchestrationReactorLive), Layer.provideMerge(ProviderRuntimeIngestionLive), Layer.provideMerge(ProviderCommandReactorLive), Layer.provideMerge(CheckpointReactorLive), Layer.provideMerge(RuntimeReceiptBusLive));
const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(OrchestrationEventStoreLive, OrchestrationCommandReceiptRepositoryLive);
const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(Layer.provide(OrchestrationEventStoreLive));
const OrchestrationInfrastructureLayerLive = Layer.mergeAll(OrchestrationProjectionSnapshotQueryLive, OrchestrationEventInfrastructureLayerLive, OrchestrationProjectionPipelineLayerLive);
const OrchestrationLayerLive = Layer.mergeAll(OrchestrationInfrastructureLayerLive, OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)));
const CheckpointingLayerLive = Layer.empty.pipe(Layer.provideMerge(CheckpointDiffQueryLive), Layer.provideMerge(CheckpointStoreLive));
const ProviderLayerLive = Layer.unwrap(Effect.gen(function* () {
	const { providerEventLogPath } = yield* ServerConfig;
	const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, { stream: "native" });
	const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, { stream: "canonical" });
	const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(ProviderSessionRuntimeRepositoryLive));
	const codexAdapterLayer = makeCodexAdapterLive(nativeEventLogger ? { nativeEventLogger } : void 0);
	const claudeAdapterLayer = makeClaudeAdapterLive(nativeEventLogger ? { nativeEventLogger } : void 0);
	const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(Layer.provide(codexAdapterLayer), Layer.provide(claudeAdapterLayer), Layer.provideMerge(providerSessionDirectoryLayer));
	return makeProviderServiceLive(canonicalEventLogger ? { canonicalEventLogger } : void 0).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
}));
const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(layerConfig));
const GitLayerLive = Layer.empty.pipe(Layer.provideMerge(GitManagerLive.pipe(Layer.provideMerge(ProjectSetupScriptRunnerLive), Layer.provideMerge(GitCoreLive), Layer.provideMerge(GitHubCliLive), Layer.provideMerge(RoutingTextGenerationLive))), Layer.provideMerge(GitCoreLive));
const TerminalLayerLive = TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive));
const WorkspaceLayerLive = Layer.mergeAll(WorkspacePathsLive, WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)), WorkspaceFileSystemLive.pipe(Layer.provide(WorkspacePathsLive), Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)))));
const RuntimeDependenciesLive = ReactorLayerLive.pipe(Layer.provideMerge(CheckpointingLayerLive), Layer.provideMerge(GitLayerLive), Layer.provideMerge(OrchestrationLayerLive), Layer.provideMerge(ProviderLayerLive), Layer.provideMerge(TerminalLayerLive), Layer.provideMerge(PersistenceLayerLive), Layer.provideMerge(KeybindingsLive), Layer.provideMerge(ProviderRegistryLive), Layer.provideMerge(ServerSettingsLive), Layer.provideMerge(WorkspaceLayerLive), Layer.provideMerge(ProjectFaviconResolverLive), Layer.provideMerge(AnalyticsServiceLayerLive), Layer.provideMerge(OpenLive), Layer.provideMerge(ServerLifecycleEventsLive));
const RuntimeServicesLive = ServerRuntimeStartupLive.pipe(Layer.provideMerge(RuntimeDependenciesLive));
const makeRoutesLayer = Layer.mergeAll(attachmentsRouteLayer, otlpTracesProxyRouteLayer, projectFaviconRouteLayer, staticAndDevRouteLayer, websocketRpcRouteLayer);
const makeServerLayer = Layer.unwrap(Effect.gen(function* () {
	const config = yield* ServerConfig;
	fixPath();
	const httpListeningLayer = Layer.effectDiscard(Effect.gen(function* () {
		yield* HttpServer.HttpServer;
		yield* (yield* ServerRuntimeStartup).markHttpListening;
	}));
	return Layer.mergeAll(HttpRouter.serve(makeRoutesLayer, { disableLogger: !config.logWebSocketEvents }), httpListeningLayer).pipe(Layer.provideMerge(RuntimeServicesLive), Layer.provideMerge(HttpServerLive), Layer.provide(ObservabilityLive), Layer.provideMerge(FetchHttpClient.layer), Layer.provideMerge(PlatformServicesLive));
}));
const runServer = Layer.launch(makeServerLayer);

//#endregion
//#region src/cli.ts
const PortSchema = Schema.Int.check(Schema.isBetween({
	minimum: 1,
	maximum: 65535
}));
const BootstrapEnvelopeSchema = Schema.Struct({
	mode: Schema.optional(RuntimeMode),
	port: Schema.optional(PortSchema),
	host: Schema.optional(Schema.String),
	t3Home: Schema.optional(Schema.String),
	devUrl: Schema.optional(Schema.URLFromString),
	noBrowser: Schema.optional(Schema.Boolean),
	authToken: Schema.optional(Schema.String),
	autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
	logWebSocketEvents: Schema.optional(Schema.Boolean),
	otlpTracesUrl: Schema.optional(Schema.String),
	otlpMetricsUrl: Schema.optional(Schema.String)
});
const modeFlag = Flag.choice("mode", RuntimeMode.literals).pipe(Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."), Flag.optional);
const portFlag = Flag.integer("port").pipe(Flag.withSchema(PortSchema), Flag.withDescription("Port for the HTTP/WebSocket server."), Flag.optional);
const hostFlag = Flag.string("host").pipe(Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."), Flag.optional);
const baseDirFlag = Flag.string("base-dir").pipe(Flag.withDescription("Base directory path (equivalent to T3CODE_HOME)."), Flag.optional);
const devUrlFlag = Flag.string("dev-url").pipe(Flag.withSchema(Schema.URLFromString), Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."), Flag.optional);
const noBrowserFlag = Flag.boolean("no-browser").pipe(Flag.withDescription("Disable automatic browser opening."), Flag.optional);
const authTokenFlag = Flag.string("auth-token").pipe(Flag.withDescription("Auth token required for WebSocket connections."), Flag.withAlias("token"), Flag.optional);
const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(Flag.withSchema(Schema.Int), Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."), Flag.optional);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(Flag.withDescription("Create a project for the current working directory on startup when missing."), Flag.optional);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(Flag.withDescription("Emit server-side logs for outbound WebSocket push traffic (equivalent to T3CODE_LOG_WS_EVENTS)."), Flag.withAlias("log-ws-events"), Flag.optional);
const EnvServerConfig = Config.all({
	logLevel: Config.logLevel("T3CODE_LOG_LEVEL").pipe(Config.withDefault("Info")),
	traceMinLevel: Config.logLevel("T3CODE_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
	traceTimingEnabled: Config.boolean("T3CODE_TRACE_TIMING_ENABLED").pipe(Config.withDefault(true)),
	traceFile: Config.string("T3CODE_TRACE_FILE").pipe(Config.option, Config.map(Option.getOrUndefined)),
	traceMaxBytes: Config.int("T3CODE_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
	traceMaxFiles: Config.int("T3CODE_TRACE_MAX_FILES").pipe(Config.withDefault(10)),
	traceBatchWindowMs: Config.int("T3CODE_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(200)),
	otlpTracesUrl: Config.string("T3CODE_OTLP_TRACES_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
	otlpMetricsUrl: Config.string("T3CODE_OTLP_METRICS_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
	otlpExportIntervalMs: Config.int("T3CODE_OTLP_EXPORT_INTERVAL_MS").pipe(Config.withDefault(1e4)),
	otlpServiceName: Config.string("T3CODE_OTLP_SERVICE_NAME").pipe(Config.withDefault("t3-server")),
	mode: Config.schema(RuntimeMode, "T3CODE_MODE").pipe(Config.option, Config.map(Option.getOrUndefined)),
	port: Config.port("T3CODE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
	host: Config.string("T3CODE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
	t3Home: Config.string("T3CODE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
	devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
	noBrowser: Config.boolean("T3CODE_NO_BROWSER").pipe(Config.option, Config.map(Option.getOrUndefined)),
	authToken: Config.string("T3CODE_AUTH_TOKEN").pipe(Config.option, Config.map(Option.getOrUndefined)),
	bootstrapFd: Config.int("T3CODE_BOOTSTRAP_FD").pipe(Config.option, Config.map(Option.getOrUndefined)),
	autoBootstrapProjectFromCwd: Config.boolean("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(Config.option, Config.map(Option.getOrUndefined)),
	logWebSocketEvents: Config.boolean("T3CODE_LOG_WS_EVENTS").pipe(Config.option, Config.map(Option.getOrUndefined))
});
const resolveBooleanFlag = (flag, envValue) => Option.getOrElse(Option.filter(flag, Boolean), () => envValue);
const resolveOptionPrecedence = (...values) => Option.firstSomeOf(values);
const loadPersistedObservabilitySettings = Effect.fn(function* (settingsPath) {
	const fs = yield* FileSystem.FileSystem;
	if (!(yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false)))) return {
		otlpTracesUrl: void 0,
		otlpMetricsUrl: void 0
	};
	return parsePersistedServerObservabilitySettings(yield* fs.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => "")));
});
const resolveServerConfig = (flags, cliLogLevel) => Effect.gen(function* () {
	const { findAvailablePort } = yield* NetService;
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const env = yield* EnvServerConfig;
	const bootstrapFd = Option.getOrUndefined(flags.bootstrapFd) ?? env.bootstrapFd;
	const bootstrapEnvelope = bootstrapFd !== void 0 ? yield* readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd) : Option.none();
	const mode = Option.getOrElse(resolveOptionPrecedence(flags.mode, Option.fromUndefinedOr(env.mode), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.mode))), () => "web");
	const port = yield* Option.match(resolveOptionPrecedence(flags.port, Option.fromUndefinedOr(env.port), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.port))), {
		onSome: (value) => Effect.succeed(value),
		onNone: () => {
			if (mode === "desktop") return Effect.succeed(DEFAULT_PORT);
			return findAvailablePort(DEFAULT_PORT);
		}
	});
	const devUrl = Option.getOrElse(resolveOptionPrecedence(flags.devUrl, Option.fromUndefinedOr(env.devUrl), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.devUrl))), () => void 0);
	const baseDir = yield* resolveBaseDir(Option.getOrUndefined(resolveOptionPrecedence(flags.baseDir, Option.fromUndefinedOr(env.t3Home), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.t3Home)))));
	const rawCwd = Option.getOrElse(flags.cwd, () => process.cwd());
	const cwd = path.resolve(yield* expandHomePath$1(rawCwd.trim()));
	yield* fs.makeDirectory(cwd, { recursive: true });
	const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
	yield* ensureServerDirectories(derivedPaths);
	const persistedObservabilitySettings = yield* loadPersistedObservabilitySettings(derivedPaths.settingsPath);
	const serverTracePath = env.traceFile ?? derivedPaths.serverTracePath;
	yield* fs.makeDirectory(path.dirname(serverTracePath), { recursive: true });
	const noBrowser = resolveBooleanFlag(flags.noBrowser, Option.getOrElse(resolveOptionPrecedence(Option.fromUndefinedOr(env.noBrowser), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.noBrowser))), () => mode === "desktop"));
	const authToken = Option.getOrUndefined(resolveOptionPrecedence(flags.authToken, Option.fromUndefinedOr(env.authToken), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.authToken))));
	const autoBootstrapProjectFromCwd = resolveBooleanFlag(flags.autoBootstrapProjectFromCwd, Option.getOrElse(resolveOptionPrecedence(Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.autoBootstrapProjectFromCwd))), () => mode === "web"));
	const logWebSocketEvents = resolveBooleanFlag(flags.logWebSocketEvents, Option.getOrElse(resolveOptionPrecedence(Option.fromUndefinedOr(env.logWebSocketEvents), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.logWebSocketEvents))), () => Boolean(devUrl)));
	const staticDir = devUrl ? void 0 : yield* resolveStaticDir();
	const host = Option.getOrElse(resolveOptionPrecedence(flags.host, Option.fromUndefinedOr(env.host), Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.host))), () => mode === "desktop" ? "127.0.0.1" : void 0);
	return {
		logLevel: Option.getOrElse(cliLogLevel, () => env.logLevel),
		traceMinLevel: env.traceMinLevel,
		traceTimingEnabled: env.traceTimingEnabled,
		traceBatchWindowMs: env.traceBatchWindowMs,
		traceMaxBytes: env.traceMaxBytes,
		traceMaxFiles: env.traceMaxFiles,
		otlpTracesUrl: env.otlpTracesUrl ?? Option.getOrUndefined(Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.otlpTracesUrl))) ?? persistedObservabilitySettings.otlpTracesUrl,
		otlpMetricsUrl: env.otlpMetricsUrl ?? Option.getOrUndefined(Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.otlpMetricsUrl))) ?? persistedObservabilitySettings.otlpMetricsUrl,
		otlpExportIntervalMs: env.otlpExportIntervalMs,
		otlpServiceName: env.otlpServiceName,
		mode,
		port,
		cwd,
		baseDir,
		...derivedPaths,
		serverTracePath,
		host,
		staticDir,
		devUrl,
		noBrowser,
		authToken,
		autoBootstrapProjectFromCwd,
		logWebSocketEvents
	};
});
const commandFlags = {
	mode: modeFlag,
	port: portFlag,
	host: hostFlag,
	baseDir: baseDirFlag,
	cwd: Argument.string("cwd").pipe(Argument.withDescription("Working directory for provider sessions (defaults to the current directory)."), Argument.optional),
	devUrl: devUrlFlag,
	noBrowser: noBrowserFlag,
	authToken: authTokenFlag,
	bootstrapFd: bootstrapFdFlag,
	autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
	logWebSocketEvents: logWebSocketEventsFlag
};
const rootCommand = Command.make("t3", commandFlags).pipe(Command.withDescription("Run the T3 Code server."), Command.withHandler((flags) => Effect.gen(function* () {
	const config = yield* resolveServerConfig(flags, yield* GlobalFlag.LogLevel);
	return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
})));
const cli = rootCommand;

//#endregion
//#region src/bin.ts
const CliRuntimeLayer = Layer$1.mergeAll(NodeServices.layer, NetService.layer);
Command.run(cli, { version }).pipe(Effect$1.scoped, Effect$1.provide(CliRuntimeLayer), NodeRuntime.runMain);

//#endregion
export { PtyAdapter as t };
//# sourceMappingURL=bin.mjs.map