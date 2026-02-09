import {AddRepoDialog} from '@/components/add-repo-dialog';
import {Button} from '@/components/ui/button';
import {FolderGit2, Plus} from 'lucide-react';
import {useState} from 'react';

type EmptyStateProperties = {
	onReposChange: () => void;
};

export function EmptyState({onReposChange}: EmptyStateProperties) {
	const [isAddRepoOpen, setIsAddRepoOpen] = useState(false);

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
				<Button onClick={() => setIsAddRepoOpen(true)}>
					<Plus className="size-4" />
					Add Repository
				</Button>
				<AddRepoDialog
					open={isAddRepoOpen}
					onOpenChange={setIsAddRepoOpen}
					onReposChange={onReposChange}
				/>
			</div>
		</div>
	);
}
