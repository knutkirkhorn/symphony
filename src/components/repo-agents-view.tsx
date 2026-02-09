import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import type {Agent, AgentConversationEntry} from '@/lib/types';
import {cn} from '@/lib/utils';
import {useState} from 'react';

type RepoAgentsViewProperties = {
	agents: Agent[];
	isLoading: boolean;
	error: string | null;
	isCreating: boolean;
	selectedAgentId: number | null;
	prompt: string;
	messages: AgentConversationEntry[];
	logs: string[];
	isRunning: boolean;
	onSelectAgent: (agentId: number) => void;
	onPromptChange: (prompt: string) => void;
	onRunPrompt: () => void;
	onStopRun: () => void;
	onCreateAgent: (name: string) => Promise<void>;
};

function formatCreatedAt(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

export function RepoAgentsView({
	agents,
	isLoading,
	error,
	isCreating,
	selectedAgentId,
	prompt,
	messages,
	logs,
	isRunning,
	onSelectAgent,
	onPromptChange,
	onRunPrompt,
	onStopRun,
	onCreateAgent,
}: RepoAgentsViewProperties) {
	const [newAgentName, setNewAgentName] = useState('');

	async function handleCreateAgent() {
		const trimmedName = newAgentName.trim();
		if (!trimmedName) return;
		await onCreateAgent(trimmedName);
		setNewAgentName('');
	}

	const selectedAgent =
		agents.find(agent => agent.id === selectedAgentId) ?? undefined;

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
			<div className="rounded-md border">
				<div className="space-y-2 p-3">
					<p className="font-medium">Create new agent</p>
					<div className="flex items-center gap-2">
						<Input
							placeholder="Agent name"
							value={newAgentName}
							onChange={event => {
								setNewAgentName(event.target.value);
							}}
							onKeyDown={event => {
								if (event.key === 'Enter') {
									event.preventDefault();
									void handleCreateAgent();
								}
							}}
							disabled={isCreating}
						/>
						<Button
							onClick={() => void handleCreateAgent()}
							disabled={isCreating || newAgentName.trim().length === 0}
						>
							{isCreating ? 'Creating...' : 'Create agent'}
						</Button>
					</div>
				</div>
			</div>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
				<div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
					<div className="min-h-0 border-b lg:border-r lg:border-b-0">
						<div className="p-3">
							<p className="font-medium">Agents</p>
							<p className="text-xs text-muted-foreground">
								Select an agent to start a prompt session.
							</p>
						</div>
						<Separator />
						<ScrollArea className="h-full">
							<div className="space-y-2 p-3">
								{isLoading ? (
									Array.from({length: 6}).map((_, index) => (
										<Skeleton key={index} className="h-16 w-full" />
									))
								) : error ? (
									<p className="text-sm text-destructive">{error}</p>
								) : agents.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No agents created for this repository yet.
									</p>
								) : (
									agents.map(agent => (
										<button
											key={agent.id}
											type="button"
											className={cn(
												'w-full rounded-md border p-3 text-left hover:bg-muted/50',
												selectedAgentId === agent.id &&
													'border-primary bg-muted',
											)}
											onClick={() => {
												onSelectAgent(agent.id);
											}}
										>
											<p className="font-medium">{agent.name}</p>
											<p className="text-xs text-muted-foreground">
												Created {formatCreatedAt(agent.created_at)}
											</p>
										</button>
									))
								)}
							</div>
						</ScrollArea>
					</div>

					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<div className="p-3">
							<p className="font-medium">
								{selectedAgent
									? `Chat - ${selectedAgent.name}`
									: 'Select an agent'}
							</p>
							<p className="text-xs text-muted-foreground">
								Prompt the selected Cursor CLI agent and follow streaming logs.
							</p>
						</div>
						<Separator />
						<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
							<ScrollArea className="min-h-0 flex-1 rounded-md border">
								<div className="space-y-2 p-3">
									{messages.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											No messages yet. Send a prompt to begin.
										</p>
									) : (
										messages.map(message => (
											<div
												key={message.id}
												className={cn(
													'rounded-md border px-3 py-2 text-sm whitespace-pre-wrap',
													message.role === 'user' && 'bg-primary/10',
													message.role === 'assistant' && 'bg-emerald-500/10',
													message.role === 'tool' && 'bg-amber-500/10',
													message.role === 'system' && 'bg-muted',
													message.role === 'error' &&
														'border-destructive/50 bg-destructive/10 text-destructive',
												)}
											>
												<p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
													{message.role}
												</p>
												<p>{message.text}</p>
											</div>
										))
									)}
								</div>
							</ScrollArea>

							<div className="rounded-md border">
								<div className="space-y-2 p-3">
									<Input
										placeholder="Enter prompt for selected agent..."
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
									/>
									<div className="flex items-center justify-end gap-2">
										<Button
											variant="outline"
											onClick={onStopRun}
											disabled={!isRunning}
										>
											Stop
										</Button>
										<Button
											onClick={onRunPrompt}
											disabled={!selectedAgent || isRunning || !prompt.trim()}
										>
											{isRunning ? 'Running...' : 'Run prompt'}
										</Button>
									</div>
								</div>
							</div>

							<div className="min-h-0 rounded-md border">
								<div className="border-b px-3 py-2">
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										Raw logs
									</p>
								</div>
								<ScrollArea className="h-36">
									<div className="space-y-1 p-3 font-mono text-xs">
										{logs.length === 0 ? (
											<p className="text-muted-foreground">
												No logs yet.
											</p>
										) : (
											logs.map((line, index) => (
												<p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
											))
										)}
									</div>
								</ScrollArea>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
