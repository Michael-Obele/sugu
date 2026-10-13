import * as v from 'valibot';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Todo + SessionMeta
// ---------------------------------------------------------------------------

export const TodoSchema = v.strictObject({
	id: v.number(),
	text: v.string(),
	status: v.picklist(['open', 'done', 'dropped']),
	pos: v.number()
});

export type Todo = v.InferOutput<typeof TodoSchema>;

export const SessionMetaSchema = v.strictObject({
	id: v.string(),
	title: v.string(),
	model: v.string(),
	createdAt: v.string(),
	updatedAt: v.string(),
	lastSeq: v.number(),
	archived: v.boolean()
});

export type SessionMeta = v.InferOutput<typeof SessionMetaSchema>;

// ---------------------------------------------------------------------------
// Frame variants
// ---------------------------------------------------------------------------

const HelloFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('hello'),
	sessionId: v.string(),
	token: v.string(),
	since: v.optional(v.number())
});

const SendFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('send'),
	text: v.pipe(v.string(), v.maxLength(8000)),
	skills: v.optional(v.array(v.string()))
});

const CancelFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('cancel')
});

const ApproveFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('approve'),
	runId: v.string()
});

const AckFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('ack'),
	seq: v.number(),
	to: v.number()
});

const TokenFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('token'),
	seq: v.number(),
	delta: v.string()
});

const MsgFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('msg'),
	seq: v.number(),
	id: v.number(),
	role: v.picklist(['user', 'assistant', 'system']),
	text: v.string(),
	interrupted: v.optional(v.boolean())
});

const ToolFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('tool'),
	seq: v.number(),
	runId: v.string(),
	name: v.string(),
	status: v.picklist(['running', 'ok', 'failed']),
	summary: v.optional(v.string())
});

const StateFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('state'),
	seq: v.number(),
	todos: v.array(TodoSchema),
	busy: v.boolean(),
	model: v.string()
});

const ErrFrame = v.strictObject({
	v: v.literal(1),
	t: v.literal('err'),
	code: v.picklist(['auth', 'busy', 'quota', 'model', 'bad_frame']),
	message: v.string()
});

export const Frame = v.variant('t', [
	HelloFrame,
	SendFrame,
	CancelFrame,
	ApproveFrame,
	AckFrame,
	TokenFrame,
	MsgFrame,
	ToolFrame,
	StateFrame,
	ErrFrame
]);

export type Frame = v.InferOutput<typeof Frame>;

// ---------------------------------------------------------------------------
// parseFrame — discriminated result, never throws
// ---------------------------------------------------------------------------

export type ParseFrameResult = { ok: true; frame: Frame } | { ok: false; issues: v.BaseIssue<unknown>[] };

export function parseFrame(raw: unknown): ParseFrameResult {
	const result = v.safeParse(Frame, raw);
	if (result.success) return { ok: true, frame: result.output };
	return { ok: false, issues: [...result.issues] };
}
