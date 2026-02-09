import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import type {GitCommit, GitCommitFileDiff, Repo} from '@/lib/types';
import {cn} from '@/lib/utils';

type GitHistoryViewProperties = {
	repo: Repo;
	commits: GitCommit[];
	selectedCommitHash: string | null;
	onSelectCommit: (hash: string) => void;
	isHistoryLoading: boolean;
	historyError: string | null;
	fileDiffs: GitCommitFileDiff[];
	isDiffLoading: boolean;
	diffError: string | null;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: 'auto',
});

function formatCommitDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	const elapsedSeconds = Math.round((Date.now() - date.getTime()) / 1000);
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		['year', 60 * 60 * 24 * 365],
		['month', 60 * 60 * 24 * 30],
		['week', 60 * 60 * 24 * 7],
		['day', 60 * 60 * 24],
		['hour', 60 * 60],
		['minute', 60],
		['second', 1],
	];

	for (const [unit, secondsPerUnit] of units) {
		if (Math.abs(elapsedSeconds) >= secondsPerUnit || unit === 'second') {
			const valueForUnit = Math.round(elapsedSeconds / secondsPerUnit);
			return relativeTimeFormatter.format(-valueForUnit, unit);
		}
	}

	return date.toLocaleString();
}

function getDiffLineClass(line: string) {
	if (line.startsWith('diff --git')) {
		return 'bg-muted/50 text-foreground font-medium';
	}

	if (line.startsWith('@@')) {
		return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
	}

	if (line.startsWith('+') && !line.startsWith('+++')) {
		return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
	}

	if (line.startsWith('-') && !line.startsWith('---')) {
		return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
	}

	if (line.startsWith('+++') || line.startsWith('---')) {
		return 'text-muted-foreground';
	}

	return 'text-foreground/90';
}

function DiffPreview({diff}: {diff: string}) {
	return (
		<div className="overflow-hidden rounded-b-md">
			{diff.split('\n').map((line, index) => (
				<div
					key={`${index}-${line.slice(0, 24)}`}
					className={cn(
						'px-3 py-0.5 font-mono text-xs leading-5 whitespace-pre-wrap wrap-break-word',
						getDiffLineClass(line),
					)}
				>
					{line}
				</div>
			))}
		</div>
	);
}

export function GitHistoryView({
	repo,
	commits,
	selectedCommitHash,
	onSelectCommit,
	isHistoryLoading,
	historyError,
	fileDiffs,
	isDiffLoading,
	diffError,
}: GitHistoryViewProperties) {
	const selectedCommit =
		commits.find(commit => commit.hash === selectedCommitHash) ?? undefined;

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden p-4 lg:flex-row">
			<div className="flex w-full shrink-0 flex-col rounded-md border lg:w-[24rem] lg:min-w-[20rem]">
				<div className="p-3">
					<p className="font-medium">Commit history</p>
					<p className="text-xs text-muted-foreground truncate">{repo.path}</p>
				</div>
				<Separator />
				<ScrollArea className="h-full">
					<div className="space-y-1 p-2">
						{isHistoryLoading ? (
							Array.from({length: 8}).map((_, index) => (
								<Skeleton key={index} className="h-16 w-full" />
							))
						) : historyError ? (
							<p className="p-2 text-sm text-destructive">{historyError}</p>
						) : commits.length === 0 ? (
							<p className="p-2 text-sm text-muted-foreground">
								No commits found for this repository.
							</p>
						) : (
							commits.map(commit => (
								<Button
									key={commit.hash}
									variant="ghost"
									className={cn(
										'h-auto w-full justify-start px-2 py-2 text-left',
										selectedCommitHash === commit.hash &&
											'bg-accent text-accent-foreground',
									)}
									onClick={() => onSelectCommit(commit.hash)}
								>
									<div className="w-full overflow-hidden">
										<p className="truncate text-sm font-medium">
											{commit.subject || '(no message)'}
										</p>
										<p className="truncate text-xs text-muted-foreground">
											{commit.short_hash} - {commit.author_name}
										</p>
										<p
											className="truncate text-xs text-muted-foreground"
											title={new Date(commit.author_date).toLocaleString()}
										>
											{formatCommitDate(commit.author_date)}
										</p>
									</div>
								</Button>
							))
						)}
					</div>
				</ScrollArea>
			</div>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border">
				<div className="p-3">
					<p className="font-medium">
						{selectedCommit
							? selectedCommit.subject || '(no message)'
							: 'Select a commit'}
					</p>
					{selectedCommit && (
						<p className="text-xs text-muted-foreground">
							{selectedCommit.short_hash} - {selectedCommit.author_name} (
							{selectedCommit.author_email})
						</p>
					)}
				</div>
				<Separator />
				<ScrollArea className="h-full">
					<div className="space-y-3 p-3">
						{selectedCommit ? (
							isDiffLoading ? (
								Array.from({length: 4}).map((_, index) => (
									<Skeleton key={index} className="h-40 w-full" />
								))
							) : diffError ? (
								<p className="text-sm text-destructive">{diffError}</p>
							) : fileDiffs.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No file changes were found for this commit.
								</p>
							) : (
								fileDiffs.map((fileDiff, index) => (
									<div
										key={`${fileDiff.path}-${index}`}
										className="rounded-md border"
									>
										<div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
											{fileDiff.path}
										</div>
										<DiffPreview diff={fileDiff.diff} />
									</div>
								))
							)
						) : (
							<p className="text-sm text-muted-foreground">
								Choose a commit from the list to view changed files and diffs.
							</p>
						)}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}
