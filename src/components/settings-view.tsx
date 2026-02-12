type SettingsViewProperties = {
	version: string | null;
	isVersionLoading: boolean;
	versionError: string | null;
};

export function SettingsView({
	version,
	isVersionLoading,
	versionError,
}: SettingsViewProperties) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b px-4 py-3">
				<h2 className="text-lg font-semibold">Settings</h2>
				<p className="text-sm text-muted-foreground">
					Application information and preferences.
				</p>
			</div>
			<div className="p-4">
				<div className="max-w-xl rounded-lg border bg-card p-4">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Application
					</p>
					<div className="mt-3 flex items-center justify-between gap-3">
						<span className="text-sm font-medium">Version</span>
						<span className="text-sm text-muted-foreground">
							{isVersionLoading
								? 'Loading...'
								: (version ?? (versionError ? 'Unavailable' : 'Unknown'))}
						</span>
					</div>
					{versionError && (
						<p className="mt-2 text-xs text-destructive">{versionError}</p>
					)}
				</div>
			</div>
		</div>
	);
}
