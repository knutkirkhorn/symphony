import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import type {Agent} from '@/lib/types';
import {useState} from 'react';

type RepoAgentsViewProperties = {
	agents: Agent[];
	isLoading: boolean;
	error: string | null;
	isCreating: boolean;
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
	onCreateAgent,
}: RepoAgentsViewProperties) {
	const [newAgentName, setNewAgentName] = useState('');

	async function handleCreateAgent() {
		const trimmedName = newAgentName.trim();
		if (!trimmedName) return;
		await onCreateAgent(trimmedName);
		setNewAgentName('');
	}

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
				<div className="p-3">
					<p className="font-medium">Agents</p>
					<p className="text-xs text-muted-foreground">
						All agents configured for this repository.
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
								<div key={agent.id} className="rounded-md border p-3">
									<p className="font-medium">{agent.name}</p>
									<p className="text-xs text-muted-foreground">
										Created {formatCreatedAt(agent.created_at)}
									</p>
								</div>
							))
						)}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}
