import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import type {Agent, AgentConversationEntry} from '@/lib/types';
import {cn} from '@/lib/utils';

type RepoAgentsViewProperties = {
	selectedAgent: Agent | null;
	prompt: string;
	messages: AgentConversationEntry[];
	logs: string[];
	isRunning: boolean;
	onPromptChange: (prompt: string) => void;
	onRunPrompt: () => void;
	onStopRun: () => void;
};

export function RepoAgentsView({
	selectedAgent,
	prompt,
	messages,
	logs,
	isRunning,
	onPromptChange,
	onRunPrompt,
	onStopRun,
}: RepoAgentsViewProperties) {
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
				<div className="p-3">
					<p className="font-medium">
						{selectedAgent ? `Chat - ${selectedAgent.name}` : 'Select an agent'}
					</p>
					<p className="text-xs text-muted-foreground">
						Agents live under each repository in the left sidebar.
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
									<p className="text-muted-foreground">No logs yet.</p>
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
	);
}
