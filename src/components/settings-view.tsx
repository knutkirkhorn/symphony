type SettingsViewProperties = {
	version: string | null;
	isVersionLoading: boolean;
	versionError: string | null;
	simulatorMode: boolean;
	onSimulatorModeChange: (enabled: boolean) => void;
};

export function SettingsView({
	version,
	isVersionLoading,
	versionError,
	simulatorMode,
	onSimulatorModeChange,
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
				<div className="mt-4 max-w-xl rounded-lg border bg-card p-4">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Agent testing
					</p>
					<div className="mt-3 flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-medium">Simulator mode</p>
							<p className="text-xs text-muted-foreground">
								Use the simulator script instead of Cursor Agent CLI.
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={simulatorMode}
							aria-label="Toggle simulator mode"
							className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
								simulatorMode
									? 'border-yellow-500 bg-yellow-400/80'
									: 'border-border bg-muted'
							}`}
							onClick={() => onSimulatorModeChange(!simulatorMode)}
						>
							<span
								className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
									simulatorMode ? 'translate-x-5' : 'translate-x-0'
								}`}
							/>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
