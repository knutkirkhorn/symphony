import {Button} from '@/components/ui/button';
import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {FolderGit2, Plus} from 'lucide-react';
import {toast} from 'sonner';

type EmptyStateProperties = {
	onReposChange: () => void;
};

async function handleAddRepo(onReposChange: () => void) {
	const selected = await open({
		directory: true,
		multiple: false,
		title: 'Select a Git repository',
	});

	if (!selected) {
		return;
	}

	try {
		await invoke('add_repo', {path: selected});
		toast.success('Repository added successfully');
		onReposChange();
	} catch (error) {
		toast.error(String(error));
	}
}

export function EmptyState({onReposChange}: EmptyStateProperties) {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="flex flex-col items-center gap-4 text-center">
				<div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
					<FolderGit2 className="size-8 text-muted-foreground" />
				</div>
				<div className="space-y-1.5">
					<h2 className="text-lg font-semibold">No repositories</h2>
					<p className="text-sm text-muted-foreground max-w-64">
						Add a Git repository to get started managing your repos and AI
						agents.
					</p>
				</div>
				<Button onClick={() => handleAddRepo(onReposChange)}>
					<Plus className="size-4" />
					Add Repository
				</Button>
			</div>
		</div>
	);
}
