const prompt = process.argv[2] ?? 'Write me a new hello world script using typescript';
const cwd = process.argv[3] ?? process.cwd();
const sessionId = '29c7275b-dbcc-4a5f-aaff-05b6c93cb038';
const requestId = '9bbaedf1-917d-4671-a362-4805c54171ba';
const modelCallId = `${requestId}-0-odvi`;

const sleep = milliseconds =>
	new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});

const now = Date.now();

const stream = [
	{
		type: 'system',
		subtype: 'init',
		apiKeySource: 'login',
		cwd,
		session_id: sessionId,
		model: 'Claude 4.6 Opus (Thinking)',
		permissionMode: 'default',
	},
	{
		type: 'user',
		message: {
			role: 'user',
			content: [{type: 'text', text: prompt}],
		},
		session_id: sessionId,
	},
	{
		type: 'thinking',
		subtype: 'delta',
		text: 'The user wants a',
		session_id: sessionId,
		timestamp_ms: now + 100,
	},
	{
		type: 'thinking',
		subtype: 'delta',
		text: ' new',
		session_id: sessionId,
		timestamp_ms: now + 240,
	},
	{
		type: 'thinking',
		subtype: 'delta',
		text: ' hello world script in',
		session_id: sessionId,
		timestamp_ms: now + 390,
	},
	{
		type: 'thinking',
		subtype: 'delta',
		text: ' TypeScript.',
		session_id: sessionId,
		timestamp_ms: now + 540,
	},
	{
		type: 'thinking',
		subtype: 'completed',
		session_id: sessionId,
		timestamp_ms: now + 800,
	},
	{
		type: 'tool_call',
		subtype: 'started',
		call_id: 'toolu_01PPh4fR7b2zfbx8D58VvVz7',
		tool_call: {
			editToolCall: {
				args: {
					path: `${cwd}\\hello.ts`,
					streamContent: 'console.log("Hello, World!");\n',
				},
			},
		},
		model_call_id: modelCallId,
		session_id: sessionId,
		timestamp_ms: now + 1200,
	},
	{
		type: 'tool_call',
		subtype: 'completed',
		call_id: 'toolu_01PPh4fR7b2zfbx8D58VvVz7',
		tool_call: {
			editToolCall: {
				args: {
					path: `${cwd}\\hello.ts`,
					streamContent: 'console.log("Hello, World!");\n',
				},
				result: {
					success: {
						path: `${cwd}\\hello.ts`,
						linesAdded: 1,
						linesRemoved: 1,
						diffString: '-\n+console.log("Hello, World!");',
						afterFullFileContent: 'console.log("Hello, World!");\n',
						message: `Wrote contents to ${cwd}\\hello.ts`,
					},
				},
			},
		},
		model_call_id: modelCallId,
		session_id: sessionId,
		timestamp_ms: now + 2500,
	},
	{
		type: 'assistant',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text:
						'Created `hello.ts` with a simple "Hello, World!" script. You can run it with:\n\n```bash\nnpx tsx hello.ts\n```\n\nOr if you have `ts-node` installed:\n\n```bash\nnpx ts-node hello.ts\n```',
				},
			],
		},
		session_id: sessionId,
	},
	{
		type: 'result',
		subtype: 'success',
		duration_ms: 20656,
		duration_api_ms: 20656,
		is_error: false,
		result:
			'Created `hello.ts` with a simple "Hello, World!" script. You can run it with:\n\n```bash\nnpx tsx hello.ts\n```\n\nOr if you have `ts-node` installed:\n\n```bash\nnpx ts-node hello.ts\n```',
		session_id: sessionId,
		request_id: requestId,
	},
];

for (const payload of stream) {
	console.log(JSON.stringify(payload));
	await sleep(300);
}
