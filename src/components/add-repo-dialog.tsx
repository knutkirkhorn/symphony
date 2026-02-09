import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {invoke} from '@tauri-apps/api/core';
import {open as openDialog} from '@tauri-apps/plugin-dialog';
import {FolderOpen, GitBranchPlus} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {toast} from 'sonner';

type AddRepoDialogProperties = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onReposChange: () => void;
};

type AddRepoMode = 'local' | 'clone';

export function AddRepoDialog({
	open,
	onOpenChange,
	onReposChange,
}: AddRepoDialogProperties) {
	const [mode, setMode] = useState<AddRepoMode>('local');
	const [cloneUrl, setCloneUrl] = useState('');
	const [destinationParent, setDestinationParent] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (open) return;
		setMode('local');
		setCloneUrl('');
		setDestinationParent('');
		setIsSubmitting(false);
	}, [open]);

	const handleOpenLocalRepo = async () => {
		const selected = await openDialog({
			directory: true,
			multiple: false,
			title: 'Select a Git repository',
		});

		if (!selected) {
			return;
		}

		setIsSubmitting(true);
		try {
			await invoke('add_repo', {path: selected});
			toast.success('Repository added successfully');
			onReposChange();
			onOpenChange(false);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handlePickDestination = async () => {
		const selected = await openDialog({
			directory: true,
			multiple: false,
			title: 'Select a folder to clone into',
		});

		if (!selected) return;
		setDestinationParent(selected);
	};

	const handleCloneRepo = async (event: FormEvent) => {
		event.preventDefault();
		const trimmedUrl = cloneUrl.trim();
		const trimmedDestination = destinationParent.trim();
		if (!trimmedUrl || !trimmedDestination) return;

		setIsSubmitting(true);
		try {
			await invoke('clone_repo', {
				url: trimmedUrl,
				destinationParent: trimmedDestination,
			});
			toast.success('Repository cloned and added successfully');
			onReposChange();
			onOpenChange(false);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add repository</DialogTitle>
					<DialogDescription>
						Open an existing local repository or clone a new one from URL.
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant={mode === 'local' ? 'default' : 'outline'}
						onClick={() => setMode('local')}
						disabled={isSubmitting}
					>
						<FolderOpen className="size-4" />
						Open local
					</Button>
					<Button
						type="button"
						variant={mode === 'clone' ? 'default' : 'outline'}
						onClick={() => setMode('clone')}
						disabled={isSubmitting}
					>
						<GitBranchPlus className="size-4" />
						Clone from URL
					</Button>
				</div>

				{mode === 'local' ? (
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							Choose a local folder that already contains a Git repository.
						</p>
						<Button
							type="button"
							className="w-full"
							onClick={() => void handleOpenLocalRepo()}
							disabled={isSubmitting}
						>
							<FolderOpen className="size-4" />
							Select repository
						</Button>
					</div>
				) : (
					<form className="space-y-3" onSubmit={handleCloneRepo}>
						<Input
							value={cloneUrl}
							onChange={event => setCloneUrl(event.target.value)}
							placeholder="https://github.com/owner/repo.git"
							disabled={isSubmitting}
							autoFocus
						/>
						<div className="flex gap-2">
							<Input
								value={destinationParent}
								onChange={event => setDestinationParent(event.target.value)}
								placeholder="Destination folder"
								disabled={isSubmitting}
								className={cn('flex-1')}
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => void handlePickDestination()}
								disabled={isSubmitting}
							>
								Browse
							</Button>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isSubmitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={isSubmitting || !cloneUrl.trim() || !destinationParent.trim()}
							>
								Clone and add
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
