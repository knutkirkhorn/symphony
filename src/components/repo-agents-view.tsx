import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import type {Agent, AgentConversationEntry} from '@/lib/types';
import {cn} from '@/lib/utils';
import {
	Bot,
	Check,
	ChevronDown,
	Copy,
	ExternalLink,
	LoaderCircle,
	MessageSquareText,
	Play,
	Square,
	TerminalSquare,
	UserRound,
	Wrench,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';

const SCROLL_BOTTOM_THRESHOLD = 60;

type RepoAgentsViewProperties = {
	selectedAgent: Agent | null;
	model: string | null;
	prompt: string;
	messages: AgentConversationEntry[];
	logs: string[];
	isRunning: boolean;
	showRawLogs: boolean;
	onOpenEditedFile?: (path: string) => void;
	onPromptChange: (prompt: string) => void;
	onRunPrompt: () => void;
	onStopRun: () => void;
};

type MessageSegment =
	| {type: 'text'; content: string}
	| {type: 'code'; language: string; content: string};

const FENCED_CODE_BLOCK_REGEXP = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
const COMMAND_LANGUAGES = new Set([
	'bash',
	'sh',
	'shell',
	'zsh',
	'fish',
	'cmd',
	'powershell',
	'pwsh',
]);

function parseMessageSegments(text: string): MessageSegment[] {
	const segments: MessageSegment[] = [];
	let lastIndex = 0;
	for (const match of text.matchAll(FENCED_CODE_BLOCK_REGEXP)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			segments.push({
				type: 'text',
				content: text.slice(lastIndex, index),
			});
		}
		segments.push({
			type: 'code',
			language: (match[1] ?? '').trim(),
			content: (match[2] ?? '').replace(/\n$/, ''),
		});
		lastIndex = index + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({
			type: 'text',
			content: text.slice(lastIndex),
		});
	}
	return segments.length > 0 ? segments : [{type: 'text', content: text}];
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
	const parts: ReactNode[] = [];
	const regexp = /`([^`\n]+)`/g;
	let lastIndex = 0;
	let matchIndex = 0;
	for (const match of text.matchAll(regexp)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			parts.push(text.slice(lastIndex, index));
		}
		parts.push(
			<code
				key={`${keyPrefix}-inline-${matchIndex}`}
				className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.92em]"
			>
				{match[1]}
			</code>,
		);
		lastIndex = index + match[0].length;
		matchIndex += 1;
	}
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}
	return parts;
}

function MessageCodeBlock({
	language,
	content,
}: {
	language: string;
	content: string;
}) {
	const [copied, setCopied] = useState(false);
	const normalizedLanguage = language.toLowerCase();
	const isCommand = COMMAND_LANGUAGES.has(normalizedLanguage);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(content);
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
			}, 1500);
		} catch {
			// Ignore clipboard failures in restricted environments.
		}
	}

	return (
		<div className="relative overflow-hidden rounded-lg border border-border/70 bg-background/75">
			<div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-2.5 py-1.5">
				<p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
					{isCommand ? 'Command' : language || 'Code'}
				</p>
				<button
					type="button"
					onClick={() => void handleCopy()}
					className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
					aria-label={isCommand ? 'Copy command' : 'Copy code'}
					title={isCommand ? 'Copy command' : 'Copy code'}
				>
					{copied ? (
						<>
							<Check className="size-3.5" />
							Copied
						</>
					) : (
						<>
							<Copy className="size-3.5" />
							Copy
						</>
					)}
				</button>
			</div>
			<pre className="overflow-x-auto p-2.5 font-mono text-xs leading-relaxed whitespace-pre">
				<code>{content}</code>
			</pre>
		</div>
	);
}

function MessageContent({text}: {text: string}) {
	const segments = parseMessageSegments(text);

	return (
		<div className="space-y-2">
			{segments.flatMap((segment, segmentIndex) => {
				if (segment.type === 'code') {
					return [
						<MessageCodeBlock
							key={`${segment.language}-${segmentIndex}-${segment.content.slice(0, 24)}`}
							language={segment.language}
							content={segment.content}
						/>,
					];
				}

				const paragraphs = segment.content
					.split(/\n{2,}/)
					.map(entry => entry.trim())
					.filter(Boolean);
				if (paragraphs.length === 0) return [];

				return [
					<div key={`text-${segmentIndex}`} className="space-y-2">
						{paragraphs.map((paragraph, paragraphIndex) => {
							const lines = paragraph.split('\n');
							return (
								<p
									key={`paragraph-${segmentIndex}-${paragraphIndex}`}
									className="leading-relaxed whitespace-pre-wrap"
								>
									{lines.map((line, lineIndex) => (
										<span
											key={`line-${segmentIndex}-${paragraphIndex}-${lineIndex}`}
										>
											{renderInlineMarkdown(
												line,
												`${segmentIndex}-${paragraphIndex}-${lineIndex}`,
											)}
											{lineIndex < lines.length - 1 && <br />}
										</span>
									))}
								</p>
							);
						})}
					</div>,
				];
			})}
		</div>
	);
}

export function RepoAgentsView({
	selectedAgent,
	model,
	prompt,
	messages,
	logs,
	isRunning,
	showRawLogs,
	onOpenEditedFile,
	onPromptChange,
	onRunPrompt,
	onStopRun,
}: RepoAgentsViewProperties) {
	const messageCount = messages.length;
	const messagesScrollReference = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	const checkAtBottom = useCallback(() => {
		const element = messagesScrollReference.current;
		if (!element) return;
		const nearBottom =
			element.scrollHeight - element.scrollTop - element.clientHeight <
			SCROLL_BOTTOM_THRESHOLD;
		setIsAtBottom(nearBottom);
	}, []);

	const scrollToBottom = useCallback(() => {
		const element = messagesScrollReference.current;
		if (element) {
			element.scrollTo({top: element.scrollHeight, behavior: 'smooth'});
			setIsAtBottom(true);
		}
	}, []);

	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			const element = messagesScrollReference.current;
			if (element) {
				element.scrollTo({top: element.scrollHeight, behavior: 'auto'});
			}
		}
	}, [messages.length, isAtBottom]);

	useEffect(() => {
		const element = messagesScrollReference.current;
		if (!element) return () => {};
		const resizeObserver = new ResizeObserver(checkAtBottom);
		resizeObserver.observe(element);
		return () => resizeObserver.disconnect();
	}, [checkAtBottom]);

	const getMessageVisuals = (message: AgentConversationEntry) => {
		if (message.kind === 'thinking') {
			if (!message.isPending) {
				return {
					icon: MessageSquareText,
					label: 'Thought',
					containerClassName:
						'border-sky-500/30 bg-linear-to-b from-sky-500/12 to-sky-500/5',
				};
			}

			return {
				icon: LoaderCircle,
				label: 'Thinking',
				containerClassName:
					'border-sky-500/30 bg-linear-to-b from-sky-500/12 to-sky-500/5',
			};
		}

		switch (message.role) {
			case 'user': {
				return {
					icon: UserRound,
					label: 'You',
					containerClassName:
						'border-primary/30 bg-linear-to-b from-primary/15 to-primary/8',
				};
			}
			case 'assistant': {
				return {
					icon: Bot,
					label: 'Assistant',
					containerClassName:
						'border-emerald-500/30 bg-linear-to-b from-emerald-500/15 to-emerald-500/6',
				};
			}
			case 'tool': {
				return {
					icon: Wrench,
					label: 'Tool',
					containerClassName:
						'border-amber-500/35 bg-linear-to-b from-amber-500/18 to-amber-500/8',
				};
			}
			case 'error': {
				return {
					icon: TerminalSquare,
					label: 'Error',
					containerClassName:
						'border-destructive/45 bg-linear-to-b from-destructive/20 to-destructive/8 text-destructive',
				};
			}
			default: {
				return {
					icon: MessageSquareText,
					label: 'System',
					containerClassName: 'border-border/80 bg-muted/50',
				};
			}
		}
	};

	return (
		<div className="relative flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
			<div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(1000px_400px_at_100%_0%,hsl(var(--primary)/0.11),transparent_55%),radial-gradient(800px_300px_at_0%_100%,hsl(var(--muted-foreground)/0.08),transparent_60%)]" />
			<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<div className="flex shrink-0 flex-wrap items-start justify-between gap-2 px-1 py-2 md:px-4">
					<div className="min-w-0">
						<p className="truncate text-base font-semibold tracking-tight">
							{selectedAgent ? selectedAgent.name : 'Select an agent'}
						</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{selectedAgent
								? `${messageCount} ${messageCount === 1 ? 'message' : 'messages'} in this chat`
								: 'Choose an agent from the sidebar to start chatting'}
						</p>
						{model && (
							<p className="mt-0.5 truncate text-xs text-muted-foreground">
								Model: {model}
							</p>
						)}
					</div>
					<div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
						<span
							className={cn(
								'size-2 rounded-full bg-emerald-500',
								isRunning && 'animate-pulse',
							)}
						/>
						{isRunning ? 'Agent running' : 'Ready'}
					</div>
				</div>
				<Separator className="opacity-60" />
				<div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-1">
					<div
						ref={messagesScrollReference}
						className="h-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 md:px-4"
						onScroll={checkAtBottom}
					>
						<div className="space-y-3 py-2">
							{messages.length === 0 ? (
								<div className="flex h-full min-h-48 items-center justify-center">
									<div className="max-w-sm rounded-xl border border-dashed border-border/70 bg-muted/25 px-5 py-6 text-center">
										<MessageSquareText className="mx-auto mb-2 size-5 text-muted-foreground" />
										<p className="text-sm font-medium">No messages yet</p>
										<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
											Send a prompt below to start a clean chat thread with this
											agent.
										</p>
									</div>
								</div>
							) : (
								messages.map(message => (
									<div
										key={message.id}
										className={cn(
											'flex w-full',
											message.role === 'user' && message.kind !== 'thinking'
												? 'justify-end'
												: 'justify-start',
										)}
									>
										<div
											className={cn(
												'max-w-[92%] rounded-xl border px-3 py-2.5 text-sm shadow-xs md:max-w-[80%]',
												getMessageVisuals(message).containerClassName,
											)}
										>
											<p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
												{(() => {
													const visuals = getMessageVisuals(message);
													const Icon = visuals.icon;
													return (
														<>
															<Icon className="size-3.5" />
															<span>{visuals.label}</span>
														</>
													);
												})()}
												{message.isPending && (
													<span
														className="ml-1 inline-flex items-center gap-1"
														aria-label="Awaiting response"
													>
														{['0ms', '120ms', '240ms'].map(delay => (
															<span
																key={delay}
																className="size-1.5 rounded-full bg-muted-foreground/80 animate-bounce"
																style={{animationDelay: delay}}
															/>
														))}
													</span>
												)}
											</p>
											{(() => {
												const editedFilePath =
													message.role === 'tool'
														? parseEditedFileMessage(message.text)
														: undefined;
												if (!editedFilePath) {
													return <MessageContent text={message.text} />;
												}
												return (
													<p className="leading-relaxed">
														Edited{' '}
														<button
															type="button"
															onClick={() => {
																onOpenEditedFile?.(editedFilePath);
															}}
															className="inline-flex items-center gap-1 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-[0.92em] underline decoration-dotted underline-offset-2 transition-colors hover:bg-muted"
														>
															<code>{editedFilePath}</code>
															<ExternalLink className="size-3.5 shrink-0" />
														</button>
														.
													</p>
												);
											})()}
										</div>
									</div>
								))
							)}
						</div>
					</div>

					<div className="relative shrink-0 border-t border-border/70 pt-2 px-1 md:px-4">
						{!isAtBottom && messages.length > 0 && (
							<div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2">
								<Button
									variant="secondary"
									size="icon"
									onClick={scrollToBottom}
									className="h-9 w-9 rounded-full shadow-md border border-border/70"
									aria-label="Scroll to newest messages"
								>
									<ChevronDown className="size-4" />
								</Button>
							</div>
						)}
						<div className="space-y-2">
							<textarea
								placeholder="Enter prompt for selected agent"
								value={prompt}
								onChange={event => {
									onPromptChange(event.target.value);
								}}
								onKeyDown={event => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										onRunPrompt();
									}
								}}
								disabled={!selectedAgent || isRunning}
								rows={3}
								className={cn(
									'flex w-full min-w-0 resize-none rounded-lg border border-input/80 bg-background/80 px-3 py-2.5 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground',
									'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
									'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
									'min-h-10 max-h-48 overflow-y-auto md:text-sm',
								)}
							/>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-[11px] text-muted-foreground">
									Enter to run, Shift+Enter for a new line.
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										onClick={onStopRun}
										disabled={!isRunning}
										className="gap-1.5"
									>
										<Square className="size-3.5" />
										Stop
									</Button>
									<Button
										onClick={onRunPrompt}
										disabled={!selectedAgent || isRunning || !prompt.trim()}
										className="gap-1.5"
									>
										<Play className="size-3.5" />
										{isRunning ? 'Running...' : 'Run prompt'}
									</Button>
								</div>
							</div>
						</div>
					</div>

					{showRawLogs && (
						<div className="h-28 shrink-0 overflow-hidden border-t border-border/70 pt-2 md:h-32 px-1 md:px-4">
							<div className="px-1 py-1.5">
								<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									Raw logs
								</p>
							</div>
							<ScrollArea className="h-full">
								<div className="space-y-1 rounded-md bg-muted/20 p-2.5 font-mono text-xs leading-relaxed">
									{logs.length === 0 ? (
										<p className="text-muted-foreground">No logs yet.</p>
									) : (
										logs.map((line, index) => (
											<p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
										))
									)}
								</div>
							</ScrollArea>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
function parseEditedFileMessage(text: string) {
	const trimmedText = text.trim();
	const editedMatch =
		/^Edited\s+(.+?)\.$/.exec(trimmedText) ??
		/^Edited:\s+(.+)$/.exec(trimmedText);
	if (!editedMatch?.[1]) return '';
	return editedMatch[1].trim();
}
