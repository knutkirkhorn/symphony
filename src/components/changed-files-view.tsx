import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import {invoke} from '@/lib/host-bridge';
import type {GitWorkingTreeFileChange, Repo} from '@/lib/types';
import {cn} from '@/lib/utils';
import {PatchDiff} from '@pierre/diffs/react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

type ChangedFilesViewProperties = {
	repo: Repo;
	isActive: boolean;
	onCommitted?: () => void;
};

export function ChangedFilesView({
	repo,
	isActive,
	onCommitted,
}: ChangedFilesViewProperties) {
	const [changedFiles, setChangedFiles] = useState<GitWorkingTreeFileChange[]>(
		[],
	);
	const [selectedFilePath, setSelectedFilePath] = useState<
		string | undefined
	>();
	const [selectedFileDiff, setSelectedFileDiff] = useState('');
	const [isChangedFilesLoading, setIsChangedFilesLoading] = useState(false);
	const [isFileDiffLoading, setIsFileDiffLoading] = useState(false);
	const [changedFilesError, setChangedFilesError] = useState<
		string | undefined
	>();
	const [fileDiffError, setFileDiffError] = useState<string | undefined>();
	const [commitMessage, setCommitMessage] = useState('');
	const [selectedFilesForCommit, setSelectedFilesForCommit] = useState<
		Set<string>
	>(new Set());
	const [isCommitting, setIsCommitting] = useState(false);
	const [refreshNonce, setRefreshNonce] = useState(0);
	const changedFilesRequestIdReference = useRef(0);
	const fileDiffRequestIdReference = useRef(0);
	const selectAllCheckboxReference = useRef<HTMLInputElement>(null);
	const allFilesSelected =
		changedFiles.length > 0 &&
		selectedFilesForCommit.size === changedFiles.length;
	const someFilesSelected =
		selectedFilesForCommit.size > 0 &&
		selectedFilesForCommit.size < changedFiles.length;

	useEffect(() => {
		if (selectAllCheckboxReference.current) {
			selectAllCheckboxReference.current.indeterminate = someFilesSelected;
		}
	}, [someFilesSelected]);

	useEffect(() => {
		if (!isActive) return;

		changedFilesRequestIdReference.current += 1;
		const requestId = changedFilesRequestIdReference.current;
		setIsChangedFilesLoading(true);
		setChangedFilesError(undefined);

		(async () => {
			try {
				const files = await invoke<GitWorkingTreeFileChange[]>(
					'list_working_tree_changes',
					{
						path: repo.path,
					},
				);
				if (requestId !== changedFilesRequestIdReference.current) return;
				setChangedFiles(files);
				setSelectedFilesForCommit(previous => {
					const next = new Set<string>();
					const existingPaths = new Set(files.map(file => file.path));
					for (const path of previous) {
						if (existingPaths.has(path)) {
							next.add(path);
						}
					}
					if (next.size === 0) {
						for (const file of files) {
							next.add(file.path);
						}
					}
					return next;
				});
				setSelectedFilePath(previous => {
					if (previous && files.some(file => file.path === previous)) {
						return previous;
					}
					return files[0]?.path ?? undefined;
				});
			} catch (error) {
				if (requestId !== changedFilesRequestIdReference.current) return;
				setChangedFiles([]);
				setSelectedFilesForCommit(new Set());
				setSelectedFilePath(undefined);
				setChangedFilesError(String(error));
			} finally {
				if (requestId === changedFilesRequestIdReference.current) {
					setIsChangedFilesLoading(false);
				}
			}
		})();
	}, [isActive, repo.path, refreshNonce]);

	useEffect(() => {
		if (!isActive) return;
		if (!selectedFilePath) {
			setSelectedFileDiff('');
			setFileDiffError(undefined);
			return;
		}

		fileDiffRequestIdReference.current += 1;
		const requestId = fileDiffRequestIdReference.current;
		setIsFileDiffLoading(true);
		setFileDiffError(undefined);
		setSelectedFileDiff('');

		(async () => {
			try {
				const diff = await invoke<string>('get_working_tree_file_diff', {
					path: repo.path,
					filePath: selectedFilePath,
				});
				if (requestId !== fileDiffRequestIdReference.current) return;
				setSelectedFileDiff(diff);
			} catch (error) {
				if (requestId !== fileDiffRequestIdReference.current) return;
				setFileDiffError(String(error));
			} finally {
				if (requestId === fileDiffRequestIdReference.current) {
					setIsFileDiffLoading(false);
				}
			}
		})();
	}, [isActive, repo.path, selectedFilePath]);

	async function handleCommit() {
		const message = commitMessage.trim();
		if (!message) return;
		const files = [...selectedFilesForCommit];
		if (files.length === 0) return;

		setIsCommitting(true);
		try {
			const output = await invoke<string>('commit_working_tree', {
				path: repo.path,
				message,
				files,
			});
			toast.success(output.split('\n')[0] || 'Commit created');
			setCommitMessage('');
			setRefreshNonce(previous => previous + 1);
			onCommitted?.();
		} catch (error) {
			toast.error(String(error));
		} finally {
			setIsCommitting(false);
		}
	}

	function toggleFileForCommit(path: string) {
		setSelectedFilesForCommit(previous => {
			const next = new Set(previous);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}

	function toggleAllFilesForCommit() {
		setSelectedFilesForCommit(previous => {
			const shouldSelectAll =
				changedFiles.length > 0 && previous.size !== changedFiles.length;
			if (!shouldSelectAll) {
				return new Set();
			}

			const next = new Set<string>();
			for (const file of changedFiles) {
				next.add(file.path);
			}
			return next;
		});
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden p-4 lg:flex-row">
			<div className="flex w-full shrink-0 flex-col rounded-md border lg:w-88 lg:min-w-[18rem]">
				<div className="p-3">
					<p className="font-medium">Changes</p>
					<p className="text-xs text-muted-foreground truncate">{repo.path}</p>
					<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
						<input
							ref={selectAllCheckboxReference}
							type="checkbox"
							className="size-4 cursor-pointer"
							checked={allFilesSelected}
							onChange={toggleAllFilesForCommit}
							disabled={changedFiles.length === 0}
							aria-label="Select all files for commit"
						/>
						<span>Select all files</span>
					</div>
				</div>
				<Separator />
				<ScrollArea className="h-full">
					<div className="space-y-1 p-2">
						{isChangedFilesLoading ? (
							Array.from({length: 8}).map((_, index) => (
								<Skeleton key={index} className="h-12 w-full" />
							))
						) : changedFilesError ? (
							<p className="p-2 text-sm text-destructive">
								{changedFilesError}
							</p>
						) : changedFiles.length === 0 ? (
							<p className="p-2 text-sm text-muted-foreground">
								No changes in this repository.
							</p>
						) : (
							changedFiles.map(file => (
								<div
									key={file.path}
									className={cn(
										'flex items-start gap-2 rounded-md px-2 py-2',
										selectedFilePath === file.path &&
											'bg-accent text-accent-foreground',
									)}
								>
									<input
										type="checkbox"
										className="mt-1 size-4 shrink-0 cursor-pointer"
										checked={selectedFilesForCommit.has(file.path)}
										onChange={() => toggleFileForCommit(file.path)}
										aria-label={`Select ${file.path} for commit`}
									/>
									<div
										role="button"
										tabIndex={0}
										className="w-full overflow-hidden text-left"
										onClick={() => setSelectedFilePath(file.path)}
										onKeyDown={event => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												setSelectedFilePath(file.path);
											}
										}}
									>
										<p className="truncate text-sm font-medium">{file.path}</p>
										<p className="truncate text-xs text-muted-foreground capitalize">
											{file.status}
										</p>
									</div>
								</div>
							))
						)}
					</div>
				</ScrollArea>
			</div>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
				<div className="space-y-3 p-3">
					<p className="font-medium">
						{selectedFilePath || 'Select a changed file'}
					</p>
					<div className="flex gap-2">
						<Input
							placeholder="Commit message"
							value={commitMessage}
							onChange={event => setCommitMessage(event.target.value)}
							disabled={isCommitting}
						/>
						<Button
							onClick={() => void handleCommit()}
							disabled={
								isCommitting ||
								!commitMessage.trim() ||
								selectedFilesForCommit.size === 0
							}
						>
							{isCommitting ? 'Committing...' : 'Commit'}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{selectedFilesForCommit.size} file
						{selectedFilesForCommit.size === 1 ? '' : 's'} selected for commit
					</p>
				</div>
				<Separator />
				<ScrollArea className="h-full">
					<div className="p-3">
						{selectedFilePath ? (
							isFileDiffLoading ? (
								<Skeleton className="h-60 w-full" />
							) : fileDiffError ? (
								<p className="text-sm text-destructive">{fileDiffError}</p>
							) : selectedFileDiff.trim().length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No textual diff available for this file.
								</p>
							) : (
								<div className="overflow-hidden rounded-md border">
									<PatchDiff
										patch={selectedFileDiff}
										options={{
											diffStyle: 'split',
											theme: 'github-light',
										}}
									/>
								</div>
							)
						) : (
							<p className="text-sm text-muted-foreground">
								Select a file from the list to preview its diff.
							</p>
						)}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}
